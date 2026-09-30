import type { Fact } from "../assumptions/facts";
import type { EvidenceKind, EventActor } from "../events/event";
import type { ResourceRef } from "../resources/resources";
import type { AssumptionValidity, EvidenceRelation } from "./domain";

/** Records for the 2.0 tables (db/migrations/0005). */

export type Scope = "read" | "propose" | "write" | "admin";

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  scopes: Scope[];
  actorType: "user" | "agent" | "integration";
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface EvidenceItem {
  id: string;
  tenantId: string;
  projectId: string | null;
  eventId: string | null;
  documentId: string | null;
  kind: EvidenceKind;
  source: string;
  sourceRef: string | null;
  subject: string | null;
  authority: number;
  confidence: number;
  occurredAt: string;
  ingestedAt: string;
  content: string | null;
  contentHash: string;
  facts: Fact[];
  resources: ResourceRef[];
  provenance: Record<string, unknown>;
  actor: EventActor;
  supersedesEvidenceId: string | null;
}

export type EvaluationMethod = "DETERMINISTIC" | "SEMANTIC" | "UNAVAILABLE" | "SKIPPED";

export interface AssumptionEvaluation {
  id: string;
  tenantId: string;
  agentRunId: string | null;
  eventId: string | null;
  evidenceItemId: string | null;
  assumptionId: string;
  decisionId: string;
  fact: Fact | null;
  method: EvaluationMethod;
  relation: EvidenceRelation;
  confidence: number;
  evidenceAuthority: number;
  assumptionAuthority: number;
  previousValidity: AssumptionValidity;
  nextValidity: AssumptionValidity | null;
  decisionFlagged: boolean;
  matchedPolicies: string[];
  actions: string[];
  explanation: string;
  retrievalScore: number | null;
  createdAt: string;
}

export type ApprovalKind = "COMMIT_DECISION" | "ADD_ASSUMPTION" | "REVIEW_CONFLICT" | "SUPERSEDE_DECISION";
export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "NEEDS_EVIDENCE"
  | "LINKED"
  | "SUPERSEDED_OLD";

export interface ApprovalRequest {
  id: string;
  tenantId: string;
  kind: ApprovalKind;
  decisionId: string | null;
  relatedDecisionIds: string[];
  conflictId: string | null;
  payload: Record<string, unknown> | null;
  reason: string;
  requestedByType: string;
  requestedByLabel: string | null;
  agentSessionId: string | null;
  status: ApprovalStatus;
  resolvedBy: string | null;
  resolvedByLabel: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "DEAD";

export interface Job {
  id: string;
  tenantId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedBy: string | null;
  lockedAt: string | null;
  dedupeKey: string | null;
  lastError: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AgentSession {
  id: string;
  tenantId: string;
  agent: string;
  externalSessionId: string;
  repository: string | null;
  intent: string | null;
  status: "ACTIVE" | "ENDED";
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  outcome: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ConstraintFinding {
  id: string;
  tenantId: string;
  decisionId: string;
  constraintId: string;
  eventId: string | null;
  evidenceItemId: string | null;
  explanation: string;
  status: "OPEN" | "ACKNOWLEDGED" | "FALSE_POSITIVE" | "ACCEPTED";
  resolutionNote: string | null;
  resolvedByLabel: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface DecisionDependency {
  id: string;
  tenantId: string;
  decisionId: string;
  targetType: "ASSUMPTION" | "DECISION" | "RESOURCE" | "POLICY" | "METRIC" | "VENDOR" | "PACKAGE" | "SERVICE";
  targetId: string | null;
  targetKey: string | null;
  relationship: string;
  importance: number;
  createdAt: string;
}

export interface RepositoryBinding {
  id: string;
  tenantId: string;
  projectId: string | null;
  provider: string;
  repository: string;
  installationId: string | null;
  advisoryMode: boolean;
  createdAt: string;
}

/** Immutable receipt from a completed, signature-verified external check. */
export interface DecisionVerificationRun {
  id: string;
  tenantId: string;
  decisionId: string;
  eventId: string | null;
  source: string;
  sourceRunId: string;
  checkName: string;
  repository: string;
  commitSha: string;
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "stale" | "skipped" | "startup_failure";
  detailsUrl: string | null;
  completedAt: string;
  createdAt: string;
}

/**
 * Who is acting, resolved by the surface that authenticated them. Services
 * take this instead of trusting identity claims inside request bodies.
 */
export interface Actor {
  tenantId: string;
  type: "user" | "agent" | "integration" | "system";
  /** users.id for signed-in humans; null for keys and system. */
  userId: string | null;
  label: string;
  scopes: Scope[];
  apiKeyId?: string | null;
  agentSessionId?: string | null;
  /** Stable id of the conversation/session doing the work (cross-session provenance). */
  sessionId?: string | null;
}
