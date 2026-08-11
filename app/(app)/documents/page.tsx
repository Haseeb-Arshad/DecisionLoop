"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { DocumentStatusBadge, SourceTypeBadge } from "@/components/StatusBadge";
import { SOURCE_TYPE_OPTIONS } from "@/lib/api/uploadTypes";
import { useDocuments, useUploadDocument } from "@/lib/queries";
import type { DocumentSourceType } from "@/lib/types";
import type { UploadResult } from "@/lib/api/client";

export default function DocumentsPage() {
  const { data, isLoading } = useDocuments();
  const upload = useUploadDocument();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastResult, setLastResult] = useState<UploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sourceType, setSourceType] = useState<DocumentSourceType>("VENDOR_OFFICIAL");

  async function handleFile(file: File) {
    setLastResult(null);
    const result = await upload.mutateAsync({ file, sourceType });
    setLastResult(result);
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await handleFile(file);
    e.target.value = "";
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  }

  const documents = data?.documents ?? [];
  const summary = lastResult?.conflictSummary;
  const activeSource = SOURCE_TYPE_OPTIONS.find((o) => o.value === sourceType);

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-50">Evidence</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-400">
          Upload a document with no reference to any existing decision. DecisionLoop extracts
          facts, checks them against every stored assumption across your workspace, and flags a
          decision as <span className="font-medium text-risk-400">at risk</span> if one no longer
          holds.
        </p>
      </div>

      <div className="card p-4">
        <label className="label" htmlFor="source-type">
          Source type
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <select
            id="source-type"
            className="input max-w-xs"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as DocumentSourceType)}
          >
            {SOURCE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-500">{activeSource?.hint}</p>
        </div>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`card flex flex-col items-center justify-center gap-3 border-2 border-dashed
          px-6 py-14 text-center transition ${
            dragOver ? "border-signal-500 bg-signal-500/5" : "border-ink-700"
          }`}
      >
        <p className="text-sm text-ink-300">
          Drag a file here, or{" "}
          <button
            className="text-signal-400 underline underline-offset-2 hover:text-signal-300"
            onClick={() => fileInputRef.current?.click()}
          >
            browse
          </button>
        </p>
        <p className="text-xs text-ink-500">PDF, TXT, or Markdown. Max 25MB.</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          className="hidden"
          onChange={onFileChange}
        />
        {upload.isPending && (
          <p className="mt-2 flex items-center gap-2 text-xs text-signal-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal-400" />
            Extracting text, embedding, checking every stored assumption…
          </p>
        )}
        {upload.isError && (
          <p className="mt-2 text-xs text-risk-400">{(upload.error as Error).message}</p>
        )}
      </div>

      {lastResult && (
        <div
          className={`card p-5 ${
            summary && summary.conflictsFound > 0 ? "border-risk-500/40 bg-risk-500/[0.05]" : ""
          }`}
        >
          {lastResult.duplicateOf ? (
            <>
              <p className="mb-1 text-sm font-semibold text-ink-100">
                Duplicate content — no re-analysis
              </p>
              <p className="text-sm text-ink-400">
                This file&apos;s content matches a document already in memory, so DecisionLoop
                skipped re-embedding it and did not raise the same conflicts twice.
              </p>
            </>
          ) : (
            <>
              <p className="mb-2 text-sm font-semibold text-ink-100">
                {summary && summary.conflictsFound > 0
                  ? `${summary.conflictsFound} conflict${summary.conflictsFound === 1 ? "" : "s"} found`
                  : "No conflicts found"}
              </p>
              <p className="text-sm text-ink-400">
                Extracted {summary?.factsExtracted ?? 0} fact
                {summary?.factsExtracted === 1 ? "" : "s"}, checked against{" "}
                {summary?.candidatesConsidered ?? 0} candidate assumption
                {summary?.candidatesConsidered === 1 ? "" : "s"} retrieved from CockroachDB.
                {summary && summary.assumptionsChallenged > 0 && (
                  <>
                    {" "}
                    <span className="text-amber-400">
                      {summary.assumptionsChallenged} challenged
                    </span>{" "}
                    (source authority too low to invalidate outright).
                  </>
                )}
              </p>
              {summary?.injectionSuspected && (
                <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 text-xs text-amber-300">
                  This document contains text that looks like instructions to an AI
                  ({summary.injectionPatterns.join(", ")}). It was processed as data only — see
                  the audit log.
                </p>
              )}
              {summary && summary.decisionsMarkedAtRisk.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {summary.decisionsMarkedAtRisk.map((id) => (
                    <Link
                      key={id}
                      href={`/decisions/${id}`}
                      className="pill bg-risk-500/15 text-risk-400 ring-1 ring-inset ring-risk-500/30 hover:bg-risk-500/25"
                    >
                      View decision now at risk →
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div>
        <p className="label !mb-3">Upload history</p>
        {isLoading ? (
          <div className="card px-6 py-10 text-center text-sm text-ink-400">Loading…</div>
        ) : documents.length === 0 ? (
          <div className="card px-6 py-10 text-center text-sm text-ink-400">
            No documents uploaded yet.
          </div>
        ) : (
          <div className="card divide-y divide-ink-800/60">
            {documents.map((doc) => (
              <Link
                key={doc.id}
                href={`/documents/${doc.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-ink-800/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink-100">{doc.filename}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {new Date(doc.createdAt).toLocaleString()}
                    {doc.processingError ? ` — ${doc.processingError}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <SourceTypeBadge
                    sourceType={doc.sourceType}
                    authorityScore={doc.authorityScore}
                  />
                  <DocumentStatusBadge status={doc.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
