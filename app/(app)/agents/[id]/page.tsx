"use client";

import Link from "next/link";
import { use } from "react";
import { timeAgo, useV1 } from "@/lib/v1";

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
 * Agent Run Inspector (spec §24): what did this agent know when it made its
 * change — which decisions and constraints it was given, what it proposed,
 * and what a person decided.
 */
export default function AgentSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading, error } = useV1<Inspection>(["session", id], `/sessions/${id}`);
  if (error) return <div className="card p-6 text-sm text-risk-600">{(error as Error).message}</div>;
  if (isLoading || !data) return <div className="card p-6 text-sm text-ink-400">Loading…</div>;
  const { session, contextRequests, proposals } = data;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <Link href="/agents" className="text-xs text-ink-500 hover:underline">
          ← Agents
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-ink-50">
          <span className="font-mono text-signal-400">{session.agent}</span> session
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          {session.repository ?? "no repository"} · started {timeAgo(session.startedAt)} · {session.status.toLowerCase()} ·{" "}
          <span className="font-mono text-xs">{session.externalSessionId}</span>
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-200">What it asked, and what DecisionLoop told it</h2>
        {contextRequests.length === 0 ? (
          <p className="text-sm text-ink-500">This session never requested decision context.</p>
        ) : (
          contextRequests.map((c) => (
            <div key={c.runId} className="card p-4 text-sm">
              <p className="text-xs text-ink-500">
                {timeAgo(c.at)} · {c.memoriesRetrieved} memories retrieved · {c.constraintCount} constraint(s) provided
                {c.tokenEstimate !== null && ` · ~${c.tokenEstimate} tokens`}
                {c.memoryTraceId && (
                  <>
                    {" · "}
                    <Link className="underline" href={`/inspector?trace=${c.memoryTraceId}`}>
                      memory trace
                    </Link>
                  </>
                )}
              </p>
              <p className="mt-1 text-ink-200">{c.intent}</p>
              {c.resources.length > 0 && (
                <p className="mt-1 font-mono text-xs text-ink-500">{c.resources.slice(0, 8).map(resourceLabel).join(", ")}</p>
              )}
              <div className="mt-2 space-y-1">
                {c.decisions.length === 0 ? (
                  <p className="text-ink-500">No recorded decision applied.</p>
                ) : (
                  c.decisions.map((d) => (
                    <p key={d.id}>
                      <Link href={`/decisions/${d.id}`} className="text-ink-200 hover:underline">
                        {d.externalRef ? `${d.externalRef} — ` : ""}
                        {d.title}
                      </Link>{" "}
                      <span className={d.status === "AT_RISK" ? "text-risk-600" : "text-ink-500"}>[{d.status} when provided]</span>
                      {d.statusNow && d.statusNow !== d.status && <span className="ml-1 text-xs text-ink-500">now {d.statusNow}</span>}
                    </p>
                  ))
                )}
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-200">What it proposed</h2>
        {proposals.length === 0 ? (
          <p className="text-sm text-ink-500">No proposals from this session.</p>
        ) : (
          proposals.map((p) => (
            <div key={p.approval.id} className="card p-4 text-sm">
              <p className="text-xs text-ink-500">
                {p.approval.kind} · {p.approval.status} · {timeAgo(p.approval.createdAt)}
              </p>
              {p.decision && (
                <Link href={`/decisions/${p.decision.id}`} className="mt-1 block text-ink-200 hover:underline">
                  {p.decision.title} <span className="text-ink-500">[{p.decision.status}]</span>
                </Link>
              )}
              <p className="mt-1 text-ink-400">{p.approval.reason}</p>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
