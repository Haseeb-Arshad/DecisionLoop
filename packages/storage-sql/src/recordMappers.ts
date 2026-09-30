import type { StoredEvent } from "@decisionloop/core/events/event";
import type {
  AgentRun,
  ConflictEvent,
  ConflictResolution,
  ConflictType,
  DetectionMethod,
  EvidenceRelation,
  MemoryEvent,
} from "@decisionloop/core/types/domain";
import type {
  AgentSession,
  ApiKeyRecord,
  ApprovalRequest,
  AssumptionEvaluation,
  ConstraintFinding,
  DecisionVerificationRun,
  DecisionDependency,
  EvidenceItem,
  Job,
  ProfileOverride,
  RepositoryBinding,
  Scope,
} from "@decisionloop/core/types/records";

type Row = Record<string, unknown>;

const iso = (v: unknown): string | null => (v ? new Date(v as string | Date).toISOString() : null);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function textArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.startsWith("{")) {
    return v
      .slice(1, -1)
      .split(",")
      .map((s) => s.replace(/^"|"$/g, ""))
      .filter(Boolean);
  }
  return [];
}

export function mapApiKey(row: Row): ApiKeyRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    name: row.name as string,
    keyPrefix: row.key_prefix as string,
    scopes: textArray(row.scopes) as Scope[],
    actorType: row.actor_type as ApiKeyRecord["actorType"],
    eventSource: (row.event_source as string | null | undefined) ?? null,
    createdAt: iso(row.created_at)!,
    lastUsedAt: iso(row.last_used_at),
    revokedAt: iso(row.revoked_at),
  };
}

export function mapProfileOverride(row: Row): ProfileOverride {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    kind: row.kind as ProfileOverride["kind"],
    key: row.key as string,
    value: json<Record<string, unknown>>(row.value, {}),
    approvalId: (row.approval_id as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: iso(row.created_at)!,
  };
}

export function mapEvent(row: Row): StoredEvent {
  return {
    id: row.id as string,
    workspaceId: row.tenant_id as string,
    source: row.source as string,
    externalId: row.external_id as string,
    type: row.event_type as string,
    occurredAt: iso(row.occurred_at)!,
    receivedAt: iso(row.received_at)!,
    actor: json(row.actor, { type: "system" as const }),
    resources: json(row.resources, []),
    facts: json(row.facts, []),
    text: str(row.body_text),
    subject: str(row.subject),
    evidenceKind: (row.evidence_kind as StoredEvent["evidenceKind"]) ?? "OBSERVATION",
    payload: json(row.payload, {}),
    provenance: json(row.provenance, { receivedVia: "unknown" }),
    status: row.status as StoredEvent["status"],
    attempts: Number(row.attempts ?? 0),
    lastError: str(row.last_error),
    processedAt: iso(row.processed_at),
    result: json(row.result, null),
  };
}

export function mapEvidenceItem(row: Row): EvidenceItem {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    projectId: str(row.project_id),
    eventId: str(row.event_id),
    documentId: str(row.document_id),
    kind: row.kind as EvidenceItem["kind"],
    source: row.source as string,
    sourceRef: str(row.source_ref),
    subject: str(row.subject),
    authority: Number(row.authority),
    confidence: Number(row.confidence),
    occurredAt: iso(row.occurred_at)!,
    ingestedAt: iso(row.ingested_at)!,
    content: str(row.content),
    contentHash: row.content_hash as string,
    facts: json(row.facts, []),
    resources: json(row.resources, []),
    provenance: json(row.provenance, {}),
    actor: json(row.actor, { type: "system" as const }),
    supersedesEvidenceId: str(row.supersedes_evidence_id),
  };
}

