"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useMemoryTraces, useVerifyTrace } from "@/lib/queries";
import type { MemoryTrace } from "@/lib/types";

const ACTION_LABELS: Record<string, string> = {
  retrieval: "Retrieval",
  conflict_check: "Conflict check",
  extraction: "Extraction",
  answer: "Question answered",
  mcp_verify: "MCP verify",
};

function scoreColor(score: number): string {
  if (score >= 0.6) return "text-signal-400";
  if (score >= 0.35) return "text-amber-400";
  return "text-ink-500";
}

function MemoryInspectorInner() {
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
        <p className="mt-1 max-w-3xl text-sm text-ink-400">
          Every AI action that touched memory, in order. Each trace shows the exact SQL that ran,
          every candidate row with its real hybrid score, which ones were used in reasoning, and
          the model&apos;s stated conclusion — plus an independent cross-check via
          CockroachDB&apos;s own Managed MCP Server. None of these numbers are illustrative.
          {decisionId && " Filtered to one decision."}
        </p>
      </div>

      {isLoading ? (
        <div className="card px-6 py-12 text-center text-sm text-ink-400">Loading…</div>
      ) : traces.length === 0 ? (
        <div className="card px-6 py-12 text-center text-sm text-ink-400">
          No memory traces yet — commit a decision, upload evidence, or ask a question to generate
          one.
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <div className="card max-h-[70vh] divide-y divide-ink-800/60 overflow-y-auto">
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
                  {t.candidates.length} retrieved · {t.usedChunkIds.length} used
                  {t.retrievalLatencyMs !== null && ` · ${t.retrievalLatencyMs}ms`}
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
  const verification = verify.data?.trace.mcpVerification ?? trace.mcpVerification;

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="pill bg-ink-700/60 text-ink-200">
            {ACTION_LABELS[trace.actionType] ?? trace.actionType}
          </span>
          <span className="text-xs text-ink-500">
            {new Date(trace.createdAt).toLocaleString()}
            {trace.agentRunId && (
              <span className="ml-2 font-mono text-ink-600">
                run {trace.agentRunId.slice(0, 8)}…
              </span>
            )}
          </span>
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
              Memory used in reasoning
            </p>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-200">
              {trace.llmReasoning}
            </pre>
          </div>
        )}
      </div>

      {trace.scoringWeights && (
        <div className="card p-5">
          <p className="label !mb-2">Hybrid scoring weights</p>
          <div className="flex flex-wrap gap-4 font-mono text-xs text-ink-300">
            <span>semantic {trace.scoringWeights.semantic}</span>
            <span>importance {trace.scoringWeights.importance}</span>
            <span>authority {trace.scoringWeights.authority}</span>
            <span>contextual {trace.scoringWeights.contextual}</span>
          </div>
          <p className="mt-2 text-xs text-ink-600">
            final = Σ(weight × component). Vector similarity alone would rank an unimportant note
            from an unverified source above a load-bearing, contract-backed assumption.
          </p>
        </div>
      )}

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
          <p className="label px-5 pt-5">Retrieved memories</p>
          <div className="overflow-x-auto">
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700/60 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2 font-medium">Source</th>
                  <th className="px-2 py-2 font-medium">Similarity</th>
                  <th className="px-2 py-2 font-medium">Imp.</th>
                  <th className="px-2 py-2 font-medium">Auth.</th>
                  <th className="px-2 py-2 font-medium">Ctx.</th>
                  <th className="px-2 py-2 font-medium">Final</th>
                  <th className="px-3 py-2 font-medium">Content</th>
                  <th className="px-5 py-2 font-medium">Selected</th>
                </tr>
              </thead>
              <tbody>
                {trace.candidates.map((c) => (
                  <tr key={c.chunkId} className="border-b border-ink-800/60 last:border-0">
                    <td className="px-5 py-2.5 align-top text-xs text-ink-300">
                      {c.sourceType}
                      {c.crossSession && (
                        <span
                          className="ml-1 text-signal-400"
                          title="Written by a different session than the one retrieving it"
                        >
                          ✦
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 align-top font-mono text-xs text-ink-400">
                      {c.semanticScore.toFixed(3)}
                    </td>
                    <td className="px-2 py-2.5 align-top font-mono text-xs text-ink-500">
                      {c.importanceScore.toFixed(2)}
                    </td>
                    <td className="px-2 py-2.5 align-top font-mono text-xs text-ink-500">
                      {c.authorityComponent.toFixed(2)}
                    </td>
                    <td className="px-2 py-2.5 align-top font-mono text-xs text-ink-500">
                      {c.contextualScore.toFixed(2)}
                    </td>
                    <td
                      className={`px-2 py-2.5 align-top font-mono text-xs font-medium ${scoreColor(c.finalScore)}`}
                    >
                      {c.finalScore.toFixed(3)}
                    </td>
                    <td className="max-w-xs px-3 py-2.5 align-top text-xs text-ink-400">
                      {c.contentPreview}
                    </td>
                    <td className="px-5 py-2.5 align-top text-xs">
                      {trace.usedChunkIds.includes(c.chunkId) ? (
                        <span className="text-signal-400">✓ used</span>
                      ) : c.selectedForContext ? (
                        <span className="text-ink-400">considered</span>
                      ) : (
                        <span className="text-ink-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 pb-4 pt-3 text-xs text-ink-600">
            ✦ marks a memory written by a different session than the one that retrieved it — the
            cross-session recall this product exists to demonstrate.
          </p>
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

        {verification ? (
          <McpVerificationPanel verification={verification} />
        ) : (
          <p className="text-sm text-ink-500">
            Not yet checked. This re-runs a read-only query against CockroachDB via its own
            Managed MCP Server — a second channel, independent of the app&apos;s database
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

export default function MemoryInspectorPage() {
  return (
    <Suspense
      fallback={<div className="card px-6 py-12 text-center text-sm text-ink-400">Loading…</div>}
    >
      <MemoryInspectorInner />
    </Suspense>
  );
}
