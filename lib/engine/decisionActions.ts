import { getDecisionLoop } from "@/lib/decisionloopInstance";
import type { Actor } from "@decisionloop/core/types/records";
import type { ConflictResolution } from "@/lib/types";
export class ActionNotApplicableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionNotApplicableError";
  }
}
type ActionInput = { tenantId: string; userId: string; note?: string | null };
function actor(input: ActionInput): Actor {
  return {
    tenantId: input.tenantId,
    type: "user",
    userId: input.userId,
    label: "user:" + input.userId,
    scopes: ["admin"],
    sessionId: "user:" + input.userId,
  };
}
// Compatibility entry points share the authoritative transaction and policy rules.
export function reopenDecision(
  input: ActionInput & { decisionId: string; conflictId?: string | null },
) {
  return getDecisionLoop().conflicts.reopen(
    actor(input),
    input.decisionId,
    input.note,
  );
}
export function dismissConflict(input: ActionInput & { conflictId: string }) {
  return getDecisionLoop().conflicts.dismiss(actor(input), input.conflictId, {
    note: input.note,
  });
}
export function acceptConflictEvidence(
  input: ActionInput & { conflictId: string },
) {
  return getDecisionLoop().conflicts.accept(actor(input), input.conflictId, {
    note: input.note,
  });
}
export function supersedeDecision(
  input: ActionInput & { decisionId: string; supersededByDecisionId: string },
) {
  return getDecisionLoop().decisions.supersede(
    actor(input),
    input.decisionId,
    input.supersededByDecisionId,
    input.note,
  );
}
export const CONFLICT_RESOLUTIONS: ConflictResolution[] = [
  "REOPENED",
  "DISMISSED",
  "ACCEPTED",
  "SUPERSEDED",
];