export function mapEvaluation(row: Row): AssumptionEvaluation {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    agentRunId: str(row.agent_run_id),
    eventId: str(row.event_id),
    evidenceItemId: str(row.evidence_item_id),
    assumptionId: row.assumption_id as string,
    decisionId: row.decision_id as string,
    fact: json(row.fact, null),
    method: row.method as AssumptionEvaluation["method"],
    relation: row.relation as EvidenceRelation,
    confidence: Number(row.confidence),
    evidenceAuthority: Number(row.evidence_authority),
    assumptionAuthority: Number(row.assumption_authority),
    previousValidity: row.previous_validity as AssumptionEvaluation["previousValidity"],
    nextValidity: (str(row.next_validity) as AssumptionEvaluation["nextValidity"]) ?? null,
    decisionFlagged: Boolean(row.decision_flagged),
    matchedPolicies: json(row.matched_policies, []),
    actions: json(row.actions, []),
    explanation: row.explanation as string,
    retrievalScore: row.retrieval_score === null || row.retrieval_score === undefined ? null : Number(row.retrieval_score),
    createdAt: iso(row.created_at)!,
  };
}

export function mapConflictRow(row: Row): ConflictEvent & {
  evidenceItemId: string | null;
  eventId: string | null;
  evaluationId: string | null;
  resolutionNote: string | null;
  resolvedByLabel: string | null;
} {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    decisionId: row.decision_id as string,
    assumptionId: row.assumption_id as string,
    documentId: str(row.document_id),
    memoryChunkId: str(row.memory_chunk_id),
    agentRunId: str(row.agent_run_id),
    factStatement: row.fact_statement as string,
    explanation: row.explanation as string,
    conflictType: (row.conflict_type as ConflictType) ?? "EVIDENCE_CONTRADICTS",
    relation: (row.relation as EvidenceRelation) ?? "CONTRADICTS",
    confidence: Number(row.confidence ?? 0.8),
    oldValue: str(row.old_value),
    newValue: str(row.new_value),
    sourceQuote: str(row.source_quote),
    detectionMethod: (row.detection_method as DetectionMethod) ?? "DETERMINISTIC",
    suggestedOptionId: str(row.suggested_option_id),
    memoryTraceId: str(row.memory_trace_id),
    reviewedAt: iso(row.reviewed_at),
    resolution: (str(row.resolution) as ConflictResolution | null) ?? null,
    resolvedBy: str(row.resolved_by),
    detectedAt: iso(row.detected_at)!,
    evidenceItemId: str(row.evidence_item_id),
    eventId: str(row.event_id),
    evaluationId: str(row.evaluation_id),
    resolutionNote: str(row.resolution_note),
    resolvedByLabel: str(row.resolved_by_label),
  };
}

export function mapFinding(row: Row): ConstraintFinding {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    decisionId: row.decision_id as string,
    constraintId: row.constraint_id as string,
    eventId: str(row.event_id),
    evidenceItemId: str(row.evidence_item_id),
    explanation: row.explanation as string,
    status: row.status as ConstraintFinding["status"],
    resolutionNote: str(row.resolution_note),
    resolvedByLabel: str(row.resolved_by_label),
    reviewedAt: iso(row.reviewed_at),
    createdAt: iso(row.created_at)!,
  };
}

export function mapVerificationRun(row: Row): DecisionVerificationRun {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    decisionId: row.decision_id as string,
    eventId: str(row.event_id),
    source: row.source as string,
    sourceRunId: row.source_run_id as string,
    checkName: row.check_name as string,
    repository: row.repository as string,
    commitSha: row.commit_sha as string,
    conclusion: row.conclusion as DecisionVerificationRun["conclusion"],
    detailsUrl: str(row.details_url),
    completedAt: iso(row.completed_at)!,
    createdAt: iso(row.created_at)!,
  };
}

