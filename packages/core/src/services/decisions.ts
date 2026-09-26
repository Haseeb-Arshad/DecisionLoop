import { assumptionSpecSchema, type AssumptionSpecInput } from "../assumptions/model";
import {
  decisionDraftSchema,
  outcomeSchema,
  proposeAssumptionSchema,
  searchRequestSchema,
  type DecisionDraft,
  type DecisionDraftInput,
} from "../contracts";
import {
  ApprovalRequiredError,
  InvalidRequestError,
  NotFoundError,
  hasScope,
  requireHuman,
  requireScope,
} from "../errors";
import type { NewDecisionRecord } from "../ports/store";
import { bestResourceMatch, parseResource, type ResourceRef } from "../resources/resources";
import { scoreCandidates } from "../retrieval/scoring";
import type { DecisionStatus, DecisionWithDetails } from "../types/domain";
import type { Actor, ApprovalRequest } from "../types/records";
import {
  actorTypeForEvents,
  assumptionMemoryText,
  decisionMemoryText,
  namesMatch,
  sessionOf,
  silentLogger,
  type ServiceDeps,
} from "./shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE: DecisionStatus[] = ["ACTIVE", "AT_RISK", "REOPENED"];

export interface RelatedDecision {
  decisionId: string;
  title: string;
  externalRef: string | null;
  status: DecisionStatus;
  reasons: string[];
  /** True when the proposal chooses an option this decision explicitly rejected. */
  reintroducesRejectedAlternative: boolean;
}

export class DecisionService {
  constructor(private readonly deps: ServiceDeps) {}

  private get store() {
    return this.deps.store;
  }

  private toRecord(actor: Actor, draft: DecisionDraft, status: DecisionStatus, projectId: string): NewDecisionRecord {
    const resources: ResourceRef[] = draft.resources.map((r) => parseResource(r, draft.repository ?? null));
    if (draft.repository && !resources.some((r) => r.type === "repository")) {
      resources.push({ type: "repository", key: draft.repository.toLowerCase(), repository: null });
    }
    // A dependency constraint is about that package: record it as an
    // affected resource so a change to the package finds this decision.
    for (const c of draft.constraints) {
      if (c.rule.kind === "dependency_present" || c.rule.kind === "dependency_absent") {
        const ref = parseResource(c.rule.subject.replace(/^package:/i, ""));
        if (!resources.some((r) => r.type === ref.type && r.key === ref.key)) resources.push(ref);
      }
    }
    return {
      tenantId: actor.tenantId,
      projectId,
      title: draft.title,
      problemStatement: draft.problem ?? null,
      reasoning: draft.rationale ?? null,
      status,
      confidence: draft.confidence,
      importance: draft.importance,
      domain: draft.domain,
      scope: draft.scope ?? null,
      origin: actor.type === "user" ? "HUMAN" : actor.type === "agent" ? "AGENT" : "INTEGRATION",
      decidedByType: actor.type === "user" ? "USER" : actor.type === "agent" ? "AGENT" : "SYSTEM",
      decidedByLabel: actor.type === "user" ? null : actor.label,
      externalRef: draft.externalRef ?? null,
      tags: draft.tags,
      metadata: draft.supersedes ? { proposedSupersedes: draft.supersedes } : null,
      sourceRefs: draft.sourceRefs,
      createdBy: actor.userId,
      createdInSession: sessionOf(actor),
      agentSessionId: actor.agentSessionId ?? null,
      options: [
        { name: draft.chosenOption.name, description: draft.chosenOption.description ?? null, isChosen: true, rejectionReason: null },
        ...draft.alternatives.map((a) => ({
          name: a.name,
          description: a.description ?? null,
          isChosen: false,
          rejectionReason: a.rejectionReason ?? null,
        })),
      ],
      assumptions: draft.assumptions,
      resources,
      constraints: draft.constraints,
    };
  }

