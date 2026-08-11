"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { DocumentStatusBadge, SourceTypeBadge } from "@/components/StatusBadge";
import { useDocument } from "@/lib/queries";

/**
 * Evidence Viewer (§36): the source document behind a piece of evidence,
 * with the chunks DecisionLoop actually indexed shown separately from the
 * raw text — so a claim like "SignalForge Proposal — page 3" can be
 * followed all the way back to the paragraph it came from.
 */
export default function EvidenceViewerPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useDocument(params.id);

  if (isLoading) {
    return <div className="card px-6 py-12 text-center text-sm text-ink-400">Loading…</div>;
  }
  if (isError || !data) {
    return (
      <div className="card px-6 py-12 text-center text-sm text-risk-400">
        {isError ? (error as Error).message : "Document not found."}
      </div>
    );
  }

  const { document, chunks, downloadUrl } = data;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <Link href="/documents" className="text-xs text-ink-400 hover:text-ink-200">
          ← All evidence
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-50">{document.filename}</h1>
            <p className="mt-1 text-sm text-ink-500">
              Uploaded {new Date(document.createdAt).toLocaleString()}
              {document.pageCount ? ` · ${document.pageCount} pages` : ""}
              {document.sizeBytes
                ? ` · ${(document.sizeBytes / 1024).toFixed(0)} KB`
                : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SourceTypeBadge
              sourceType={document.sourceType}
              authorityScore={document.authorityScore}
            />
            <DocumentStatusBadge status={document.status} />
          </div>
        </div>
      </div>

      {document.processingError && (
        <div className="card border-risk-500/40 bg-risk-500/[0.05] p-4 text-sm text-risk-400">
          {document.processingError}
        </div>
      )}

      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-ink-300">
            Authority{" "}
            <span className="font-mono text-ink-100">
              {document.authorityScore.toFixed(2)}
            </span>{" "}
            — {document.authorityScore >= 0.75
              ? "strong enough to invalidate an assumption outright."
              : "will challenge an assumption for human review, not invalidate it on its own."}
          </div>
          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary !px-3 !py-1.5 text-xs"
            >
              Open original
            </a>
          )}
        </div>
      </div>

      {chunks.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-100">
            Indexed memory chunks ({chunks.length})
          </h2>
          <p className="mb-3 text-xs text-ink-500">
            These are the exact units stored in CockroachDB and searched by vector similarity —
            what the Memory Inspector cites when this document drives an action.
          </p>
          <div className="space-y-2">
            {chunks.map((chunk) => (
              <div key={chunk.id} className="card p-4">
                <div className="mb-2 flex items-center gap-3 text-[11px] text-ink-500">
                  <span className="font-mono">#{chunk.chunkIndex ?? 0}</span>
                  {chunk.pageNumber && <span>page {chunk.pageNumber}</span>}
                  <span className="font-mono">{chunk.id.slice(0, 8)}…</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-300">
                  {chunk.content}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {document.extractedText && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-100">Extracted text</h2>
          <div className="card max-h-[480px] overflow-y-auto p-4">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-400">
              {document.extractedText}
            </pre>
          </div>
        </section>
      )}
    </div>
  );
}
