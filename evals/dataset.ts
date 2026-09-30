import type { DecisionDraftInput, EvidenceSubmissionInput } from "@decisionloop/core/contracts";
import type { InboundEventInput } from "@decisionloop/core/events/event";

/**
 * Behavioural evaluation dataset (spec §27). A small, realistic workspace
 * plus cases that each assert what DecisionLoop should and should not do.
 *
 * Decisions are referenced by `externalRef`; assumptions by
 * `ref:predicate` (or `ref:#n` for unstructured ones). Categories follow the
 * spec's list A–K.
 */

export type Category =
  | "A_relevant_retrieved"
  | "B_similar_not_dominant"
  | "C_evidence_supports"
  | "D_numeric_invalidation"
  | "E_qualitative_contradiction"
  | "F_low_authority_challenges"
  | "G_high_authority_invalidates"
  | "H_superseded_inactive"
  | "I_tenant_isolation"
  | "J_agent_change_violates"
  | "K_suspicious_but_unrelated"
  | "L_action_check"
  | "M_other_domain_evidence";

export interface ContextCase {
  kind: "context";
  id: string;
  category: Category;
  intent: string;
  resources: string[];
  repository?: string;
  /** Must appear in the returned decisions (recall). */
  expect: string[];
  /** Must be ranked first. */
  expectFirst?: string;
  /** Must not appear, or (for B) must not outrank `expectFirst`. */
  forbid?: string[];
  /** Run as the other tenant's agent (isolation). */
  otherTenant?: boolean;
}

export interface EvidenceCase {
  kind: "evidence";
  id: string;
  category: Category;
  /** Evidence as a person/agent/integration would submit it… */
  submit?: { as: "human" | "agent" | "integration"; input: EvidenceSubmissionInput };
  /** …or a raw canonical event (GitHub, metrics, documents). */
  event?: InboundEventInput;
  otherTenant?: boolean;
  /** Assumptions expected to end in these states because of this evidence. */
  expectTransitions: Record<string, "CHALLENGED" | "INVALIDATED">;
  /** Decisions expected to be AT_RISK afterwards. */
  expectAtRisk?: string[];
  /** Decisions expected to receive a constraint finding. */
  expectFindings?: string[];
  /** Assumptions that must NOT receive a conflict (false-alert guards). */
  expectUntouched?: string[];
  /** Expected support links (C). */
  expectSupports?: string[];
}

/** A dry-run check before an action with side effects (refund, purchase, message). */
export interface ActionCase {
  kind: "action";
  id: string;
  category: Category;
  action: string;
  resources: string[];
  facts?: Array<{ subject?: string; predicate: string; valueType: "NUMBER" | "BOOLEAN" | "CATEGORY"; value: number | boolean | string; unit?: string; statement: string }>;
  expectVerdict: "no_decision" | "clear" | "caution" | "stop";
  /** Decisions the verdict must name as violated (by externalRef). */
  expectViolations?: string[];
}

export type EvalCase = ContextCase | EvidenceCase | ActionCase;

const REPO = "acme/platform";

