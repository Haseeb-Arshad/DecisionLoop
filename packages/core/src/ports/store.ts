import type { AssumptionSpec } from "../assumptions/model";
import type { Fact } from "../assumptions/facts";
import type { EventActor, EvidenceKind, InboundEvent, StoredEvent } from "../events/event";
import type { PolicyRule } from "../policy/policy";
import type { ResourceRef } from "../resources/resources";
import type {
  ActorType,
  AgentIntent,
  AgentRun,
  Assumption,
  AssumptionValidity,
  ConflictEvent,
  ConflictResolution,
  ConflictType,
  ConstraintRule,
  Decision,
  DecisionOrigin,
  DecisionResource,
  DecisionStatus,
  DecisionWithDetails,
  MemoryEvent,
  MemoryEventType,
  MemoryEntityType,
  MemoryChunkCandidate,
  MemorySourceType,
  ScoredMemoryCandidate,
  ScoringWeights,
} from "../types/domain";
import type {
  AgentSession,
  ApiKeyRecord,
  ApprovalKind,
  ApprovalRequest,
  ApprovalStatus,
  AssumptionEvaluation,
  ConstraintFinding,
  DecisionDependency,
  EvaluationMethod,
  EvidenceItem,
  Job,
  RepositoryBinding,
  Scope,
} from "../types/records";

/**
 * The storage port (spec §16). Every surface — HTTP API, MCP, CLI, worker,
 * web app — reaches persistent state only through this interface, so the
 * business rules in services/ exist exactly once.
 *
 * Every method that reads or writes workspace data takes `tenantId` and must
 * scope by it in the query itself (never by filtering results afterwards).
 *
 * `transaction` runs `fn` against a store bound to one database
 * transaction. Anything that changes an assumption's validity or a
 * decision's status must happen inside one, together with the record that
 * explains it (docs/v2 §4.2).
 */
export interface DecisionStore {
  transaction<T>(fn: (tx: DecisionStore) => Promise<T>): Promise<T>;

  // ── Machine credentials ──────────────────────────────────────────────────
  createApiKey(input: {
    tenantId: string;
    name: string;
    keyPrefix: string;
    keyHash: string;
    scopes: Scope[];
    actorType: ApiKeyRecord["actorType"];
    createdBy?: string | null;
  }): Promise<ApiKeyRecord>;
  findApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  touchApiKey(id: string): Promise<void>;
  revokeApiKey(tenantId: string, id: string): Promise<void>;
  listApiKeys(tenantId: string): Promise<ApiKeyRecord[]>;

  // ── Workspaces (bootstrap only; accounts live in the web app) ────────────
  createWorkspace(name: string): Promise<{ id: string; name: string; slug: string }>;
  getWorkspace(id: string): Promise<{ id: string; name: string; slug: string } | null>;
  findWorkspaceBySlug(slug: string): Promise<{ id: string; name: string; slug: string } | null>;
  getOrCreateDefaultProject(tenantId: string): Promise<{ id: string; name: string }>;

  // ── Decisions ────────────────────────────────────────────────────────────
  insertDecision(input: NewDecisionRecord): Promise<DecisionWithDetails>;
  getDecision(tenantId: string, id: string): Promise<DecisionWithDetails | null>;
  getDecisionByExternalRef(tenantId: string, ref: string): Promise<DecisionWithDetails | null>;
  listDecisions(
    tenantId: string,
    opts?: { statuses?: DecisionStatus[]; ids?: string[]; domain?: string; limit?: number },
  ): Promise<DecisionWithDetails[]>;
  /** Transition-checked status change (lifecycle/decisionStatus.ts). */
  updateDecisionStatus(
    tenantId: string,
    id: string,
    to: DecisionStatus,
    opts?: { riskExplanation?: string | null; supersededByDecisionId?: string | null },
  ): Promise<Decision>;
  markDecisionReviewed(tenantId: string, id: string): Promise<void>;
  setMemoryIndexStatus(tenantId: string, id: string, status: "PENDING" | "INDEXED" | "FAILED", error?: string | null): Promise<void>;

  /** Resources recorded on active-ish decisions, for structural matching in core. */
  listResourcesForMatching(
    tenantId: string,
    opts: { types?: string[]; statuses?: DecisionStatus[]; limit?: number },
  ): Promise<DecisionResource[]>;

