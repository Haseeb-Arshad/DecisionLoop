"use client";
import { PageHeader } from "@/components/Workspace";

import Link from "next/link";
import { useState } from "react";
import { timeAgo, useV1 } from "@/lib/v1";

interface EventRow {
  id: string;
  source: string;
  type: string;
  status: "RECEIVED" | "PROCESSING" | "PROCESSED" | "FAILED" | "IGNORED";
  attempts: number;
  lastError: string | null;
  receivedAt: string;
  occurredAt: string;
  actor: { type: string; label?: string | null };
  provenance: { url?: string | null; authority?: number | null };
  result: {
    conflictIds?: string[];
    decisionsAtRisk?: string[];
    constraintFindings?: unknown[];
    evaluations?: unknown[];
  } | null;
}

interface EventDetail {
  event: EventRow & { text: string | null };
  evidence: Array<{
    id: string;
    kind: string;
    authority: number;
    contentHash: string;
    facts: Array<{
      subject?: string | null;
      predicate: string;
      value: unknown;
      statement: string;
      quote?: string | null;
      extractor?: string | null;
    }>;
  }>;
  evaluations: Array<{
    id: string;
    decisionId: string;
    method: string;
    relation: string;
    previousValidity: string;
    nextValidity: string | null;
    decisionFlagged: boolean;
    matchedPolicies: string[];
    explanation: string;
    evidenceAuthority: number;
    assumptionAuthority: number;
  }>;
  findings: Array<{
    id: string;
    decisionId: string;
    explanation: string;
    status: string;
  }>;
}

const STATUS_STYLE: Record<EventRow["status"], string> = {
  RECEIVED: "text-ink-300",
  PROCESSING: "text-amber-700",
  PROCESSED: "text-signal-400",
  FAILED: "text-risk-600",
  IGNORED: "text-ink-500",
};

/**
 * Trigger history: every event that entered DecisionLoop and exactly what it
 * did — including the checks where nothing changed, so "why didn't this
 * fire?" has an answer.
 */
export default function TriggersPage() {
  const { data, isLoading, error } = useV1<EventRow[]>(
    ["events"],
    "/events?limit=100",
    { refetchInterval: 5000 },
  );
  const [open, setOpen] = useState<string | null>(null);
  const events = data ?? [];

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        eyebrow="Workspace operations"
        title="Triggers"
        description={
          <>
            Evidence from GitHub, agents, people and documents, as it arrives.
            Each event is checked against recorded assumptions —
            deterministically first, by a model only when needed — and every
            check is recorded.
          </>
        }
      />
      {error ? (
        <div className="card px-6 py-6 text-sm text-risk-600">
          Could not load events: {(error as Error).message}
        </div>
      ) : isLoading ? (
        <div className="card px-6 py-12 text-center text-sm text-ink-400">
          Loading…
        </div>
      ) : events.length === 0 ? (
        <div className="card px-6 py-12 text-center text-sm text-ink-400">
          No events yet.
        </div>
      ) : (
        <div className="card divide-y divide-ink-800">
          {events.map((e) => (
            <div key={e.id}>
              <button
                className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-ink-900/60"
                onClick={() => setOpen(open === e.id ? null : e.id)}
              >
                <span
                  className={`w-24 shrink-0 text-xs font-medium ${STATUS_STYLE[e.status]}`}
                >
                  {e.status}
                </span>
                <span className="w-56 shrink-0 truncate font-mono text-xs text-ink-300">
                  {e.source} · {e.type}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-400">
                  {e.status === "FAILED"
                    ? `attempt ${e.attempts}: ${e.lastError ?? "error"}`
                    : e.result
                      ? `${e.result.evaluations?.length ?? 0} check(s) · ${e.result.conflictIds?.length ?? 0} conflict(s) · ${e.result.decisionsAtRisk?.length ?? 0} at risk · ${e.result.constraintFindings?.length ?? 0} finding(s)`
                      : "queued"}
                </span>
                <span className="shrink-0 text-xs text-ink-500">
                  {timeAgo(e.receivedAt)}
                </span>
              </button>
              {open === e.id && <EventDetailPanel id={e.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventDetailPanel({ id }: { id: string }) {
  const { data, isLoading, error } = useV1<EventDetail>(
    ["event", id],
    `/events/${id}/detail`,
  );
  if (error)
    return (
      <div className="px-5 pb-4 text-sm text-risk-600">
        {(error as Error).message}
      </div>
    );
  if (isLoading || !data)
    return <div className="px-5 pb-4 text-sm text-ink-500">Loading…</div>;
  const { event, evidence, evaluations, findings } = data;
  return (
    <div className="space-y-4 bg-ink-950/50 px-5 pb-5 pt-2 text-sm">
      <p className="text-xs text-ink-500">
        {event.actor.label ?? event.actor.type} · authority{" "}
        {evidence[0]?.authority.toFixed(2) ?? "—"}
        {event.provenance.url && (
          <>
            {" · "}
            <a
              className="underline"
              href={event.provenance.url}
              target="_blank"
              rel="noreferrer"
            >
              source
            </a>
          </>
        )}
        {evidence[0] && (
          <span className="ml-2 font-mono">
            sha256 {evidence[0].contentHash.slice(0, 12)}…
          </span>
        )}
      </p>
      {evidence.flatMap((ev) => ev.facts).length > 0 && (
        <div>
          <p className="label">Facts observed</p>
          {evidence
            .flatMap((ev) => ev.facts)
            .map((f, i) => (
              <p key={i} className="text-ink-300">
                <span className="font-mono text-xs text-ink-400">
                  {f.subject ? `${f.subject}.` : ""}
                  {f.predicate} = {JSON.stringify(f.value)}
                </span>{" "}
                — {f.statement}
                {f.extractor && (
                  <span className="ml-1 text-xs text-ink-500">
                    [{f.extractor}]
                  </span>
                )}
              </p>
            ))}
        </div>
      )}
      <div>
        <p className="label">Assumption checks</p>
        {evaluations.length === 0 ? (
          <p className="text-ink-500">
            No recorded assumption was affected by this event.
          </p>
        ) : (
          evaluations.map((ev) => (
            <div
              key={ev.id}
              className="mb-2 rounded-md border border-ink-800 p-3"
            >
              <p className="text-xs text-ink-400">
                <span className="font-mono">{ev.method}</span> · {ev.relation} ·{" "}
                {ev.previousValidity}
                {ev.nextValidity ? ` → ${ev.nextValidity}` : " (unchanged)"}
                {ev.decisionFlagged && (
                  <span className="ml-2 text-risk-600">
                    decision flagged AT RISK
                  </span>
                )}
                {ev.matchedPolicies.length > 0 && (
                  <span className="ml-2 text-ink-500">
                    policies: {ev.matchedPolicies.join(", ")}
                  </span>
                )}
              </p>
              <p className="mt-1 text-ink-200">{ev.explanation}</p>
              <Link
                href={`/decisions/${ev.decisionId}`}
                className="mt-1 inline-block text-xs text-signal-400 hover:underline"
              >
                Open decision →
              </Link>
            </div>
          ))
        )}
      </div>
      {findings.length > 0 && (
        <div>
          <p className="label">Constraint findings (advisory)</p>
          {findings.map((f) => (
            <p key={f.id} className="text-amber-700">
              {f.explanation}{" "}
              <span className="text-xs text-ink-500">[{f.status}]</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
