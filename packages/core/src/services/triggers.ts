import crypto from "node:crypto";
import { evaluateAssumption, type DeterministicEvaluation } from "../assumptions/evaluate";
import { factSchema, type Fact } from "../assumptions/facts";
import { canonicalForm, normalizeKey } from "../assumptions/model";
import { evidenceSubmissionSchema } from "../contracts";
import { NotFoundError, requireScope } from "../errors";
import { inboundEventSchema, type EmittedEvent, type InboundEventInput, type StoredEvent } from "../events/event";
import { resolveEvaluationOutcome, type EvaluationOutcome } from "../lifecycle/outcome";
import { mergePolicies } from "../policy/policy";
import { ReasoningUnavailableError } from "../ports/providers";
import { bestResourceMatch, parseResource, type ResourceRef } from "../resources/resources";
import { scoreCandidates } from "../retrieval/scoring";
import type { Assumption, DecisionStatus, DecisionWithDetails, EvidenceRelation, ScoredMemoryCandidate } from "../types/domain";
import type { Actor, EvaluationMethod, EvidenceItem } from "../types/records";
import { withRun, type RunContext, type ServiceDeps } from "./shared";

const LIVE: DecisionStatus[] = ["ACTIVE", "AT_RISK", "REOPENED"];
const LIVE_VALIDITY = new Set(["VALID", "UNCERTAIN", "CHALLENGED"]);

/** Limits that keep one event's cost bounded no matter how large the workspace is. */
const MAX_CANDIDATE_ASSUMPTIONS = 30;
const MAX_SEMANTIC_JUDGMENTS = 6;
const MIN_SEMANTIC_SIMILARITY = 0.2;
const MIN_SEMANTIC_FINAL = 0.35;
const MIN_SCORE_FOR_MODEL = 0.5;
const MIN_RESOURCE_MATCH = 0.7;

/** Default authority when neither the receiving surface nor a domain pack sets one. */
const SOURCE_AUTHORITY: Record<string, number> = {
  human: 0.8,
  api: 0.6,
  agent: 0.5,
  document: 0.6,
};

/** Agents can raise challenges; their own reports never carry invalidating authority. */
const AGENT_AUTHORITY_CAP = 0.5;

export interface EvaluationSummary {
  assumptionId: string;
  decisionId: string;
  decisionTitle: string;
  statement: string;
  method: EvaluationMethod;
  relation: EvidenceRelation;
  previousValidity: string;
  nextValidity: string | null;
  via: string;
  explanation: string;
}

export interface TriggerResult {
  eventId: string;
  evidenceId: string | null;
  duplicateOfEvidenceId: string | null;
  authority: number;
  facts: Fact[];
  factsFromModel: number;
  resources: ResourceRef[];
  candidatesConsidered: number;
  evaluations: EvaluationSummary[];
  conflictIds: string[];
  decisionsAtRisk: string[];
  approvalIds: string[];
  constraintFindings: Array<{ findingId: string; decisionId: string; constraintId: string; statement: string; explanation: string }>;
  relatedDecisionIds: string[];
  emitted: EmittedEvent[];
  memoryTraceId: string | null;
}

interface Candidate {
  assumption: Assumption;
  decision: DecisionWithDetails;
  score: number;
  via: "predicate" | "resource" | "semantic";
  chunkId?: string;
}

export class EvidenceService {
  constructor(private readonly deps: ServiceDeps) {}

  /**
   * Accepts evidence from a person, agent or integration as a canonical
   * event. Evaluation happens asynchronously on the worker (spec §6: "Do not
   * hide important changes inside synchronous HTTP requests").
   */
  async submit(actor: Actor, input: unknown, opts: { receivedVia?: string } = {}) {
    requireScope(actor, "propose");
    const req = evidenceSubmissionSchema.parse(input);
    const resources = req.resources.map((r) => parseResource(r, req.repository ?? null));
    const text = [req.statement, req.text].filter(Boolean).join("\n\n");
    const source = actor.type === "agent" ? "agent" : actor.type === "user" ? "human" : "api";
    const externalId =
      req.idempotencyKey ??
      crypto
        .createHash("sha256")
        .update(JSON.stringify({ text, facts: req.facts, resources }))
        .digest("hex");

    const event = inboundEventSchema.parse({
      source,
      externalId,
      type: "evidence.submitted",
      occurredAt: req.occurredAt ?? new Date().toISOString(),
      actor: { type: actor.type, id: actor.userId ?? actor.apiKeyId ?? null, label: actor.label },
      resources: repository(resources, req.repository),
      facts: req.facts.map((f) => ({ ...f, extractor: f.extractor ?? `${source}-supplied` })),
      text,
      subject: req.subject ?? null,
      evidenceKind: actor.type === "user" && req.kind === "OBSERVATION" ? "HUMAN_STATEMENT" : req.kind,
      payload: { sourceRef: req.sourceRef ?? null, agentSessionId: actor.agentSessionId ?? null },
      provenance: {
        receivedVia: opts.receivedVia ?? "api",
        url: req.sourceRef ?? null,
        // Authority is set here, by the authenticated surface — never by the payload.
        authority: actor.type === "agent" ? AGENT_AUTHORITY_CAP : (SOURCE_AUTHORITY[source] ?? 0.6),
      },
    });
    return this.ingest(actor.tenantId, event);
  }

