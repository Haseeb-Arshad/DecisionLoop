"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { DecisionAtRiskCard } from "@/components/DecisionAtRiskCard";
import { MemoryTimeline } from "@/components/MemoryTimeline";
import {
  AssumptionStatusBadge,
  DecisionStatusBadge,
  SourceTypeBadge,
} from "@/components/StatusBadge";
import { useDecision, useRetryDecisionMemory } from "@/lib/queries";

export default function DecisionDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useDecision(params.id);
  const retryMemory = useRetryDecisionMemory();

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

  const { decision, conflicts, traces, evidence, timeline } = data;
  const chosen = decision.options.find((o) => o.isChosen);
  const rejected = decision.options.filter((o) => !o.isChosen);
  const openConflict = conflicts.find((c) => !c.resolution);
  const supportingEvidence = evidence.filter((e) => e.evidenceType === "SUPPORTING");

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
        {decision.memoryIndexStatus !== "INDEXED" && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-3 text-xs text-amber-200">
            Memory indexing is {decision.memoryIndexStatus.toLowerCase()}.
            {decision.memoryIndexError ? ` ${decision.memoryIndexError}` : " Retry the commit before relying on cross-session recall."}
            <button
              type="button"
              className="ml-2 underline underline-offset-2"
              disabled={retryMemory.isPending}
              onClick={() => retryMemory.mutate(decision.id)}
            >
              {retryMemory.isPending ? "Retrying…" : "Retry now"}
            </button>
          </div>
        )}
      </div>

      {openConflict && (
        <DecisionAtRiskCard
          decision={decision}
          conflict={openConflict}
          evidence={evidence}
        />
      )}

      {decision.status === "SUPERSEDED" && decision.supersededByDecisionId && (
        <div className="card p-4 text-sm text-ink-300">
          This decision was superseded.{" "}
          <Link
            href={`/decisions/${decision.supersededByDecisionId}`}
            className="text-signal-400 hover:text-signal-300"
          >
            View the decision that replaced it →
          </Link>
        </div>
      )}

      {decision.reasoning && (
        <div className="card p-5">
          <p className="label !mb-2">Reasoning</p>
          <p className="text-sm leading-relaxed text-ink-200">{decision.reasoning}</p>
          <p className="mt-3 text-xs text-ink-600">
            Confidence at commit time: {decision.confidence.toFixed(2)} · importance{" "}
            {decision.importance.toFixed(2)}
          </p>
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
                a.validityStatus === "INVALIDATED"
                  ? "border-risk-500/40 bg-risk-500/[0.05]"
                  : a.validityStatus === "CHALLENGED"
                    ? "border-amber-500/40 bg-amber-500/[0.04]"
                    : "border-ink-700 bg-ink-900/40"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm text-ink-100">{a.statement}</p>
                {a.normalizedStatement && (
                  <p className="mt-1 font-mono text-xs text-ink-500">{a.normalizedStatement}</p>
                )}
                <p className="mt-1 text-[11px] text-ink-600">
                  importance {a.importance.toFixed(2)} · authority {a.authorityScore.toFixed(2)} ·{" "}
                  {a.assumptionType.toLowerCase()}
                </p>
              </div>
              <AssumptionStatusBadge status={a.validityStatus} />
            </div>
          ))}
          {decision.assumptions.length === 0 && (
            <p className="text-sm text-ink-500">No structured assumptions were recorded.</p>
          )}
        </div>
      </div>

      {supportingEvidence.length > 0 && (
        <div className="card p-5">
          <p className="label !mb-3">Supporting evidence</p>
          <div className="space-y-2">
            {supportingEvidence.map((e) => (
              <div key={e.id} className="rounded-lg border border-ink-700 bg-ink-900/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  {e.documentId ? (
                    <Link
                      href={`/documents/${e.documentId}`}
                      className="text-sm text-signal-400 hover:text-signal-300"
                    >
                      {e.documentFilename ?? "Document"}
                      {e.pageNumber ? ` — page ${e.pageNumber}` : ""}
                    </Link>
                  ) : (
                    <span className="text-sm text-ink-300">Recorded at commit time</span>
                  )}
                  {e.documentSourceType && (
                    <SourceTypeBadge
                      sourceType={e.documentSourceType}
                      authorityScore={e.documentAuthorityScore ?? undefined}
                    />
                  )}
                </div>
                {e.excerpt && (
                  <p className="mt-2 text-xs italic text-ink-400">“{e.excerpt}”</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-5">
        <p className="label !mb-3">Memory timeline</p>
        <MemoryTimeline events={timeline} />
      </div>

      {conflicts.length > 0 && (
        <div className="card p-5">
          <p className="label !mb-3">Conflict history</p>
          <div className="space-y-3">
            {conflicts.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-ink-700 bg-ink-900/40 p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  <span>{new Date(c.detectedAt).toLocaleString()}</span>
                  <span className="font-mono">{c.conflictType.replaceAll("_", " ").toLowerCase()}</span>
                  <span className="font-mono">confidence {c.confidence.toFixed(2)}</span>
                  {c.resolution && (
                    <span className="pill bg-ink-700/60 text-ink-200">{c.resolution}</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink-100">{c.factStatement}</p>
                <p className="mt-1 text-sm text-ink-400">{c.explanation}</p>
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