  /**
   * Existing live decisions a draft bears on: same resources, semantically
   * close, and — the important one — whether the draft chooses something an
   * earlier decision explicitly rejected.
   */
  async findRelated(tenantId: string, draft: DecisionDraft, excludeId?: string): Promise<RelatedDecision[]> {
    const reasons = new Map<string, Set<string>>();
    const add = (id: string, reason: string) => {
      if (id === excludeId) return;
      if (!reasons.has(id)) reasons.set(id, new Set());
      reasons.get(id)!.add(reason);
    };

    const requested = draft.resources.map((r) => parseResource(r, draft.repository ?? null));
    if (requested.length > 0) {
      const recorded = await this.store.listResourcesForMatching(tenantId, { statuses: LIVE });
      const byDecision = new Map<string, ResourceRef[]>();
      for (const r of recorded) {
        const list = byDecision.get(r.decisionId) ?? [];
        list.push({ type: r.resourceType, key: r.resourceKey, repository: r.repository });
        byDecision.set(r.decisionId, list);
      }
      for (const [id, refs] of byDecision) {
        const match = bestResourceMatch(refs, requested);
        if (match.score >= 0.7) add(id, `affects the same ${match.recorded!.type} (${match.recorded!.key})`);
      }
    }

    const query = `${draft.title}. Chosen: ${draft.chosenOption.name}. ${draft.rationale ?? ""}`;
    const [embedding] = await this.deps.embeddings.embed([query]);
    if (embedding) {
      const { candidates } = await this.store.searchMemory(tenantId, embedding, {
        limit: 10,
        sourceType: "decision",
        embeddingModel: this.deps.embeddings.modelName,
      });
      for (const c of candidates) {
        if (c.decisionId && c.similarity >= 0.35) add(c.decisionId, `similar decision (similarity ${c.similarity.toFixed(2)})`);
      }
    }

    if (reasons.size === 0) return [];
    const decisions = await this.store.listDecisions(tenantId, { ids: Array.from(reasons.keys()), statuses: LIVE });
    return decisions.map((d) => {
      const rejected = d.options.find((o) => !o.isChosen && namesMatch(o.name, draft.chosenOption.name));
      const r = reasons.get(d.id)!;
      if (rejected) {
        r.add(
          `chooses "${draft.chosenOption.name}", which ${d.externalRef ?? "this decision"} rejected` +
            (rejected.rejectionReason ? ` because: ${rejected.rejectionReason}` : ""),
        );
      }
      return {
        decisionId: d.id,
        title: d.title,
        externalRef: d.externalRef,
        status: d.status,
        reasons: Array.from(r),
        reintroducesRejectedAlternative: Boolean(rejected),
      };
    });
  }

