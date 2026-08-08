"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { DocumentStatusBadge } from "@/components/StatusBadge";
import { useDocuments, useUploadDocument } from "@/lib/queries";
import type { ConflictDetectionSummary } from "@/lib/engine/conflictDetection";

export default function DocumentsPage() {
  const { data, isLoading } = useDocuments();
  const upload = useUploadDocument();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastSummary, setLastSummary] = useState<ConflictDetectionSummary | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setLastSummary(null);
    const result = await upload.mutateAsync(file);
    setLastSummary(result.conflictSummary);
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

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-50">Documents</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-400">
          Upload a document with no reference to any existing decision. DecisionLoop extracts
          facts, checks them against every stored assumption across your workspace, and flags a
          decision as{" "}
          <span className="font-medium text-risk-400">at risk</span> if one no longer holds.
        </p>
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
        <p className="text-xs text-ink-500">PDF, TXT, or Markdown. Max 50MB.</p>
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

      {lastSummary && (
        <div
          className={`card p-5 ${
            lastSummary.conflictsFound > 0 ? "border-risk-500/40 bg-risk-500/[0.05]" : ""
          }`}
        >
          <p className="mb-2 text-sm font-semibold text-ink-100">
            {lastSummary.conflictsFound > 0
              ? `${lastSummary.conflictsFound} conflict${lastSummary.conflictsFound === 1 ? "" : "s"} found`
              : "No conflicts found"}
          </p>
          <p className="text-sm text-ink-400">
            Extracted {lastSummary.factsExtracted} fact{lastSummary.factsExtracted === 1 ? "" : "s"},
            checked against {lastSummary.candidatesConsidered} candidate assumption
            {lastSummary.candidatesConsidered === 1 ? "" : "s"} retrieved from CockroachDB.
          </p>
          {lastSummary.decisionsMarkedAtRisk.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {lastSummary.decisionsMarkedAtRisk.map((id) => (
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
              <div key={doc.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm text-ink-100">{doc.filename}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {new Date(doc.createdAt).toLocaleString()}
                    {doc.processingError ? ` — ${doc.processingError}` : ""}
                  </p>
                </div>
                <DocumentStatusBadge status={doc.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
