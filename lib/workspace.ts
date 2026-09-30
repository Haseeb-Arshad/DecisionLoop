"use client";
import { useQuery } from "@tanstack/react-query";
import type { DecisionWithDetails } from "@/lib/types";
export interface WorkspaceData {
  decisions: DecisionWithDetails[];
  capabilities: {
    reasoning: string;
    embeddings: string;
    documentUpload: boolean;
    workerSeenAt: string | null;
    workerHealthy: boolean;
    pendingJobs: number;
    oldestJobAt: string | null;
  };
}
export function useWorkspace() {
  return useQuery<WorkspaceData>({
    queryKey: ["v1", "workspace"],
    queryFn: async () => {
      const res = await fetch("/api/workspace");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Unable to load workspace.");
      return body;
    },
    refetchInterval: 10000,
  });
}