  /**
   * A non-authoritative candidate (spec §8, §12): stored as DRAFT, never
   * returned as active context, and paired with an approval request that a
   * person resolves.
   */
  async propose(actor: Actor, input: DecisionDraftInput) {
    requireScope(actor, "propose");
    const draft = decisionDraftSchema.parse(input);
    const project = await this.store.getOrCreateDefaultProject(actor.tenantId);
    const related = await this.findRelated(actor.tenantId, draft);
    const conflicting = related.filter((r) => r.reintroducesRejectedAlternative);

    const { decision, approval } = await this.store.transaction(async (tx) => {
      const decision = await tx.insertDecision(this.toRecord(actor, draft, "DRAFT", project.id));
      if (draft.dependsOn.length) {
        await tx.insertDependencies(
          actor.tenantId,
          decision.id,
          draft.dependsOn.map((id) => ({ targetType: "DECISION" as const, targetId: id, relationship: "DEPENDS_ON" })),
        );
      }
      const reason = conflicting.length
        ? `Possible conflict: ${conflicting.map((c) => `${c.externalRef ?? c.title} — ${c.reasons.join("; ")}`).join(" | ")}`
        : related.length
          ? `Related to ${related.map((r) => r.externalRef ?? r.title).join(", ")}.`
          : "New decision proposed; no related decisions found.";
      const { approval } = await tx.insertApproval({
        tenantId: actor.tenantId,
        kind: "COMMIT_DECISION",
        decisionId: decision.id,
        relatedDecisionIds: related.map((r) => r.decisionId),
        payload: { related, supersedes: draft.supersedes ?? null },
        reason,
        requestedByType: actor.type,
        requestedByLabel: actor.label,
        agentSessionId: actor.agentSessionId ?? null,
        dedupeKey: `commit:${decision.id}`,
      });
      await tx.recordMemoryEvent({
        tenantId: actor.tenantId,
        projectId: decision.projectId,
        entityType: "decision",
        entityId: decision.id,
        decisionId: decision.id,
        eventType: "DECISION_PROPOSED",
        actorType: actorTypeForEvents(actor),
        actorUserId: actor.userId,
        summary: `${actor.label} proposed "${decision.title}".`,
        metadata: { approvalId: approval.id, related: related.map((r) => r.decisionId) },
      });
      for (const r of conflicting) {
        await tx.recordMemoryEvent({
          tenantId: actor.tenantId,
          entityType: "approval",
          entityId: approval.id,
          decisionId: r.decisionId,
          eventType: "APPROVAL_REQUESTED",
          actorType: actorTypeForEvents(actor),
          summary: `A proposal (${decision.title}) ${r.reasons.join("; ").replace(/\.+$/, "")}.`,
          metadata: { proposalId: decision.id },
        });
      }
      await tx.recordAudit({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        action: "decision.proposed",
        entityType: "decision",
        entityId: decision.id,
        metadata: { approvalId: approval.id },
      });
      return { decision, approval };
    });

    return { decision, approval, related };
  }

  /** Human-authored decision committed directly (the 1.x "Commit Decision" path). */
  async create(actor: Actor, input: DecisionDraftInput) {
    requireHuman(actor, "commit a decision");
    const draft = decisionDraftSchema.parse(input);
    const project = await this.store.getOrCreateDefaultProject(actor.tenantId);
    const decision = await this.store.transaction(async (tx) => {
      const d = await tx.insertDecision(this.toRecord(actor, draft, "ACTIVE", project.id));
      if (draft.dependsOn.length) {
        await tx.insertDependencies(
          actor.tenantId,
          d.id,
          draft.dependsOn.map((id) => ({ targetType: "DECISION" as const, targetId: id })),
        );
      }
      await this.recordCommitted(tx, actor, d);
      return d;
    });
    await this.indexOrQueue(actor.tenantId, decision.id);
    if (draft.supersedes) await this.supersede(actor, draft.supersedes, decision.id, "Superseded at creation.");
    return (await this.store.getDecision(actor.tenantId, decision.id))!;
  }

  private async recordCommitted(tx: ServiceDeps["store"], actor: Actor, d: DecisionWithDetails) {
    await tx.recordMemoryEvent({
      tenantId: actor.tenantId,
      projectId: d.projectId,
      entityType: "decision",
      entityId: d.id,
      decisionId: d.id,
      eventType: "DECISION_COMMITTED",
      actorType: actorTypeForEvents(actor),
      actorUserId: actor.userId,
      summary: `Committed "${d.title}" with ${d.assumptions.length} assumption(s), ${d.resources?.length ?? 0} resource(s).`,
      metadata: { chosenOption: d.options.find((o) => o.isChosen)?.name ?? null },
    });
    for (const a of d.assumptions) {
      await tx.recordMemoryEvent({
        tenantId: actor.tenantId,
        projectId: d.projectId,
        entityType: "assumption",
        entityId: a.id,
        decisionId: d.id,
        eventType: "MEMORY_CREATED",
        actorType: actorTypeForEvents(actor),
        actorUserId: actor.userId,
        summary: a.statement,
        metadata: { normalized: a.normalizedStatement, valueType: a.valueType },
      });
    }
    await tx.recordAudit({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorLabel: actor.label,
      action: "decision.committed",
      entityType: "decision",
      entityId: d.id,
    });
  }