export function mapApproval(row: Row): ApprovalRequest {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    kind: row.kind as ApprovalRequest["kind"],
    decisionId: str(row.decision_id),
    relatedDecisionIds: json(row.related_decision_ids, []),
    conflictId: str(row.conflict_id),
    payload: json(row.payload, null),
    reason: row.reason as string,
    requestedByType: row.requested_by_type as string,
    requestedByLabel: str(row.requested_by_label),
    agentSessionId: str(row.agent_session_id),
    status: row.status as ApprovalRequest["status"],
    resolvedBy: str(row.resolved_by),
    resolvedByLabel: str(row.resolved_by_label),
    resolvedAt: iso(row.resolved_at),
    resolutionNote: str(row.resolution_note),
    createdAt: iso(row.created_at)!,
  };
}

export function mapDependency(row: Row): DecisionDependency {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    decisionId: row.decision_id as string,
    targetType: row.target_type as DecisionDependency["targetType"],
    targetId: str(row.target_id),
    targetKey: str(row.target_key),
    relationship: row.relationship as string,
    importance: Number(row.importance),
    createdAt: iso(row.created_at)!,
  };
}

export function mapJob(row: Row): Job {
  return {
    id: row.id as string,
    tenantId: str(row.tenant_id),
    kind: row.kind as string,
    payload: json(row.payload, {}),
    status: row.status as Job["status"],
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    runAfter: iso(row.run_after)!,
    lockedBy: str(row.locked_by),
    lockedAt: iso(row.locked_at),
    dedupeKey: str(row.dedupe_key),
    lastError: str(row.last_error),
    result: json(row.result, null),
    createdAt: iso(row.created_at)!,
    completedAt: iso(row.completed_at),
  };
}

export function mapSession(row: Row): AgentSession {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    agent: row.agent as string,
    externalSessionId: row.external_session_id as string,
    repository: str(row.repository),
    intent: str(row.intent),
    status: row.status as AgentSession["status"],
    startedAt: iso(row.started_at)!,
    lastSeenAt: iso(row.last_seen_at)!,
    endedAt: iso(row.ended_at),
    outcome: str(row.outcome),
    metadata: json(row.metadata, null),
  };
}

export function mapRun(row: Row): AgentRun & { details: Record<string, unknown> | null } {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    projectId: str(row.project_id),
    sessionId: row.session_id as string,
    request: str(row.request),
    intent: row.intent as AgentRun["intent"],
    model: str(row.model),
    status: row.status as AgentRun["status"],
    startedAt: iso(row.started_at)!,
    completedAt: iso(row.completed_at),
    latencyMs: row.latency_ms === null || row.latency_ms === undefined ? null : Number(row.latency_ms),
    retrievalLatencyMs:
      row.retrieval_latency_ms === null || row.retrieval_latency_ms === undefined ? null : Number(row.retrieval_latency_ms),
    memoriesRetrieved: Number(row.memories_retrieved ?? 0),
    memoriesWritten: Number(row.memories_written ?? 0),
    conflictsDetected: Number(row.conflicts_detected ?? 0),
    tokenUsage: json(row.token_usage, null),
    outputSummary: str(row.output_summary),
    error: str(row.error),
    createdBy: str(row.created_by),
    details: json(row.details, null),
  };
}

export function mapMemoryEvent(row: Row): MemoryEvent {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    projectId: str(row.project_id),
    entityType: row.entity_type as MemoryEvent["entityType"],
    entityId: row.entity_id as string,
    decisionId: str(row.decision_id),
    eventType: row.event_type as MemoryEvent["eventType"],
    agentRunId: str(row.agent_run_id),
    actorType: row.actor_type as MemoryEvent["actorType"],
    actorUserId: str(row.actor_user_id),
    summary: str(row.summary),
    metadata: json(row.metadata, null),
    createdAt: iso(row.created_at)!,
  };
}

export function mapBinding(row: Row): RepositoryBinding {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    projectId: str(row.project_id),
    provider: row.provider as string,
    repository: row.repository as string,
    installationId: str(row.installation_id),
    advisoryMode: Boolean(row.advisory_mode),
    createdAt: iso(row.created_at)!,
  };
}
