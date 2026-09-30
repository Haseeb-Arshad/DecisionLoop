"use client";
import Link from "next/link";
import {
  PageHeader,
  EmptyState,
  QueryState,
  Icon,
} from "@/components/Workspace";
import { DecisionStatusBadge } from "@/components/StatusBadge";
import { useWorkspace } from "@/lib/workspace";
import { useObservability } from "@/lib/queries";
import { timeAgo } from "@/lib/v1";
export default function DashboardPage() {
  const workspace = useWorkspace();
  const activity = useObservability();
  const decisions = workspace.data?.decisions ?? [];
  const caps = workspace.data?.capabilities;
  const active = decisions.filter((d) => d.status === "ACTIVE");
  const risk = decisions.filter(
    (d) => d.status === "AT_RISK" || d.status === "REOPENED",
  );
  const assumptions = decisions.reduce((n, d) => n + d.assumptions.length, 0);
  const workerHealthy = caps?.workerHealthy;
  const metrics = [
    [
      "Recorded decisions",
      decisions.length,
      "Your team's choices, in one place",
    ],
    ["Active decisions", active.length, "Current choices and their rationale"],
    ["Need attention", risk.length, "Challenged or reopened decisions"],
    ["Assumptions", assumptions, "Conditions behind your choices"],
  ] as const;
  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="The decision workspace"
        title="Keep the why. Watch what changes."
        description="Your decisions, the assumptions behind them, and the evidence that calls them into question."
        action={
          <Link className="btn-primary" href="/decisions/new">
            + Record a decision
          </Link>
        }
      />
      <QueryState
        loading={workspace.isLoading}
        error={workspace.error}
        retry={workspace.refetch}
      />
      {workspace.data && (
        <>
          <div className="metric-strip">
            {metrics.map(([label, value, hint]) => (
              <Link
                href={label === "Need attention" ? "/at-risk" : "/decisions"}
                key={label}
                className="metric-cell"
              >
                <p>{label}</p>
                <strong
                  className={
                    label === "Need attention" && value > 0
                      ? "text-risk-600"
                      : ""
                  }
                >
                  {value}
                </strong>
                <small>{hint}</small>
              </Link>
            ))}
          </div>
          <div className="mt-8 grid gap-7 xl:grid-cols-[minmax(0,1.65fr)_minmax(260px,1fr)]">
            <div className="space-y-8">
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="section-label !mb-0">
                    Attention queue{" "}
                    <span className="ml-2 rounded-full bg-ink-800 px-2 py-1 text-[10px] text-ink-400">
                      {risk.length}
                    </span>
                  </h2>
                  <Link className="text-xs text-signal-600" href="/at-risk">
                    Open queue ↗
                  </Link>
                </div>
                {risk.length ? (
                  <div className="card">
                    {risk.slice(0, 4).map((d) => (
                      <Link
                        className="record-row"
                        key={d.id}
                        href={`/decisions/${d.id}`}
                      >
                        <span className="rounded-lg bg-orange-50 p-2 text-risk-600">
                          <Icon name="risk" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="record-title">{d.title}</p>
                          <p className="record-subtitle line-clamp-2">
                            {d.riskExplanation ??
                              "This choice needs a human review."}
                          </p>
                        </div>
                        <DecisionStatusBadge status={d.status} />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No decisions are waiting for review">
                    No recorded conflicts currently need attention. New evidence
                    can change this.
                  </EmptyState>
                )}
              </section>
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="section-label !mb-0">Recent decisions</h2>
                  <Link className="text-xs text-signal-600" href="/decisions">
                    View register ↗
                  </Link>
                </div>
                {decisions.length ? (
                  <div className="card">
                    {decisions.slice(0, 5).map((d) => (
                      <Link
                        className="record-row"
                        key={d.id}
                        href={`/decisions/${d.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="record-reference mb-1">
                            {d.externalRef ?? d.id.slice(0, 8)}
                          </p>
                          <p className="record-title">{d.title}</p>
                          <p className="record-subtitle">
                            {d.options.find((o) => o.isChosen)?.name}
                          </p>
                        </div>
                        <DecisionStatusBadge status={d.status} />
                        <span className="hidden text-[10px] text-ink-500 sm:block">
                          {timeAgo(d.updatedAt)}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Start with a decision you already made"
                    href="/decisions/new"
                    action="Record your first decision"
                  >
                    Capture the choice, why it won, and what would make you
                    reconsider it.
                  </EmptyState>
                )}
              </section>
            </div>
            <aside className="space-y-7">
              <section className="card p-6">
                <p className="eyebrow">Workspace status</p>
                <h2 className="text-lg font-semibold">A living record</h2>
                <p className="mt-2 text-xs leading-6 text-ink-400">
                  Evidence is checked against the conditions you record. People
                  decide how to respond.
                </p>
                <dl className="mt-5 divide-y divide-ink-800 text-xs">
                  <div className="flex justify-between py-3">
                    <dt className="text-ink-400">Background worker</dt>
                    <dd
                      className={
                        workerHealthy ? "text-signal-600" : "text-risk-600"
                      }
                    >
                      {workerHealthy ? "Running" : "No recent heartbeat"}
                    </dd>
                  </div>
                  <div className="flex justify-between py-3">
                    <dt className="text-ink-400">Queued work</dt>
                    <dd>{caps?.pendingJobs ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between py-3">
                    <dt className="text-ink-400">Reasoning</dt>
                    <dd
                      className="max-w-[140px] truncate"
                      title={caps?.reasoning}
                    >
                      {caps?.reasoning === "none"
                        ? "Manual + deterministic"
                        : caps?.reasoning}
                    </dd>
                  </div>
                </dl>
                <Link
                  href="/system"
                  className="mt-4 inline-block text-xs text-signal-600"
                >
                  View system health →
                </Link>
              </section>
              <section>
                <h2 className="section-label">Recent activity</h2>
                <QueryState
                  loading={activity.isLoading}
                  error={activity.error}
                />
                {activity.data?.memoryEvents.length ? (
                  <div className="space-y-5">
                    {activity.data.memoryEvents.slice(0, 5).map((e) => (
                      <div className="flex gap-3" key={e.id}>
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-600" />
                        <div>
                          <p className="text-xs leading-5">
                            {e.summary ??
                              e.eventType.replaceAll("_", " ").toLowerCase()}
                          </p>
                          <p className="mt-1 text-[10px] text-ink-500">
                            {timeAgo(e.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  !activity.isLoading && (
                    <p className="text-xs leading-6 text-ink-400">
                      Your record begins when you commit the first decision.
                    </p>
                  )
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
