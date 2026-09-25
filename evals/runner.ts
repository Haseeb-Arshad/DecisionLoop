import { normalizeKey } from "@decisionloop/core/assumptions/model";
import type { SemanticJudgment, ReasoningProvider } from "@decisionloop/core/ports/providers";
import { createDecisionLoop, type DecisionLoop } from "@decisionloop/core/services/index";
import { drainJobs } from "@decisionloop/core/services/worker";
import type { Actor } from "@decisionloop/core/types/records";
import type { DecisionWithDetails } from "@decisionloop/core/types/domain";
import { LexicalEmbeddingProvider, selectReasoningProvider } from "@decisionloop/providers";
import { createSql } from "@decisionloop/storage-sql/connection";
import { SqlDecisionStore } from "@decisionloop/storage-sql/store";
import { CASES, DECISIONS, DEPENDENCIES, OTHER_TENANT_DECISION, SUPERSESSIONS, type ContextCase, type EvidenceCase } from "./dataset";

/**
 * Behavioural evaluation runner (spec §27). Seeds a realistic workspace,
 * runs every case through the real services and database, and scores what
 * DecisionLoop actually did — not whether unit tests pass.
 *
 * Semantic judgments come from a scripted stand-in model unless
 * `useConfiguredModel` is set, so category E measures the pipeline (does a
 * qualitative contradiction reach a model and get applied correctly), not
 * model quality. Deterministic categories need no model at all.
 */

export interface CaseResult {
  id: string;
  category: string;
  pass: boolean;
  notes: string[];
  latencyMs: number;
  tokens?: number;
  modelCalls?: number;
}

export interface EvalReport {
  generatedAt: string;
  model: string;
  cases: CaseResult[];
  metrics: {
    retrievalRecall: number;
    retrievalPrecision: number;
    firstHitRate: number;
    forbiddenHits: number;
    conflictPrecision: number;
    conflictRecall: number;
    falseAlertRate: number;
    findingPrecision: number;
    findingRecall: number;
    tenantLeaks: number;
    contextTokensAvg: number;
    contextTokensMax: number;
    contextLatencyP50: number;
    contextLatencyP95: number;
    evidenceLatencyP50: number;
    evidenceLatencyP95: number;
    modelCallsPerEvidence: number;
    /** Needs human decisions from real use; see evals/dogfood. */
    approvalAcceptanceRate: null;
    humanOverrideRate: null;
  };
}

