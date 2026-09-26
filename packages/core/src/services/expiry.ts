import type { DecisionStore } from "../ports/store";
import type { ServiceDeps } from "./shared";

/**
 * Temporal validity (docs/v2 §8): an assumption past its `valid_until` is
 * not known to be false — it is no longer known to be true. It moves
 * VALID/UNCERTAIN → CHALLENGED with an ASSUMPTION_EXPIRED conflict, and its
 * decision is flagged for re-verification. No new validity state is needed.
 *
 * Each assumption is handled in its own transaction and re-checked inside
 * it, so concurrent sweeps and retries cannot double-apply.
 */
export class ExpiryService {
  constructor(private readonly deps: ServiceDeps) {}

  async sweep(now: Date = new Date(), limit = 200): Promise<{ challenged: string[]; decisionsAtRisk: string[] }> {
    const expired = await this.deps.store.listExpiredAssumptions(now, limit);
    const challenged: string[] = [];
    const atRisk = new Set<string>();

    for (const { tenantId, assumption } of expired) {
      const applied = await this.deps.store.transaction((tx) => this.expire(tx, tenantId, assumption.id, now));
      if (!applied) continue;
      challenged.push(assumption.id);
      if (applied.flagged) atRisk.add(applied.decisionId);
    }
    return { challenged, decisionsAtRisk: Array.from(atRisk) };
  }

  private async expire(tx: DecisionStore, tenantId: string, assumptionId: string, now: Date) {
    const a = await tx.getAssumption(tenantId, assumptionId);
    if (!a || !a.validUntil || new Date(a.validUntil) >= now) return null;
    if (a.validityStatus !== "VALID" && a.validityStatus !== "UNCERTAIN") return null;
    const d = await tx.getDecision(tenantId, a.decisionId);
    if (!d || !["ACTIVE", "AT_RISK", "REOPENED"].includes(d.status)) return null;

    const until = a.validUntil.slice(0, 10);
    const explanation = `"${a.statement}" was recorded as valid until ${until}. It has not been re-verified since, so it is challenged until someone confirms or replaces it.`;
    const flag = d.status === "ACTIVE" || d.status === "REOPENED";

    const evaluation = await tx.insertEvaluation({
      tenantId,
      agentRunId: null,
      eventId: null,
      evidenceItemId: null,
      assumptionId: a.id,
      decisionId: d.id,
      fact: null,
      method: "DETERMINISTIC",
      relation: "UPDATES",
      confidence: 1,
      evidenceAuthority: 1,
      assumptionAuthority: a.authorityScore,
      previousValidity: a.validityStatus,
      nextValidity: "CHALLENGED",
      decisionFlagged: flag,
      matchedPolicies: [],
      actions: [],
      explanation,
      retrievalScore: null,
    });
    const { conflict } = await tx.insertConflict({
      tenantId,
      decisionId: d.id,
      assumptionId: a.id,
      evidenceItemId: null,
      eventId: null,
      evaluationId: evaluation.id,
      agentRunId: null,
      factStatement: `valid_until ${until} has passed`,
      explanation,
      conflictType: "ASSUMPTION_EXPIRED",
      relation: "UPDATES",
      confidence: 1,
      oldValue: `valid until ${until}`,
      newValue: `checked ${now.toISOString().slice(0, 10)}`,
      sourceQuote: null,
      detectionMethod: "DETERMINISTIC",
    });
    await tx.setAssumptionValidity(tenantId, a.id, "CHALLENGED");
    await tx.recordMemoryEvent({
      tenantId,
      projectId: d.projectId,
      entityType: "assumption",
      entityId: a.id,
      decisionId: d.id,
      eventType: "ASSUMPTION_CHALLENGED",
      actorType: "SYSTEM",
      summary: explanation,
      metadata: { conflictId: conflict.id, evaluationId: evaluation.id, reason: "expired" },
    });
    if (flag) {
      await tx.updateDecisionStatus(tenantId, d.id, "AT_RISK", { riskExplanation: explanation });
      await tx.recordMemoryEvent({
        tenantId,
        projectId: d.projectId,
        entityType: "decision",
        entityId: d.id,
        decisionId: d.id,
        eventType: "DECISION_AT_RISK",
        actorType: "SYSTEM",
        summary: explanation,
        metadata: { conflictId: conflict.id, assumptionId: a.id, reason: "expired" },
      });
    }
    return { decisionId: d.id, flagged: flag };
  }
}

/** Hour-bucketed dedupe key: any number of workers enqueue at most one sweep per hour. */
export function expirySweepDedupeKey(now: Date = new Date()): string {
  return `expiry:${now.toISOString().slice(0, 13)}`;
}
