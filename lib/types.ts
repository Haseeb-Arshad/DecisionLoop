// Shared domain types. Field names are camelCase here — the repo layer
// (lib/repo/*) is the only place that translates to/from the DB's snake_case
// columns, so nothing above the repo layer ever sees a raw SQL row shape.
//
// The vocabulary here mirrors decision.md §9–§15. See docs/memory-model.md
// for the spec-name → schema-name mapping (e.g. the spec's `organizations`
// is this codebase's `tenants`).

// ── Enumerations ────────────────────────────────────────────────────────────

export type DecisionStatus =
  | "DRAFT"
  | "ACTIVE"
  | "AT_RISK"
  | "REOPENED"
  | "SUPERSEDED"
  | "ARCHIVED";

/** §10 — a memory is not merely true or false. */
export type AssumptionValidity =
  | "VALID"
  | "UNCERTAIN"
  | "CHALLENGED"
  | "INVALIDATED"
  | "SUPERSEDED";

export type AssumptionType =
  | "QUANTITATIVE"
  | "QUALITATIVE"
  | "REGULATORY"
  | "CAPACITY"
  | "TEMPORAL";

export type DocumentStatus = "UPLOADED" | "PROCESSING" | "PROCESSED" | "FAILED";

/** §11 — drives the default authority score for evidence from this source. */
export type DocumentSourceType =
  | "CONTRACT"
  | "VENDOR_OFFICIAL"
  | "INTERNAL_ANALYSIS"
  | "NEWS"
  | "UNVERIFIED"
  | "OTHER";

export type EvidenceType = "SUPPORTING" | "CONTRADICTING" | "CONTEXT" | "OUTCOME";

/** §20 — how a new piece of evidence relates to an existing assumption. */
export type EvidenceRelation =
  | "SUPPORTS"
  | "CONTRADICTS"
  | "UPDATES"
  | "IRRELEVANT"
  | "UNCERTAIN";

/** §13 */
export type ConflictType =
  | "VALUE_CHANGED"
  | "POLICY_CHANGED"
  | "CONSTRAINT_CHANGED"
  | "EVIDENCE_CONTRADICTS"
  | "ASSUMPTION_EXPIRED"
  | "OUTCOME_DISPROVES";

export type ConflictResolution = "REOPENED" | "DISMISSED" | "ACCEPTED" | "SUPERSEDED";

export type DetectionMethod = "DETERMINISTIC" | "SEMANTIC";

/** §14 */
export type MemoryEventType =
  | "MEMORY_CREATED"
  | "MEMORY_RETRIEVED"
  | "MEMORY_REFERENCED"
  | "DECISION_COMMITTED"
  | "EVIDENCE_ADDED"
  | "ASSUMPTION_CHALLENGED"
  | "ASSUMPTION_INVALIDATED"
  | "DECISION_AT_RISK"
  | "DECISION_REOPENED"
  | "DECISION_SUPERSEDED"
  | "CONFLICT_DISMISSED"
  | "CONFLICT_ACCEPTED";

export type MemoryEntityType =
  | "decision"
  | "assumption"
  | "document"
  | "memory_chunk"
  | "conflict";

export type ActorType = "USER" | "AGENT" | "SYSTEM";

/** §15 */
export type AgentIntent =
  | "EXTRACT_DECISION"
  | "INGEST_EVIDENCE"
  | "CONFLICT_CHECK"
  | "ANSWER_QUESTION"
  | "MEMORY_ANALYSIS"
  | "UNKNOWN";

export type AgentRunStatus = "RUNNING" | "SUCCEEDED" | "FAILED";

export type MemorySourceType = "decision" | "assumption" | "document";

export type MemoryTraceAction =
  | "retrieval"
  | "conflict_check"
  | "extraction"
  | "answer"
  | "mcp_verify";

export type AssumptionOperator = "<" | "<=" | ">" | ">=" | "=";

export type OutcomeSentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

// ── Core entities ───────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

export interface UserWithPasswordHash extends User {
  passwordHash: string;
}