  /**
   * DRAFT → ACTIVE. Only a person with write scope; an agent asking gets an
   * approval request back instead (spec §8).
   */
  async commit(actor: Actor, decisionId: string, opts: { approvalId?: string | null; note?: string | null } = {}) {
    const decision = await this.store.getDecision(actor.tenantId, decisionId);
    if (!decision) throw new NotFoundError("Decision");
    if (actor.type !== "user" || !hasScope(actor, "write")) {
      requireScope(actor, "propose");
      const { approval } = await this.store.insertApproval({
        tenantId: actor.tenantId,
        kind: "COMMIT_DECISION",
        decisionId,
        reason: `${actor.label} asked to commit "${decision.title}"; commits require a person.`,
        requestedByType: actor.type,
        requestedByLabel: actor.label,
        agentSessionId: actor.agentSessionId ?? null,
        dedupeKey: `commit:${decisionId}`,
      });
      throw new ApprovalRequiredError("Committing a decision requires human approval.", approval.id);
    }
    if (decision.status !== "DRAFT") {
      throw new InvalidRequestError(`Decision is ${decision.status}; only DRAFT decisions can be committed.`);
    }

    await this.store.transaction(async (tx) => {
      await tx.updateDecisionStatus(actor.tenantId, decisionId, "ACTIVE");
      const pending = opts.approvalId
        ? await tx.getApproval(actor.tenantId, opts.approvalId)
        : (await tx.listApprovals(actor.tenantId, { decisionId, status: "PENDING" })).find((a) => a.kind === "COMMIT_DECISION");
      if (pending && (pending.status === "PENDING" || pending.status === "NEEDS_EVIDENCE")) {
        await tx.resolveApproval(actor.tenantId, pending.id, "APPROVED", { userId: actor.userId, label: actor.label, note: opts.note });
      }
      await tx.markDecisionReviewed(actor.tenantId, decisionId);
      await this.recordCommitted(tx, actor, { ...decision, status: "ACTIVE" });
    });
    await this.indexOrQueue(actor.tenantId, decisionId);
    return (await this.store.getDecision(actor.tenantId, decisionId))!;
  }

  /** Embedding happens outside any transaction; failure leaves a durable retry job. */
  async indexOrQueue(tenantId: string, decisionId: string): Promise<void> {
    try {
      await this.indexMemory(tenantId, decisionId);
    } catch (err) {
      (this.deps.logger ?? silentLogger).warn({ err, decisionId }, "memory indexing failed; queued for retry");
      await this.store.setMemoryIndexStatus(tenantId, decisionId, "FAILED", err instanceof Error ? err.message : String(err));
      await this.store.enqueueJob({
        tenantId,
        kind: "index_decision",
        payload: { tenantId, decisionId },
        dedupeKey: `index:${decisionId}:${Date.now()}`,
      });
    }
  }

  async indexMemory(tenantId: string, decisionId: string): Promise<number> {
    const d = await this.store.getDecision(tenantId, decisionId);
    if (!d) throw new NotFoundError("Decision");
    const units = [
      { sourceType: "decision" as const, sourceId: d.id, text: decisionMemoryText(d), importance: d.importance, authority: 0.9 },
      ...d.assumptions.map((a) => ({
        sourceType: "assumption" as const,
        sourceId: a.id,
        text: assumptionMemoryText(d, a),
        importance: a.importance,
        authority: a.authorityScore,
      })),
    ];
    const vectors = await this.deps.embeddings.embed(units.map((u) => u.text));
    const written = await this.store.replaceDecisionMemory(
      tenantId,
      d.id,
      units.map((u, i) => ({
        sourceType: u.sourceType,
        sourceId: u.sourceId,
        content: u.text,
        embedding: vectors[i]!,
        embeddingModel: this.deps.embeddings.modelName,
        importance: u.importance,
        authorityScore: u.authority,
        originSessionId: d.createdInSession,
      })),
    );
    await this.store.setMemoryIndexStatus(tenantId, d.id, "INDEXED");
    return written;
  }

