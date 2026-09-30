"use client";

import Link from "next/link";
import { useState } from "react";
import { SourceTypeBadge } from "@/components/StatusBadge";
import { useReopenDecision, useResolveConflict } from "@/lib/queries";
import type { ConflictEvent, DecisionEvidenceWithSource, DecisionWithDetails } from "@/lib/types";

/**
 * What a person needs to judge a flagged decision, side by side: the original
 * assumption and where it came from, the new evidence and where it came from,
 * why they conflict, and the four explicit actions. The system recommends; the
 * person decides, and nothing is deleted by any action.
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

  const assumption = decision.assumptions.find((a) => a.id === conflict.assumptionId);
  const suggested = decision.options.find((o) => o.id === conflict.suggestedOptionId);
  const chosen = decision.options.find((o) => o.isChosen);
  const contradicting = evidence.find((e) => e.assumptionId === conflict.assumptionId && e.evidenceType === "CONTRADICTING");
  const supporting = evidence.find((e) => e.assumptionId === conflict.assumptionId && e.evidenceType === "SUPPORTING");
  const busy = reopen.isPending || resolve.isPending;
  const resolved = Boolean(conflict.resolution);

  return (
    <section className="card">
      <div className="border-b border-ink-700 px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base">{chosen ? `${decision.externalRef ? `${decision.externalRef}: ` : ""}${chosen.name}` : decision.title}</h2>
          <span className="font-mono text-xs text-ink-400">
            {conflict.detectionMethod === "DETERMINISTIC" ? "checked by comparison" : "judged by a model"}, confidence {conflict.confidence.toFixed(2)}
          </span>
        </div>
        <p className="mt-1 text-sm text-ink-300">{conflict.explanation}</p>
      </div>

      <div className="grid divide-ink-700 md:grid-cols-2 md:divide-x">
        <div className="p-4">
          <p className="eyebrow">Recorded assumption</p>
          <p className="text-sm">{assumption?.statement ?? "(no longer available)"}</p>
          {conflict.oldValue && <p className="mt-1 font-mono text-xs text-ink-400">{conflict.oldValue}</p>}
          <p className="mt-2 text-xs text-ink-400">
            Source:{" "}
            {supporting?.documentFilename ? (
              <Link href={`/documents/${supporting.documentId}`} className="text-signal-600 underline">
                {supporting.documentFilename}
                {supporting.pageNumber ? `, page ${supporting.pageNumber}` : ""}
              </Link>
            ) : (
              "recorded when the decision was made"
            )}
          </p>
        </div>
        <div className="border-t border-ink-700 p-4 md:border-t-0">
          <p className="eyebrow">New evidence</p>
          <p className="text-sm">{conflict.factStatement}</p>
          {conflict.newValue && <p className="mt-1 font-mono text-xs text-risk-600">{conflict.newValue}</p>}
          {conflict.sourceQuote && <blockquote className="mt-2 border-l-2 border-ink-600 pl-3 text-xs text-ink-300">“{conflict.sourceQuote}”</blockquote>}
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-400">
            <span>Source:</span>
            {contradicting?.documentFilename ? (
              <Link href={`/documents/${contradicting.documentId}`} className="text-signal-600 underline">
                {contradicting.documentFilename}
                {contradicting.pageNumber ? `, page ${contradicting.pageNumber}` : ""}
              </Link>
            ) : (
              <span>submitted evidence</span>
            )}
            {contradicting?.documentSourceType && (
              <SourceTypeBadge sourceType={contradicting.documentSourceType} authorityScore={contradicting.documentAuthorityScore ?? undefined} />
            )}
          </p>
        </div>
      </div>

      {suggested && (
        <div className="border-t border-ink-700 px-4 py-3 text-sm">
          <p className="eyebrow">What this changes</p>
          <p className="text-ink-200">
            {suggested.rejectionReason
              ? `${suggested.name} was rejected because ${suggested.rejectionReason.replace(/^because\s+/i, "")}`
              : `${suggested.name} was considered and rejected.`}{" "}
            That reasoning may no longer hold.
          </p>
        </div>
      )}

      <div className="border-t border-ink-700 px-4 py-3">
        {resolved ? (
          <p className="text-sm text-ink-300">
            Resolved as <strong className="text-ink-50">{conflict.resolution}</strong>
            {conflict.reviewedAt ? ` on ${new Date(conflict.reviewedAt).toLocaleString()}` : ""}.
          </p>
        ) : (
          <>
            <label className="label" htmlFor={`note-${conflict.id}`}>
              Note (optional, kept in the decision history)
            </label>
            <input id={`note-${conflict.id}`} className="input mb-3" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => reopen.mutate({ decisionId: decision.id, conflictId: conflict.id, note: note || undefined })}
              >
                {reopen.isPending ? "Reopening…" : "Reopen decision"}
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => resolve.mutate({ conflictId: conflict.id, resolution: "accept", note: note || undefined })}
              >
                Accept evidence
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => resolve.mutate({ conflictId: conflict.id, resolution: "dismiss", note: note || undefined })}
              >
                Dismiss conflict
              </button>
              <Link href={`/inspector?decisionId=${decision.id}`} className="ml-auto text-xs text-signal-600 underline">
                Why was this flagged?
              </Link>
            </div>
            {(reopen.isError || resolve.isError) && (
              <p role="alert" className="mt-2 text-sm text-risk-600">
                {((reopen.error ?? resolve.error) as Error).message}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
