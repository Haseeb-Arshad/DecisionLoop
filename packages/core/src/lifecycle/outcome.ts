import type { AssumptionValidity, EvidenceRelation } from "../types/domain";
import { classifyConflictSeverity } from "./decisionStatus";
import {
  evaluatePolicies,
  type EvaluationAction,
  type PolicyFacts,
  type PolicyRule,
} from "../policy/policy";

/**
 * What one (evidence, assumption) evaluation does to stored memory.
 *
 * Two layers, in order:
 *  1. `classifyConflictSeverity` (unchanged from 1.x) — confidence and
 *     relative authority decide between nothing / CHALLENGED / INVALIDATED.
 *  2. Workspace policies — may only make the outcome *more* conservative
 *     (cap at CHALLENGED, suppress, keep the decision's status, require
 *     review) or add notifications. A policy cannot escalate weak evidence
 *     into an invalidation; that asymmetry is deliberate.
 *
 * Pure: the trigger engine applies the result inside one transaction.
 */

const SEVERITY_ORDER: Record<AssumptionValidity, number> = {
  VALID: 0,
  UNCERTAIN: 1,
  CHALLENGED: 2,
  INVALIDATED: 3,
  SUPERSEDED: 4,
};

export interface OutcomeInput {
  relation: EvidenceRelation;
  confidence: number;
  method: "DETERMINISTIC" | "SEMANTIC";
  evidenceAuthority: number;
  assumptionAuthority: number;
  assumptionImportance: number;
  currentValidity: AssumptionValidity;
  decisionImportance: number;
  source: string;
  actorType: PolicyFacts["actorType"];
  affectedResourceTypes: string[];
  domain: string;
  policies: PolicyRule[];
}

export interface EvaluationOutcome {
  /** Create a conflict row for this evaluation. */
  recordConflict: boolean;
  /** Record the evidence as supporting this assumption. */
  recordSupport: boolean;
  /** New validity, or null for "unchanged". */
  nextValidity: AssumptionValidity | null;
  /** Move the parent decision to AT_RISK (if it isn't already). */
  flagDecision: boolean;
  requireReview: boolean;
  notify: Array<"dashboard" | "github">;
  matchedRules: string[];
  actions: EvaluationAction[];
  /** Human-readable account of every step, stored with the evaluation. */
  reasons: string[];
}

export function resolveEvaluationOutcome(input: OutcomeInput): EvaluationOutcome {
  const reasons: string[] = [];

  if (input.currentValidity === "SUPERSEDED") {
    return {
      recordConflict: false,
      recordSupport: false,
      nextValidity: null,
      flagDecision: false,
      requireReview: false,
      notify: [],
      matchedRules: [],
      actions: [],
      reasons: ["Assumption belongs to a superseded decision; recorded for history only."],
    };
  }

  const severity = classifyConflictSeverity({
    relation: input.relation,
    confidence: input.confidence,
    evidenceAuthority: input.evidenceAuthority,
    assumptionAuthority: input.assumptionAuthority,
  });
  reasons.push(severity.reason);

  const policy = evaluatePolicies("evaluation", input.policies, {
    decisionImportance: input.decisionImportance,
    assumptionImportance: input.assumptionImportance,
    evidenceAuthority: input.evidenceAuthority,
    confidence: input.confidence,
    relation: input.relation,
    proposedValidity: severity.nextValidity,
    method: input.method,
    source: input.source,
    actorType: input.actorType,
    affectedResourceTypes: input.affectedResourceTypes,
    domain: input.domain,
  });
  const actions = new Set(policy.actions);
  if (policy.matchedRules.length > 0) {
    reasons.push(`Policies matched: ${policy.matchedRules.join(", ")} → ${policy.actions.join(", ")}.`);
  }

  if (input.relation === "SUPPORTS" && !actions.has("suppress")) {
    return {
      recordConflict: false,
      recordSupport: true,
      nextValidity: null,
      flagDecision: false,
      requireReview: false,
      notify: [],
      matchedRules: policy.matchedRules,
      actions: policy.actions,
      reasons: [
        ...reasons,
        // Supporting evidence never silently restores a challenged
        // assumption: that is a human judgment (dismiss the conflict).
        "Evidence supports the assumption; recorded as supporting evidence.",
      ],
    };
  }

  if (!severity.record || !severity.nextValidity) {
    return {
      recordConflict: false,
      recordSupport: false,
      nextValidity: null,
      flagDecision: false,
      requireReview: false,
      notify: [],
      matchedRules: policy.matchedRules,
      actions: policy.actions,
      reasons,
    };
  }

  if (actions.has("suppress")) {
    return {
      recordConflict: false,
      recordSupport: false,
      nextValidity: null,
      flagDecision: false,
      requireReview: false,
      notify: [],
      matchedRules: policy.matchedRules,
      actions: policy.actions,
      reasons: [...reasons, "Suppressed by policy; evaluation recorded without changing memory."],
    };
  }

  let next: AssumptionValidity = severity.nextValidity;
  if (next === "INVALIDATED" && (actions.has("challenge_only") || actions.has("never_auto_invalidate"))) {
    next = "CHALLENGED";
    reasons.push("Policy caps this evidence at CHALLENGED; a human decides whether it invalidates.");
  }

  // Never move backwards: a second, weaker contradiction must not turn an
  // INVALIDATED assumption back into a merely CHALLENGED one.
  const nextValidity = SEVERITY_ORDER[next] > SEVERITY_ORDER[input.currentValidity] ? next : null;
  if (!nextValidity) {
    reasons.push(`Assumption is already ${input.currentValidity}; conflict recorded, state unchanged.`);
  }

  const notify: Array<"dashboard" | "github"> = [];
  if (actions.has("notify_dashboard")) notify.push("dashboard");
  if (actions.has("create_github_comment")) notify.push("github");

  return {
    recordConflict: true,
    recordSupport: false,
    nextValidity,
    flagDecision: severity.flagDecision && !actions.has("do_not_flag_decision"),
    requireReview: actions.has("require_human_review"),
    notify,
    matchedRules: policy.matchedRules,
    actions: policy.actions,
    reasons,
  };
}