  async reject(actor: Actor, decisionId: string, note: string | null) {
    requireHuman(actor, "reject a proposal");
    await this.store.transaction(async (tx) => {
      await tx.updateDecisionStatus(actor.tenantId, decisionId, "ARCHIVED", { riskExplanation: null });
      await tx.recordMemoryEvent({
        tenantId: actor.tenantId,
        entityType: "decision",
        entityId: decisionId,
        decisionId,
        eventType: "DECISION_REJECTED",
        actorType: "USER",
        actorUserId: actor.userId,
        summary: note || "Proposal rejected.",
      });
    });
  }

  async supersede(actor: Actor, oldId: string, newId: string, note?: string | null) {
    requireHuman(actor, "supersede a decision");
    if (oldId === newId) throw new InvalidRequestError("A decision cannot supersede itself.");
    const [old, replacement] = await Promise.all([
      this.store.getDecision(actor.tenantId, oldId),
      this.store.getDecision(actor.tenantId, newId),
    ]);
    if (!old) throw new NotFoundError("Decision to supersede");
    if (!replacement) throw new NotFoundError("Replacement decision");

    await this.store.transaction(async (tx) => {
      await tx.updateDecisionStatus(actor.tenantId, oldId, "SUPERSEDED", {
        riskExplanation: old.riskExplanation,
        supersededByDecisionId: newId,
      });
      // True-as-recorded, no longer live: SUPERSEDED, not INVALIDATED.
      for (const a of old.assumptions) {
        if (a.validityStatus !== "INVALIDATED") {
          await tx.setAssumptionValidity(actor.tenantId, a.id, "SUPERSEDED");
        }
      }
      await tx.insertDependencies(actor.tenantId, newId, [
        { targetType: "DECISION", targetId: oldId, relationship: "SUPERSEDES", importance: 1 },
      ]);
      // Nothing is left to decide about a replaced decision: its open
      // conflicts resolve as SUPERSEDED and pending reviews close, so the
      // approval queue only holds questions that still matter.
      const by = { userId: actor.userId, label: actor.label, note: `Decision superseded by ${replacement.externalRef ?? replacement.title}.` };
      for (const c of await tx.listConflicts(actor.tenantId, { decisionId: oldId, unresolvedOnly: true })) {
        await tx.resolveConflict(actor.tenantId, c.id, "SUPERSEDED", by);
      }
      for (const status of ["PENDING", "NEEDS_EVIDENCE"] as const) {
        for (const a of await tx.listApprovals(actor.tenantId, { status, decisionId: oldId })) {
          await tx.resolveApproval(actor.tenantId, a.id, "SUPERSEDED_OLD", by);
        }
      }
      await tx.recordMemoryEvent({
        tenantId: actor.tenantId,
        projectId: old.projectId,
        entityType: "decision",
        entityId: oldId,
        decisionId: oldId,
        eventType: "DECISION_SUPERSEDED",
        actorType: "USER",
        actorUserId: actor.userId,
        summary: note || `Superseded by "${replacement.title}".`,
        metadata: { supersededByDecisionId: newId },
      });
      await tx.recordAudit({
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        action: "decision.superseded",
        entityType: "decision",
        entityId: oldId,
        metadata: { supersededByDecisionId: newId },
      });
    });
    return (await this.store.getDecision(actor.tenantId, oldId))!;
  }

  async get(actor: Actor, idOrRef: string): Promise<DecisionWithDetails> {
    requireScope(actor, "read");
    const d = UUID_RE.test(idOrRef)
      ? await this.store.getDecision(actor.tenantId, idOrRef)
      : await this.store.getDecisionByExternalRef(actor.tenantId, idOrRef);
    if (!d) throw new NotFoundError("Decision");
    return d;
  }

