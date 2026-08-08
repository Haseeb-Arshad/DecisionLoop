"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CreateDecisionInput } from "@/lib/api/client";
import type { DecisionStatus } from "@/lib/types";

// Centralized TanStack Query hooks. One file, kept small on purpose — this
// app has a handful of resources, not a large API surface, and colocating
// them makes the query-key conventions (and cache invalidation on mutation)
// easy to audit in one place.

export const queryKeys = {
  me: ["me"] as const,
  decisions: (status?: DecisionStatus) => ["decisions", status ?? "all"] as const,
  decision: (id: string) => ["decision", id] as const,
  documents: ["documents"] as const,
  memoryTraces: (decisionId?: string) => ["memoryTraces", decisionId ?? "all"] as const,
  audit: ["audit"] as const,
};

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

export function useDecisions(status?: DecisionStatus) {
  return useQuery({
    queryKey: queryKeys.decisions(status),
    queryFn: () => api.listDecisions(status),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["decisions"] });
    },
  });
}

export function useDocuments() {
  return useQuery({ queryKey: queryKeys.documents, queryFn: api.listDocuments });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const { document, uploadUrl } = await api.requestUploadUrl({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      await api.uploadToS3(uploadUrl, file);
      const result = await api.confirmUpload(document.id);
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.documents });
      qc.invalidateQueries({ queryKey: ["decisions"] });
      qc.invalidateQueries({ queryKey: ["memoryTraces"] });
    },
  });
}

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

export function useAuditEvents() {
  return useQuery({ queryKey: queryKeys.audit, queryFn: api.listAuditEvents });
}