class ScriptedModel implements ReasoningProvider {
  readonly name = "scripted-stand-in";
  calls = 0;
  async extractFacts() {
    return [];
  }
  async judge(input: Parameters<ReasoningProvider["judge"]>[0]): Promise<SemanticJudgment> {
    this.calls += 1;
    const text = (input.evidenceText ?? "").toLowerCase();
    if (/european hosting/i.test(input.assumption.statement) && /discontinu/.test(text) && /eu hosting/.test(text)) {
      return { relation: "CONTRADICTS", confidence: 0.9, explanation: "The vendor is discontinuing EU hosting.", quote: "discontinue EU hosting" };
    }
    return { relation: "IRRELEVANT", confidence: 0.9, explanation: "The evidence is about something else.", quote: "" };
  }
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

const ratio = (n: number, d: number) => (d === 0 ? 1 : n / d);

function actors(tenantId: string) {
  const base = { tenantId, userId: null, sessionId: "eval" } as const;
  return {
    human: { ...base, type: "user", label: "eval-human", scopes: ["admin"] } as Actor,
    agent: { ...base, type: "agent", label: "eval-agent", scopes: ["read", "propose"] } as Actor,
    integration: { ...base, type: "integration", label: "eval-integration", scopes: ["read", "propose"] } as Actor,
  };
}

async function seed(loop: DecisionLoop, tenantId: string, drafts = DECISIONS) {
  const { human } = actors(tenantId);
  const byRef = new Map<string, DecisionWithDetails>();
  for (const draft of drafts) {
    const deps = DEPENDENCIES.filter(([dependent]) => dependent === draft.externalRef).map(([, on]) => byRef.get(on)!.id);
    byRef.set(draft.externalRef!, await loop.decisions.create(human, { ...draft, dependsOn: deps }));
  }
  for (const [oldRef, newRef] of SUPERSESSIONS) {
    if (byRef.has(oldRef) && byRef.has(newRef)) await loop.decisions.supersede(human, byRef.get(oldRef)!.id, byRef.get(newRef)!.id);
  }
  return byRef;
}

export async function runEvaluation(opts: { databaseUrl: string; useConfiguredModel?: boolean }): Promise<EvalReport> {
  const sql = createSql(opts.databaseUrl, { max: 1 });
  const scripted = new ScriptedModel();
  const reasoning = opts.useConfiguredModel ? selectReasoningProvider() : scripted;
  const loop = createDecisionLoop({ store: new SqlDecisionStore(sql), embeddings: new LexicalEmbeddingProvider(), reasoning });
  const worker = loop.createWorker({ workerId: "eval" });
  const tenant = await loop.store.createWorkspace("Eval Co");
  const other = await loop.store.createWorkspace("Other Co");

  try {
    const decisions = await seed(loop, tenant.id);
    await seed(loop, other.id, [OTHER_TENANT_DECISION]);
    const idToRef = new Map(Array.from(decisions.entries()).map(([ref, d]) => [d.id, ref]));

    const assumptionId = async (ref: string): Promise<string> => {
      const [decisionRef, key] = ref.split(":") as [string, string];
      const d = await loop.store.getDecision(tenant.id, decisions.get(decisionRef)!.id);
      const a = key.startsWith("#") ? d!.assumptions[Number(key.slice(1))] : d!.assumptions.find((x) => x.predicate === normalizeKey(key));
      if (!a) throw new Error(`Dataset references unknown assumption ${ref}`);
      return a.id;
    };

    const results: CaseResult[] = [];
    const retrieval = { hits: 0, expected: 0, returnedRelevant: 0, returned: 0, firstHits: 0, firstExpected: 0, forbidden: 0 };
    const conflicts = { tp: 0, fp: 0, fn: 0 };
    const findings = { tp: 0, fp: 0, fn: 0 };
    let quietCases = 0;
    let falseAlerts = 0;
    let leaks = 0;
    const tokens: number[] = [];
    const ctxLatency: number[] = [];
    const evLatency: number[] = [];
    const modelCalls: number[] = [];

    for (const c of CASES) {
      if (c.kind === "context") results.push(await runContext(c));
      else results.push(await runEvidence(c));
    }

    async function runContext(c: ContextCase): Promise<CaseResult> {
      const notes: string[] = [];
      const tenantId = c.otherTenant ? other.id : tenant.id;
      const started = Date.now();
      const ctx = await loop.context.getContext(actors(tenantId).agent, { intent: c.intent, resources: c.resources, repository: c.repository ?? null });
      const latencyMs = Date.now() - started;
      ctxLatency.push(latencyMs);
      tokens.push(ctx.tokenEstimate);
      const returnedRefs = ctx.decisions.map((d) => idToRef.get(d.id) ?? `(foreign:${d.externalRef ?? d.title})`);

      if (c.otherTenant) {
        const leaked = ctx.decisions.filter((d) => idToRef.has(d.id));
        leaks += leaked.length;
        if (leaked.length) notes.push(`LEAK: ${leaked.map((d) => d.externalRef).join(", ")}`);
        return { id: c.id, category: c.category, pass: leaked.length === 0, notes, latencyMs, tokens: ctx.tokenEstimate };
      }

      for (const ref of c.expect) {
        retrieval.expected += 1;
        if (returnedRefs.includes(ref)) retrieval.hits += 1;
        else notes.push(`missed ${ref}`);
      }
      retrieval.returned += returnedRefs.length;
      retrieval.returnedRelevant += returnedRefs.filter((r) => c.expect.includes(r)).length;
      if (c.expectFirst) {
        retrieval.firstExpected += 1;
        if (returnedRefs[0] === c.expectFirst) retrieval.firstHits += 1;
        else notes.push(`first was ${returnedRefs[0] ?? "(none)"}, expected ${c.expectFirst}`);
      }
      for (const ref of c.forbid ?? []) {
        const idx = returnedRefs.indexOf(ref);
        // For B cases a forbidden decision may appear lower, but never first.
        const bad = c.category === "B_similar_not_dominant" && c.expectFirst ? idx === 0 : idx !== -1;
        if (bad) {
          retrieval.forbidden += 1;
          notes.push(`forbidden ${ref} at rank ${idx + 1}`);
        }
      }
      if (returnedRefs.length) notes.push(`returned ${returnedRefs.join(", ")}`);
      return { id: c.id, category: c.category, pass: !notes.some((n) => /missed|first was|forbidden/.test(n)), notes, latencyMs, tokens: ctx.tokenEstimate };
    }

    async function runEvidence(c: EvidenceCase): Promise<CaseResult> {
      const notes: string[] = [];
      const tenantId = c.otherTenant ? other.id : tenant.id;
      const callsBefore = scripted.calls;
      const started = Date.now();
      const submitted = c.submit
        ? await loop.evidence.submit(actors(tenantId)[c.submit.as], c.submit.input)
        : await loop.evidence.ingest(tenantId, c.event!);
      await drainJobs(worker);
      const latencyMs = Date.now() - started;
      evLatency.push(latencyMs);
      modelCalls.push(scripted.calls - callsBefore);

      const evaluations = await loop.store.listEvaluations(tenantId, { eventId: submitted.event.id });
      const observed = new Map(evaluations.filter((e) => e.nextValidity).map((e) => [e.assumptionId, e.nextValidity!]));
      const producedConflict = new Set(
        (await loop.store.listConflicts(tenantId, { limit: 500 })).filter((x) => (x as { eventId?: string | null }).eventId === submitted.event.id).map((x) => x.assumptionId),
      );

      // Transitions are scored against this tenant's assumption ids; for the
      // other-tenant case, anything observed in *this* tenant is a leak.
      const expected = new Map<string, string>();
      const refOf = new Map<string, string>();
      for (const [ref, state] of Object.entries(c.expectTransitions)) {
        const id = await assumptionId(ref);
        expected.set(id, state);
        refOf.set(id, ref);
      }
      if (!c.otherTenant) {
        for (const [id, state] of expected) {
          if (observed.get(id) === state) conflicts.tp += 1;
          else {
            conflicts.fn += 1;
            notes.push(`expected ${state} on ${refOf.get(id)}, got ${observed.get(id) ?? "no change"}`);
          }
        }
        for (const [id, state] of observed) {
          if (!expected.has(id) || expected.get(id) !== state) {
            conflicts.fp += 1;
            notes.push(`unexpected ${state} on assumption ${id}`);
          }
        }
      }
      if (Object.keys(c.expectTransitions).length === 0) {
        quietCases += 1;
        const own = c.otherTenant ? 0 : observed.size + producedConflict.size;
        if (own > 0) falseAlerts += 1;
      }
      for (const ref of c.expectUntouched ?? []) {
        const id = await assumptionId(ref);
        const a = await loop.store.getAssumption(tenant.id, id);
        const touched = (await loop.store.listConflicts(tenant.id, { limit: 500 })).some((x) => x.assumptionId === id && (x as { eventId?: string | null }).eventId === submitted.event.id);
        if (touched) {
          notes.push(`${ref} received a conflict`);
          if (c.otherTenant) leaks += 1;
        }
        if (c.otherTenant && a?.validityStatus !== "VALID") {
          notes.push(`${ref} changed to ${a?.validityStatus} from another tenant's evidence`);
          leaks += 1;
        }
      }
      for (const ref of c.expectSupports ?? []) {
        const id = await assumptionId(ref);
        if (!evaluations.some((e) => e.assumptionId === id && e.relation === "SUPPORTS")) notes.push(`no SUPPORTS recorded for ${ref}`);
      }
      for (const ref of c.expectAtRisk ?? []) {
        const d = await loop.store.getDecision(tenant.id, decisions.get(ref)!.id);
        if (d?.status !== "AT_RISK") notes.push(`${ref} is ${d?.status}, expected AT_RISK`);
      }
      const event = await loop.store.getEvent(tenantId, submitted.event.id);
      const gotFindings = new Set(
        ((event?.result as { constraintFindings?: Array<{ decisionId: string }> } | null)?.constraintFindings ?? []).map((f) => idToRef.get(f.decisionId)),
      );
      const wantFindings = new Set(c.expectFindings ?? []);
      for (const ref of wantFindings) {
        if (gotFindings.has(ref)) findings.tp += 1;
        else {
          findings.fn += 1;
          notes.push(`missing constraint finding on ${ref}`);
        }
      }
      for (const ref of gotFindings) {
        if (!wantFindings.has(ref!)) {
          findings.fp += 1;
          notes.push(`unexpected constraint finding on ${ref}`);
        }
      }
      if (event?.status !== "PROCESSED") notes.push(`event ${event?.status}: ${event?.lastError ?? ""}`);
      return { id: c.id, category: c.category, pass: notes.length === 0, notes, latencyMs, modelCalls: scripted.calls - callsBefore };
    }

    return {
      generatedAt: new Date().toISOString(),
      model: opts.useConfiguredModel ? reasoning.name : scripted.name,
      cases: results,
      metrics: {
        retrievalRecall: ratio(retrieval.hits, retrieval.expected),
        retrievalPrecision: ratio(retrieval.returnedRelevant, retrieval.returned),
        firstHitRate: ratio(retrieval.firstHits, retrieval.firstExpected),
        forbiddenHits: retrieval.forbidden,
        conflictPrecision: ratio(conflicts.tp, conflicts.tp + conflicts.fp),
        conflictRecall: ratio(conflicts.tp, conflicts.tp + conflicts.fn),
        falseAlertRate: quietCases === 0 ? 0 : falseAlerts / quietCases,
        findingPrecision: ratio(findings.tp, findings.tp + findings.fp),
        findingRecall: ratio(findings.tp, findings.tp + findings.fn),
        tenantLeaks: leaks,
        contextTokensAvg: Math.round(tokens.reduce((a, b) => a + b, 0) / Math.max(1, tokens.length)),
        contextTokensMax: Math.max(0, ...tokens),
        contextLatencyP50: pct(ctxLatency, 50),
        contextLatencyP95: pct(ctxLatency, 95),
        evidenceLatencyP50: pct(evLatency, 50),
        evidenceLatencyP95: pct(evLatency, 95),
        modelCallsPerEvidence: Number((modelCalls.reduce((a, b) => a + b, 0) / Math.max(1, modelCalls.length)).toFixed(2)),
        approvalAcceptanceRate: null,
        humanOverrideRate: null,
      },
    };
  } finally {
    await sql`DELETE FROM jobs WHERE tenant_id IN ${sql([tenant.id, other.id])}`;
    await sql`DELETE FROM tenants WHERE id IN ${sql([tenant.id, other.id])}`;
    await sql.end({ timeout: 5 });
  }
}

export function renderReport(r: EvalReport): string {
  const m = r.metrics;
  const f = (x: number) => x.toFixed(2);
  return [
    `# DecisionLoop behavioural evaluation`,
    ``,
    `Generated ${r.generatedAt} · semantic judgments: ${r.model} · embeddings: local-lexical-v1`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| Retrieval recall | ${f(m.retrievalRecall)} |`,
    `| Retrieval precision | ${f(m.retrievalPrecision)} |`,
    `| Governing decision ranked first | ${f(m.firstHitRate)} |`,
    `| Forbidden/dominating irrelevant hits | ${m.forbiddenHits} |`,
    `| Conflict precision | ${f(m.conflictPrecision)} |`,
    `| Conflict recall | ${f(m.conflictRecall)} |`,
    `| False alert rate | ${f(m.falseAlertRate)} |`,
    `| Constraint finding precision / recall | ${f(m.findingPrecision)} / ${f(m.findingRecall)} |`,
    `| Cross-tenant leaks | ${m.tenantLeaks} |`,
    `| Context size (tokens, avg / max) | ${m.contextTokensAvg} / ${m.contextTokensMax} |`,
    `| Context latency p50 / p95 (ms) | ${m.contextLatencyP50} / ${m.contextLatencyP95} |`,
    `| Evidence end-to-end latency p50 / p95 (ms) | ${m.evidenceLatencyP50} / ${m.evidenceLatencyP95} |`,
    `| Model calls per evidence event | ${m.modelCallsPerEvidence} |`,
    `| Approval acceptance / human override rate | not measurable offline — from dogfood data |`,
    ``,
    `| Case | Category | Result | Notes |`,
    `|---|---|---|---|`,
    ...r.cases.map((c) => `| ${c.id} | ${c.category} | ${c.pass ? "pass" : "**FAIL**"} | ${c.notes.join("; ").replace(/\|/g, "/")} |`),
  ].join("\n");
}