  /** Idempotent: a replayed event (webhook retry) returns the original and enqueues nothing. */
  async ingest(tenantId: string, event: InboundEventInput): Promise<{ event: StoredEvent; created: boolean; jobId: string | null }> {
    const parsed = inboundEventSchema.parse(event);
    const { event: stored, created } = await this.deps.store.insertEvent(tenantId, parsed);
    if (!created) return { event: stored, created, jobId: null };
    const { job } = await this.deps.store.enqueueJob({
      tenantId,
      kind: "process_event",
      payload: { tenantId, eventId: stored.id },
      dedupeKey: `event:${stored.id}`,
    });
    return { event: stored, created, jobId: job.id };
  }
}

function repository(resources: ResourceRef[], repo: string | null | undefined): ResourceRef[] {
  if (!repo || resources.some((r) => r.type === "repository")) return resources;
  return [...resources, { type: "repository", key: repo.toLowerCase(), repository: null }];
}

function dedupeResources(list: ResourceRef[]): ResourceRef[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const k = `${r.type}|${r.key}|${r.repository ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export class TriggerEngine {
  constructor(private readonly deps: ServiceDeps) {}

  /** Processes one inbox event. Safe to call repeatedly (job retries). */
  async process(tenantId: string, eventId: string): Promise<TriggerResult> {
    const store = this.deps.store;
    const event = await store.getEvent(tenantId, eventId);
    if (!event) throw new NotFoundError("Event");
    if (event.status === "PROCESSED" && event.result) return event.result as unknown as TriggerResult;

    await store.updateEventStatus(tenantId, eventId, "PROCESSING", { incrementAttempts: true });
    try {
      const { result } = await withRun(
        store,
        {
          tenantId,
          sessionId: `event:${event.source}`,
          intent: "TRIGGER_EVALUATION",
          request: `${event.source} ${event.type} (${event.externalId})`,
          eventId,
          agentSessionId: (event.payload.agentSessionId as string | null | undefined) ?? null,
        },
        async (ctx) => {
          const result = await this.evaluate(event, ctx);
          ctx.details = {
            evidenceId: result.evidenceId,
            conflicts: result.conflictIds.length,
            decisionsAtRisk: result.decisionsAtRisk,
            findings: result.constraintFindings.length,
          };
          return {
            result,
            summary:
              `${result.evaluations.length} assumption check(s); ${result.conflictIds.length} conflict(s); ` +
              `${result.decisionsAtRisk.length} decision(s) at risk; ${result.constraintFindings.length} constraint finding(s).`,
          };
        },
      );
      await store.updateEventStatus(tenantId, eventId, "PROCESSED", { result: result as unknown as Record<string, unknown> });
      return result;
    } catch (err) {
      await store
        .updateEventStatus(tenantId, eventId, "FAILED", { error: err instanceof Error ? err.message : String(err) })
        .catch(() => undefined);
      throw err;
    }
  }

  private authorityFor(event: StoredEvent): number {
    const base =
      event.provenance.authority ?? this.deps.domains.authorityFor(event) ?? SOURCE_AUTHORITY[event.source] ?? 0.6;
    return event.actor.type === "agent" ? Math.min(base, AGENT_AUTHORITY_CAP) : base;
  }

  private async evaluate(event: StoredEvent, ctx: RunContext): Promise<TriggerResult> {
    const { store, embeddings, reasoning, domains } = this.deps;
    const tenantId = event.workspaceId;
    const reasoningLog: string[] = [];
    const emitted: EmittedEvent[] = [];
    const evalOptions = domains.evaluateOptions();

    // ── 1. Normalize: deterministic facts and resources from the payload ──
    const packOut = domains.extract(event);
    const resources = dedupeResources([...event.resources, ...packOut.resources]);
    let facts: Fact[] = [...event.facts, ...packOut.facts];
    const authority = this.authorityFor(event);
    reasoningLog.push(
      `Event ${event.source}/${event.type}: ${facts.length} structured fact(s), ${resources.length} resource(s), authority ${authority.toFixed(2)}.`,
    );

    // ── 2. Affected decisions by structure (resources) ─────────────────────
    const decisionsById = new Map<string, DecisionWithDetails>();
    const resourceMatched = new Map<string, number>();
    if (resources.length > 0) {
      const recorded = await store.listResourcesForMatching(tenantId, { statuses: LIVE });
      const byDecision = new Map<string, ResourceRef[]>();
      for (const r of recorded) {
        const list = byDecision.get(r.decisionId) ?? [];
        list.push({ type: r.resourceType, key: r.resourceKey, repository: r.repository });
        byDecision.set(r.decisionId, list);
      }
      for (const [id, refs] of byDecision) {
        // A shared repository alone is too weak to call a decision affected.
        const match = bestResourceMatch(refs.filter((r) => r.type !== "repository"), resources);
        if (match.score >= MIN_RESOURCE_MATCH) resourceMatched.set(id, match.score);
      }
    }

    // ── 3. Semantic retrieval over assumptions (no decision id given) ──────
    const queries = [
      ...facts.slice(0, 10).map((f) => f.statement),
      ...(event.text ? [event.text.slice(0, 1500)] : []),
    ];
    const allCandidates: ScoredMemoryCandidate[] = [];
    let renderedSql: string | null = null;
    if (queries.length > 0) {
      const vectors = await embeddings.embed(queries);
      for (const v of vectors) {
        const found = await store.searchMemory(tenantId, v, { limit: 8, sourceType: "assumption", embeddingModel: embeddings.modelName });
        renderedSql ??= found.renderedSql;
        ctx.stats.retrievalLatencyMs += found.latencyMs;
        ctx.stats.retrieved += found.candidates.length;
        allCandidates.push(
          ...scoreCandidates(found.candidates, {
            selectTopK: 3,
            minFinalScore: MIN_SEMANTIC_FINAL,
            signals: { sessionId: `event:${event.source}` },
          }),
        );
      }
    }
    const semantic = allCandidates.filter((c) => c.selectedForContext && c.semanticScore >= MIN_SEMANTIC_SIMILARITY);

    // ── 4. Model fact extraction from untrusted text, if a model exists ────
    let factsFromModel = 0;
    if (event.text && reasoning.name !== "none") {
      const decisionIds = new Set([...resourceMatched.keys(), ...semantic.map((c) => c.decisionId).filter(Boolean)] as string[]);
      const hintDecisions = decisionIds.size ? await store.listDecisions(tenantId, { ids: Array.from(decisionIds), statuses: LIVE }) : [];
      const hints = hintDecisions.flatMap((d) => d.assumptions);
      try {
        const extracted = await reasoning.extractFacts(event.text, {
          predicates: Array.from(new Set(hints.map((a) => a.predicate).filter((p): p is string => Boolean(p)))).slice(0, 40),
          subjects: Array.from(new Set(hints.map((a) => a.subject).filter((s): s is string => Boolean(s)))).slice(0, 40),
        });
        factsFromModel = extracted.length;
        facts = [...facts, ...extracted];
        reasoningLog.push(`Model ${reasoning.name} extracted ${extracted.length} fact(s) from the evidence text.`);
      } catch (err) {
        reasoningLog.push(`Fact extraction failed (${err instanceof Error ? err.message : String(err)}); continuing with structured facts only.`);
      }
    }

    // ── 5. Immutable evidence item ─────────────────────────────────────────
    const content = event.text ?? facts.map((f) => f.statement).join("\n");
    const contentHash = crypto.createHash("sha256").update(`${content}\n${JSON.stringify(facts)}`).digest("hex");
    const { evidence, created: evidenceCreated } = await store.insertEvidence({
      tenantId,
      projectId: null,
      eventId: event.id,
      // Set only by the server's own document pipeline; the store re-checks
      // that the document belongs to this workspace.
      documentId: typeof event.payload.documentId === "string" ? event.payload.documentId : null,
      kind: event.evidenceKind,
      source: event.source,
      sourceRef: (event.provenance.url as string | null) ?? event.externalId,
      subject: event.subject ?? null,
      authority,
      confidence: 1,
      occurredAt: event.occurredAt,
      content: content.slice(0, 20_000),
      contentHash,
      facts,
      resources,
      provenance: { ...event.provenance, eventId: event.id, eventType: event.type, externalId: event.externalId },
      actor: event.actor,
    });
    const duplicateOf = !evidenceCreated && evidence.eventId !== event.id ? evidence.id : null;
    if (duplicateOf) {
      reasoningLog.push(`Identical evidence already recorded (${duplicateOf}); not re-evaluated, so no duplicate conflicts.`);
      return this.finish(event, ctx, {
        evidence, duplicateOf, authority, facts, factsFromModel, resources, candidates: [], evaluations: [],
        conflictIds: [], atRisk: [], approvals: [], findings: [], related: [], emitted, reasoningLog, allCandidates, renderedSql, usedChunkIds: [],
      });
    }

    // ── 6. Candidate assumptions: predicate, resource, semantic ────────────
    const predicateHits = await store.findAssumptionsByPredicates(
      tenantId,
      facts.map((f) => {
        const k = normalizeKey(f.predicate)!;
        return evalOptions.predicateAliases?.[k] ?? k;
      }),
    );
    const neededDecisions = new Set<string>([
      ...predicateHits.map((a) => a.decisionId),
      ...resourceMatched.keys(),
      ...(semantic.map((c) => c.decisionId).filter(Boolean) as string[]),
    ]);
    for (const d of neededDecisions.size ? await store.listDecisions(tenantId, { ids: Array.from(neededDecisions), statuses: LIVE }) : []) {
      decisionsById.set(d.id, d);
    }

    const candidates = new Map<string, Candidate>();
    const consider = (assumption: Assumption, score: number, via: Candidate["via"], chunkId?: string) => {
      const decision = decisionsById.get(assumption.decisionId);
      if (!decision || !LIVE_VALIDITY.has(assumption.validityStatus)) return;
      const existing = candidates.get(assumption.id);
      if (!existing || existing.score < score) candidates.set(assumption.id, { assumption, decision, score, via, chunkId });
    };
    for (const a of predicateHits) consider(a, 1, "predicate");
    for (const [decisionId, score] of resourceMatched) {
      for (const a of decisionsById.get(decisionId)?.assumptions ?? []) consider(a, score * 0.9, "resource");
    }
    for (const c of semantic) {
      const d = c.decisionId ? decisionsById.get(c.decisionId) : undefined;
      const a = d?.assumptions.find((x) => x.id === c.sourceId);
      if (a) consider(a, c.finalScore, "semantic", c.chunkId);
    }
    const ranked = Array.from(candidates.values()).sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATE_ASSUMPTIONS);
    reasoningLog.push(
      `${ranked.length} candidate assumption(s): ${predicateHits.length} by predicate, ${resourceMatched.size} decision(s) by resource, ${semantic.length} by retrieval.`,
    );

    // ── 7. Evaluate: deterministic first, model only when needed ───────────
    const alreadyEvaluated = new Set((await store.listEvaluations(tenantId, { eventId: event.id, limit: 500 })).map((e) => e.assumptionId));
    const workspacePolicies = mergePolicies(this.deps.defaultPolicies, await store.listWorkspacePolicies(tenantId));
    const evaluations: EvaluationSummary[] = [];
    const conflictIds: string[] = [];
    const atRisk = new Set<string>();
    const approvals: string[] = [];
    const usedChunkIds: string[] = [];
    let semanticBudget = MAX_SEMANTIC_JUDGMENTS;

    for (const cand of ranked) {
      if (alreadyEvaluated.has(cand.assumption.id)) continue;
      const judged = await this.judge(cand, facts, event, evalOptions, () => semanticBudget-- > 0);
      if (!judged) continue;
      if (cand.chunkId) usedChunkIds.push(cand.chunkId);
      reasoningLog.push(
        `[${cand.via} ${cand.score.toFixed(2)}] "${cand.assumption.statement}" → ${judged.method} ${judged.relation}: ${judged.explanation}`,
      );

      const outcome: EvaluationOutcome | null =
        judged.method === "DETERMINISTIC" || judged.method === "SEMANTIC"
          ? resolveEvaluationOutcome({
              relation: judged.relation,
              confidence: judged.confidence,
              method: judged.method,
              evidenceAuthority: authority,
              assumptionAuthority: cand.assumption.authorityScore,
              assumptionImportance: cand.assumption.importance,
              currentValidity: cand.assumption.validityStatus,
              decisionImportance: cand.decision.importance,
              source: event.source,
              actorType: event.actor.type,
              affectedResourceTypes: (cand.decision.resources ?? []).map((r) => r.resourceType),
              domain: cand.decision.domain,
              policies: workspacePolicies,
            })
          : null;
      if (outcome) reasoningLog.push(`   outcome: ${outcome.reasons.join(" ")}`);

      const applied = await this.apply(event, evidence, cand, judged, outcome, authority, ctx);
      evaluations.push({
        assumptionId: cand.assumption.id,
        decisionId: cand.decision.id,
        decisionTitle: cand.decision.title,
        statement: cand.assumption.statement,
        method: judged.method,
        relation: judged.relation,
        previousValidity: cand.assumption.validityStatus,
        nextValidity: outcome?.nextValidity ?? null,
        via: cand.via,
        explanation: judged.explanation,
      });
      if (applied.conflictId) conflictIds.push(applied.conflictId);
      if (applied.flagged) atRisk.add(cand.decision.id);
      approvals.push(...applied.approvalIds);
      emitted.push(...applied.emitted);
    }

    // ── 8. Constraints the evidence may violate ────────────────────────────
    const findings: TriggerResult["constraintFindings"] = [];
    const constraintDecisions = new Set<string>([...resourceMatched.keys(), ...predicateHits.map((a) => a.decisionId)]);
    for (const decisionId of constraintDecisions) {
      const d = decisionsById.get(decisionId);
      for (const constraint of d?.constraints ?? []) {
        const check = domains.evaluateConstraint(constraint, { facts, resources });
        if (!check?.violated) continue;
        const finding = await store.transaction(async (tx) => {
          const { finding, created } = await tx.insertConstraintFinding({
            tenantId,
            decisionId,
            constraintId: constraint.id,
            eventId: event.id,
            evidenceItemId: evidence.id,
            explanation: check.explanation,
          });
          if (created) {
            await tx.recordMemoryEvent({
              tenantId,
              entityType: "decision",
              entityId: decisionId,
              decisionId,
              eventType: "CONSTRAINT_VIOLATION_SUSPECTED",
              agentRunId: ctx.run.id,
              actorType: "AGENT",
              summary: check.explanation,
              metadata: { constraintId: constraint.id, eventId: event.id, evidenceId: evidence.id, findingId: finding.id },
            });
          }
          return finding;
        });
        findings.push({ findingId: finding.id, decisionId, constraintId: constraint.id, statement: constraint.statement, explanation: check.explanation });
        emitted.push({ type: "constraint.violated", workspaceId: tenantId, decisionId, constraintId: constraint.id, causedByEventId: event.id, summary: check.explanation });
        reasoningLog.push(`Constraint "${constraint.statement}" on ${d!.externalRef ?? d!.title}: ${check.explanation}`);
      }
    }

    ctx.stats.conflicts += conflictIds.length;
    return this.finish(event, ctx, {
      evidence, duplicateOf: null, authority, facts, factsFromModel, resources, candidates: ranked, evaluations,
      conflictIds, atRisk: Array.from(atRisk), approvals, findings,
      related: Array.from(new Set([...resourceMatched.keys(), ...ranked.map((c) => c.decision.id)])),
      emitted, reasoningLog, allCandidates, renderedSql, usedChunkIds,
    });
  }

  private async judge(
    cand: Candidate,
    facts: Fact[],
    event: StoredEvent,
    evalOptions: ReturnType<ServiceDeps["domains"]["evaluateOptions"]>,
    takeSemanticBudget: () => boolean,
  ): Promise<{ method: EvaluationMethod; relation: EvidenceRelation; confidence: number; explanation: string; fact: Fact | null; oldValue?: string; newValue?: string; quote?: string | null } | null> {
    const a = cand.assumption;
    const evaluable = {
      statement: a.statement,
      subject: a.subject,
      predicate: a.predicate,
      valueType: a.valueType,
      operator: a.operatorV2,
      expected: a.expected,
      unit: a.unit,
    };

    // Deterministic: prefer a contradiction if several facts evaluate.
    const results: Array<{ fact: Fact; r: Extract<DeterministicEvaluation, { status: "EVALUATED" }> }> = [];
    const reasons: string[] = [];
    for (const fact of facts) {
      const r = evaluateAssumption(evaluable, fact, evalOptions);
      if (r.status === "EVALUATED") results.push({ fact, r });
      else reasons.push(r.reason);
    }
    const decisive = results.find((x) => x.r.relation === "CONTRADICTS") ?? results[0];
    if (decisive) {
      return {
        method: "DETERMINISTIC",
        relation: decisive.r.relation,
        confidence: decisive.r.confidence,
        explanation: decisive.r.explanation,
        fact: decisive.fact,
        oldValue: decisive.r.expectedText,
        newValue: decisive.r.observedText,
        quote: decisive.fact.quote ?? null,
      };
    }

    if (a.verificationPolicy === "MANUAL") {
      return cand.via === "semantic"
        ? null
        : { method: "SKIPPED", relation: "UNCERTAIN", confidence: 0, explanation: "Manual verification policy: flagged for a person, not evaluated automatically.", fact: null };
    }

    // A fact about this exact predicate that deterministic evaluation
    // declined (different subject, incompatible unit) is evidence that the
    // pair is NOT comparable — escalating it to a model would invite a false
    // contradiction.
    const aPred = a.predicate ? (evalOptions.predicateAliases?.[normalizeKey(a.predicate)!] ?? normalizeKey(a.predicate)) : null;
    const samePredicate = aPred
      ? facts.find((f) => {
          const k = normalizeKey(f.predicate)!;
          return (evalOptions.predicateAliases?.[k] ?? k) === aPred;
        })
      : undefined;
    if (samePredicate && a.valueType !== "TEXT") {
      return cand.via === "semantic"
        ? null
        : { method: "SKIPPED", relation: "IRRELEVANT", confidence: 0, explanation: `Same predicate but not comparable: ${reasons[0] ?? "declined"}`, fact: samePredicate };
    }

    const eligible = cand.via !== "semantic" || cand.score >= MIN_SCORE_FOR_MODEL;
    if (!eligible || (!event.text && facts.length === 0)) return null;
    if (!takeSemanticBudget()) {
      return { method: "SKIPPED", relation: "UNCERTAIN", confidence: 0, explanation: "Semantic judgment budget for this event exhausted.", fact: null };
    }

    const fact = facts[0] ?? null;
    try {
      const j = await this.deps.reasoning.judge({
        decisionTitle: cand.decision.title,
        assumption: {
          statement: a.statement,
          subject: a.subject,
          predicate: a.predicate,
          structured: canonicalForm({ ...evaluable, operator: a.operatorV2 }),
        },
        fact: facts.length === 1 ? fact : null,
        evidenceText: event.text ?? facts.map((f) => f.statement).join("\n"),
      });
      return { method: "SEMANTIC", relation: j.relation, confidence: j.confidence, explanation: j.explanation, fact, quote: j.quote };
    } catch (err) {
      const unavailable = err instanceof ReasoningUnavailableError;
      return {
        method: "UNAVAILABLE",
        relation: "UNCERTAIN",
        confidence: 0,
        explanation: unavailable
          ? "Needs semantic evaluation, but no reasoning model is configured. Recorded for review; memory unchanged."
          : `Semantic evaluation failed: ${err instanceof Error ? err.message : String(err)}. Memory unchanged.`,
        fact,
      };
    }
  }

  /**
   * One transaction per assumption: the evaluation record, and any conflict,
   * validity change, decision status change, approval request and memory
   * events it causes, commit together or not at all (docs/v2 §4.2).
   */
  private async apply(
    event: StoredEvent,
    evidence: EvidenceItem,
    cand: Candidate,
    judged: NonNullable<Awaited<ReturnType<TriggerEngine["judge"]>>>,
    outcome: EvaluationOutcome | null,
    authority: number,
    ctx: RunContext,
  ): Promise<{ conflictId: string | null; flagged: boolean; approvalIds: string[]; emitted: EmittedEvent[] }> {
    const tenantId = event.workspaceId;
    const { assumption, decision } = cand;
    const emitted: EmittedEvent[] = [];

    return this.deps.store.transaction(async (tx) => {
      const evaluation = await tx.insertEvaluation({
        tenantId,
        agentRunId: ctx.run.id,
        eventId: event.id,
        evidenceItemId: evidence.id,
        assumptionId: assumption.id,
        decisionId: decision.id,
        fact: judged.fact,
        method: judged.method,
        relation: judged.relation,
        confidence: judged.confidence,
        evidenceAuthority: authority,
        assumptionAuthority: assumption.authorityScore,
        previousValidity: assumption.validityStatus,
        nextValidity: outcome?.nextValidity ?? null,
        decisionFlagged: Boolean(outcome?.recordConflict && outcome.flagDecision),
        matchedPolicies: outcome?.matchedRules ?? [],
        actions: outcome?.actions ?? [],
        explanation: [judged.explanation, ...(outcome?.reasons ?? [])].join(" "),
        retrievalScore: cand.score,
      });
      await tx.touchAssumptionEvaluated(tenantId, [assumption.id]);

      if (!outcome) return { conflictId: null, flagged: false, approvalIds: [], emitted };

      if (outcome.recordSupport) {
        await tx.linkEvidenceToDecision({
          tenantId,
          decisionId: decision.id,
          assumptionId: assumption.id,
          evidenceItemId: evidence.id,
          evidenceType: "SUPPORTING",
          relevance: cand.score,
          excerpt: judged.quote ?? judged.fact?.statement ?? null,
        });
        await tx.recordMemoryEvent({
          tenantId,
          projectId: decision.projectId,
          entityType: "assumption",
          entityId: assumption.id,
          decisionId: decision.id,
          eventType: "ASSUMPTION_SUPPORTED",
          agentRunId: ctx.run.id,
          actorType: "AGENT",
          summary: judged.explanation,
          metadata: { evidenceId: evidence.id, evaluationId: evaluation.id, eventId: event.id },
          dedupeKey: `support:${evidence.id}:${assumption.id}`,
        });
        emitted.push({ type: "assumption.supported", workspaceId: tenantId, decisionId: decision.id, assumptionId: assumption.id, causedByEventId: event.id, summary: judged.explanation });
      }

      if (!outcome.recordConflict) return { conflictId: null, flagged: false, approvalIds: [], emitted };

      const { conflict, created } = await tx.insertConflict({
        tenantId,
        decisionId: decision.id,
        assumptionId: assumption.id,
        evidenceItemId: evidence.id,
        eventId: event.id,
        evaluationId: evaluation.id,
        agentRunId: ctx.run.id,
        factStatement: judged.fact?.statement ?? (event.text ?? "").slice(0, 500),
        explanation: judged.explanation,
        conflictType: judged.method === "DETERMINISTIC" ? "VALUE_CHANGED" : "EVIDENCE_CONTRADICTS",
        relation: judged.relation === "UPDATES" ? "UPDATES" : "CONTRADICTS",
        confidence: judged.confidence,
        oldValue: judged.oldValue ?? null,
        newValue: judged.newValue ?? null,
        sourceQuote: judged.quote ?? judged.fact?.quote ?? null,
        detectionMethod: judged.method === "DETERMINISTIC" ? "DETERMINISTIC" : "SEMANTIC",
      });
      if (!created) return { conflictId: conflict.id, flagged: false, approvalIds: [], emitted };

      await tx.linkEvidenceToDecision({
        tenantId,
        decisionId: decision.id,
        assumptionId: assumption.id,
        evidenceItemId: evidence.id,
        evidenceType: "CONTRADICTING",
        relevance: cand.score,
        excerpt: judged.quote ?? judged.fact?.statement ?? null,
      });

      if (outcome.nextValidity) {
        await tx.setAssumptionValidity(tenantId, assumption.id, outcome.nextValidity, { evidenceItemId: evidence.id });
        await tx.recordMemoryEvent({
          tenantId,
          projectId: decision.projectId,
          entityType: "assumption",
          entityId: assumption.id,
          decisionId: decision.id,
          eventType: outcome.nextValidity === "INVALIDATED" ? "ASSUMPTION_INVALIDATED" : "ASSUMPTION_CHALLENGED",
          agentRunId: ctx.run.id,
          actorType: "AGENT",
          summary: judged.explanation,
          metadata: {
            conflictId: conflict.id,
            evaluationId: evaluation.id,
            evidenceId: evidence.id,
            eventId: event.id,
            evidenceAuthority: authority,
            policies: outcome.matchedRules,
          },
        });
        emitted.push({
          type: outcome.nextValidity === "INVALIDATED" ? "assumption.invalidated" : "assumption.challenged",
          workspaceId: tenantId,
          decisionId: decision.id,
          assumptionId: assumption.id,
          conflictId: conflict.id,
          causedByEventId: event.id,
          summary: judged.explanation,
        });
      }

      let flagged = false;
      if (outcome.flagDecision) {
        // Re-read inside the transaction: an earlier assumption in this same
        // event may already have flagged the decision.
        const current = await tx.getDecision(tenantId, decision.id);
        if (current && (current.status === "ACTIVE" || current.status === "REOPENED")) {
          await tx.updateDecisionStatus(tenantId, decision.id, "AT_RISK", { riskExplanation: judged.explanation });
          await tx.recordMemoryEvent({
            tenantId,
            projectId: decision.projectId,
            entityType: "decision",
            entityId: decision.id,
            decisionId: decision.id,
            eventType: "DECISION_AT_RISK",
            agentRunId: ctx.run.id,
            actorType: "AGENT",
            summary: judged.explanation,
            metadata: { conflictId: conflict.id, assumptionId: assumption.id, eventId: event.id },
          });
          await tx.recordAudit({
            tenantId,
            actorLabel: "system",
            action: "decision.marked_at_risk",
            entityType: "decision",
            entityId: decision.id,
            metadata: { conflictId: conflict.id, eventId: event.id, evidenceId: evidence.id },
          });
          emitted.push({ type: "decision.at_risk", workspaceId: tenantId, decisionId: decision.id, conflictId: conflict.id, causedByEventId: event.id, summary: judged.explanation });
        }
        flagged = true;
      }

      const approvalIds: string[] = [];
      if (outcome.requireReview) {
        const { approval, created: newApproval } = await tx.insertApproval({
          tenantId,
          kind: "REVIEW_CONFLICT",
          decisionId: decision.id,
          conflictId: conflict.id,
          reason: `Evidence ${outcome.nextValidity === "INVALIDATED" ? "invalidates" : "challenges"} "${assumption.statement}" behind ${decision.externalRef ?? decision.title}: ${judged.explanation}`,
          requestedByType: "system",
          requestedByLabel: "trigger-engine",
          payload: { policies: outcome.matchedRules, eventId: event.id },
          dedupeKey: `review:${conflict.id}`,
        });
        approvalIds.push(approval.id);
        if (newApproval) {
          emitted.push({ type: "approval.required", workspaceId: tenantId, decisionId: decision.id, approvalId: approval.id, conflictId: conflict.id, causedByEventId: event.id, summary: approval.reason });
        }
      }
      for (const channel of outcome.notify) {
        emitted.push({ type: "notification.requested", workspaceId: tenantId, decisionId: decision.id, conflictId: conflict.id, causedByEventId: event.id, summary: `[${channel}] ${decision.externalRef ?? decision.title}: ${judged.explanation}` });
      }
      return { conflictId: conflict.id, flagged, approvalIds, emitted };
    });
  }

  private async finish(
    event: StoredEvent,
    ctx: RunContext,
    x: {
      evidence: EvidenceItem;
      duplicateOf: string | null;
      authority: number;
      facts: Fact[];
      factsFromModel: number;
      resources: ResourceRef[];
      candidates: Candidate[];
      evaluations: EvaluationSummary[];
      conflictIds: string[];
      atRisk: string[];
      approvals: string[];
      findings: TriggerResult["constraintFindings"];
      related: string[];
      emitted: EmittedEvent[];
      reasoningLog: string[];
      allCandidates: ScoredMemoryCandidate[];
      renderedSql: string | null;
      usedChunkIds: string[];
    },
  ): Promise<TriggerResult> {
    const tenantId = event.workspaceId;
    // The Memory Inspector's record of this run: every retrieved candidate
    // with its real scores, which were used, and the full reasoning log —
    // including the runs where nothing changed.
    const trace = await this.deps.store.recordTrace({
      tenantId,
      agentRunId: ctx.run.id,
      actionType: "trigger_evaluation",
      relatedDecisionId: x.atRisk[0] ?? null,
      queryText: `${event.source} ${event.type}: ${(event.text ?? x.facts.map((f) => f.statement).join("; ")).slice(0, 500)}`,
      renderedSql: x.renderedSql,
      candidates: x.allCandidates,
      usedChunkIds: Array.from(new Set(x.usedChunkIds)),
      llmReasoning: x.reasoningLog.join("\n"),
      retrievalLatencyMs: ctx.stats.retrievalLatencyMs || null,
    });
    await this.deps.store.recordRetrievalEvents({ tenantId, agentRunId: ctx.run.id, memoryTraceId: trace.id, candidates: x.allCandidates });

    return {
      eventId: event.id,
      evidenceId: x.evidence.id,
      duplicateOfEvidenceId: x.duplicateOf,
      authority: x.authority,
      facts: x.facts.map((f) => factSchema.parse(f)),
      factsFromModel: x.factsFromModel,
      resources: x.resources,
      candidatesConsidered: x.candidates.length,
      evaluations: x.evaluations,
      conflictIds: x.conflictIds,
      decisionsAtRisk: x.atRisk,
      approvalIds: x.approvals,
      constraintFindings: x.findings,
      relatedDecisionIds: x.related,
      emitted: x.emitted,
      memoryTraceId: trace.id,
    };
  }
}
