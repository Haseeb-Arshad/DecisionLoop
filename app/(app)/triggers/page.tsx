"use client";
import Link from "next/link";
import { Fragment, useState } from "react";
import { PageHeader, QueryState, EmptyState, When } from "@/components/Workspace";
import { useV1 } from "@/lib/v1";

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
  RECEIVED: "status",
  PROCESSING: "status status-warn",
  PROCESSED: "status status-active",
  FAILED: "status status-risk",
  IGNORED: "status status-muted",
};

/**
 * Every event that entered DecisionLoop and exactly what it did, including
 * the checks where nothing changed, so "why didn't this fire?" has an answer.
 */
export default function TriggersPage() {
  const { data, isLoading, error } = useV1<EventRow[]>(["events"], "/events?limit=100", { refetchInterval: 5000 });
  const [open, setOpen] = useState<string | null>(null);
  const events = data ?? [];

  return (
    <div>
      <PageHeader
        title="Triggers"
        description="Evidence from source systems, agents, people and documents as it arrives. Each event is compared with recorded assumptions by code first, and by a model only when code cannot decide."
      />
      <QueryState loading={isLoading} error={error as Error | null} />
      {!isLoading &&
        !error &&
        (events.length === 0 ? (
          <EmptyState title="No events yet">Submit evidence, upload a document, or connect a source system.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded border border-ink-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-800 text-xs text-ink-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">Received</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <Fragment key={e.id}>
                    <tr
                      className="cursor-pointer border-t border-ink-700/60 hover:bg-ink-800"
                      onClick={() => setOpen(open === e.id ? null : e.id)}
                      aria-expanded={open === e.id}
                    >
                      <td className="px-3 py-2">
                        <span className={STATUS_STYLE[e.status]}>{e.status.toLowerCase()}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{e.source}</td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-300">{e.type}</td>
                      <td className="px-3 py-2 text-ink-300">
                        {e.status === "FAILED"
                          ? `attempt ${e.attempts}: ${e.lastError ?? "error"}`
                          : e.result
                            ? `${e.result.evaluations?.length ?? 0} checks, ${e.result.conflictIds?.length ?? 0} conflicts, ${e.result.decisionsAtRisk?.length ?? 0} at risk, ${e.result.constraintFindings?.length ?? 0} findings`
                            : "queued"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <When iso={e.receivedAt} />
                      </td>
                    </tr>
                    {open === e.id && (
                      <tr className="bg-ink-800">
                        <td colSpan={5}>
                          <EventDetailPanel id={e.id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ))}
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
    <div className="space-y-4 px-4 pb-4 pt-2 text-sm">
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
          <p className="eyebrow">Facts observed</p>
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
        <p className="eyebrow">Assumption checks</p>
        {evaluations.length === 0 ? (
          <p className="text-ink-500">
            No recorded assumption was affected by this event.
          </p>
        ) : (
          evaluations.map((ev) => (
            <div
              key={ev.id}
              className="mb-2 rounded border border-ink-700 bg-white p-3"
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
                className="mt-1 inline-block text-xs text-signal-600 underline"
              >
                Open decision
              </Link>
            </div>
          ))
        )}
      </div>
      {findings.length > 0 && (
        <div>
          <p className="eyebrow">Constraint findings (advisory)</p>
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
