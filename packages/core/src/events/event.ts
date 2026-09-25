import { z } from "zod";
import { factSchema } from "../assumptions/facts";
import { resourceRefSchema } from "../resources/resources";

/**
 * Canonical DecisionLoop event (docs/v2/00-audit-and-plan.md §7).
 *
 * Every external change — a merged PR, a pricing sheet, a CI failure, an
 * agent's report, a human's statement — enters as one of these. The inbox
 * deduplicates on (workspace, source, externalId), so a webhook retried by
 * GitHub five times produces one event, one evidence item and at most one
 * conflict per assumption.
 *
 * `workspaceId` is never taken from the payload: the receiving surface
 * resolves it from the authenticated key, the verified webhook's repository
 * binding, or the session.
 *
 * `text` is untrusted third-party content. It is evidence to analyse, never
 * an instruction (spec §33) — see safety/promptSafety.ts.
 */

export const actorSchema = z.object({
  type: z.enum(["user", "agent", "integration", "system"]),
  id: z.string().max(200).nullish(),
  label: z.string().max(200).nullish(),
});
export type EventActor = z.infer<typeof actorSchema>;

export const eventProvenanceSchema = z.object({
  url: z.string().max(2000).nullish(),
  /** Authority claimed by the *receiving surface*, never by the payload. */
  authority: z.number().min(0).max(1).nullish(),
  receivedVia: z.string().max(100),
  signatureVerified: z.boolean().nullish(),
});

export const EVIDENCE_KINDS = [
  "OBSERVATION",
  "DOCUMENT",
  "METRIC",
  "CODE_DIFF",
  "TEST_RESULT",
  "DEPLOYMENT_RESULT",
  "HUMAN_STATEMENT",
  "OFFICIAL_SOURCE",
  "EXTERNAL_REPORT",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const inboundEventSchema = z.object({
  source: z.string().min(1).max(60),
  externalId: z.string().min(1).max(300),
  type: z.string().min(1).max(120),
  occurredAt: z.string().datetime({ offset: true }),
  actor: actorSchema,
  resources: z.array(resourceRefSchema).max(500).default([]),
  facts: z.array(factSchema).max(200).default([]),
  /** Bounded untrusted free text: PR body, document excerpt, report. */
  text: z.string().max(50_000).nullish(),
  subject: z.string().max(200).nullish(),
  evidenceKind: z.enum(EVIDENCE_KINDS).default("OBSERVATION"),
  payload: z.record(z.unknown()).default({}),
  provenance: eventProvenanceSchema,
});

export type InboundEventInput = z.input<typeof inboundEventSchema>;
export type InboundEvent = z.output<typeof inboundEventSchema>;

export const EVENT_STATUSES = ["RECEIVED", "PROCESSING", "PROCESSED", "FAILED", "IGNORED"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export interface StoredEvent extends InboundEvent {
  id: string;
  workspaceId: string;
  receivedAt: string;
  status: EventStatus;
  attempts: number;
  lastError: string | null;
  processedAt: string | null;
  result: Record<string, unknown> | null;
}

/** Events DecisionLoop itself emits after evaluating something. */
export const EMITTED_EVENT_TYPES = [
  "assumption.supported",
  "assumption.challenged",
  "assumption.invalidated",
  "decision.at_risk",
  "decision.reopened",
  "decision.superseded",
  "approval.required",
  "constraint.violated",
  "notification.requested",
] as const;
export type EmittedEventType = (typeof EMITTED_EVENT_TYPES)[number];

export interface EmittedEvent {
  type: EmittedEventType;
  workspaceId: string;
  decisionId?: string | null;
  assumptionId?: string | null;
  constraintId?: string | null;
  conflictId?: string | null;
  approvalId?: string | null;
  causedByEventId?: string | null;
  summary: string;
}
