"use client";

import { useState } from "react";
import { StatCard } from "@/components/StatCard";
import {
  useAnalystQuestions,
  useObservability,
  useRunAnalystQuestion,
} from "@/lib/queries";

/**
 * §32 observability + the §27 Decision Memory Analyst. Both read from real
 * sources: the metrics are aggregates over actual rows, and the analyst
 * answers come back from live CockroachDB Managed MCP tool calls.
 */
export default function SystemPage() {
  const { data, isLoading } = useObservability();
  const { data: questionsData } = useAnalystQuestions();
  const runQuestion = useRunAnalystQuestion();
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);

  const metrics = data?.metrics;
  const runs = data?.runs ?? [];
  const questions = questionsData?.questions ?? [];
  const analyst = runQuestion.data?.result;

  return (
    <div className="animate-fade-in space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-ink-50">System</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-400">
          Live operational metrics and a Decision Memory Analyst that queries structured memory
          through CockroachDB&apos;s Managed MCP Server. Every value here is computed from real
          rows — metrics with no data show a dash rather than a zero.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Agent runs" value={isLoading ? null : (metrics?.agentRuns ?? 0)} />
        <StatCard
          label="Run failures"
          value={isLoading ? null : (metrics?.agentRunFailures ?? 0)}
          tone={metrics?.agentRunFailures ? "risk" : "neutral"}
        />
        <StatCard
          label="Avg retrieval latency"
          value={
            isLoading
              ? null
              : metrics?.averageRetrievalLatencyMs === null
                ? null
                : `${metrics?.averageRetrievalLatencyMs}ms`
          }
          hint="CockroachDB vector search"
        />
        <StatCard
          label="Avg agent latency"
          value={
            isLoading
              ? null
              : metrics?.averageAgentLatencyMs === null
                ? null
                : `${metrics?.averageAgentLatencyMs}ms`
          }
          hint="end-to-end pipeline"
        />
        <StatCard label="Memories stored" value={isLoading ? null : (metrics?.memoriesStored ?? 0)} />
        <StatCard
          label="Documents ingested"
          value={isLoading ? null : (metrics?.documentsIngested ?? 0)}
        />
        <StatCard
          label="Conflicts detected"
          value={isLoading ? null : (metrics?.conflictsDetected ?? 0)}
          hint={
            metrics?.conflictsUnreviewed
              ? `${metrics.conflictsUnreviewed} unreviewed`
              : undefined
          }
        />
        <StatCard
          label="Cross-session recalls"
          value={isLoading ? null : (metrics?.crossSessionRecalls ?? 0)}
          tone="signal"
          hint="proof memory outlives a session"
        />
      </div>

      <section>
        <h2 className="mb-1 text-sm font-semibold text-ink-100">Decision Memory Analyst</h2>
        <p className="mb-3 text-xs text-ink-500">
          These questions are answered by real <code className="font-mono">select_query</code> tool
          calls to CockroachDB Cloud&apos;s Managed MCP Server — a second channel, independent of
          the app&apos;s own database connection. The SQL and raw response are shown below.
        </p>

        <div className="flex flex-wrap gap-2">
          {questions.map((q) => (
            <button
              key={q.id}
              title={q.description}
              onClick={() => {
                setActiveQuestion(q.id);
                runQuestion.mutate(q.id);
              }}
              className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                activeQuestion === q.id
                  ? "border-signal-500/50 bg-signal-500/10 text-ink-100"
                  : "border-ink-700 bg-ink-900/60 text-ink-300 hover:border-ink-600"
              }`}
            >
              {q.label}
            </button>
          ))}
        </div>

        {runQuestion.isPending && (
          <p className="mt-4 text-sm text-ink-400">Querying CockroachDB via MCP…</p>
        )}

        {analyst && (
          <div className="mt-4 space-y-3">
            <div className="card p-4">
              <p className="label !mb-2">Query sent via MCP</p>
              <pre className="overflow-x-auto rounded-lg bg-ink-950 p-3 font-mono text-xs leading-relaxed text-signal-400">
                {analyst.sql}
              </pre>
            </div>
            {analyst.verification.error ? (
              <div className="card p-4 text-sm text-ink-400">{analyst.verification.error}</div>
            ) : (
              <div className="card p-4">
                <p className="label !mb-2">MCP tool response</p>
                {analyst.verification.toolCalls.map((call, i) => (
                  <pre
                    key={i}
                    className="overflow-x-auto rounded-lg bg-ink-950 p-3 font-mono text-xs leading-relaxed text-ink-300"
                  >
                    {JSON.stringify(call.output, null, 2)}
                  </pre>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-100">Recent agent runs</h2>
        {runs.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-ink-400">
            No agent runs recorded yet.
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-700/60 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2 font-medium">Intent</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Retrieved</th>
                  <th className="px-3 py-2 font-medium">Written</th>
                  <th className="px-3 py-2 font-medium">Conflicts</th>
                  <th className="px-3 py-2 font-medium">Latency</th>
                  <th className="px-4 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-ink-800/60 last:border-0">
                    <td className="px-4 py-2.5 text-xs text-ink-200">
                      {run.intent.replaceAll("_", " ").toLowerCase()}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <span
                        className={
                          run.status === "FAILED"
                            ? "text-risk-400"
                            : run.status === "RUNNING"
                              ? "text-amber-400"
                              : "text-signal-400"
                        }
                      >
                        {run.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-ink-400">
                      {run.memoriesRetrieved}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-ink-400">
                      {run.memoriesWritten}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-ink-400">
                      {run.conflictsDetected}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-ink-400">
                      {run.latencyMs === null ? "—" : `${run.latencyMs}ms`}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-500">
                      {new Date(run.startedAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
