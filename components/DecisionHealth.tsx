"use client";

import Link from "next/link";
import { StatCard } from "@/components/StatCard";
import { When } from "@/components/Workspace";
import { useV1 } from "@/lib/v1";

interface Overview {
  decisions: Record<string, number>;
  assumptions: Record<string, number>;
  pendingApprovals: number;
  openConflicts: number;
  openFindings: number;
  eventsSince: number;
  failedEvents: number;
  deadJobs: number;
  contextRequestsSince: number;
  recentRecalls: Array<{
    runId: string;
    at: string;
    request: string | null;
    agentSessionId: string | null;
    decisions: Array<{ id: string; title: string; externalRef: string | null; status: string }>;
  }>;
}

/** Whether the recorded reasoning still holds, what needs a person, and what agents were told recently. */
export function DecisionHealth() {
  const { data, error } = useV1<Overview>(["overview"], "/overview", { refetchInterval: 15_000 });
  if (error) return <p className="text-sm text-risk-600">Health figures are unavailable: {(error as Error).message}</p>;
  if (!data) return null;
  const a = data.assumptions;
  const monitored = Object.values(a).reduce((x, y) => x + y, 0);
  const compromised = (a.CHALLENGED ?? 0) + (a.INVALIDATED ?? 0);

  return (
    <section className="space-y-3">
      <h2 className="section-label">Last 24 hours</h2>
      <div className="metric-strip">
        <StatCard label="Assumptions tracked" value={monitored} />
        <StatCard
          label="Challenged or invalidated"
          value={`${a.CHALLENGED ?? 0} / ${a.INVALIDATED ?? 0}`}
          tone={compromised ? "risk" : "neutral"}
          href="/at-risk"
        />
        <StatCard label="Waiting for a person" value={data.pendingApprovals} tone={data.pendingApprovals ? "warn" : "neutral"} href="/approvals" />
        <StatCard label="Open constraint findings" value={data.openFindings} tone={data.openFindings ? "warn" : "neutral"} href="/triggers" />
        <StatCard label="Evidence received" value={data.eventsSince} href="/triggers" />
        <StatCard label="Agent context requests" value={data.contextRequestsSince} href="/agents" />
      </div>
      {(data.failedEvents > 0 || data.deadJobs > 0) && (
        <p role="alert" className="text-sm text-risk-600">
          {data.failedEvents} event(s) failed processing and {data.deadJobs} job(s) used up their retries. See{" "}
          <Link href="/triggers" className="underline">
            Triggers
          </Link>
          .
        </p>
      )}
      {data.recentRecalls.length > 0 && (
        <div>
          <h2 className="section-label mt-5">What agents were told recently</h2>
          <div className="card">
            {data.recentRecalls.map((r) => (
              <div key={r.runId} className="record-row flex-wrap">
                <span className="w-20 shrink-0 text-xs">
                  <When iso={r.at} />
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-300">{r.request}</span>
                <span className="flex flex-wrap gap-x-3 text-xs">
                  {r.decisions.map((d) => (
                    <Link key={d.id} href={`/decisions/${d.id}`} className={d.status === "AT_RISK" ? "text-risk-600 underline" : "text-signal-600 underline"}>
                      {d.externalRef ?? d.title}
                    </Link>
                  ))}
                  {r.agentSessionId && (
                    <Link href={`/agents/${r.agentSessionId}`} className="text-ink-400 underline">
                      session
                    </Link>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
