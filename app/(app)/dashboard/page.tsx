"use client";

import Link from "next/link";
import { DecisionStatusBadge } from "@/components/StatusBadge";
import { StatCard } from "@/components/StatCard";
import { useDecisions, useObservability } from "@/lib/queries";

/**
 * §37 — the dashboard leads with what needs attention, then recent memory
 * activity, then decision health. Every number is read from real rows via
 * /api/observability; nothing is manufactured.
 */
export default function DashboardPage() {
  const { data: obs, isLoading: obsLoading } = useObservability();
  const { data: decisionsData } = useDecisions();

  const metrics = obs?.metrics;
  const decisions = decisionsData?.decisions ?? [];
  const atRisk = decisions.filter((d) => d.status === "AT_RISK");
  const recentEvents = obs?.memoryEvents.slice(0, 8) ?? [];

  return (
    <div className="animate-fade-in space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-ink-50">
          Your organization&apos;s reasoning has a memory.
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          DecisionLoop is watching {metrics?.assumptionsTracked ?? 0} assumption
          {metrics?.assumptionsTracked === 1 ? "" : "s"} behind{" "}
          {metrics?.activeDecisions ?? 0} active decision
          {metrics?.activeDecisions === 1 ? "" : "s"}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active decisions"
          value={obsLoading ? null : (metrics?.activeDecisions ?? 0)}
          href="/decisions"
        />
        <StatCard
          label="At risk"
          value={obsLoading ? null : (metrics?.decisionsAtRisk ?? 0)}
          tone={metrics && metrics.decisionsAtRisk > 0 ? "risk" : "neutral"}
          hint={
            metrics && metrics.decisionsAtRisk > 0
              ? "An assumption changed."
              : "All stored assumptions still hold."
          }
          href="/at-risk"
        />
        <StatCard
          label="Assumptions tracked"
          value={obsLoading ? null : (metrics?.assumptionsTracked ?? 0)}
          hint={
            metrics && metrics.assumptionsChallenged > 0
              ? `${metrics.assumptionsChallenged} challenged`
              : undefined
          }
        />
        <StatCard
          label="Cross-session recalls"
          value={obsLoading ? null : (metrics?.crossSessionRecalls ?? 0)}
          tone="signal"
          hint="Memories retrieved by a later session than the one that wrote them."
          href="/system"
        />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-100">Needs attention</h2>
          {atRisk.length > 0 && (
            <Link href="/at-risk" className="text-xs text-signal-400 hover:text-signal-300">
              View all →
            </Link>
          )}
        </div>
        {atRisk.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-ink-400">
            Nothing is at risk. Every assumption behind your committed decisions still holds, as
            far as DecisionLoop can tell from the evidence it has seen.
          </div>
        ) : (
          <div className="space-y-2">
            {atRisk.slice(0, 4).map((decision) => (
              <Link
                key={decision.id}
                href={`/decisions/${decision.id}`}
                className="card block border-risk-500/30 bg-risk-500/[0.04] p-4 transition hover:border-risk-500/50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-ink-100">{decision.title}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-400">
                      {decision.riskExplanation ?? "An assumption behind this decision changed."}
                    </p>
                  </div>
                  <DecisionStatusBadge status={decision.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink-100">Recent memory activity</h2>
          {recentEvents.length === 0 ? (
            <div className="card px-6 py-8 text-center text-sm text-ink-400">
              No memory activity yet. Commit a decision to start the record.
            </div>
          ) : (
            <div className="card divide-y divide-ink-800/60">
              {recentEvents.map((event) => (
                <div key={event.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink-200">
                      {event.eventType.replaceAll("_", " ").toLowerCase()}
                    </p>
                    {event.summary && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-ink-500">{event.summary}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] text-ink-600">
                    {new Date(event.createdAt).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink-100">Decision health</h2>
          <div className="card space-y-3 p-4">
            <HealthRow
              label="Conflicts detected"
              value={metrics?.conflictsDetected ?? 0}
              detail={
                metrics && metrics.conflictsUnreviewed > 0
                  ? `${metrics.conflictsUnreviewed} awaiting review`
                  : "all reviewed"
              }
            />
            <HealthRow
              label="Evidence documents"
              value={metrics?.documentsIngested ?? 0}
              detail={`${metrics?.memoriesStored ?? 0} memories stored`}
            />
            <HealthRow
              label="Agent runs"
              value={metrics?.agentRuns ?? 0}
              detail={
                metrics?.agentRunFailures
                  ? `${metrics.agentRunFailures} failed`
                  : "no failures"
              }
            />
            <HealthRow
              label="Avg retrieval latency"
              value={
                metrics?.averageRetrievalLatencyMs === null ||
                metrics?.averageRetrievalLatencyMs === undefined
                  ? "—"
                  : `${metrics.averageRetrievalLatencyMs}ms`
              }
              detail="CockroachDB vector search"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Link href="/decisions/new" className="btn-primary flex-1 justify-center">
              Commit a decision
            </Link>
            <Link href="/documents" className="btn-secondary flex-1 justify-center">
              Add evidence
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function HealthRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-ink-300">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-sm font-medium tabular-nums text-ink-100">{value}</span>
        {detail && <span className="text-[11px] text-ink-500">{detail}</span>}
      </span>
    </div>
  );
}