  // ── Assumptions ──────────────────────────────────────────────────────────
  getAssumption(tenantId: string, id: string): Promise<Assumption | null>;
  addAssumption(tenantId: string, decisionId: string, spec: AssumptionSpec): Promise<Assumption>;
  /**
   * Structural candidate lookup: live assumptions whose normalized predicate
   * matches one of `predicates`. This is how a structured fact finds the
   * assumption it bears on without any embedding at all.
   */
  findAssumptionsByPredicates(
    tenantId: string,
    predicates: string[],
  ): Promise<Assumption[]>;
  setAssumptionValidity(
    tenantId: string,
    id: string,
    validity: AssumptionValidity,
    opts?: { evidenceItemId?: string | null },
  ): Promise<void>;
  touchAssumptionEvaluated(tenantId: string, ids: string[]): Promise<void>;
  /**
   * Live assumptions on live decisions whose `valid_until` has passed and
   * that are still VALID/UNCERTAIN. Cross-tenant by design: only the system
   * expiry sweep calls it, and it processes each row within its own tenant.
   */
  listExpiredAssumptions(now: Date, limit: number): Promise<Array<{ tenantId: string; assumption: Assumption }>>;

  // ── Memory surface (vector + hybrid retrieval) ───────────────────────────
  replaceDecisionMemory(
    tenantId: string,
    decisionId: string,
    chunks: Array<{
      sourceType: "decision" | "assumption";
      sourceId: string;
      content: string;
      embedding: number[];
      embeddingModel: string;
      importance: number;
      authorityScore: number;
      originSessionId: string | null;
    }>,
  ): Promise<number>;
  searchMemory(
    tenantId: string,
    embedding: number[],
    opts: { limit: number; sourceType?: MemorySourceType; embeddingModel?: string },
  ): Promise<{ candidates: MemoryChunkCandidate[]; renderedSql: string; latencyMs: number }>;

  // ── Events and evidence ──────────────────────────────────────────────────
  /** Idempotent on (tenant, source, externalId): `created: false` on replays. */
  insertEvent(tenantId: string, event: InboundEvent): Promise<{ event: StoredEvent; created: boolean }>;
  getEvent(tenantId: string, id: string): Promise<StoredEvent | null>;
  listEvents(tenantId: string, opts?: { limit?: number; status?: string }): Promise<StoredEvent[]>;
  updateEventStatus(
    tenantId: string,
    id: string,
    status: StoredEvent["status"],
    opts?: { error?: string | null; result?: Record<string, unknown> | null; incrementAttempts?: boolean },
  ): Promise<void>;

  /** Insert-only; idempotent on (tenant, source, contentHash). */
  insertEvidence(input: NewEvidenceRecord): Promise<{ evidence: EvidenceItem; created: boolean }>;
  getEvidence(tenantId: string, id: string): Promise<EvidenceItem | null>;
  listEvidence(tenantId: string, opts?: { limit?: number; eventId?: string }): Promise<EvidenceItem[]>;
  linkEvidenceToDecision(input: {
    tenantId: string;
    decisionId: string;
    assumptionId: string | null;
    evidenceItemId: string;
    evidenceType: "SUPPORTING" | "CONTRADICTING" | "CONTEXT";
    relevance: number;
    excerpt: string | null;
  }): Promise<void>;

  // ── Evaluations, conflicts, constraint findings ──────────────────────────
  insertEvaluation(input: Omit<AssumptionEvaluation, "id" | "createdAt">): Promise<AssumptionEvaluation>;
  listEvaluations(
    tenantId: string,
    opts: { eventId?: string; assumptionId?: string; decisionId?: string; limit?: number },
  ): Promise<AssumptionEvaluation[]>;

  /** Idempotent on (tenant, assumption, evidenceItem). */
  insertConflict(input: NewConflictRecord): Promise<{ conflict: ConflictEvent; created: boolean }>;
  getConflict(tenantId: string, id: string): Promise<ConflictEvent | null>;
  listConflicts(
    tenantId: string,
    opts?: { decisionId?: string; decisionIds?: string[]; unresolvedOnly?: boolean; limit?: number },
  ): Promise<ConflictEvent[]>;
  resolveConflict(
    tenantId: string,
    id: string,
    resolution: ConflictResolution,
    by: { userId: string | null; label: string; note?: string | null },
  ): Promise<ConflictEvent>;

