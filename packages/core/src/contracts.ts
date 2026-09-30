import { z } from "zod";
import { assumptionSpecSchema } from "./assumptions/model";
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
  domain: z.string().max(60).default("engineering"),
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
