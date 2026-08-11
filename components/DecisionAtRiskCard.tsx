"use client";

import Link from "next/link";
import { useState } from "react";
import { SourceTypeBadge } from "@/components/StatusBadge";
import { useReopenDecision, useResolveConflict } from "@/lib/queries";
import type {
  ConflictEvent,
  DecisionEvidenceWithSource,
  DecisionWithDetails,
} from "@/lib/types";

/**
 * The §22 centrepiece: when memory contradicts a committed decision, this
 * is what the user sees. It states the original assumption and its source,
 * the new evidence and its source, why they conflict, and what that means
 * for the alternative that was rejected — then offers the four explicit
 * human actions. The AI recommends; the person decides.
 */
export function DecisionAtRiskCard({
  decision,
  conflict,
  evidence,
}: {
  decision: DecisionWithDetails;
  conflict: ConflictEvent;
  evidence: DecisionEvidenceWithSource[];
}) {
  const reopen = useReopenDecision();
  const resolve = useResolveConflict();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const assumption = decision.assumptions.find((a) => a.id === conflict.assumptionId);
  const suggested = decision.options.find((o) => o.id === conflict.suggestedOptionId);
  const chosen = decision.options.find((o) => o.isChosen);

  const contradicting = evidence.find(
    (e) => e.assumptionId === conflict.assumptionId && e.evidenceType === "CONTRADICTING",
  );
  const supporting = evidence.find(
    (e) => e.assumptionId === conflict.assumptionId && e.evidenceType === "SUPPORTING",
  );

  const busy = reopen.isPending || resolve.isPending;
  const resolved = Boolean(conflict.resolution);

  return (
    <section className="card animate-fade-in overflow-hidden border-risk-500/40">
      <div className="border-b border-risk-500/25 bg-risk-500/[0.07] px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-risk-400">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-risk-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-risk-400" />
              </span>
              Decision at risk
            </p>
            <h2 className="mt-1.5 text-lg font-semibold text-ink-50">
              {chosen ? `Choose ${chosen.name}` : decision.title}
            </h2>
            <p className="mt-1 text-sm text-ink-300">
              {conflict.explanation}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-xs text-ink-500">
              confidence {conflict.confidence.toFixed(2)}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-600">
              {conflict.detectionMethod === "DETERMINISTIC"
                ? "structured comparison"
                : "model judgment"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-px bg-ink-700/40 md:grid-cols-2">
        <div className="bg-ink-900/60 p-5">
          <p className="label !mb-2">Original assumption</p>
          <p className="text-sm text-ink-100">
            {assumption?.statement ?? "(assumption no longer available)"}
          </p>
          {conflict.oldValue && (
            <p className="mt-1.5 font-mono text-xs text-ink-400">{conflict.oldValue}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <span>Source:</span>
            {supporting?.documentFilename ? (
              <Link
                href={`/documents/${supporting.documentId}`}
                className="text-signal-400 underline underline-offset-2 hover:text-signal-300"
              >
                {supporting.documentFilename}
                {supporting.pageNumber ? ` — page ${supporting.pageNumber}` : ""}
              </Link>
            ) : (
              <span className="text-ink-500">recorded at commit time</span>
            )}
          </div>
        </div>

        <div className="bg-ink-900/60 p-5">
          <p className="label !mb-2">New evidence</p>
          <p className="text-sm text-ink-100">{conflict.factStatement}</p>
          {conflict.newValue && (
            <p className="mt-1.5 font-mono text-xs text-risk-400">{conflict.newValue}</p>
          )}
          {conflict.sourceQuote && (
            <blockquote className="mt-2 border-l-2 border-ink-600 pl-3 text-xs italic text-ink-400">
              “{conflict.sourceQuote}”
            </blockquote>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <span>Source:</span>
            {contradicting?.documentFilename ? (
              <Link
                href={`/documents/${contradicting.documentId}`}
                className="text-signal-400 underline underline-offset-2 hover:text-signal-300"
              >
                {contradicting.documentFilename}
                {contradicting.pageNumber ? ` — page ${contradicting.pageNumber}` : ""}
              </Link>
            ) : (
              <span>uploaded document</span>
            )}
            {contradicting?.documentSourceType && (
              <SourceTypeBadge
                sourceType={contradicting.documentSourceType}
                authorityScore={contradicting.documentAuthorityScore ?? undefined}
              />
            )}
          </div>
        </div>
      </div>

      {suggested && (
        <div className="border-t border-ink-700/50 bg-ink-900/40 px-6 py-4">
          <p className="label !mb-1.5">Impact</p>
          <p className="text-sm leading-relaxed text-ink-200">
            {suggested.rejectionReason
              ? `${suggested.name} was rejected because ${suggested.rejectionReason.replace(/^because\s+/i, "")}`
              : `${suggested.name} was considered and rejected.`}{" "}
            <span className="text-ink-100">
              That reasoning no longer holds — {suggested.name} may now be preferable.
            </span>
          </p>
        </div>
      )}

      <div className="border-t border-ink-700/50 px-6 py-4">
        {resolved ? (
          <p className="text-sm text-ink-400">
            Resolved as <span className="text-ink-100">{conflict.resolution}</span>
            {conflict.reviewedAt
              ? ` on ${new Date(conflict.reviewedAt).toLocaleString()}`
              : ""}
            .
          </p>
        ) : (
          <>
            {showNote && (
              <input
                className="input mb-3"
                placeholder="Optional note — recorded in the decision's history"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() =>
                  reopen.mutate({
                    decisionId: decision.id,
                    conflictId: conflict.id,
                    note: note || undefined,
                  })
                }
              >
                {reopen.isPending ? "Reopening…" : "Reopen decision"}
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() =>
                  resolve.mutate({
                    conflictId: conflict.id,
                    resolution: "accept",
                    note: note || undefined,
                  })
                }
              >
                Accept new evidence
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() =>
                  resolve.mutate({
                    conflictId: conflict.id,
                    resolution: "dismiss",
                    note: note || undefined,
                  })
                }
              >
                Dismiss conflict
              </button>
              <Link href={`/ask?decisionId=${decision.id}`} className="btn-secondary">
                Ask DecisionLoop
              </Link>
              <button
                className="ml-auto text-xs text-ink-500 hover:text-ink-300"
                onClick={() => setShowNote((v) => !v)}
              >
                {showNote ? "Hide note" : "Add note"}
              </button>
            </div>
            {(reopen.isError || resolve.isError) && (
              <p className="mt-2 text-sm text-risk-400">
                {((reopen.error ?? resolve.error) as Error).message}
              </p>
            )}
          </>
        )}
        <p className="mt-3 text-xs text-ink-600">
          Nothing is deleted by any of these actions — the conflict, the original assumption and
          the evidence all stay in the record.{" "}
          <Link
            href={`/inspector?decisionId=${decision.id}`}
            className="text-signal-400 underline underline-offset-2 hover:text-signal-300"
          >
            See which memories caused this
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
