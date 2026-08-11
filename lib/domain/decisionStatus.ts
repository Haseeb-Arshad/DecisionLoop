import type {
  AssumptionValidity,
  DecisionStatus,
  EvidenceRelation,
} from "@/lib/types";

/**
 * Pure decision/assumption lifecycle rules (decision.md §9, §10, §20).
 * Deliberately free of database and network dependencies so the rules that
 * govern business history are unit-testable in isolation — see
 * tests/unit/decisionStatus.test.ts.
 */

/**
 * Legal decision status transitions. ARCHIVED and SUPERSEDED are terminal:
 * §3 Principle 3 — "never destroy historical truth simply because
 * circumstances changed" — so a superseded decision stays superseded and
 * the new decision is a separate row pointing back at it.
 */
const ALLOWED_TRANSITIONS: Record<DecisionStatus, DecisionStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["AT_RISK", "REOPENED", "SUPERSEDED", "ARCHIVED"],
  AT_RISK: ["REOPENED", "ACTIVE", "SUPERSEDED", "ARCHIVED"],
  REOPENED: ["ACTIVE", "AT_RISK", "SUPERSEDED", "ARCHIVED"],
  SUPERSEDED: [],
  ARCHIVED: [],
};

export function canTransition(from: DecisionStatus, to: DecisionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class IllegalStatusTransitionError extends Error {
  constructor(
    public readonly from: DecisionStatus,
    public readonly to: DecisionStatus,
  ) {
    super(
      `Illegal decision status transition: ${from} → ${to}. ` +
        `Allowed from ${from}: ${ALLOWED_TRANSITIONS[from].join(", ") || "(terminal state)"}.`,
    );
    this.name = "IllegalStatusTransitionError";
  }
}

export function assertTransition(from: DecisionStatus, to: DecisionStatus): void {
  if (from === to) return;
  if (!canTransition(from, to)) throw new IllegalStatusTransitionError(from, to);
}

// ── Authority-weighted conflict severity (§20) ──────────────────────────────

/**
 * Default authority by document provenance. A signed contract outranks a
 * vendor's marketing PDF, which outranks an unattributed upload — this is
 * what stops "a low-authority random document silently invalidating an
 * important decision" (§20).
 */
export const SOURCE_AUTHORITY: Record<string, number> = {
  CONTRACT: 0.95,
  VENDOR_OFFICIAL: 0.85,
  INTERNAL_ANALYSIS: 0.75,
  NEWS: 0.5,
  OTHER: 0.6,
  UNVERIFIED: 0.3,
};

export function authorityForSourceType(sourceType: string): number {
  return SOURCE_AUTHORITY[sourceType] ?? SOURCE_AUTHORITY.OTHER!;
}

/** Minimum model confidence before a contradiction is worth recording at all. */
export const MIN_CONFIDENCE_TO_RECORD = 0.5;
/** Confidence at or above which a sufficiently authoritative source invalidates. */
export const MIN_CONFIDENCE_TO_INVALIDATE = 0.75;
/**
 * How far below the assumption's own authority the evidence may sit and
 * still be allowed to invalidate rather than merely challenge.
 */
export const AUTHORITY_TOLERANCE = 0.1;

export interface ConflictSeverityInput {
  relation: EvidenceRelation;
  confidence: number;
  evidenceAuthority: number;
  assumptionAuthority: number;
}

export interface ConflictSeverity {
  /** Whether this rises to a recorded conflict at all. */
  record: boolean;
  /** The validity state the assumption should move to, if recording. */
  nextValidity: AssumptionValidity | null;
  /** Whether the parent decision should move to AT_RISK. */
  flagDecision: boolean;
  reason: string;
}

/**
 * Decides what a detected contradiction actually *does* to stored memory.
 *
 * The important case is the middle one: strong evidence from a weak source
 * challenges an assumption (visible, reviewable, decision flagged) but does
 * not invalidate it outright. Human judgment stays in the loop (§3
 * Principle 6) rather than an anonymous PDF rewriting business history.
 */
export function classifyConflictSeverity(
  input: ConflictSeverityInput,
): ConflictSeverity {
  const { relation, confidence, evidenceAuthority, assumptionAuthority } = input;

  if (relation !== "CONTRADICTS" && relation !== "UPDATES") {
    return {
      record: false,
      nextValidity: null,
      flagDecision: false,
      reason: `Evidence relation is ${relation}; nothing to record against this assumption.`,
    };
  }

  if (confidence < MIN_CONFIDENCE_TO_RECORD) {
    return {
      record: false,
      nextValidity: null,
      flagDecision: false,
      reason: `Confidence ${confidence.toFixed(2)} is below the ${MIN_CONFIDENCE_TO_RECORD} threshold to record a conflict.`,
    };
  }

  const authoritative = evidenceAuthority >= assumptionAuthority - AUTHORITY_TOLERANCE;

  if (confidence >= MIN_CONFIDENCE_TO_INVALIDATE && authoritative) {
    return {
      record: true,
      nextValidity: "INVALIDATED",
      flagDecision: true,
      reason:
        `Confidence ${confidence.toFixed(2)} ≥ ${MIN_CONFIDENCE_TO_INVALIDATE} and evidence authority ` +
        `${evidenceAuthority.toFixed(2)} is at least as strong as the assumption's ${assumptionAuthority.toFixed(2)}.`,
    };
  }

  return {
    record: true,
    nextValidity: "CHALLENGED",
    flagDecision: true,
    reason: authoritative
      ? `Confidence ${confidence.toFixed(2)} is below the ${MIN_CONFIDENCE_TO_INVALIDATE} bar to invalidate outright; flagged for human review.`
      : `Evidence authority ${evidenceAuthority.toFixed(2)} is materially weaker than the assumption's ${assumptionAuthority.toFixed(2)}; challenged rather than invalidated so a human decides.`,
  };
}
