import { recordAuditEvent } from "@/lib/repo/auditEvents";
import { getConflictById, resolveConflict } from "@/lib/repo/conflictEvents";
import {
  getDecisionById,
  setAssumptionValidity,
  updateDecisionStatus,
} from "@/lib/repo/decisions";
import { recordMemoryEvent } from "@/lib/repo/memoryEvents";
import type { ConflictResolution, Decision } from "@/lib/types";

/**
 * The explicit human actions decision.md §3 Principle 6 and §22 require:
 * the AI may *recommend* reopening a decision, but it must not silently
 * rewrite business history. Each action here is initiated by an
 * authenticated user, leaves a memory_event and an audit_event, and moves
 * the decision through a legal status transition (or refuses).
 */

export class ActionNotApplicableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionNotApplicableError";
  }
}

async function requireDecision(tenantId: string, decisionId: string) {
  const decision = await getDecisionById(tenantId, decisionId);
  if (!decision) throw new ActionNotApplicableError("Decision not found.");
  return decision;
}

/**
 * Reopen: the team agrees the contradiction matters and the original choice
 * is back on the table. The decision is NOT deleted or rewritten — it moves
 * to REOPENED and keeps its full history, per §3 Principle 3.
 */
export async function reopenDecision(input: {
  tenantId: string;
  decisionId: string;
  userId: string;
  conflictId?: string | null;
  note?: string | null;
}): Promise<Decision> {
  const decision = await requireDecision(input.tenantId, input.decisionId);

  const updated = await updateDecisionStatus(input.tenantId, input.decisionId, "REOPENED", {
    riskExplanation: decision.riskExplanation,
  });

  if (input.conflictId) {
    await resolveConflict(input.tenantId, input.conflictId, "REOPENED", input.userId);
  }

  await recordMemoryEvent({
    tenantId: input.tenantId,
    projectId: decision.projectId,
    entityType: "decision",
    entityId: decision.id,
    decisionId: decision.id,
    eventType: "DECISION_REOPENED",
    actorType: "USER",
    actorUserId: input.userId,
    summary: input.note || "Decision reopened for reconsideration.",
    metadata: { conflictId: input.conflictId ?? null, previousStatus: decision.status },
  });

  await recordAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.userId,
    action: "decision.reopened",
    entityType: "decision",
    entityId: decision.id,
    metadata: { conflictId: input.conflictId ?? null, previousStatus: decision.status },
  });

  return updated;
}

/**
 * Dismiss: a human judges the flagged conflict not to apply — wrong vendor,
 * stale document, misread number. The assumption returns to VALID and the
 * decision returns to ACTIVE, but the conflict row stays, marked DISMISSED
 * with who dismissed it. Nothing is erased.
 */
export async function dismissConflict(input: {
  tenantId: string;
  conflictId: string;
  userId: string;
  note?: string | null;
}): Promise<Decision> {
  const conflict = await getConflictById(input.tenantId, input.conflictId);
  if (!conflict) throw new ActionNotApplicableError("Conflict not found.");

  const decision = await requireDecision(input.tenantId, conflict.decisionId);

  await resolveConflict(input.tenantId, conflict.id, "DISMISSED", input.userId);
  await setAssumptionValidity(conflict.assumptionId, "VALID");

  // Only return the decision to ACTIVE once nothing else is still holding it
  // open — a second, unrelated conflict must keep it at risk.
  const refreshed = await requireDecision(input.tenantId, conflict.decisionId);
  const stillCompromised = refreshed.assumptions.some(
    (a) => a.validityStatus === "CHALLENGED" || a.validityStatus === "INVALIDATED",
  );

  let updated: Decision = refreshed;
  if (!stillCompromised && refreshed.status === "AT_RISK") {
    updated = await updateDecisionStatus(input.tenantId, refreshed.id, "ACTIVE", {
      riskExplanation: null,
    });
  }

  await recordMemoryEvent({
    tenantId: input.tenantId,
    projectId: decision.projectId,
    entityType: "conflict",
    entityId: conflict.id,
    decisionId: decision.id,
    eventType: "CONFLICT_DISMISSED",
    actorType: "USER",
    actorUserId: input.userId,
    summary: input.note || "Conflict dismissed; assumption restored to valid.",
    metadata: { assumptionId: conflict.assumptionId, stillCompromised },
  });

  await recordAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.userId,
    action: "conflict.dismissed",
    entityType: "conflict",
    entityId: conflict.id,
    metadata: { decisionId: decision.id, assumptionId: conflict.assumptionId },
  });

  return updated;
}