export const DECISIONS: Array<DecisionDraftInput & { externalRef: string }> = [
  {
    externalRef: "ADR-018",
    title: "Use Redis-backed server-side sessions for authentication",
    chosenOption: { name: "Server-side sessions in Redis" },
    alternatives: [{ name: "Stateless JWT", rejectionReason: "JWTs cannot be revoked immediately; enterprise customers require instant revocation." }],
    rationale: "Enterprise customers require immediate session revocation on offboarding.",
    assumptions: [
      { statement: "Customers require immediate session revocation", subject: "service:auth", predicate: "immediate_revocation_required", valueType: "BOOLEAN", operator: "=", expected: true, importance: 0.95, authority: 0.8 },
      { statement: "Redis session lookup p95 stays under 15 ms", subject: "infrastructure:redis", predicate: "p95_latency_ms", valueType: "NUMBER", operator: "<", expected: 15, unit: "ms", authority: 0.7 },
    ],
    constraints: [{ statement: "Sessions stay server-side and revocable (Redis)", rule: { kind: "dependency_present", subject: "npm:redis" } }],
    resources: ["src/auth/**", "src/session/**"],
    repository: REPO,
    importance: 0.9,
  },
  {
    externalRef: "ADR-031",
    title: "Use Redis for the billing rate limiter",
    chosenOption: { name: "Redis token bucket" },
    rationale: "Redis is already operated by the platform team; rate limits must be shared across API nodes.",
    resources: ["src/billing/**"],
    repository: REPO,
    importance: 0.5,
  },
  {
    externalRef: "ADR-040",
    title: "PostgreSQL as the primary transactional database",
    chosenOption: { name: "PostgreSQL 16" },
    alternatives: [{ name: "CockroachDB", rejectionReason: "Operational overhead not justified below 10k writes/s." }],
    rationale: "Write volume is modest and the team has deep PostgreSQL expertise.",
    assumptions: [
      { statement: "Peak write volume stays under 10,000 writes/s", subject: "database:primary", predicate: "write_throughput_per_s", valueType: "NUMBER", operator: "<", expected: 10000, importance: 0.9, authority: 0.7 },
      { statement: "All customer data is hosted in the EU", subject: "database:primary", predicate: "hosting_region", valueType: "CATEGORY", operator: "IN", expected: ["EU"], importance: 0.8, authority: 0.8 },
    ],
    resources: ["services/api/db/**", "database:primary"],
    repository: REPO,
    importance: 0.85,
  },
  {
    externalRef: "ADR-041",
    title: "Cache hot reads in front of PostgreSQL",
    chosenOption: { name: "Read-through cache" },
    rationale: "Read load dominates; the cache relies on the primary database choice.",
    resources: ["services/api/cache/**"],
    repository: REPO,
  },
  {
    externalRef: "ADR-050",
    title: "Ingest analytics events through Kafka",
    chosenOption: { name: "Kafka" },
    rationale: "Replayable ingestion for downstream consumers.",
    assumptions: [{ statement: "Event volume stays under 50M per day", subject: "service:ingest", predicate: "events_per_day", valueType: "NUMBER", operator: "<", expected: 50_000_000 }],
    resources: ["services/ingest/**"],
    repository: REPO,
  },
  {
    externalRef: "PROC-007",
    title: "Select SignalForge as the analytics vendor",
    domain: "procurement",
    chosenOption: { name: "SignalForge" },
    alternatives: [{ name: "MetricLake", rejectionReason: "About $9k/year more expensive for capacity we don't need." }],
    rationale: "SignalForge meets requirements at lower cost with EU hosting and SOC2.",
    assumptions: [
      { statement: "SignalForge costs under $25,000/year", subject: "vendor:signalforge", predicate: "annual_cost", valueType: "NUMBER", operator: "<", expected: 25000, unit: "USD/year", importance: 0.9, authority: 0.8 },
      { statement: "SignalForge maintains European hosting" },
      { statement: "SignalForge holds SOC2 certification", subject: "vendor:signalforge", predicate: "certifications", valueType: "SET", operator: "CONTAINS", expected: "SOC2", importance: 0.8, authority: 0.8 },
    ],
    resources: ["vendor:signalforge"],
    importance: 0.7,
  },
  {
    externalRef: "ADR-060",
    title: "GraphQL gateway on Apollo Server",
    chosenOption: { name: "Apollo Server" },
    assumptions: [{ statement: "Apollo Server stays at major version 4 or later", subject: "npm:@apollo/server", predicate: "version", valueType: "VERSION", operator: ">=", expected: "4.0.0", authority: 0.7 }],
    resources: ["src/api/graphql/**", "npm:@apollo/server"],
    repository: REPO,
  },
  {
    externalRef: "ADR-007",
    title: "Store feature flags as YAML in the repository",
    chosenOption: { name: "YAML files" },
    assumptions: [{ statement: "Fewer than 50 feature flags exist", subject: "service:flags", predicate: "flag_count", valueType: "NUMBER", operator: "<", expected: 50 }],
    resources: ["src/flags/**"],
    repository: REPO,
  },
  {
    externalRef: "ADR-044",
    title: "Move feature flags to a flag service",
    chosenOption: { name: "Hosted flag service" },
    resources: ["src/featureflags/**"],
    repository: REPO,
  },
  {
    externalRef: "ADR-070",
    title: "Web frontend on React",
    chosenOption: { name: "React" },
    assumptions: [{ statement: "React stays at 18 or later", subject: "npm:react", predicate: "version", valueType: "VERSION", operator: ">=", expected: "18.0.0" }],
    resources: ["apps/web/**"],
    repository: REPO,
  },
  {
    externalRef: "SUP-007",
    title: "Auto-approve refunds up to $200",
    domain: "support",
    chosenOption: { name: "Auto-approve up to $200" },
    alternatives: [{ name: "Escalate every refund to a person", rejectionReason: "Median resolution time tripled and satisfaction fell." }],
    rationale: "Consumer chargebacks are rare, so small refunds are cheaper to grant than to review.",
    assumptions: [
      { statement: "Consumer chargeback rate stays under 0.5%", subject: "segment:consumer", predicate: "chargeback_rate_pct", valueType: "NUMBER", operator: "<", expected: 0.5, unit: "%", importance: 0.9, authority: 0.8 },
    ],
    constraints: [{ statement: "Refunds above $200 need a person", severity: "BLOCKING", rule: { kind: "fact_bound", predicate: "refund_amount_usd", operator: "<=", value: 200, unit: "USD" } }],
    resources: ["policy:refunds", "segment:consumer"],
    importance: 0.7,
  },
  {
    externalRef: "PROC-012",
    title: "No vendor above $100k a year without the CFO",
    domain: "procurement",
    chosenOption: { name: "Annual vendor spend cap" },
    constraints: [{ statement: "Annual vendor cost stays at or under $100k", rule: { kind: "fact_bound", subject: "vendor:*", predicate: "annual_cost", operator: "<=", value: 100000, unit: "USD/year" } }],
    importance: 0.6,
  },
  {
    externalRef: "PRD-012",
    title: "Defer the Android app",
    domain: "product",
    chosenOption: { name: "iOS and web only" },
    assumptions: [{ statement: "Android is under 10% of requested platform demand", subject: "product:mobile", predicate: "android_demand_share", valueType: "NUMBER", operator: "<", expected: 0.1 }],
    resources: ["product:mobile"],
  },
];