  insertConstraintFinding(input: {
    tenantId: string;
    decisionId: string;
    constraintId: string;
    eventId: string | null;
    evidenceItemId: string | null;
    explanation: string;
  }): Promise<{ finding: ConstraintFinding; created: boolean }>;
  listConstraintFindings(tenantId: string, opts?: { eventId?: string; status?: string; limit?: number }): Promise<ConstraintFinding[]>;
  resolveConstraintFinding(
    tenantId: string,
    id: string,
    status: ConstraintFinding["status"],
    by: { label: string; note?: string | null },
  ): Promise<ConstraintFinding | null>;

  // ── Approvals ────────────────────────────────────────────────────────────
  insertApproval(input: {
    tenantId: string;
    kind: ApprovalKind;
    decisionId: string | null;
    relatedDecisionIds?: string[];
    conflictId?: string | null;
    payload?: Record<string, unknown> | null;
    reason: string;
    requestedByType: string;
    requestedByLabel?: string | null;
    agentSessionId?: string | null;
    dedupeKey?: string | null;
  }): Promise<{ approval: ApprovalRequest; created: boolean }>;
  getApproval(tenantId: string, id: string): Promise<ApprovalRequest | null>;
  listApprovals(tenantId: string, opts?: { status?: ApprovalStatus; decisionId?: string; limit?: number }): Promise<ApprovalRequest[]>;
  resolveApproval(
    tenantId: string,
    id: string,
    status: Exclude<ApprovalStatus, "PENDING">,
    by: { userId: string | null; label: string; note?: string | null },
  ): Promise<ApprovalRequest>;

  // ── Dependencies ─────────────────────────────────────────────────────────
  insertDependencies(tenantId: string, decisionId: string, deps: NewDependency[]): Promise<void>;
  listDependencies(
    tenantId: string,
    opts: { decisionIds?: string[]; targetIds?: string[]; targetKeys?: string[] },
  ): Promise<DecisionDependency[]>;

  // ── Outcomes ─────────────────────────────────────────────────────────────
  insertOutcome(input: {
    tenantId: string;
    decisionId: string;
    summary: string;
    sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
    recordedBy: string | null;
  }): Promise<{ id: string }>;

