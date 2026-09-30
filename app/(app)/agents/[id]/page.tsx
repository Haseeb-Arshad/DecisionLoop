"use client";

import Link from "next/link";
import { use } from "react";
import { PageHeader, QueryState, When } from "@/components/Workspace";
import { useV1 } from "@/lib/v1";

interface Inspection {
  session: { agent: string; externalSessionId: string; repository: string | null; startedAt: string; status: string; outcome: string | null };
  contextRequests: Array<{
    runId: string;
    at: string;
    intent: string | null;
    resources: unknown[];
    decisions: Array<{ id: string; title: string; status: string | null; statusNow?: string | null; externalRef: string | null }>;
    constraintCount: number;
    tokenEstimate: number | null;
    memoryTraceId: string | null;
    memoriesRetrieved: number;
  }>;
  proposals: Array<{
    approval: { id: string; kind: string; status: string; reason: string; createdAt: string };
    decision: { id: string; title: string; status: string } | null;
  }>;
  evidenceRuns: Array<{ id: string; request: string | null; outputSummary: string | null; startedAt: string }>;
}

function resourceLabel(r: unknown): string {
  if (typeof r === "string") return r;
  if (r && typeof r === "object" && "key" in r) return String((r as { key: unknown }).key);
  return JSON.stringify(r);
}

/**
 * What did this agent know when it acted: which decisions and constraints it
 * was given, what it proposed, and what a person decided. Statuses are shown
 * as they were when served, with the current status beside them.
 */
export default function AgentSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error } = useV1<Inspection>(["session", id], `/sessions/${id}`);
  if (error || isLoading || !data) return <QueryState loading={isLoading} error={error as Error | null} />;
  const { session, contextRequests, proposals } = data;

  return (
    <div>
      <Link href="/agents" className="text-xs text-ink-400 underline">
        Agent sessions
      </Link>
      <div className="mt-3">
        <PageHeader title={`${session.agent} session`} />
      </div>
      <dl className="kv mb-8">
        <dt>Session</dt>
        <dd className="font-mono text-xs">{session.externalSessionId}</dd>
        <dt>Started</dt>
        <dd>
          <When iso={session.startedAt} /> ({session.status.toLowerCase()})
        </dd>
        {session.repository && (
          <>
            <dt>Repository</dt>
            <dd>{session.repository}</dd>
          </>
        )}
        {session.outcome && (
          <>
            <dt>Outcome</dt>
            <dd>{session.outcome}</dd>
          </>
        )}
      </dl>

      <section className="mb-8">
        <h2 className="section-label">What it asked and what it was told ({contextRequests.length})</h2>
        {contextRequests.length === 0 ? (
          <p className="text-sm text-ink-500">This session never asked for decision context.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-ink-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-800 text-xs text-ink-400">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Request</th>
                  <th className="px-3 py-2 font-medium">Decisions it was given</th>
                  <th className="px-3 py-2 text-right font-medium">Constraints</th>
                  <th className="px-3 py-2 text-right font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {contextRequests.map((c) => (
                  <tr key={c.runId} className="border-t border-ink-700/60 align-top">
                    <td className="px-3 py-2 text-xs">
                      <When iso={c.at} />
                    </td>
                    <td className="px-3 py-2">
                      {c.intent}
                      {c.resources.length > 0 && <span className="mt-0.5 block font-mono text-xs text-ink-400">{c.resources.slice(0, 6).map(resourceLabel).join(", ")}</span>}
                      {c.memoryTraceId && (
                        <Link className="mt-0.5 block text-xs text-signal-600 underline" href={`/inspector?trace=${c.memoryTraceId}`}>
                          memory trace
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {c.decisions.length === 0 ? (
                        <span className="text-ink-500">None applied</span>
                      ) : (
                        c.decisions.map((d) => (
                          <p key={d.id}>
                            <Link href={`/decisions/${d.id}`} className="underline">
                              {d.externalRef ?? d.title}
                            </Link>{" "}
                            <span className={d.status === "AT_RISK" ? "text-risk-600" : "text-ink-400"}>
                              {d.status?.toLowerCase().replace("_", " ")} when given
                            </span>
                            {d.statusNow && d.statusNow !== d.status && <span className="ml-1 text-xs text-ink-400">(now {d.statusNow.toLowerCase().replace("_", " ")})</span>}
                          </p>
                        ))
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.constraintCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.tokenEstimate ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="section-label">What it proposed ({proposals.length})</h2>
        {proposals.length === 0 ? (
          <p className="text-sm text-ink-500">No proposals from this session.</p>
        ) : (
          <div className="card">
            {proposals.map((p) => (
              <div key={p.approval.id} className="record-row">
                <div className="min-w-0 flex-1">
                  {p.decision ? (
                    <Link href={`/decisions/${p.decision.id}`} className="record-title hover:underline">
                      {p.decision.title}
                    </Link>
                  ) : (
                    <span className="record-title">{p.approval.kind.replaceAll("_", " ").toLowerCase()}</span>
                  )}
                  <p className="record-subtitle">{p.approval.reason}</p>
                </div>
                <span className="text-xs text-ink-400">{p.approval.status.toLowerCase().replace("_", " ")}</span>
                <span className="text-xs">
                  <When iso={p.approval.createdAt} />
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
