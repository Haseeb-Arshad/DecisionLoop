"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Control-plane access to the v1 API — the same API agents, the SDK and the
 * CLI use, authenticated here by the browser session cookie.
 */
export async function v1<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok && res.status !== 202) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export function useV1<T>(key: unknown[], path: string, opts: { refetchInterval?: number } = {}) {
  return useQuery({ queryKey: ["v1", ...key], queryFn: () => v1<T>(path), refetchInterval: opts.refetchInterval });
}

export function useV1Mutation<TInput, TOut>(fn: (input: TInput) => Promise<TOut>, invalidate: unknown[][] = [["v1"]]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k }))),
  });
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
