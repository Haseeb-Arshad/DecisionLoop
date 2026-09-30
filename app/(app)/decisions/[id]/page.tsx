"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHeader, QueryState, EmptyState, When } from "@/components/Workspace";
import { DecisionStatusBadge, AssumptionStatusBadge } from "@/components/StatusBadge";
import { MemoryTimeline } from "@/components/MemoryTimeline";
import { useV1, useV1Mutation, v1 } from "@/lib/v1";
import type { DecisionService } from "@decisionloop/core/services/decisions";
import { useWorkspace } from "@/lib/workspace";

type History = Awaited<ReturnType<DecisionService["history"]>>;

function verifiedBy(a: History["decision"]["assumptions"][number]): string {
  if (a.verificationPolicy === "MANUAL") return "A person";
  if (a.valueType === "TEXT") return "A model (if configured)";
  return "Comparison by code";
}

export default function DecisionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useV1<History>(["decision", id], `/decisions/${id}`, { refetchInterval: 10000 });
  const [note, setNote] = useState("");
  const workspace = useWorkspace();
  const [replacement, setReplacement] = useState("");
  const [localError, setLocalError] = useState("");

  const supersede = useV1Mutation<string, unknown>((supersededBy) =>
    v1(`/decisions/${id}/supersede`, { body: { supersededBy, note: note || undefined } }),
  );
  const resolve = useV1Mutation<{ conflictId: string; action: string }, unknown>((x) =>
    v1(`/conflicts/${x.conflictId}/${x.action}`, { body: { note: note || undefined } }),
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

  if (q.isLoading || q.error || !q.data) return <QueryState loading={q.isLoading} error={q.error} retry={q.refetch} />;

  const { decision: d, conflicts, timeline, evidence, evaluations, latestVerificationRuns } = q.data;
  const chosen = d.options.find((o) => o.isChosen);
  const rejected = d.options.filter((o) => !o.isChosen);
  const open = conflicts.filter((c) => !c.resolution);
  const live = d.status === "ACTIVE" || d.status === "AT_RISK" || d.status === "REOPENED";

  return (
    <div>
      <Link href="/decisions" className="text-xs text-ink-400 underline">
        All decisions
      </Link>
      <div className="mt-3">
        <PageHeader
          title={`${d.externalRef ? `${d.externalRef}  ` : ""}${d.title}`}
          description={d.problemStatement}
          action={<DecisionStatusBadge status={d.status} />}
        />
      </div>

      {d.supersededByDecisionId && (
        <p className="mb-6 rounded border border-ink-700 bg-ink-800 px-4 py-3 text-sm">
          This decision was replaced.{" "}
          <Link className="text-signal-600 underline" href={`/decisions/${d.supersededByDecisionId}`}>
            Read the current one
          </Link>
          .
        </p>
      )}
      {d.riskExplanation && d.status === "AT_RISK" && (
        <p role="note" className="mb-6 rounded border border-risk-500/40 px-4 py-3 text-sm text-risk-600">
          {d.riskExplanation}
        </p>
      )}

      <div className="space-y-8">
        <section>
          <h2 className="section-label">Decision</h2>
          <dl className="kv">
            <dt>Chosen</dt>
            <dd className="font-medium">
              {chosen?.name ?? "—"}
              {chosen?.description && <span className="block font-normal text-ink-400">{chosen.description}</span>}
            </dd>
            <dt>Why</dt>
            <dd className="whitespace-pre-wrap">{d.reasoning ?? "No rationale recorded."}</dd>
            {rejected.map((o) => (
              <div key={o.id} className="contents">
                <dt>Rejected</dt>
                <dd>
                  <span className="font-medium">{o.name}</span>
                  <span className="block text-ink-400">{o.rejectionReason ?? o.description ?? "No reason recorded."}</span>
                </dd>
              </div>
            ))}
            <dt>Domain</dt>
            <dd>{d.domain ?? "—"}</dd>
            <dt>Decided by</dt>
            <dd>
              {d.decidedByType === "USER" ? "A person" : (d.decidedByLabel ?? d.decidedByType.toLowerCase())} on {new Date(d.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </dd>
            {d.resources?.filter((r) => r.resourceType !== "repository").length ? (
              <>
                <dt>Governs</dt>
                <dd className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
                  {d.resources
                    .filter((r) => r.resourceType !== "repository")
                    .map((r) => (
                      <span key={r.id}>{r.resourceType === "path" ? r.resourceKey : `${r.resourceType}:${r.resourceKey}`}</span>
                    ))}
                </dd>
              </>
            ) : null}
          </dl>
        </section>

        <section>
          <h2 className="section-label">Assumptions ({d.assumptions.length})</h2>
          {d.assumptions.length ? (
            <div className="overflow-x-auto rounded border border-ink-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-ink-800 text-xs text-ink-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Assumption</th>
                    <th className="px-3 py-2 font-medium">Rule</th>
                    <th className="px-3 py-2 font-medium">Checked by</th>
                    <th className="px-3 py-2 font-medium">Valid until</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.assumptions.map((a) => (
                    <tr key={a.id} className="border-t border-ink-700/60 align-top">
                      <td className="px-3 py-2">{a.statement}</td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-300">{a.normalizedStatement ?? "—"}</td>
                      <td className="px-3 py-2 text-ink-300">{verifiedBy(a)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-300">{a.validUntil ? new Date(a.validUntil).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-2">
                        <AssumptionStatusBadge status={a.validityStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No assumptions recorded">This decision has a rationale but nothing explicit for evidence to be checked against.</EmptyState>
          )}
        </section>

        {d.constraints?.length ? (
          <section>
            <h2 className="section-label">Constraints ({d.constraints.length})</h2>
            <div className="overflow-x-auto rounded border border-ink-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-ink-800 text-xs text-ink-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Constraint</th>
                    <th className="px-3 py-2 font-medium">Kind</th>
                    <th className="px-3 py-2 font-medium">Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {d.constraints.map((c) => (
                    <tr key={c.id} className="border-t border-ink-700/60 align-top">
                      <td className="px-3 py-2">{c.statement}</td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-300">{c.rule.kind.replaceAll("_", " ")}</td>
                      <td className="px-3 py-2 text-ink-300">{c.severity.toLowerCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {open.length > 0 && (
          <section className="card form-section">
            <h2 className="text-risk-600">
              {open.length} open conflict{open.length === 1 ? "" : "s"}: needs a person
            </h2>
            <label className="label mt-3" htmlFor="review-note">
              Review note (kept in the history)
            </label>
            <textarea id="review-note" className="input" rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            {open.map((c) => (
              <div key={c.id} className="mt-4 border-t border-ink-700 pt-4">
                <p className="text-sm">{c.explanation}</p>
                {c.sourceQuote && <blockquote className="mt-2 border-l-2 border-ink-600 pl-3 text-xs text-ink-300">“{c.sourceQuote}”</blockquote>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn-primary" disabled={resolve.isPending} onClick={() => act(c.id, "accept")}>
                    Accept evidence
                  </button>
                  <button className="btn-secondary" disabled={resolve.isPending} onClick={() => act(c.id, "dismiss")}>
                    Dismiss conflict
                  </button>
                </div>
              </div>
            ))}
            {localError && (
              <p role="alert" className="mt-3 text-sm text-risk-600">
                {localError}
              </p>
            )}
          </section>
        )}

        <section>
          <h2 className="section-label">Evidence checked ({evaluations.length})</h2>
          {evaluations.length ? (
            <div className="overflow-x-auto rounded border border-ink-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-ink-800 text-xs text-ink-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Result</th>
                    <th className="px-3 py-2 font-medium">How</th>
                    <th className="px-3 py-2 font-medium">Explanation</th>
                    <th className="px-3 py-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluations.map((e) => (
                    <tr key={e.id} className="border-t border-ink-700/60 align-top">
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{e.relation.toLowerCase()}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-300">{e.method.toLowerCase()}</td>
                      <td className="px-3 py-2">
                        {e.explanation}
                        {evidence.find((x) => x.id === e.evidenceItemId)?.content && (
                          <span className="mt-1 block text-xs text-ink-400">{evidence.find((x) => x.id === e.evidenceItemId)?.content?.slice(0, 240)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <When iso={e.createdAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No evidence has been checked against this decision yet">An observation that matches one of its assumptions starts the record.</EmptyState>
          )}
          <Link href="/documents" className="mt-2 inline-block text-xs text-signal-600 underline">
            Submit evidence
          </Link>
        </section>

        {d.verificationChecks?.length ? (
          <section>
            <h2 className="section-label">Verification workflows</h2>
            <dl className="kv">
              {d.verificationChecks.map((c) => {
                const run = latestVerificationRuns.find((r) => r.checkName === c.name && r.repository === c.repository);
                return (
                  <div key={c.name + c.repository} className="contents">
                    <dt>{c.repository}</dt>
                    <dd>
                      {c.name}: {run ? `${run.conclusion} on ${run.commitSha.slice(0, 8)}` : "no completed run recorded"}
                      {run?.detailsUrl?.startsWith("https://github.com/") && (
                        <a target="_blank" rel="noreferrer" href={run.detailsUrl} className="ml-2 text-signal-600 underline">
                          view run
                        </a>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ) : null}

        <section>
          <h2 className="section-label">History</h2>
          <MemoryTimeline events={timeline} />
        </section>

        {live && (
          <section className="card form-section">
            <h2>Change this decision</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="btn-secondary" disabled={reopen.isPending || d.status === "REOPENED"} onClick={() => reopen.mutate()}>
                {d.status === "REOPENED" ? "Already reopened" : "Reopen"}
              </button>
              <Link href={`/decisions/${id}/impact`} className="text-sm text-signal-600 underline">
                Decisions that depend on this one
              </Link>
            </div>
            {reopen.error && (
              <p role="alert" className="mt-2 text-sm text-risk-600">
                {reopen.error.message}
              </p>
            )}
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium">Replace with a newer decision</summary>
              <p className="mt-2 text-sm text-ink-400">The old record stays and points to its replacement.</p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="label !mb-0 flex-1" htmlFor="replacement">
                  Replacement
                  <select id="replacement" className="input mt-1.5" value={replacement} onChange={(e) => setReplacement(e.target.value)}>
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
                <button className="btn-secondary" disabled={!replacement || supersede.isPending} onClick={() => supersede.mutate(replacement)}>
                  {supersede.isPending ? "Replacing…" : "Supersede"}
                </button>
              </div>
              {supersede.error && (
                <p role="alert" className="mt-2 text-sm text-risk-600">
                  {supersede.error.message}
                </p>
              )}
            </details>
          </section>
        )}
      </div>
    </div>
  );
}
