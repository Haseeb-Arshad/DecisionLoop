import { z } from "zod";
import type { AssumptionValidity, EvidenceRelation } from "../types/domain";

/**
 * Policies decide what a finding *does* (spec §7). The same contradiction
 * can warrant an automatic invalidation in one workspace and a mandatory
 * human review in another.
 *
 * Deliberately small: a rule is a conjunction of simple conditions and a
 * list of named actions. No expressions, no scripting, no custom language —
 * every rule a workspace has is readable in one glance, and every decision
 * the engine makes records which rules matched.
 *
 * Two scopes:
 *  - `evaluation` — applied when evidence is checked against an assumption.
 *  - `commit`     — applied when someone asks to make a decision authoritative.
 */

/** `">=0.8"`, `"<0.5"`, `"=1"` */
const comparisonSchema = z
  .string()
  .regex(/^(<=|>=|<|>|=)\s*-?\d+(\.\d+)?$/, "Use a comparison like \">=0.8\" or \"<0.5\".");

export const policyConditionSchema = z
  .object({
    decisionImportance: comparisonSchema.optional(),
    assumptionImportance: comparisonSchema.optional(),
    evidenceAuthority: comparisonSchema.optional(),
    confidence: comparisonSchema.optional(),
    relation: z.array(z.string()).optional(),
    /** The validity the severity rules would move the assumption to. */
    proposedValidity: z.array(z.string()).optional(),
    method: z.array(z.enum(["DETERMINISTIC", "SEMANTIC"])).optional(),
    source: z.array(z.string()).optional(),
    actorType: z.array(z.enum(["user", "agent", "integration", "system"])).optional(),
    affectedResourceType: z.array(z.string()).optional(),
    domain: z.array(z.string()).optional(),
  })
  .strict();

export const EVALUATION_ACTIONS = [
  /** Never move an assumption past CHALLENGED; a human decides. */
  "challenge_only",
  /** Alias of challenge_only, named as in the spec. */
  "never_auto_invalidate",
  /** Record the evaluation, but create no conflict and change no state. */
  "suppress",
  /** Leave the parent decision's status alone. */
  "do_not_flag_decision",
  "require_human_review",
  "notify_dashboard",
  "create_github_comment",
] as const;

export const COMMIT_ACTIONS = ["require_approval", "allow_commit", "propose_only"] as const;

export type EvaluationAction = (typeof EVALUATION_ACTIONS)[number];
export type CommitAction = (typeof COMMIT_ACTIONS)[number];

export const policyRuleSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("evaluation"),
    name: z.string().min(1).max(80),
    description: z.string().max(500).default(""),
    when: policyConditionSchema,
    actions: z.array(z.enum(EVALUATION_ACTIONS)).min(1),
  }),
  z.object({
    scope: z.literal("commit"),
    name: z.string().min(1).max(80),
    description: z.string().max(500).default(""),
    when: policyConditionSchema,
    actions: z.array(z.enum(COMMIT_ACTIONS)).min(1),
  }),
]);

export type PolicyRule = z.infer<typeof policyRuleSchema>;
export type PolicyCondition = z.infer<typeof policyConditionSchema>;

/** The spec's three example policies, as shipped defaults. */
export const DEFAULT_POLICIES: PolicyRule[] = [
  {
    scope: "evaluation",
    name: "low_authority_evidence",
    description: "Evidence from weak sources may challenge an assumption but never invalidate it.",
    when: { evidenceAuthority: "<0.5" },
    actions: ["challenge_only", "never_auto_invalidate"],
  },
  {
    scope: "evaluation",
    name: "agent_supplied_evidence",
    description:
      "An agent's own report can raise a challenge; invalidating organizational memory needs a stronger source or a human.",
    when: { actorType: ["agent"] },
    actions: ["challenge_only"],
  },
  {
    scope: "evaluation",
    name: "high_impact_architecture",
    description: "Invalidating an assumption behind an important decision requires human review.",
    when: { decisionImportance: ">=0.8", proposedValidity: ["INVALIDATED"] },
    actions: ["require_human_review", "notify_dashboard", "create_github_comment"],
  },
  {
    scope: "commit",
    name: "agent_architecture_change",
    description: "Decisions proposed by coding agents are candidates until a human approves them.",
    when: { actorType: ["agent"] },
    actions: ["propose_only", "require_approval"],
  },
  {
    scope: "commit",
    name: "integration_proposals",
    description: "Decisions inferred by integrations (e.g. from a PR) need approval.",
    when: { actorType: ["integration", "system"] },
    actions: ["require_approval"],
  },
];

