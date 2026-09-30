"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeader, QueryState, EmptyState } from "@/components/Workspace";
import {
  DecisionStatusBadge,
  AssumptionStatusBadge,
} from "@/components/StatusBadge";
import { useV1, useV1Mutation, v1, timeAgo } from "@/lib/v1";
import type { DecisionService } from "@decisionloop/core/services/decisions";
import { useWorkspace } from "@/lib/workspace";
type History = Awaited<ReturnType<DecisionService["history"]>>;
export default function DecisionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useV1<History>(["decision", id], `/decisions/${id}`, {
    refetchInterval: 10000,
  });
  const [note, setNote] = useState("");
  const workspace = useWorkspace();
  const [replacement, setReplacement] = useState("");
  const supersede = useV1Mutation<string, unknown>((supersededBy) =>
    v1(`/decisions/${id}/supersede`, {
      body: { supersededBy, note: note || undefined },
    }),
  );
  const [localError, setLocalError] = useState("");
  const resolve = useV1Mutation<
    { conflictId: string; action: string },
    unknown
  >((x) =>
    v1(`/conflicts/${x.conflictId}/${x.action}`, {
      body: { note: note || undefined },
    }),
  );
  const reopen = useV1Mutation<void, unknown>(async () => {
    const r = await fetch(`/api/decisions/${id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reopen", note }),
    });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error);
    return b;
  });
  async function act(conflictId: string, action: string) {
    setLocalError("");
    try {
      await resolve.mutateAsync({ conflictId, action });
    } catch (e) {
      setLocalError((e as Error).message);
    }
  }
  if (q.isLoading || q.error || !q.data)
    return (
      <QueryState loading={q.isLoading} error={q.error} retry={q.refetch} />
    );
  const {
    decision: d,
    conflicts,
    timeline,
    evidence,
    evaluations,
    latestVerificationRuns,
  } = q.data;
  const chosen = d.options.find((o) => o.isChosen);
  const open = conflicts.filter((c) => !c.resolution);
  return (
    <div className="animate-fade-in">
      <Link href="/decisions" className="text-xs text-ink-400">
        ← Decision register
      </Link>
      <div className="mt-5">
        <PageHeader
          eyebrow={d.externalRef ?? "Decision record"}
          title={d.title}
          description={
            d.problemStatement ??
            "The choice, rationale, and conditions preserved in shared memory."
          }
          action={<DecisionStatusBadge status={d.status} />}
        />
      </div>
      {d.supersededByDecisionId && (
        <Link
          className="mb-6 block rounded-lg border border-ink-700 bg-ink-900 p-4 text-sm text-signal-600"
          href={`/decisions/${d.supersededByDecisionId}`}
        >
          This record has been replaced. Read the current decision →
        </Link>
      )}
      <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <section className="card form-section">
            <p className="eyebrow">The chosen direction</p>
            <h2 className="!text-2xl">{chosen?.name ?? "No chosen option"}</h2>
            {chosen?.description && (
              <p className="mb-5 text-sm text-ink-400">{chosen.description}</p>
            )}
            <div className="mt-5 border-t border-ink-700 pt-5">
              <h3 className="mb-3 text-sm font-semibold">Why this choice</h3>
              <p className="whitespace-pre-wrap text-sm leading-7 text-ink-300">
                {d.reasoning ?? "No rationale recorded."}
              </p>
            </div>
            {d.options.filter((o) => !o.isChosen).length > 0 && (
              <div className="mt-6">
                <h3 className="mb-3 text-sm font-semibold">
                  Alternatives considered
                </h3>
                <div className="space-y-3">
                  {d.options
                    .filter((o) => !o.isChosen)
                    .map((o) => (
                      <div key={o.id} className="rounded-lg bg-ink-950 p-4">
                        <p className="text-sm font-medium">{o.name}</p>
                        <p className="mt-2 text-xs leading-6 text-ink-400">
                          {o.rejectionReason ??
                            o.description ??
                            "No rejection reason recorded."}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </section>
          {d.constraints?.length ? (
            <section className="card form-section">
              <h2>Recorded guardrails</h2>
              <div className="mt-4 space-y-4">
                {d.constraints.map((constraint) => (
                  <div key={constraint.id}>
                    <p className="text-sm leading-6">{constraint.statement}</p>
                    <p className="mt-1 text-[10px] text-ink-400">
                      {constraint.severity.toLowerCase()}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <section>
            <h2 className="section-label">
              Conditions behind the choice{" "}
              <span className="ml-2 text-xs font-normal text-ink-400">
                {d.assumptions.length}
              </span>
            </h2>
            {d.assumptions.length ? (
              <div className="card divide-y divide-ink-800">
                {d.assumptions.map((a) => (
                  <div className="p-5" key={a.id}>
                    <div className="flex items-start justify-between gap-4">
                      <p className="text-sm font-medium leading-6">
                        {a.statement}
                      </p>
                      <AssumptionStatusBadge status={a.validityStatus} />
                    </div>
                    {a.normalizedStatement && (
                      <p className="mt-3 font-mono text-xs text-ink-400">
                        {a.normalizedStatement}
                      </p>
                    )}
                    <p className="mt-2 text-[11px] text-ink-400">
                      {a.verificationPolicy === "MANUAL"
                        ? "Human review required"
                        : a.valueType === "TEXT"
                          ? "Semantic review requires a model"
                          : "Checked against matching structured observations"}
                      {a.validUntil
                        ? " · Valid until " +
                          new Date(a.validUntil).toLocaleDateString()
                        : ""}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No conditions recorded">
                This choice has a rationale, but no explicit assumptions to
                monitor.
              </EmptyState>
            )}
          </section>
          {open.length > 0 && (
            <section className="card form-section border-risk-500/30">
              <p className="eyebrow !text-risk-600">Human review required</p>
              <h2>
                {open.length} open conflict{open.length === 1 ? "" : "s"}
              </h2>
              <p className="form-hint">
                Read the evidence and decide whether the contradiction applies.
              </p>
              <label className="label">
                Review note
                <textarea
                  className="input mt-2"
                  rows={2}
                  value={note}
                  maxLength={500}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Explain your judgment for the next reviewer."
                />
              </label>
              {open.map((c) => (
                <div key={c.id} className="mt-5 border-t border-ink-700 pt-5">
                  <p className="text-sm leading-7">{c.explanation}</p>
                  {c.sourceQuote && (
                    <blockquote className="mt-3 border-l-2 border-risk-500/40 pl-4 text-xs leading-6 text-ink-400">
                      {c.sourceQuote}
                    </blockquote>
                  )}
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      className="btn-primary"
                      disabled={resolve.isPending}
                      onClick={() => act(c.id, "accept")}
                    >
                      Accept evidence
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={resolve.isPending}
                      onClick={() => act(c.id, "dismiss")}
                    >
                      Dismiss conflict
                    </button>
                  </div>
                </div>
              ))}
              {localError && (
                <p role="alert" className="mt-4 text-sm text-risk-600">
                  {localError}
                </p>
              )}
            </section>
          )}
          <section>
            <h2 className="section-label">Evidence & evaluation</h2>
            {evaluations.length ? (
              <div className="card divide-y divide-ink-800">
                {evaluations.map((e) => (
                  <div key={e.id} className="p-5">
                    <div className="flex justify-between gap-3">
                      <p className="text-xs font-semibold">
                        {e.relation} · {e.method}
                      </p>
                      <span className="text-[10px] text-ink-400">
                        {timeAgo(e.createdAt)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-ink-300">
                      {e.explanation}
                    </p>
                    <p className="mt-2 text-xs text-ink-400">
                      {evidence.find((x) => x.id === e.evidenceItemId)?.content}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Evidence hasn't tested this choice yet">
                Submit an observation that matches one of its conditions to
                start the evaluation record.
              </EmptyState>
            )}
            <Link
              href="/documents"
              className="mt-4 inline-block text-xs text-signal-600"
            >
              + Submit evidence →
            </Link>
          </section>
          <section>
            <h2 className="section-label">Decision history</h2>
            <div className="card divide-y divide-ink-800">
              {timeline.map((e) => (
                <div key={e.id} className="flex gap-4 p-5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal-600" />
                  <div>
                    <p className="text-sm">
                      {e.summary ??
                        e.eventType.replaceAll("_", " ").toLowerCase()}
                    </p>
                    <p className="mt-2 text-[10px] text-ink-500">
                      {new Date(e.createdAt).toLocaleString()} ·{" "}
                      {e.actorType.toLowerCase()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="space-y-5">
          <section className="card form-section">
            <p className="eyebrow">Record details</p>
            <dl className="space-y-4 text-xs">
              <div>
                <dt className="text-ink-400">Recorded</dt>
                <dd className="mt-1">
                  {new Date(d.createdAt).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-ink-400">Domain</dt>
                <dd className="mt-1">{d.domain ?? "engineering"}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Memory index</dt>
                <dd className="mt-1">{d.memoryIndexStatus.toLowerCase()}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Repository</dt>
                <dd className="mt-1 break-all">
                  {d.resources?.find((r) => r.resourceType === "repository")
                    ?.resourceKey ?? "Not recorded"}
                </dd>
              </div>
            </dl>
            {d.resources?.length ? (
              <div className="mt-6 border-t border-ink-700 pt-5">
                <h3 className="mb-3 text-xs font-semibold">
                  Governed resources
                </h3>
                {d.resources.map((r) => (
                  <p
                    key={r.id}
                    className="mb-2 break-all rounded bg-ink-950 p-2 font-mono text-[10px]"
                  >
                    {r.resourceKey}
                  </p>
                ))}
              </div>
            ) : null}
          </section>
          {d.verificationChecks?.length ? (
            <section className="card form-section">
              <p className="eyebrow">Executable evidence</p>
              <h2>Verification checks</h2>
              {d.verificationChecks.map((c) => {
                const run = latestVerificationRuns.find(
                  (r) =>
                    r.checkName === c.name && r.repository === c.repository,
                );
                return (
                  <div key={c.name + c.repository} className="mt-4">
                    <p className="text-xs font-semibold">{c.name}</p>
                    <p className="mt-1 text-[10px] text-ink-400">
                      {c.repository}
                    </p>
                    <p className="mt-2 text-xs">
                      {run
                        ? `${run.conclusion} · ${run.commitSha.slice(0, 8)}`
                        : "No completed run recorded"}
                    </p>
                    {run?.detailsUrl?.startsWith("https://github.com/") && (
                      <a
                        target="_blank"
                        rel="noreferrer"
                        href={run.detailsUrl}
                        className="mt-1 inline-block text-xs text-signal-600"
                      >
                        View run ↗
                      </a>
                    )}
                  </div>
                );
              })}
            </section>
          ) : null}
          {(d.status === "ACTIVE" ||
            d.status === "AT_RISK" ||
            d.status === "REOPENED") && (
            <section className="card form-section">
              <h2>Reconsider the choice</h2>
              <p className="form-hint">
                Reopening preserves the record and signals that the choice is
                back on the table.
              </p>
              <button
                className="btn-secondary w-full"
                disabled={reopen.isPending || d.status === "REOPENED"}
                onClick={() => reopen.mutate()}
              >
                {d.status === "REOPENED"
                  ? "Already reopened"
                  : "Reopen decision"}
              </button>
              {reopen.error && (
                <p role="alert" className="mt-3 text-xs text-risk-600">
                  {reopen.error.message}
                </p>
              )}
              <Link
                href={`/decisions/${id}/impact`}
                className="mt-4 block text-xs text-signal-600"
              >
                View dependent decisions →
              </Link>
              <details className="mt-5 border-t border-ink-700 pt-4">
                <summary className="cursor-pointer text-xs font-medium">
                  Replace with a newer decision
                </summary>
                <p className="mt-3 text-xs leading-6 text-ink-400">
                  The old record is preserved and points to its replacement.
                </p>
                <label className="label mt-3">
                  Replacement
                  <select
                    className="input mt-2"
                    value={replacement}
                    onChange={(event) => setReplacement(event.target.value)}
                  >
                    <option value="">Choose an active decision</option>
                    {workspace.data?.decisions
                      .filter((row) => row.id !== id && row.status === "ACTIVE")
                      .map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.title}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="btn-secondary mt-3 w-full"
                  disabled={!replacement || supersede.isPending}
                  onClick={() => supersede.mutate(replacement)}
                >
                  {supersede.isPending ? "Replacing…" : "Supersede decision"}
                </button>
                {supersede.error && (
                  <p role="alert" className="mt-3 text-xs text-risk-600">
                    {supersede.error.message}
                  </p>
                )}
              </details>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