  /** Full history: decision, timeline, conflicts, evaluations, evidence, dependencies. */
  async history(actor: Actor, idOrRef: string) {
    const decision = await this.get(actor, idOrRef);
    const [timeline, conflicts, evaluations, dependencies, dependents] = await Promise.all([
      this.store.listMemoryEvents(actor.tenantId, decision.id),
      this.store.listConflicts(actor.tenantId, { decisionId: decision.id }),
      this.store.listEvaluations(actor.tenantId, { decisionId: decision.id, limit: 50 }),
      this.store.listDependencies(actor.tenantId, { decisionIds: [decision.id] }),
      this.store.listDependencies(actor.tenantId, { targetIds: [decision.id, ...decision.assumptions.map((a) => a.id)] }),
    ]);
    const evidenceIds = Array.from(
      new Set(evaluations.map((e) => e.evidenceItemId).filter((id): id is string => Boolean(id))),
    );
    const evidence = (
      await Promise.all(evidenceIds.slice(0, 20).map((id) => this.store.getEvidence(actor.tenantId, id)))
    ).filter((e): e is NonNullable<typeof e> => Boolean(e));
    return { decision, timeline, conflicts, evaluations, evidence, dependencies, dependents };
  }

  /** Why the decision exists, with citations — the `decisionloop_explain` answer. */
  async explain(actor: Actor, idOrRef: string) {
    const h = await this.history(actor, idOrRef);
    const d = h.decision;
    const chosen = d.options.find((o) => o.isChosen);
    const lines: string[] = [
      `${d.externalRef ? `${d.externalRef}: ` : ""}${d.title} [${d.status}]`,
      chosen ? `Chose ${chosen.name}.` : "",
      d.problemStatement ? `Problem: ${d.problemStatement}` : "",
      d.reasoning ? `Why: ${d.reasoning}` : "",
      ...d.options
        .filter((o) => !o.isChosen)
        .map((o) => `Rejected ${o.name}${o.rejectionReason ? `: ${o.rejectionReason}` : "."}`),
      ...d.assumptions.map((a) => `Assumes (${a.validityStatus}): ${a.statement}`),
      ...(d.constraints ?? []).map((c) => `Constraint: ${c.statement}`),
      `Decided by ${d.decidedByType === "USER" ? "a person" : (d.decidedByLabel ?? d.decidedByType)} (${d.origin}) on ${d.createdAt.slice(0, 10)}.`,
      ...d.sourceRefs.map((s) => `Source: ${s.type} ${s.ref}`),
      ...h.conflicts.map(
        (c) =>
          `Evidence ${c.resolution ? `(${c.resolution})` : "(unresolved)"}: ${c.factStatement}${c.sourceQuote ? ` — "${c.sourceQuote}"` : ""}`,
      ),
      d.supersededByDecisionId ? `Superseded by ${d.supersededByDecisionId}.` : "",
    ].filter(Boolean);
    return { ...h, explanation: lines.join("\n") };
  }

