"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CreateDecisionInput } from "@/lib/api/client";
import type { DecisionSourceUpload } from "@/lib/api/uploadTypes";
import type { DecisionStatus } from "@/lib/types";

// Centralized TanStack Query hooks. One file, kept small on purpose — this
// app has a handful of resources, not a large API surface, and colocating
// them makes the query-key conventions (and cache invalidation on mutation)
// easy to audit in one place.

export const queryKeys = {
  me: ["me"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  decisions: (status?: DecisionStatus, projectId?: string) =>
    ["decisions", status ?? "all", projectId ?? "all"] as const,
  decision: (id: string) => ["decision", id] as const,
  documents: ["documents"] as const,
  document: (id: string) => ["document", id] as const,
  memoryTraces: (decisionId?: string) => ["memoryTraces", decisionId ?? "all"] as const,
  observability: ["observability"] as const,
  analystQuestions: ["analystQuestions"] as const,
  audit: ["audit"] as const,
};

/**
 * Invalidated together after any mutation that can change decision state.
 * Ingesting a document can flip a decision to AT_RISK, write memory traces,
 * and move observability counters — so these travel as a set rather than
 * being re-derived at each call site.
 */
function invalidateMemorySurface(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["decisions"] });
  qc.invalidateQueries({ queryKey: ["decision"] });
  qc.invalidateQueries({ queryKey: ["memoryTraces"] });
  qc.invalidateQueries({ queryKey: queryKeys.observability });
  qc.invalidateQueries({ queryKey: queryKeys.projects });
  qc.invalidateQueries({ queryKey: queryKeys.audit });
}

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: api.me });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.login,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.signup,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => qc.setQueryData(queryKeys.me, { user: null, tenant: null }),
  });
}

// ── Projects ────────────────────────────────────────────────────────────────

export function useProjects() {
  return useQuery({ queryKey: queryKeys.projects, queryFn: api.listProjects });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.project(id ?? ""),
    queryFn: () => api.getProject(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.projects }),
  });
}

// ── Decisions ───────────────────────────────────────────────────────────────

export function useDecisions(opts: { status?: DecisionStatus; projectId?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.decisions(opts.status, opts.projectId),
    queryFn: () => api.listDecisions(opts),
  });
}

export function useDecision(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.decision(id ?? ""),
    queryFn: () => api.getDecision(id as string),
    enabled: Boolean(id),
  });
}

export function useExtractDecision() {
  return useMutation({ mutationFn: api.extractDecision });
}

export function useCreateDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDecisionInput) => api.createDecision(input),
    onSuccess: () => invalidateMemorySurface(qc),
  });
}

export function useReopenDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { decisionId: string; conflictId?: string; note?: string }) =>
      api.reopenDecision(input.decisionId, {
        conflictId: input.conflictId,
        note: input.note,
      }),
    onSuccess: () => invalidateMemorySurface(qc),
  });
}

export function useResolveConflict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      conflictId: string;
      resolution: "dismiss" | "accept";
      note?: string;
    }) => api.resolveConflict(input.conflictId, { resolution: input.resolution, note: input.note }),
    onSuccess: () => invalidateMemorySurface(qc),
  });
}

// ── Documents ───────────────────────────────────────────────────────────────

export function useDocuments() {
  return useQuery({ queryKey: queryKeys.documents, queryFn: api.listDocuments });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.document(id ?? ""),
    queryFn: () => api.getDocument(id as string),
    enabled: Boolean(id),
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DecisionSourceUpload) => {
      const { document, uploadUrl } = await api.requestUploadUrl({
        filename: input.file.name,
        mimeType: input.file.type || "text/plain",
        sizeBytes: input.file.size,
        projectId: input.projectId,
        sourceType: input.sourceType,
      });
      await api.uploadToS3(uploadUrl, input.file);
      return api.confirmUpload(document.id);
    },
    onSuccess: (_data, _vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.documents });
      invalidateMemorySurface(qc);
    },
  });
}

// ── Memory ──────────────────────────────────────────────────────────────────

export function useMemoryTraces(decisionId?: string) {
  return useQuery({
    queryKey: queryKeys.memoryTraces(decisionId),
    queryFn: () => api.listMemoryTraces(decisionId),
  });
}

export function useVerifyTrace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (traceId: string) => api.verifyTrace(traceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memoryTraces"] }),
  });
}

export function useAsk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.ask,
    // Asking a question writes an agent run and memory events, so the
    // observability view is stale afterwards even though nothing "changed".
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.observability });
      qc.invalidateQueries({ queryKey: ["memoryTraces"] });
    },
  });
}

// ── MCP analyst / observability ─────────────────────────────────────────────

export function useAnalystQuestions() {
  return useQuery({
    queryKey: queryKeys.analystQuestions,
    queryFn: api.listAnalystQuestions,
  });
}

export function useRunAnalystQuestion() {
  return useMutation({ mutationFn: api.runAnalystQuestion });
}

export function useObservability() {
  return useQuery({
    queryKey: queryKeys.observability,
    queryFn: api.getObservability,
    refetchInterval: 15_000,
  });
}

export function useAuditEvents() {
  return useQuery({ queryKey: queryKeys.audit, queryFn: api.listAuditEvents });
}