export interface PolicyFacts {
  decisionImportance?: number;
  assumptionImportance?: number;
  evidenceAuthority?: number;
  confidence?: number;
  relation?: EvidenceRelation | string;
  proposedValidity?: AssumptionValidity | null;
  method?: "DETERMINISTIC" | "SEMANTIC";
  source?: string;
  actorType?: "user" | "agent" | "integration" | "system";
  affectedResourceTypes?: string[];
  domain?: string;
}

function compareNumber(expr: string, value: number | undefined): boolean {
  if (value === undefined || Number.isNaN(value)) return false;
  const m = /^(<=|>=|<|>|=)\s*(-?\d+(?:\.\d+)?)$/.exec(expr.trim());
  if (!m) return false;
  const bound = Number(m[2]);
  switch (m[1]) {
    case "<":
      return value < bound;
    case "<=":
      return value <= bound;
    case ">":
      return value > bound;
    case ">=":
      return value >= bound;
    default:
      return value === bound;
  }
}

function inList(list: string[] | undefined, value: string | null | undefined): boolean {
  if (!list) return true;
  if (value === null || value === undefined) return false;
  return list.map((v) => v.toLowerCase()).includes(value.toLowerCase());
}

/** A rule matches when every condition it states holds. Unstated conditions are ignored. */
export function conditionMatches(when: PolicyCondition, facts: PolicyFacts): boolean {
  if (when.decisionImportance && !compareNumber(when.decisionImportance, facts.decisionImportance)) return false;
  if (when.assumptionImportance && !compareNumber(when.assumptionImportance, facts.assumptionImportance)) return false;
  if (when.evidenceAuthority && !compareNumber(when.evidenceAuthority, facts.evidenceAuthority)) return false;
  if (when.confidence && !compareNumber(when.confidence, facts.confidence)) return false;
  if (!inList(when.relation, facts.relation)) return false;
  if (!inList(when.proposedValidity, facts.proposedValidity ?? null)) return false;
  if (!inList(when.method, facts.method)) return false;
  if (!inList(when.source, facts.source)) return false;
  if (!inList(when.actorType, facts.actorType)) return false;
  if (!inList(when.domain, facts.domain)) return false;
  if (when.affectedResourceType) {
    const types = (facts.affectedResourceTypes ?? []).map((t) => t.toLowerCase());
    if (!when.affectedResourceType.some((t) => types.includes(t.toLowerCase()))) return false;
  }
  return true;
}

export interface PolicyDecision<A extends string> {
  matchedRules: string[];
  actions: A[];
}

export function evaluatePolicies<S extends PolicyRule["scope"]>(
  scope: S,
  rules: PolicyRule[],
  facts: PolicyFacts,
): PolicyDecision<S extends "evaluation" ? EvaluationAction : CommitAction> {
  const matchedRules: string[] = [];
  const actions = new Set<string>();
  for (const rule of rules) {
    if (rule.scope !== scope) continue;
    if (!conditionMatches(rule.when, facts)) continue;
    matchedRules.push(rule.name);
    for (const a of rule.actions) actions.add(a);
  }
  return {
    matchedRules,
    actions: Array.from(actions) as Array<S extends "evaluation" ? EvaluationAction : CommitAction>,
  };
}

/**
 * Merges workspace rules over the defaults: a workspace rule with the same
 * name replaces the default; new names are added. A workspace can therefore
 * relax a default only by explicitly redefining it — never by accident.
 */
export function mergePolicies(defaults: PolicyRule[], overrides: PolicyRule[]): PolicyRule[] {
  const byName = new Map(defaults.map((r) => [`${r.scope}:${r.name}`, r] as const));
  for (const r of overrides) byName.set(`${r.scope}:${r.name}`, r);
  return Array.from(byName.values());
}
