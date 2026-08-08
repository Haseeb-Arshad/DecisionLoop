"use client";

// Thin typed fetch wrapper the TanStack Query hooks (lib/queries/*) call
// into. Kept separate from the hooks so it's trivially testable / reusable
// outside React.
import type { DecisionExtractionResult } from "@/lib/ai/extraction";
import type { ConflictDetectionSummary } from "@/lib/engine/conflictDetection";
import type {
  AssumptionOperator,
  AuditEvent,
  ConflictEvent,
  DecisionStatus,
  DecisionWithDetails,
  DocumentRecord,
  MemoryTrace,
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
  metric?: string;
  operator?: AssumptionOperator;
  value?: number;
  unit?: string;
}

export interface CreateDecisionInput {
  title: string;
  problemStatement?: string;
  reasoning?: string;
  createdInSession?: string;
  options: DecisionOptionInput[];
  assumptions: AssumptionInput[];
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

  extractDecision: (notes: string) =>
    request<DecisionExtractionResult>("/api/decisions/extract", {
      method: "POST",
      body: JSON.stringify({ notes }),
    }),

  createDecision: (input: CreateDecisionInput) =>
    request<{ decision: DecisionWithDetails }>("/api/decisions", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listDecisions: (status?: DecisionStatus) =>
    request<{ decisions: DecisionWithDetails[] }>(
      `/api/decisions${status ? `?status=${status}` : ""}`,
    ),

  getDecision: (id: string) =>
    request<{ decision: DecisionWithDetails; conflicts: ConflictEvent[]; traces: MemoryTrace[] }>(
      `/api/decisions/${id}`,
    ),

  requestUploadUrl: (input: { filename: string; mimeType: string; sizeBytes: number }) =>
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
    request<{ document: DocumentRecord; conflictSummary: ConflictDetectionSummary }>(
      `/api/documents/${documentId}/confirm`,
      { method: "POST" },
    ),

  listDocuments: () => request<{ documents: DocumentRecord[] }>("/api/documents"),

  listMemoryTraces: (decisionId?: string) =>
    request<{ traces: MemoryTrace[] }>(
      `/api/memory-traces${decisionId ? `?decisionId=${decisionId}` : ""}`,
    ),

  verifyTrace: (traceId: string) =>
    request<{ trace: MemoryTrace }>(`/api/memory-traces/${traceId}/verify`, { method: "POST" }),

  listAuditEvents: () => request<{ events: AuditEvent[] }>("/api/audit"),
};
