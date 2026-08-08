"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AssumptionStatusBadge, DecisionStatusBadge } from "@/components/StatusBadge";
import { useDecision } from "@/lib/queries";

export default function DecisionDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useDecision(params.id);

  if (isLoading) {
    return <div className="card px-6 py-12 text-center text-sm text-ink-400">Loading…</div>;
  }
  if (isError || !data) {
    return (
      <div className="card px-6 py-12 text-center text-sm text-risk-400">
        {isError ? (error as Error).message : "Decision not found."}
      </div>
    );
  }

  const { decision, conflicts, traces } = data;
  const chosen = decision.options.find((o) => o.isChosen);
  const rejected = decision.options.filter((o) => !o.isChosen);

  return (
    <div className="animate-fade-in mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/decisions" className="text-xs text-ink-400 hover:text-ink-200">
          ← All decisions
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-ink-50">{decision.title}</h1>
          <DecisionStatusBadge status={decision.status} />
        </div>
        {decision.problemStatement && (
          <p className="mt-2 text-sm text-ink-400">{decision.problemStatement}</p>
        )}
      </div>

      {decision.status === "AT_RISK" && decision.riskExplanation && (
        <div className="card border-risk-500/40 bg-risk-500/[0.06] p-5">
          <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-risk-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-risk-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-risk-400" />
            </span>
            This decision is at risk
          </p>
          <p className="text-sm leading-relaxed text-ink-200">{decision.riskExplanation}</p>
          {conflicts[0]?.suggestedOptionId && (
            <p className="mt-2 text-sm text-ink-300">
              Suggested reconsideration:{" "}
              <span className="font-medium text-ink-100">
                {decision.options.find((o) => o.id === conflicts[0]?.suggestedOptionId)?.name}
              </span>
            </p>
          )}
          <Link
            href={`/inspector?decisionId=${decision.id}`}
            className="mt-3 inline-block text-xs text-risk-400 underline decoration-risk-500/40 underline-offset-2 hover:text-risk-300"
          >
            See exactly what CockroachDB data drove this →
          </Link>
        </div>
      )}

      {decision.reasoning && (
        <div className="card p-5">
          <p className="label !mb-2">Reasoning</p>
          <p className="text-sm leading-relaxed text-ink-200">{decision.reasoning}</p>
        </div>
      )}

      <div className="card p-5">
        <p className="label !mb-3">Options considered</p>
        <div className="space-y-2">
          {chosen && (
            <div className="rounded-lg border border-signal-500/40 bg-signal-500/[0.06] p-3">
              <p className="text-sm font-medium text-signal-400">✓ {chosen.name} — chosen</p>
              {chosen.description && (
                <p className="mt-1 text-sm text-ink-300">{chosen.description}</p>
              )}
            </div>
          )}
          {rejected.map((o) => (
            <div key={o.id} className="rounded-lg border border-ink-700 bg-ink-900/40 p-3">
              <p className="text-sm font-medium text-ink-200">{o.name}</p>
              {o.description && <p className="mt-1 text-sm text-ink-400">{o.description}</p>}
              {o.rejectionReason && (
                <p className="mt-1 text-xs text-ink-500">Not chosen: {o.rejectionReason}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <p className="label !mb-3">Assumptions DecisionLoop is watching</p>
        <div className="space-y-2">
          {decision.assumptions.map((a) => (
            <div
              key={a.id}
              className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${
                a.status === "INVALIDATED"
                  ? "border-risk-500/40 bg-risk-500/[0.05]"
                  : "border-ink-700 bg-ink-900/40"
              }`}
            >
              <div>
                <p className="text-sm text-ink-100">{a.statement}</p>
                {a.metric && a.operator && a.value !== null && (
                  <p className="mt-1 font-mono text-xs text-ink-500">
                    {a.metric} {a.operator} {a.value} {a.unit}
                  </p>
                )}
              </div>
              <AssumptionStatusBadge status={a.status} />
            </div>
          ))}
          {decision.assumptions.length === 0 && (
            <p className="text-sm text-ink-500">No structured assumptions were recorded.</p>
          )}
        </div>
      </div>

      {conflicts.length > 0 && (
        <div className="card p-5">
          <p className="label !mb-3">Conflict history</p>
          <div className="space-y-3">
            {conflicts.map((c) => (
              <div key={c.id} className="rounded-lg border border-risk-500/30 bg-risk-500/[0.04] p-3">
                <p className="text-xs text-ink-500">
                  {new Date(c.detectedAt).toLocaleString()}
                </p>
                <p className="mt-1 text-sm text-ink-100">
                  New fact: <span className="italic">&quot;{c.factStatement}&quot;</span>
                </p>
                <p className="mt-1 text-sm text-ink-300">{c.explanation}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-500">
          {traces.length} memory trace{traces.length === 1 ? "" : "s"} recorded for this decision.
        </p>
        <Link
          href={`/inspector?decisionId=${decision.id}`}
          className="text-xs text-signal-400 hover:text-signal-300"
        >
          Open in Memory Inspector →
        </Link>
      </div>
    </div>
  );
}