export interface Project {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface ProjectWithCounts extends Project {
  decisionCount: number;
  atRiskCount: number;
  documentCount: number;
}

export interface DecisionOption {
  id: string;
  decisionId: string;
  name: string;
  description: string | null;
  isChosen: boolean;
  rejectionReason: string | null;
  createdAt: string;
}

export interface Assumption {
  id: string;
  decisionId: string;
  statement: string;
  normalizedStatement: string | null;
  assumptionType: AssumptionType;
  metric: string | null;
  operator: AssumptionOperator | null;
  value: number | null;
  unit: string | null;
  validityStatus: AssumptionValidity;
  importance: number;
  confidence: number;
  authorityScore: number;
  validFrom: string;
  validUntil: string | null;
  invalidatedByEvidenceId: string | null;
  challengedAt: string | null;
  invalidatedAt: string | null;
  createdAt: string;
}

export interface Decision {
  id: string;
  tenantId: string;
  projectId: string | null;
  title: string;
  problemStatement: string | null;
  reasoning: string | null;
  status: DecisionStatus;
  confidence: number;
  importance: number;
  riskExplanation: string | null;
  supersededByDecisionId: string | null;
  reopenedAt: string | null;
  closedAt: string | null;
  createdBy: string | null;
  createdInSession: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionWithDetails extends Decision {
  options: DecisionOption[];
  assumptions: Assumption[];
}

export interface DocumentRecord {
  id: string;
  tenantId: string;
  projectId: string | null;
  uploadedBy: string | null;
  filename: string;
  mimeType: string | null;
  s3Key: string;
  sizeBytes: number | null;
  extractedText: string | null;
  status: DocumentStatus;
  sourceType: DocumentSourceType;
  authorityScore: number;
  contentHash: string | null;
  pageCount: number | null;
  processingError: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface MemoryChunk {
  id: string;
  tenantId: string;
  projectId: string | null;
  sourceType: MemorySourceType;
  sourceId: string;
  decisionId: string | null;
  content: string;
  embeddingModel: string;
  pageNumber: number | null;
  chunkIndex: number | null;
  contentHash: string | null;
  importance: number;
  authorityScore: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** A row returned by vector search, before hybrid re-scoring. */
export interface MemoryChunkCandidate {
  chunkId: string;
  sourceType: MemorySourceType;
  sourceId: string;
  decisionId: string | null;
  contentPreview: string;
  similarity: number;
  importance: number;
  authorityScore: number;
  pageNumber: number | null;
  createdAt: string;
}

/** A candidate after hybrid scoring (§16) — what the Memory Inspector shows. */
export interface ScoredMemoryCandidate extends MemoryChunkCandidate {
  semanticScore: number;
  importanceScore: number;
  authorityComponent: number;
  contextualScore: number;
  finalScore: number;
  selectedForContext: boolean;
  crossSession: boolean;
}

export interface DecisionEvidence {
  id: string;
  tenantId: string;
  decisionId: string;
  assumptionId: string | null;
  documentId: string | null;
  memoryChunkId: string | null;
  evidenceType: EvidenceType;
  relevance: number;
  excerpt: string | null;
  pageNumber: number | null;
  createdAt: string;
}

/** Evidence joined with its source document, for the Evidence Viewer. */
export interface DecisionEvidenceWithSource extends DecisionEvidence {
  documentFilename: string | null;
  documentSourceType: DocumentSourceType | null;
  documentAuthorityScore: number | null;
}

export interface DecisionOutcome {
  id: string;
  tenantId: string;
  decisionId: string;
  summary: string;
  sentiment: OutcomeSentiment;
  recordedBy: string | null;
  observedAt: string;
  createdAt: string;
}

export interface ConflictEvent {
  id: string;
  tenantId: string;
  decisionId: string;
  assumptionId: string;
  documentId: string | null;
  memoryChunkId: string | null;
  agentRunId: string | null;
  factStatement: string;
  explanation: string;
  conflictType: ConflictType;
  relation: EvidenceRelation;
  confidence: number;
  oldValue: string | null;
  newValue: string | null;
  sourceQuote: string | null;
  detectionMethod: DetectionMethod;
  suggestedOptionId: string | null;
  memoryTraceId: string | null;
  reviewedAt: string | null;
  resolution: ConflictResolution | null;
  resolvedBy: string | null;
  detectedAt: string;
}

export interface MemoryEvent {
  id: string;
  tenantId: string;
  projectId: string | null;
  entityType: MemoryEntityType;
  entityId: string;
  decisionId: string | null;
  eventType: MemoryEventType;
  agentRunId: string | null;
  actorType: ActorType;
  actorUserId: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  tenantId: string;
  projectId: string | null;
  sessionId: string;
  request: string | null;
  intent: AgentIntent;
  model: string | null;
  status: AgentRunStatus;
  startedAt: string;
  completedAt: string | null;
  latencyMs: number | null;
  retrievalLatencyMs: number | null;
  memoriesRetrieved: number;
  memoriesWritten: number;
  conflictsDetected: number;
  tokenUsage: Record<string, unknown> | null;
  outputSummary: string | null;
  error: string | null;
  createdBy: string | null;
}

export interface RetrievalEvent {
  id: string;
  tenantId: string;
  agentRunId: string | null;
  memoryTraceId: string | null;
  memoryType: MemorySourceType;
  memoryId: string;
  memoryChunkId: string | null;
  similarityScore: number;
  importanceScore: number;
  authorityScore: number;
  contextualScore: number;
  finalScore: number;
  selectedForContext: boolean;
  crossSession: boolean;
  createdAt: string;
}

export interface McpVerification {
  verified: boolean;
  toolCalls: Array<{ tool: string; input: unknown; output: unknown }>;
  rawRows: unknown[];
  error?: string;
}

export interface ScoringWeights {
  semantic: number;
  importance: number;
  authority: number;
  contextual: number;
}

export interface MemoryTrace {
  id: string;
  tenantId: string;
  agentRunId: string | null;
  actionType: MemoryTraceAction;
  relatedDecisionId: string | null;
  relatedDocumentId: string | null;
  queryText: string | null;
  renderedSql: string | null;
  candidates: ScoredMemoryCandidate[];
  usedChunkIds: string[];
  llmReasoning: string | null;
  retrievalLatencyMs: number | null;
  scoringWeights: ScoringWeights | null;
  mcpVerification: McpVerification | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  actorUserId: string | null;
  actorLabel: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ── AI payloads ─────────────────────────────────────────────────────────────

export interface ExtractedFact {
  subject: string;
  metric: string;
  operator: AssumptionOperator;
  value: number;
  unit: string;
  statement: string;
  sourceQuote: string;
}

// ── Observability (§32) ─────────────────────────────────────────────────────

export interface ObservabilityMetrics {
  activeDecisions: number;
  decisionsAtRisk: number;
  assumptionsTracked: number;
  assumptionsChallenged: number;
  conflictsDetected: number;
  conflictsUnreviewed: number;
  crossSessionRecalls: number;
  documentsIngested: number;
  memoriesStored: number;
  averageRetrievalLatencyMs: number | null;
  averageAgentLatencyMs: number | null;
  agentRuns: number;
  agentRunFailures: number;
}
