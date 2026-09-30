"use client";
import Link from "next/link";
import { PageHeader, EmptyState, QueryState, When } from "@/components/Workspace";
import { DecisionStatusBadge } from "@/components/StatusBadge";
import { DecisionHealth } from "@/components/DecisionHealth";
import { StatCard } from "@/components/StatCard";
import { useWorkspace } from "@/lib/workspace";
import { useObservability } from "@/lib/queries";

export default function DashboardPage() {
  const workspace = useWorkspace();
  const activity = useObservability();
  const decisions = workspace.data?.decisions ?? [];
  const caps = workspace.data?.capabilities;
  const active = decisions.filter((d) => d.status === "ACTIVE");
  const attention = decisions.filter((d) => d.status === "AT_RISK" || d.status === "REOPENED");
  // Drafts are proposals, not yet part of what the workspace relies on.
  const assumptions = decisions.filter((d) => d.status !== "DRAFT").reduce((n, d) => n + d.assumptions.length, 0);

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Recorded decisions, the assumptions they rely on, and what has changed."
        action={
          <Link className="btn-primary" href="/decisions/new">
            New decision
          </Link>
        }
      />
      <QueryState loading={workspace.isLoading} error={workspace.error} retry={workspace.refetch} />
      {workspace.data && (
        <div className="space-y-8">
          <div className="metric-strip">
            <StatCard label="Decisions" value={decisions.length} href="/decisions" />
            <StatCard label="Active" value={active.length} href="/decisions" />
            <StatCard label="Need attention" value={attention.length} tone={attention.length ? "risk" : "neutral"} href="/at-risk" />
            <StatCard label="Assumptions tracked" value={assumptions} />
          </div>

          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="section-label !mb-0">Needs attention ({attention.length})</h2>
              <Link className="text-xs text-signal-600 underline" href="/at-risk">
                Open queue
              </Link>
            </div>
            {attention.length ? (
              <div className="card">
                {attention.slice(0, 5).map((d) => (
                  <Link className="record-row" key={d.id} href={`/decisions/${d.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="record-title">
                        {d.externalRef && <span className="record-reference mr-2">{d.externalRef}</span>}
                        {d.title}
                      </p>
                      <p className="record-subtitle line-clamp-2">{d.riskExplanation ?? "Evidence has challenged an assumption. A person needs to review it."}</p>
                    </div>
                    <DecisionStatusBadge status={d.status} />
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState title="Nothing needs attention">No recorded assumption is currently contradicted by evidence.</EmptyState>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="section-label !mb-0">Recent decisions</h2>
              <Link className="text-xs text-signal-600 underline" href="/decisions">
                All decisions
              </Link>
            </div>
            {decisions.length ? (
              <div className="overflow-x-auto rounded border border-ink-700">
                <table className="w-full text-left text-sm">
                  <thead className="bg-ink-800 text-xs text-ink-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Decision</th>
                      <th className="px-3 py-2 font-medium">Chosen</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decisions.slice(0, 8).map((d) => (
                      <tr key={d.id} className="border-t border-ink-700/60 hover:bg-ink-800">
                        <td className="px-3 py-2">
                          <Link href={`/decisions/${d.id}`} className="font-medium hover:underline">
                            {d.externalRef && <span className="record-reference mr-2">{d.externalRef}</span>}
                            {d.title}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-ink-300">{d.options.find((o) => o.isChosen)?.name ?? "—"}</td>
                        <td className="px-3 py-2">
                          <DecisionStatusBadge status={d.status} />
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <When iso={d.updatedAt} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No decisions yet" href="/decisions/new" action="Record a decision">
                Record a decision you have already made: what was chosen, what was rejected, and what has to stay true.
              </EmptyState>
            )}
          </section>

          <DecisionHealth />

          <div className="grid gap-8 md:grid-cols-2">
            <section>
              <h2 className="section-label">Recent activity</h2>
              <QueryState loading={activity.isLoading} error={activity.error} />
              {activity.data?.memoryEvents.length ? (
                <table className="w-full text-left text-sm">
                  <tbody>
                    {activity.data.memoryEvents.slice(0, 8).map((e) => (
                      <tr key={e.id} className="border-b border-ink-700/60 align-top last:border-0">
                        <td className="py-2 pr-3">{e.summary ?? e.eventType.replaceAll("_", " ").toLowerCase()}</td>
                        <td className="w-20 py-2 text-right text-xs">
                          <When iso={e.createdAt} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                !activity.isLoading && <p className="text-sm text-ink-500">Activity appears here once a decision is recorded.</p>
              )}
            </section>
            <section>
              <h2 className="section-label">System</h2>
              <dl className="kv">
                <dt>Background worker</dt>
                <dd className={caps?.workerHealthy ? "" : "text-risk-600"}>{caps?.workerHealthy ? "Running" : "No recent heartbeat"}</dd>
                <dt>Queued jobs</dt>
                <dd>{caps?.pendingJobs ?? "—"}</dd>
                <dt>Reasoning model</dt>
                <dd>{caps?.reasoning === "none" ? "None (comparison only)" : (caps?.reasoning ?? "—")}</dd>
              </dl>
              <Link href="/system" className="mt-3 inline-block text-xs text-signal-600 underline">
                Health details
              </Link>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