/**
 * Accept new evidence: the contradiction is real and the assumption is now
 * definitively false, but the team is not reopening the decision yet. The
 * assumption becomes INVALIDATED and the decision stays AT_RISK — an
 * explicit "yes, we know" that is different from both dismissing and
 * reopening.
 */
export async function acceptConflictEvidence(input: {
  tenantId: string;
  conflictId: string;
  userId: string;
  note?: string | null;
}): Promise<Decision> {
  const conflict = await getConflictById(input.tenantId, input.conflictId);
  if (!conflict) throw new ActionNotApplicableError("Conflict not found.");

  const decision = await requireDecision(input.tenantId, conflict.decisionId);

  await resolveConflict(input.tenantId, conflict.id, "ACCEPTED", input.userId);
  await setAssumptionValidity(conflict.assumptionId, "INVALIDATED");

  await recordMemoryEvent({
    tenantId: input.tenantId,
    projectId: decision.projectId,
    entityType: "assumption",
    entityId: conflict.assumptionId,
    decisionId: decision.id,
    eventType: "CONFLICT_ACCEPTED",
    actorType: "USER",
    actorUserId: input.userId,
    summary: input.note || "New evidence accepted; assumption confirmed invalid.",
    metadata: { conflictId: conflict.id },
  });

  await recordAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.userId,
    action: "conflict.accepted",
    entityType: "conflict",
    entityId: conflict.id,
    metadata: { decisionId: decision.id, assumptionId: conflict.assumptionId },
  });

  return requireDecision(input.tenantId, conflict.decisionId);
}

/**
 * Supersede: a new decision replaces this one. The old decision becomes
 * SUPERSEDED (terminal) and points at its replacement, so the history
 * remains reconstructible in both directions.
 */
export async function supersedeDecision(input: {
  tenantId: string;
  decisionId: string;
  supersededByDecisionId: string;
  userId: string;
  note?: string | null;
}): Promise<Decision> {
  const decision = await requireDecision(input.tenantId, input.decisionId);
  const replacement = await requireDecision(input.tenantId, input.supersededByDecisionId);

  if (replacement.id === decision.id) {
    throw new ActionNotApplicableError("A decision cannot supersede itself.");
  }

  const updated = await updateDecisionStatus(input.tenantId, decision.id, "SUPERSEDED", {
    riskExplanation: decision.riskExplanation,
    supersededByDecisionId: replacement.id,
  });

  // Assumptions of a superseded decision are no longer live claims about the
  // world, but they were true-as-recorded — SUPERSEDED preserves that
  // distinction rather than marking them invalidated.
  for (const assumption of decision.assumptions) {
    if (assumption.validityStatus === "INVALIDATED") continue;
    await setAssumptionValidity(assumption.id, "SUPERSEDED");
  }

  await recordMemoryEvent({
    tenantId: input.tenantId,
    projectId: decision.projectId,
    entityType: "decision",
    entityId: decision.id,
    decisionId: decision.id,
    eventType: "DECISION_SUPERSEDED",
    actorType: "USER",
    actorUserId: input.userId,
    summary: input.note || `Superseded by "${replacement.title}".`,
    metadata: { supersededByDecisionId: replacement.id },
  });

  await recordAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.userId,
    action: "decision.superseded",
    entityType: "decision",
    entityId: decision.id,
    metadata: { supersededByDecisionId: replacement.id },
  });

  return updated;
}

export const CONFLICT_RESOLUTIONS: ConflictResolution[] = [
  "REOPENED",
  "DISMISSED",
  "ACCEPTED",
  "SUPERSEDED",
];