/** Recorded dependencies (for blast radius): ADR-041 depends on ADR-040. */
export const DEPENDENCIES: Array<[dependent: string, dependsOn: string]> = [["ADR-041", "ADR-040"]];

/** ADR-044 supersedes ADR-007. */
export const SUPERSESSIONS: Array<[old: string, replacement: string]> = [["ADR-007", "ADR-044"]];

/** The other tenant holds a near-identical decision; nothing may leak either way. */
export const OTHER_TENANT_DECISION = DECISIONS[0]!;

const github = (id: string, payload: Record<string, unknown>, type = "pull_request.merged"): InboundEventInput => ({
  source: "github",
  externalId: id,
  type,
  occurredAt: "2026-09-01T00:00:00.000Z",
  actor: { type: "integration", label: "github" },
  evidenceKind: "CODE_DIFF",
  payload: { repository: REPO, ...payload },
  provenance: { receivedVia: "eval", signatureVerified: true },
});

export const CASES: EvalCase[] = [
  // ── A: the relevant decision is retrieved ────────────────────────────────
  { kind: "context", id: "A1", category: "A_relevant_retrieved", intent: "Add multi-factor authentication to the login flow", resources: ["src/auth/login.ts"], repository: REPO, expect: ["ADR-018"], expectFirst: "ADR-018" },
  { kind: "context", id: "A2", category: "A_relevant_retrieved", intent: "Add a read replica for reporting queries", resources: ["services/api/db/pool.ts"], repository: REPO, expect: ["ADR-040"], expectFirst: "ADR-040" },
  { kind: "context", id: "A3", category: "A_relevant_retrieved", intent: "Upgrade React and the build tooling", resources: ["apps/web/src/App.tsx"], repository: REPO, expect: ["ADR-070"], expectFirst: "ADR-070" },
  { kind: "context", id: "A4", category: "A_relevant_retrieved", intent: "Renegotiate the SignalForge analytics vendor contract", resources: ["vendor:signalforge"], expect: ["PROC-007"], expectFirst: "PROC-007" },
  { kind: "context", id: "A5", category: "A_relevant_retrieved", intent: "Change how the GraphQL gateway resolves schemas", resources: ["src/api/graphql/schema.ts"], repository: REPO, expect: ["ADR-060"], expectFirst: "ADR-060" },
  { kind: "context", id: "A6", category: "A_relevant_retrieved", intent: "Increase Kafka partitions for ingestion", resources: ["services/ingest/consumer.ts"], repository: REPO, expect: ["ADR-050"], expectFirst: "ADR-050" },

  { kind: "context", id: "A7", category: "A_relevant_retrieved", intent: "A customer asks for a $180 refund on a damaged order", resources: ["policy:refunds"], expect: ["SUP-007"], expectFirst: "SUP-007" },

  // ── B: similar but irrelevant must not dominate ─────────────────────────
  { kind: "context", id: "B1", category: "B_similar_not_dominant", intent: "Use Redis to cache session lookups", resources: ["src/session/store.ts"], repository: REPO, expect: ["ADR-018"], expectFirst: "ADR-018", forbid: ["ADR-031"] },
  { kind: "context", id: "B2", category: "B_similar_not_dominant", intent: "Tune Redis rate limits for billing", resources: ["src/billing/limiter.ts"], repository: REPO, expect: ["ADR-031"], expectFirst: "ADR-031", forbid: ["ADR-018"] },
  { kind: "context", id: "B3", category: "B_similar_not_dominant", intent: "Change the marketing landing page copy", resources: ["apps/marketing/index.tsx"], repository: REPO, expect: [], forbid: ["ADR-018", "ADR-040", "PROC-007"] },

  { kind: "context", id: "B4", category: "B_similar_not_dominant", intent: "Order new office chairs for the Berlin team", resources: ["category:furniture"], expect: [], forbid: ["SUP-007", "PROC-012", "ADR-018"] },

  // ── L: action checks, before anything happens (run while SUP-007 is ACTIVE) ──
  { kind: "action", id: "L1", category: "L_action_check", action: "Refund order 1234 for $350", resources: ["policy:refunds"], facts: [{ predicate: "refund_amount_usd", valueType: "NUMBER", value: 350, unit: "USD", statement: "Refund of $350" }], expectVerdict: "stop", expectViolations: ["SUP-007"] },
  { kind: "action", id: "L2", category: "L_action_check", action: "Refund order 1235 for $150", resources: ["policy:refunds"], facts: [{ predicate: "refund_amount_usd", valueType: "NUMBER", value: 150, unit: "USD", statement: "Refund of $150" }], expectVerdict: "clear" },
  { kind: "action", id: "L3", category: "L_action_check", action: "Order new office chairs", resources: ["category:furniture"], expectVerdict: "no_decision" },
  { kind: "action", id: "L4", category: "L_action_check", action: "Sign a three-year contract with Globex", resources: ["vendor:globex"], facts: [{ subject: "vendor:globex", predicate: "annual_cost", valueType: "NUMBER", value: 120000, unit: "USD/year", statement: "Globex annual cost $120,000" }], expectVerdict: "caution", expectViolations: ["PROC-012"] },

  // ── H: superseded decisions are not active context ─────────────────────
  { kind: "context", id: "H1", category: "H_superseded_inactive", intent: "Add a new feature flag", resources: ["src/flags/checkout.yaml"], repository: REPO, expect: [], forbid: ["ADR-007"] },

  // ── I: tenant isolation (context) ───────────────────────────────────────
  { kind: "context", id: "I1", category: "I_tenant_isolation", intent: "Change the billing rate limiter", resources: ["src/billing/limiter.ts"], repository: REPO, expect: [], forbid: ["ADR-031", "ADR-040", "PROC-007"], otherTenant: true },

  // ── C: evidence supports an assumption ──────────────────────────────────
  {
    kind: "evidence", id: "C1", category: "C_evidence_supports",
    submit: { as: "human", input: { statement: "Load test: Redis session p95 is 9 ms", facts: [{ subject: "infrastructure:redis", predicate: "p95_latency_ms", valueType: "NUMBER", value: 9, unit: "ms", statement: "p95 9 ms" }] } },
    expectTransitions: {}, expectSupports: ["ADR-018:p95_latency_ms"], expectUntouched: ["ADR-018:p95_latency_ms"],
  },

  // ── D: numeric invalidation from a production metric ────────────────────
  {
    kind: "evidence", id: "D1", category: "D_numeric_invalidation",
    event: { source: "metrics", externalId: "grafana-alert-7781", type: "metric.threshold", occurredAt: "2026-09-02T00:00:00.000Z", actor: { type: "integration", label: "grafana" }, evidenceKind: "METRIC", facts: [{ subject: "database:primary", predicate: "write_throughput_per_s", valueType: "NUMBER", value: 18400, statement: "Peak writes reached 18,400/s" }], provenance: { receivedVia: "eval" } },
    expectTransitions: { "ADR-040:write_throughput_per_s": "INVALIDATED" }, expectAtRisk: ["ADR-040"],
  },

  // ── E: qualitative contradiction (needs a model; scripted here) ─────────
  {
    kind: "evidence", id: "E1", category: "E_qualitative_contradiction",
    submit: { as: "integration", input: { statement: "SignalForge announces it will discontinue EU hosting in Q1.", resources: ["vendor:signalforge"], kind: "OFFICIAL_SOURCE" } },
    // Integration evidence (authority 0.6) is within tolerance of the
    // assumption's 0.7, so a confident contradiction invalidates.
    expectTransitions: { "PROC-007:#1": "INVALIDATED" }, expectAtRisk: ["PROC-007"],
  },

  // ── F: low-authority evidence only challenges ───────────────────────────
  {
    kind: "evidence", id: "F1", category: "F_low_authority_challenges",
    event: { source: "news", externalId: "blog-post-1", type: "article.published", occurredAt: "2026-09-03T00:00:00.000Z", actor: { type: "integration", label: "rss" }, evidenceKind: "EXTERNAL_REPORT", facts: [{ subject: "vendor:signalforge", predicate: "annual_cost", valueType: "NUMBER", value: 60000, unit: "USD/year", statement: "A blog claims SignalForge costs $60k/year" }], provenance: { receivedVia: "eval", authority: 0.3 } },
    expectTransitions: { "PROC-007:annual_cost": "CHALLENGED" },
  },

  // ── G: high-authority evidence invalidates ──────────────────────────────
  {
    kind: "evidence", id: "G1", category: "G_high_authority_invalidates",
    event: { source: "document", externalId: "signalforge-contract-2027", type: "document.uploaded", occurredAt: "2026-09-04T00:00:00.000Z", actor: { type: "user", label: "procurement" }, evidenceKind: "OFFICIAL_SOURCE", facts: [{ subject: "vendor:signalforge", predicate: "annual_cost", valueType: "NUMBER", value: 42000, unit: "USD/year", statement: "Signed renewal: $42,000/year", quote: "$42,000 per year" }], provenance: { receivedVia: "eval", authority: 0.95 } },
    expectTransitions: { "PROC-007:annual_cost": "INVALIDATED" }, expectAtRisk: ["PROC-007"],
  },
  {
    kind: "evidence", id: "G2", category: "G_high_authority_invalidates",
    event: { source: "vendor", externalId: "trust-portal-9", type: "certification.changed", occurredAt: "2026-09-05T00:00:00.000Z", actor: { type: "integration", label: "trust-portal" }, evidenceKind: "OFFICIAL_SOURCE", facts: [{ subject: "vendor:signalforge", predicate: "certifications", valueType: "SET", value: ["ISO27001"], statement: "Current certifications: ISO27001 only" }], provenance: { receivedVia: "eval", authority: 0.9 } },
    expectTransitions: { "PROC-007:certifications": "INVALIDATED" },
  },
  {
    kind: "evidence", id: "G3", category: "G_high_authority_invalidates",
    event: github("delivery-downgrade-apollo", { changedFiles: [{ path: "package.json", status: "modified" }], dependencyChanges: [{ ecosystem: "npm", name: "@apollo/server", change: "changed", from: "^4.10.0", to: "3.13.0" }] }),
    expectTransitions: { "ADR-060:version": "INVALIDATED" }, expectAtRisk: ["ADR-060"],
  },

  // ── H: evidence about a superseded decision changes nothing ─────────────
  {
    kind: "evidence", id: "H2", category: "H_superseded_inactive",
    submit: { as: "human", input: { statement: "We now have 120 feature flags", facts: [{ subject: "service:flags", predicate: "flag_count", valueType: "NUMBER", value: 120, statement: "120 flags" }] } },
    expectTransitions: {}, expectUntouched: ["ADR-007:flag_count"],
  },

  // ── I: another tenant's evidence cannot touch this tenant ──────────────
  {
    kind: "evidence", id: "I2", category: "I_tenant_isolation", otherTenant: true,
    submit: { as: "human", input: { statement: "Revocation is no longer required", facts: [{ subject: "service:auth", predicate: "immediate_revocation_required", valueType: "BOOLEAN", value: false, statement: "not required" }] } },
    expectTransitions: {}, expectUntouched: ["ADR-018:immediate_revocation_required"],
  },

  // ── J: an agent's change violates an architecture decision ─────────────
  {
    kind: "evidence", id: "J1", category: "J_agent_change_violates",
    event: github("delivery-pr-501", { changedFiles: [{ path: "src/auth/session.ts", status: "modified" }, { path: "package.json", status: "modified" }], dependencyChanges: [{ ecosystem: "npm", name: "redis", change: "removed", from: "^4.6.0" }, { ecosystem: "npm", name: "jsonwebtoken", change: "added", to: "^9.0.0" }] }, "pull_request.opened"),
    expectTransitions: {}, expectFindings: ["ADR-018"],
  },

  // ── M: evidence from other domains' source systems, through profile extraction ──
  {
    kind: "evidence", id: "M1", category: "M_other_domain_evidence",
    event: { source: "billing", externalId: "dispute-report-2026-09", type: "dispute.report", occurredAt: "2026-09-06T00:00:00.000Z", actor: { type: "integration", label: "billing" }, evidenceKind: "METRIC", payload: { dispute_report: { segment: "Consumer", chargebackRatePct: 1.2 } }, provenance: { receivedVia: "eval" } },
    expectTransitions: { "SUP-007:chargeback_rate_pct": "INVALIDATED" }, expectAtRisk: ["SUP-007"],
  },
  {
    kind: "evidence", id: "M2", category: "M_other_domain_evidence",
    event: { source: "procurement", externalId: "quote-globex-big", type: "quote.received", occurredAt: "2026-09-07T00:00:00.000Z", actor: { type: "integration", label: "erp" }, evidenceKind: "OFFICIAL_SOURCE", payload: { quote: { vendor: "Globex", annualCost: 140000, currency: "usd" } }, provenance: { receivedVia: "eval" } },
    expectTransitions: {}, expectFindings: ["PROC-012"],
  },
  {
    kind: "evidence", id: "M3", category: "M_other_domain_evidence",
    event: { source: "procurement", externalId: "quote-globex-fine", type: "quote.received", occurredAt: "2026-09-08T00:00:00.000Z", actor: { type: "integration", label: "erp" }, evidenceKind: "OFFICIAL_SOURCE", payload: { quote: { vendor: "Initech", annualCost: 70000 } }, provenance: { receivedVia: "eval" } },
    expectTransitions: {}, expectUntouched: ["PROC-007:annual_cost"],
  },

  // ── L (continued): the same refund is now a caution, because SUP-007 is AT RISK ──
  { kind: "action", id: "L5", category: "L_action_check", action: "Refund order 1236 for $120", resources: ["policy:refunds"], facts: [{ predicate: "refund_amount_usd", valueType: "NUMBER", value: 120, unit: "USD", statement: "Refund of $120" }], expectVerdict: "caution" },

  // ── K: looks suspicious but is unrelated ────────────────────────────────
  {
    kind: "evidence", id: "K1", category: "K_suspicious_but_unrelated",
    event: github("delivery-pr-502", { changedFiles: [{ path: "apps/marketing/banner.tsx", status: "modified" }], dependencyChanges: [{ ecosystem: "npm", name: "redis-mock", change: "added", to: "0.56.3" }] }, "pull_request.opened"),
    expectTransitions: {}, expectUntouched: ["ADR-018:immediate_revocation_required", "ADR-018:p95_latency_ms"],
  },
  {
    kind: "evidence", id: "K2", category: "K_suspicious_but_unrelated",
    submit: { as: "human", input: { statement: "MetricLake quoted $90,000/year", facts: [{ subject: "vendor:metriclake", predicate: "annual_cost", valueType: "NUMBER", value: 90000, unit: "USD/year", statement: "MetricLake $90k" }] } },
    expectTransitions: {}, expectUntouched: ["PROC-007:annual_cost"],
  },
  {
    kind: "evidence", id: "K3", category: "K_suspicious_but_unrelated",
    submit: { as: "human", input: { statement: "SignalForge monthly invoice was $1,900", facts: [{ subject: "vendor:signalforge", predicate: "annual_cost", valueType: "NUMBER", value: 1900, unit: "USD/month", statement: "$1,900/month" }] } },
    expectTransitions: {}, expectUntouched: ["PROC-007:annual_cost"],
  },
];