  async search(actor: Actor, input: unknown) {
    requireScope(actor, "read");
    const req = searchRequestSchema.parse(input);
    const byRef = await this.store.getDecisionByExternalRef(actor.tenantId, req.query.trim());
    const [embedding] = await this.deps.embeddings.embed([req.query]);
    const { candidates } = await this.store.searchMemory(actor.tenantId, embedding!, {
      limit: 30,
      embeddingModel: this.deps.embeddings.modelName,
    });
    const scored = scoreCandidates(candidates, { selectTopK: 30, signals: { sessionId: actor.sessionId ?? null } });
    const best = new Map<string, number>();
    for (const c of scored) {
      if (!c.decisionId) continue;
      best.set(c.decisionId, Math.max(best.get(c.decisionId) ?? 0, c.finalScore));
    }
    if (byRef) best.set(byRef.id, 2);
    const statuses = req.statuses ?? (["ACTIVE", "AT_RISK", "REOPENED"] as DecisionStatus[]);
    const decisions = await this.store.listDecisions(actor.tenantId, { ids: Array.from(best.keys()), statuses });
    return decisions
      .map((d) => ({ decision: d, score: best.get(d.id) ?? 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, req.limit);
  }

  async listAtRisk(actor: Actor, limit = 20) {
    requireScope(actor, "read");
    const decisions = await this.store.listDecisions(actor.tenantId, { statuses: ["AT_RISK", "REOPENED"], limit });
    const conflicts = await this.store.listConflicts(actor.tenantId, {
      decisionIds: decisions.map((d) => d.id),
      unresolvedOnly: true,
    });
    return decisions.map((d) => ({
      decision: d,
      compromisedAssumptions: d.assumptions.filter((a) => a.validityStatus === "CHALLENGED" || a.validityStatus === "INVALIDATED"),
      openConflicts: conflicts.filter((c) => c.decisionId === d.id),
    }));
  }

  async recordOutcome(actor: Actor, input: unknown) {
    requireScope(actor, "propose");
    const o = outcomeSchema.parse(input);
    const d = await this.store.getDecision(actor.tenantId, o.decisionId);
    if (!d) throw new NotFoundError("Decision");
    return this.store.transaction(async (tx) => {
      const outcome = await tx.insertOutcome({
        tenantId: actor.tenantId,
        decisionId: d.id,
        summary: o.summary,
        sentiment: o.sentiment,
        recordedBy: actor.userId,
      });
      await tx.recordMemoryEvent({
        tenantId: actor.tenantId,
        projectId: d.projectId,
        entityType: "decision",
        entityId: d.id,
        decisionId: d.id,
        eventType: "OUTCOME_RECORDED",
        actorType: actorTypeForEvents(actor),
        actorUserId: actor.userId,
        summary: `${o.sentiment}: ${o.summary}`,
        metadata: { recordedBy: actor.label },
      });
      return outcome;
    });
  }

  /** Agents propose assumptions for review; a person with write scope adds them directly. */
  async proposeAssumption(actor: Actor, input: unknown): Promise<{ approval?: ApprovalRequest; assumptionId?: string }> {
    requireScope(actor, "propose");
    const req = proposeAssumptionSchema.parse(input);
    const d = await this.store.getDecision(actor.tenantId, req.decisionId);
    if (!d) throw new NotFoundError("Decision");
    if (actor.type === "user" && hasScope(actor, "write")) {
      const a = await this.store.addAssumption(actor.tenantId, d.id, req.assumption);
      await this.indexOrQueue(actor.tenantId, d.id);
      return { assumptionId: a.id };
    }
    const { approval } = await this.store.insertApproval({
      tenantId: actor.tenantId,
      kind: "ADD_ASSUMPTION",
      decisionId: d.id,
      payload: { assumption: req.assumption as unknown as AssumptionSpecInput },
      reason: req.reason ?? `${actor.label} proposes: ${req.assumption.statement}`,
      requestedByType: actor.type,
      requestedByLabel: actor.label,
      agentSessionId: actor.agentSessionId ?? null,
    });
    await this.store.recordMemoryEvent({
      tenantId: actor.tenantId,
      entityType: "approval",
      entityId: approval.id,
      decisionId: d.id,
      eventType: "ASSUMPTION_PROPOSED",
      actorType: actorTypeForEvents(actor),
      summary: req.assumption.statement,
    });
    return { approval };
  }

  async addApprovedAssumption(actor: Actor, decisionId: string, spec: unknown) {
    requireHuman(actor, "add an assumption");
    const a = await this.store.addAssumption(actor.tenantId, decisionId, assumptionSpecSchema.parse(spec));
    await this.indexOrQueue(actor.tenantId, decisionId);
    return a;
  }
}
