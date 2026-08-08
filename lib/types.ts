// Shared domain types. Field names are camelCase here — the repo layer
// (lib/repo/*) is the only place that translates to/from the DB's snake_case
// columns, so nothing above the repo layer ever sees a raw SQL row shape.

export type DecisionStatus = "ACTIVE" | "AT_RISK" | "RECONSIDERED" | "ARCHIVED";
export type AssumptionStatus = "VALID" | "INVALIDATED";
export type DocumentStatus = "UPLOADED" | "PROCESSING" | "PROCESSED" | "FAILED";
export type MemorySourceType = "decision" | "assumption" | "document";
export type MemoryTraceAction =
  | "retrieval"
  | "conflict_check"
  | "extraction"
  | "mcp_verify";
export type AssumptionOperator = "<" | "<=" | ">" | ">=" | "=";

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
  metric: string | null;
  operator: AssumptionOperator | null;
  value: number | null;
  unit: string | null;
  status: AssumptionStatus;
  createdAt: string;
  invalidatedAt: string | null;
}

export interface Decision {
  id: string;
  tenantId: string;
  title: string;
  problemStatement: string | null;
  reasoning: string | null;
  status: DecisionStatus;
  riskExplanation: string | null;
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
  uploadedBy: string | null;
  filename: string;
  mimeType: string | null;
  s3Key: string;
  sizeBytes: number | null;
  extractedText: string | null;
  status: DocumentStatus;
  processingError: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface MemoryChunk {
  id: string;
  tenantId: string;
  sourceType: MemorySourceType;
  sourceId: string;
  decisionId: string | null;
  content: string;
  embeddingModel: string;
  createdAt: string;
}

export interface MemoryChunkCandidate {
  chunkId: string;
  sourceType: MemorySourceType;
  sourceId: string;
  decisionId: string | null;
  contentPreview: string;
  similarity: number;
}

export interface ConflictEvent {
  id: string;
  tenantId: string;
  decisionId: string;
  assumptionId: string;
  documentId: string | null;
  factStatement: string;
  explanation: string;
  suggestedOptionId: string | null;
  memoryTraceId: string | null;
  detectedAt: string;
}

export interface McpVerification {
  verified: boolean;
  toolCalls: Array<{ tool: string; input: unknown; output: unknown }>;
  rawRows: unknown[];
  error?: string;
}

export interface MemoryTrace {
  id: string;
  tenantId: string;
  actionType: MemoryTraceAction;
  relatedDecisionId: string | null;
  relatedDocumentId: string | null;
  queryText: string | null;
  renderedSql: string | null;
  candidates: MemoryChunkCandidate[];
  usedChunkIds: string[];
  llmReasoning: string | null;
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

export interface ExtractedFact {
  subject: string;
  metric: string;
  operator: AssumptionOperator;
  value: number;
  unit: string;
  statement: string;
}
