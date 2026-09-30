import { z } from "zod";
import { assumptionSpecSchema, OPERATORS, VALUE_TYPES } from "./assumptions/model";
import { factSchema } from "./assumptions/facts";
import { EVIDENCE_KINDS } from "./events/event";
import { resourceRefSchema } from "./resources/resources";

/**
 * Request contracts shared by every surface — REST API, MCP tools, SDK and
 * CLI parse the same schemas, so the contract cannot drift between them
 * (spec §15). Identity and workspace are never part of a contract: they
 * come from the authenticated actor.
 */

/** A resource as agents naturally write it (`src/auth/**`, `npm:redis`) or structured. */
export const resourceInputSchema = z.union([z.string().min(1).max(500), resourceRefSchema]);

const constraintRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dependency_present"), subject: z.string().min(1) }),
  z.object({ kind: z.literal("dependency_absent"), subject: z.string().min(1) }),
  z.object({ kind: z.literal("path_protected"), paths: z.array(z.string().min(1)).min(1), repository: z.string().nullish() }),
  z.object({
    kind: z.literal("fact_bound"),
    subject: z.string().max(200).nullish(),
    predicate: z.string().min(1).max(200),
    operator: z.enum(OPERATORS),
    value: z.union([z.number(), z.boolean(), z.string(), z.array(z.string())]),
    unit: z.string().max(60).nullish(),
    valueType: z.enum(VALUE_TYPES).optional(),
  }),
  z.object({ kind: z.literal("resource_protected"), resources: z.array(z.string().min(1).max(500)).min(1).max(100) }),
  z.object({ kind: z.literal("manual") }),
]);

export const constraintInputSchema = z.object({
  statement: z.string().min(1).max(1000),
  rule: constraintRuleSchema.default({ kind: "manual" }),
  severity: z.enum(["ADVISORY", "BLOCKING"]).default("ADVISORY"),
});

/**
 * A verification check is matched against the exact completed GitHub Actions
 * workflow name and repository. It records evidence; it never blocks a merge.
 */
export const decisionVerificationCheckSchema = z.object({
  name: z.string().trim().min(1).max(200),
  repository: z.string().trim().min(3).max(200).transform((v) => v.toLowerCase()),
  kind: z.enum(["TEST", "BENCHMARK", "RUNTIME"]).default("TEST"),
  description: z.string().max(1000).nullish(),
});

export const decisionDraftSchema = z.object({
  title: z.string().min(1).max(200),
  problem: z.string().max(4000).nullish(),
  chosenOption: z.object({ name: z.string().min(1).max(200), description: z.string().max(2000).nullish() }),
  alternatives: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        description: z.string().max(2000).nullish(),
        rejectionReason: z.string().max(2000).nullish(),
      }),
    )
    .max(20)
    .default([]),
  rationale: z.string().max(8000).nullish(),
  assumptions: z.array(assumptionSpecSchema).max(50).default([]),
  constraints: z.array(constraintInputSchema).max(50).default([]),
  verificationChecks: z.array(decisionVerificationCheckSchema).max(20).default([]),
  resources: z.array(resourceInputSchema).max(200).default([]),
  repository: z.string().max(200).nullish(),
  /** Defaults to the deployment's primary domain (engineering unless configured). */
  domain: z.string().max(60).optional(),
  scope: z.string().max(200).nullish(),
  externalRef: z.string().max(100).nullish(),
  tags: z.array(z.string().max(60)).max(30).default([]),
  importance: z.number().min(0).max(1).default(0.6),
  confidence: z.number().min(0).max(1).default(0.7),
  sourceRefs: z
    .array(z.object({ type: z.string().max(40), ref: z.string().max(500), url: z.string().max(2000).nullish() }))
    .max(20)
    .default([]),
  /** Decisions this one depends on (creates decision_dependencies rows). */
  dependsOn: z.array(z.string().uuid()).max(20).default([]),
  /** Decision this proposal would replace, if accepted. */
  supersedes: z.string().uuid().nullish(),
});
export type DecisionDraftInput = z.input<typeof decisionDraftSchema>;
export type DecisionDraft = z.output<typeof decisionDraftSchema>;

