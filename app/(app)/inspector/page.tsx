"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useMemoryTraces, useVerifyTrace } from "@/lib/queries";
import type { MemoryTrace } from "@/lib/types";

const ACTION_LABELS: Record<string, string> = {
  retrieval: "Retrieval",
  conflict_check: "Conflict check",
  extraction: "Extraction",
  mcp_verify: "MCP verify",
};

function similarityColor(score: number): string {
  if (score >= 0.6) return "text-signal-400";
  if (score >= 0.35) return "text-amber-400";
  return "text-ink-500";
}

export default function MemoryInspectorPage() {
  const searchParams = useSearchParams();
  const decisionId = searchParams.get("decisionId") ?? undefined;
  const { data, isLoading } = useMemoryTraces(decisionId);
  const traces = data?.traces ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = traces.find((t) => t.id === selectedId) ?? traces[0] ?? null;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-50">Memory Inspector</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-400">
          Every AI action that touched memory, in order. Each trace shows the exact SQL that ran,
          the candidate rows and similarity scores, which ones were actually used, and the
          model&apos;s stated reasoning — plus an independent cross-check via CockroachDB&apos;s
          own Managed MCP Server.
          {decisionId && " Filtered to one decision."}
        </p>
      </div>

      {isLoading ? (
        <div className="card px-6 py-12 text-center text-sm text-ink-400">Loading…</div>
      ) : traces.length === 0 ? (
        <div className="card px-6 py-12 text-center text-sm text-ink-400">
          No memory traces yet — commit a decision or upload a document to generate one.
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <div className="card max-h-[70vh] overflow-y-auto divide-y divide-ink-800/60">
            {traces.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={`block w-full px-4 py-3 text-left transition ${
                  selected?.id === t.id ? "bg-ink-800/70" : "hover:bg-ink-900/60"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="pill bg-ink-700/60 text-ink-200">
                    {ACTION_LABELS[t.actionType] ?? t.actionType}
                  </span>
                  <span className="text-[11px] text-ink-500">
                    {new Date(t.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-xs text-ink-300">
                  {t.queryText ?? "(no query text)"}
                </p>
                <p className="mt-1 text-[11px] text-ink-500">
                  {t.candidates.length} candidate{t.candidates.length === 1 ? "" : "s"} ·{" "}
                  {t.usedChunkIds.length} used
                </p>
              </button>
            ))}
          </div>

          {selected && <TraceDetail trace={selected} />}
        </div>
      )}
    </div>
  );
}

function TraceDetail({ trace }: { trace: MemoryTrace }) {
  const verify = useVerifyTrace();

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="pill bg-ink-700/60 text-ink-200">
            {ACTION_LABELS[trace.actionType] ?? trace.actionType}
          </span>
          <span className="text-xs text-ink-500">{new Date(trace.createdAt).toLocaleString()}</span>
        </div>
        {trace.queryText && (
          <p className="mb-3 text-sm text-ink-200">
            <span className="text-ink-500">Query: </span>
            {trace.queryText}
          </p>
        )}
        {trace.llmReasoning && (
          <div className="rounded-lg border border-ink-700 bg-ink-900/50 p-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-500">
              Model reasoning
            </p>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-200">
              {trace.llmReasoning}
            </pre>
          </div>
        )}
      </div>

      {trace.renderedSql && (
        <div className="card p-5">
          <p className="label !mb-2">Rendered SQL (CockroachDB)</p>
          <pre className="overflow-x-auto rounded-lg bg-ink-950 p-3 font-mono text-xs leading-relaxed text-signal-400">
            {trace.renderedSql}
          </pre>
        </div>
      )}

      {trace.candidates.length > 0 && (
        <div className="card overflow-hidden">
          <p className="label px-5 pt-5">Candidate rows retrieved</p>
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-700/60 text-xs uppercase tracking-wide text-ink-500">
                <th className="px-5 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Similarity</th>
                <th className="px-3 py-2 font-medium">Content</th>
                <th className="px-5 py-2 font-medium">Used?</th>
              </tr>
            </thead>
            <tbody>
              {trace.candidates.map((c) => (
                <tr key={c.chunkId} className="border-b border-ink-800/60 last:border-0">
                  <td className="px-5 py-2.5 align-top text-xs text-ink-300">{c.sourceType}</td>
                  <td className={`px-3 py-2.5 align-top font-mono text-xs ${similarityColor(c.similarity)}`}>
                    {c.similarity.toFixed(3)}
                  </td>
                  <td className="px-3 py-2.5 align-top text-xs text-ink-400">{c.contentPreview}</td>
                  <td className="px-5 py-2.5 align-top text-xs">
                    {trace.usedChunkIds.includes(c.chunkId) ? (
                      <span className="text-signal-400">✓ used</span>
                    ) : (
                      <span className="text-ink-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="label !mb-0">Independent verification (CockroachDB Managed MCP)</p>
          <button
            className="btn-secondary !px-3 !py-1.5 text-xs"
            onClick={() => verify.mutate(trace.id)}
            disabled={verify.isPending}
          >
            {verify.isPending ? "Verifying…" : "Verify via MCP"}
          </button>
        </div>

        {trace.mcpVerification ? (
          <McpVerificationPanel verification={trace.mcpVerification} />
        ) : verify.data ? (
          <McpVerificationPanel verification={verify.data.trace.mcpVerification!} />
        ) : (
          <p className="text-sm text-ink-500">
            Not yet checked. This re-runs a read-only query against CockroachDB via its own
            Managed MCP Server — a second, independent channel from the app&apos;s own database
            connection — to confirm these rows are real, current data.
          </p>
        )}
      </div>
    </div>
  );
}

function McpVerificationPanel({
  verification,
}: {
  verification: NonNullable<MemoryTrace["mcpVerification"]>;
}) {
  if (verification.error) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-900/50 p-3 text-sm text-ink-400">
        {verification.error}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-signal-400">✓ Verified via CockroachDB Managed MCP Server</p>
      {verification.toolCalls.map((call, i) => (
        <pre
          key={i}
          className="overflow-x-auto rounded-lg bg-ink-950 p-3 font-mono text-xs leading-relaxed text-ink-300"
        >
          {JSON.stringify(call, null, 2)}
        </pre>
      ))}
    </div>
  );
}
