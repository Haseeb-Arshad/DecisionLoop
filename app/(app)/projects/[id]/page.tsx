"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  DecisionStatusBadge,
  DocumentStatusBadge,
  SourceTypeBadge,
} from "@/components/StatusBadge";
import { useProject } from "@/lib/queries";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useProject(params.id);

  if (isLoading) {
    return <div className="card px-6 py-12 text-center text-sm text-ink-400">Loading…</div>;
  }
  if (isError || !data) {
    return (
      <div className="card px-6 py-12 text-center text-sm text-risk-400">
        {isError ? (error as Error).message : "Project not found."}
      </div>
    );
  }

  const { project, decisions, documents } = data;
  const atRisk = decisions.filter((d) => d.status === "AT_RISK");

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <Link href="/projects" className="text-xs text-ink-400 hover:text-ink-200">
          ← All projects
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink-50">{project.name}</h1>
        {project.description && (
          <p className="mt-1 text-sm text-ink-400">{project.description}</p>
        )}
      </div>

      {atRisk.length > 0 && (
        <div className="card border-risk-500/30 bg-risk-500/[0.05] p-4">
          <p className="text-sm text-risk-400">
            {atRisk.length} decision{atRisk.length === 1 ? "" : "s"} in this project{" "}
            {atRisk.length === 1 ? "is" : "are"} at risk.
          </p>
        </div>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-100">Decisions</h2>
          <Link href="/decisions/new" className="text-xs text-signal-400 hover:text-signal-300">
            + Commit a decision
          </Link>
        </div>
        {decisions.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-ink-400">
            No decisions committed in this project yet.
          </div>
        ) : (
          <div className="card divide-y divide-ink-800/60">
            {decisions.map((decision) => (
              <Link
                key={decision.id}
                href={`/decisions/${decision.id}`}
                className="flex items-start justify-between gap-4 px-4 py-3 transition hover:bg-ink-800/40"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-100">{decision.title}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {decision.options.find((o) => o.isChosen)?.name ?? "—"} ·{" "}
                    {decision.assumptions.filter((a) => a.validityStatus === "VALID").length}/
                    {decision.assumptions.length} assumptions valid
                  </p>
                </div>
                <DecisionStatusBadge status={decision.status} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-100">Evidence</h2>
          <Link href="/documents" className="text-xs text-signal-400 hover:text-signal-300">
            + Add evidence
          </Link>
        </div>
        {documents.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-ink-400">
            No documents uploaded to this project yet.
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
      </section>
    </div>
  );
}