export const evidenceSubmissionSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS).default("OBSERVATION"),
  /** One-line human statement of what was observed. */
  statement: z.string().min(1).max(2000),
  /** Optional longer untrusted text (report excerpt, log, PR body). */
  text: z.string().max(50_000).nullish(),
  facts: z.array(factSchema).max(100).default([]),
  resources: z.array(resourceInputSchema).max(200).default([]),
  repository: z.string().max(200).nullish(),
  subject: z.string().max(200).nullish(),
  sourceRef: z.string().max(2000).nullish(),
  occurredAt: z.string().datetime({ offset: true }).nullish(),
  /** Client idempotency key; defaults to a content hash. */
  idempotencyKey: z.string().min(8).max(200).nullish(),
});
export type EvidenceSubmissionInput = z.input<typeof evidenceSubmissionSchema>;

export const contextRequestSchema = z.object({
  intent: z.string().min(1).max(2000),
  repository: z.string().max(200).nullish(),
  resources: z.array(resourceInputSchema).max(200).default([]),
  maxDecisions: z.number().int().min(1).max(20).default(5),
  includeSuperseded: z.boolean().default(false),
  /** External agent identity for the Agent Run Inspector. */
  agent: z.string().max(60).nullish(),
  agentSessionId: z.string().max(200).nullish(),
});
export type ContextRequestInput = z.input<typeof contextRequestSchema>;

/**
 * A dry run before an action with side effects (a refund, a purchase order, an
 * email, a contract): which standing decisions govern it, and would the
 * values it is about to use break a constraint? Writes no evidence.
 */
export const actionCheckSchema = z.object({
  /** What the agent intends to do, in a sentence. */
  action: z.string().min(1).max(2000),
  /** The things the action touches: `customer:acme`, `policy:refunds`, `vendor:signalforge`. */
  resources: z.array(resourceInputSchema).max(200).default([]),
  /** Values the action would use or create, e.g. a refund amount. Compared with constraints by code. */
  facts: z.array(factSchema).max(100).default([]),
  repository: z.string().max(200).nullish(),
  maxDecisions: z.number().int().min(1).max(20).default(5),
  agent: z.string().max(60).nullish(),
  agentSessionId: z.string().max(200).nullish(),
});
export type ActionCheckInput = z.input<typeof actionCheckSchema>;

/**
 * An event from a source system (ERP, billing, helpdesk, analytics) sent with
 * an integration key bound to that source. The source and its trust come
 * from the key and the domain profile — never from this body.
 */
export const sourceEventSchema = z.object({
  type: z.string().min(1).max(120),
  externalId: z.string().min(1).max(300),
  occurredAt: z.string().datetime({ offset: true }).nullish(),
  subject: z.string().max(200).nullish(),
  text: z.string().max(50_000).nullish(),
  kind: z.enum(EVIDENCE_KINDS).default("OBSERVATION"),
  facts: z.array(factSchema).max(200).default([]),
  resources: z.array(resourceInputSchema).max(200).default([]),
  payload: z.record(z.unknown()).default({}),
  sourceRef: z.string().max(2000).nullish(),
});
export type SourceEventInput = z.input<typeof sourceEventSchema>;

export const searchRequestSchema = z.object({
  query: z.string().min(1).max(2000),
  statuses: z.array(z.enum(["DRAFT", "ACTIVE", "AT_RISK", "REOPENED", "SUPERSEDED", "ARCHIVED"])).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const outcomeSchema = z.object({
  decisionId: z.string().uuid(),
  summary: z.string().min(1).max(4000),
  sentiment: z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]).default("NEUTRAL"),
});

export const approvalResolutionSchema = z.object({
  action: z.enum(["approve", "reject", "request_evidence", "link", "supersede_old"]),
  note: z.string().max(2000).nullish(),
  /** For `link`: the existing decision the proposal duplicates. */
  linkDecisionId: z.string().uuid().nullish(),
});

export const conflictResolutionSchema = z.object({
  note: z.string().max(2000).nullish(),
});

export const proposeAssumptionSchema = z.object({
  decisionId: z.string().uuid(),
  assumption: assumptionSpecSchema,
  reason: z.string().max(2000).nullish(),
});
