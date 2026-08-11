"use client";

// Thin typed fetch wrapper the TanStack Query hooks (lib/queries.ts) call
// into. Kept separate from the hooks so it's trivially testable / reusable
// outside React.
import type { DecisionExtractionResult } from "@/lib/ai/reasoningProvider";
import type { MemoryAnswer } from "@/lib/ai/reasoningProvider";
import type { ConflictDetectionSummary } from "@/lib/engine/conflictDetection";
import type { AnalystResult } from "@/lib/mcp/cockroachClient";
import type {
  AgentRun,
  AssumptionOperator,
  AssumptionType,
  AuditEvent,
  ConflictEvent,
  Decision,
  DecisionEvidenceWithSource,
  DecisionOutcome,
  DecisionStatus,
  DecisionWithDetails,
  DocumentRecord,
  DocumentSourceType,
  MemoryChunk,
  MemoryEvent,
  MemoryTrace,
  ObservabilityMetrics,
  Project,
  ProjectWithCounts,
  Tenant,
  User,
} from "@/lib/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export interface DecisionOptionInput {
  name: string;
  description?: string;
  isChosen: boolean;
  rejectionReason?: string;
}

export interface AssumptionInput {
  statement: string;
  assumptionType?: AssumptionType;
  metric?: string;
  operator?: AssumptionOperator;
  value?: number;
  unit?: string;
  importance?: number;
  confidence?: number;
}

export interface CreateDecisionInput {
  projectId?: string;
  title: string;
  problemStatement?: string;
  reasoning?: string;
  confidence?: number;
  importance?: number;
  options: DecisionOptionInput[];
  assumptions: AssumptionInput[];
  evidenceDocumentIds?: string[];
}

export interface DecisionDetailResponse {
  decision: DecisionWithDetails;
  conflicts: ConflictEvent[];
  traces: MemoryTrace[];
  evidence: DecisionEvidenceWithSource[];
  timeline: MemoryEvent[];
  outcomes: DecisionOutcome[];
}

export interface UploadResult {
  document: DocumentRecord;
  chunksIndexed: number;
  duplicateOf: string | null;
  conflictSummary: ConflictDetectionSummary | null;
  agentRunId: string;
}

export interface AskResponse {
  answer: MemoryAnswer;
  agentRunId: string;
  memoryTraceId: string;
  retrievalLatencyMs: number;
  retrievedCount: number;
  usedCount: number;
}

export interface ObservabilityResponse {
  metrics: ObservabilityMetrics;
  runs: AgentRun[];
  memoryEvents: MemoryEvent[];
  conflicts: ConflictEvent[];
}

export const api = {
  me: () => request<{ user: User | null; tenant: Tenant | null }>("/api/auth/me"),

  signup: (input: { workspaceName: string; name: string; email: string; password: string }) =>
    request<{ user: User; tenant: Tenant }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  login: (input: { email: string; password: string }) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(input) }),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  // ── Projects ──────────────────────────────────────────────────────────────
  listProjects: () => request<{ projects: ProjectWithCounts[] }>("/api/projects"),

  createProject: (input: { name: string; description?: string }) =>
    request<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getProject: (id: string) =>
    request<{
      project: Project;
      decisions: DecisionWithDetails[];
      documents: DocumentRecord[];
    }>(`/api/projects/${id}`),

  // ── Decisions ─────────────────────────────────────────────────────────────
  extractDecision: (input: { notes?: string; documentIds?: string[] }) =>
    request<DecisionExtractionResult & { analysedDocuments: Array<{ id: string; filename: string }> }>(
      "/api/decisions/extract",
      { method: "POST", body: JSON.stringify(input) },
    ),

  createDecision: (input: CreateDecisionInput) =>
    request<{ decision: DecisionWithDetails }>("/api/decisions", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listDecisions: (opts: { status?: DecisionStatus; projectId?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.status) params.set("status", opts.status);
    if (opts.projectId) params.set("projectId", opts.projectId);
    const qs = params.toString();
    return request<{ decisions: DecisionWithDetails[] }>(
      `/api/decisions${qs ? `?${qs}` : ""}`,
    );
  },

  getDecision: (id: string) => request<DecisionDetailResponse>(`/api/decisions/${id}`),

  reopenDecision: (id: string, input: { conflictId?: string; note?: string } = {}) =>
    request<{ decision: Decision }>(`/api/decisions/${id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: "reopen", ...input }),
    }),

  supersedeDecision: (id: string, input: { supersededByDecisionId: string; note?: string }) =>
    request<{ decision: Decision }>(`/api/decisions/${id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: "supersede", ...input }),
    }),

  resolveConflict: (
    conflictId: string,
    input: { resolution: "dismiss" | "accept"; note?: string },
  ) =>
    request<{ decision: Decision }>(`/api/conflicts/${conflictId}/resolve`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // ── Documents ─────────────────────────────────────────────────────────────
  requestUploadUrl: (input: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    projectId?: string;
    sourceType?: DocumentSourceType;
  }) =>
    request<{ document: DocumentRecord; uploadUrl: string }>("/api/documents/upload-url", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  uploadToS3: async (uploadUrl: string, file: File) => {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!res.ok) throw new Error(`S3 upload failed (${res.status})`);
  },

  confirmUpload: (documentId: string) =>
    request<UploadResult>(`/api/documents/${documentId}/confirm`, { method: "POST" }),

  listDocuments: () => request<{ documents: DocumentRecord[] }>("/api/documents"),

  getDocument: (id: string) =>
    request<{ document: DocumentRecord; chunks: MemoryChunk[]; downloadUrl: string | null }>(
      `/api/documents/${id}`,
    ),

  // ── Memory ────────────────────────────────────────────────────────────────
  listMemoryTraces: (decisionId?: string) =>
    request<{ traces: MemoryTrace[] }>(
      `/api/memory-traces${decisionId ? `?decisionId=${decisionId}` : ""}`,
    ),

  verifyTrace: (traceId: string) =>
    request<{ trace: MemoryTrace }>(`/api/memory-traces/${traceId}/verify`, { method: "POST" }),

  ask: (input: { question: string; projectId?: string; decisionId?: string }) =>
    request<AskResponse>("/api/ask", { method: "POST", body: JSON.stringify(input) }),

  // ── MCP analyst ───────────────────────────────────────────────────────────
  listAnalystQuestions: () =>
    request<{ questions: Array<{ id: string; label: string; description: string }> }>(
      "/api/memory-analyst",
    ),

  runAnalystQuestion: (questionId: string) =>
    request<{ result: AnalystResult }>("/api/memory-analyst", {
      method: "POST",
      body: JSON.stringify({ questionId }),
    }),

  // ── Observability ─────────────────────────────────────────────────────────
  getObservability: () => request<ObservabilityResponse>("/api/observability"),

  listAuditEvents: () => request<{ events: AuditEvent[] }>("/api/audit"),
};