  // ── Provenance trail ─────────────────────────────────────────────────────
  recordMemoryEvent(input: {
    tenantId: string;
    projectId?: string | null;
    entityType: MemoryEntityType;
    entityId: string;
    decisionId?: string | null;
    eventType: MemoryEventType;
    agentRunId?: string | null;
    actorType: ActorType;
    actorUserId?: string | null;
    summary?: string | null;
    metadata?: Record<string, unknown> | null;
    dedupeKey?: string | null;
  }): Promise<void>;
  listMemoryEvents(tenantId: string, decisionId: string): Promise<MemoryEvent[]>;
  recordAudit(input: {
    tenantId: string;
    actorUserId?: string | null;
    actorLabel?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void>;
  recordTrace(input: {
    tenantId: string;
    agentRunId: string | null;
    actionType: string;
    relatedDecisionId?: string | null;
    queryText: string | null;
    renderedSql: string | null;
    candidates: ScoredMemoryCandidate[];
    usedChunkIds: string[];
    llmReasoning: string | null;
    retrievalLatencyMs?: number | null;
    scoringWeights?: ScoringWeights | null;
  }): Promise<{ id: string }>;
  recordRetrievalEvents(input: {
    tenantId: string;
    agentRunId: string | null;
    memoryTraceId: string | null;
    candidates: ScoredMemoryCandidate[];
  }): Promise<void>;

  // ── Agent sessions and runs ──────────────────────────────────────────────
  upsertAgentSession(input: {
    tenantId: string;
    agent: string;
    externalSessionId: string;
    repository?: string | null;
    intent?: string | null;
    apiKeyId?: string | null;
  }): Promise<AgentSession>;
  endAgentSession(tenantId: string, id: string, outcome: string | null): Promise<void>;
  getAgentSession(tenantId: string, id: string): Promise<AgentSession | null>;
  listAgentSessions(tenantId: string, opts?: { limit?: number }): Promise<AgentSession[]>;
  startRun(input: {
    tenantId: string;
    sessionId: string;
    intent: AgentIntent;
    request: string | null;
    agentSessionId?: string | null;
    eventId?: string | null;
    createdBy?: string | null;
  }): Promise<AgentRun>;
  completeRun(
    tenantId: string,
    id: string,
    input: {
      status: "SUCCEEDED" | "FAILED";
      latencyMs: number;
      retrievalLatencyMs?: number | null;
      memoriesRetrieved?: number;
      memoriesWritten?: number;
      conflictsDetected?: number;
      outputSummary?: string | null;
      error?: string | null;
      details?: Record<string, unknown> | null;
    },
  ): Promise<void>;
  listRuns(tenantId: string, opts: { agentSessionId?: string; eventId?: string; limit?: number }): Promise<Array<AgentRun & { details: Record<string, unknown> | null }>>;

  // ── Durable jobs ─────────────────────────────────────────────────────────
  enqueueJob(input: {
    tenantId: string | null;
    kind: string;
    payload: Record<string, unknown>;
    dedupeKey?: string | null;
    runAfter?: Date | null;
    maxAttempts?: number;
  }): Promise<{ job: Job; created: boolean }>;
  /** Claims up to `limit` runnable jobs with FOR UPDATE SKIP LOCKED. */
  claimJobs(workerId: string, limit: number, opts?: { kinds?: string[]; lockTimeoutMs?: number }): Promise<Job[]>;
  completeJob(id: string, result: Record<string, unknown> | null): Promise<void>;
  /** Reschedules with backoff, or moves to DEAD when attempts are exhausted. */
  failJob(id: string, error: string, retryAt: Date | null): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  listJobs(opts: { tenantId?: string | null; status?: Job["status"]; limit?: number }): Promise<Job[]>;

  // ── Configuration ────────────────────────────────────────────────────────
  listWorkspacePolicies(tenantId: string): Promise<PolicyRule[]>;
  findRepositoryBinding(provider: string, repository: string): Promise<RepositoryBinding | null>;
  upsertRepositoryBinding(input: {
    tenantId: string;
    provider: string;
    repository: string;
    projectId?: string | null;
    installationId?: string | null;
    advisoryMode?: boolean;
  }): Promise<RepositoryBinding>;
}

export interface NewDecisionRecord {
  tenantId: string;
  projectId: string | null;
  title: string;
  problemStatement: string | null;
  reasoning: string | null;
  status: DecisionStatus;
  confidence: number;
  importance: number;
  domain: string;
  scope: string | null;
  origin: DecisionOrigin;
  decidedByType: ActorType;
  decidedByLabel: string | null;
  externalRef: string | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  sourceRefs: Array<{ type: string; ref: string; url?: string | null }>;
  createdBy: string | null;
  createdInSession: string | null;
  agentSessionId: string | null;
  options: Array<{ name: string; description: string | null; isChosen: boolean; rejectionReason: string | null }>;
  assumptions: AssumptionSpec[];
  resources: ResourceRef[];
  constraints: Array<{ statement: string; rule: ConstraintRule; severity: "ADVISORY" | "BLOCKING" }>;
}

export interface NewEvidenceRecord {
  tenantId: string;
  projectId: string | null;
  eventId: string | null;
  documentId?: string | null;
  kind: EvidenceKind;
  source: string;
  sourceRef: string | null;
  subject: string | null;
  authority: number;
  confidence: number;
  occurredAt: string;
  content: string | null;
  contentHash: string;
  facts: Fact[];
  resources: ResourceRef[];
  provenance: Record<string, unknown>;
  actor: EventActor;
  supersedesEvidenceId?: string | null;
}

export interface NewConflictRecord {
  tenantId: string;
  decisionId: string;
  assumptionId: string;
  evidenceItemId: string | null;
  eventId: string | null;
  evaluationId: string | null;
  agentRunId: string | null;
  factStatement: string;
  explanation: string;
  conflictType: ConflictType;
  relation: "CONTRADICTS" | "UPDATES";
  confidence: number;
  oldValue: string | null;
  newValue: string | null;
  sourceQuote: string | null;
  detectionMethod: "DETERMINISTIC" | "SEMANTIC";
  memoryTraceId?: string | null;
}

export interface NewDependency {
  targetType: DecisionDependency["targetType"];
  targetId?: string | null;
  targetKey?: string | null;
  relationship?: string;
  importance?: number;
}

export type { EvaluationMethod };
