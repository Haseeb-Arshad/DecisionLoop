"use client";

import Link from "next/link";
import { timeAgo, useV1 } from "@/lib/v1";

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
  recentRecalls: Array<{ runId: string; at: string; request: string | null; agentSessionId: string | null; decisions: Array<{ id: string; title: string; externalRef: string | null; status: string }> }>;
}

function Tile({ label, value, href, tone }: { label: string; value: number | string; href?: string; tone?: "risk" | "warn" }) {
  const body = (
    <div className={`card p-4 ${tone === "risk" ? "border-risk-500/40" : tone === "warn" ? "border-amber-500/40" : ""}`}>
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === "risk" ? "text-risk-600" : tone === "warn" ? "text-amber-700" : "text-ink-100"}`}>{value}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/**
 * Decision health (spec §23): whether the organization's reasoning is still
 * sound, what needs a person, and what agents have been told recently. All
 * numbers come from /api/v1/overview.
 */
export function DecisionHealth() {
  const { data, error } = useV1<Overview>(["overview"], "/overview", { refetchInterval: 15_000 });
  if (error) return <div className="card p-4 text-sm text-risk-600">Decision health unavailable: {(error as Error).message}</div>;
  if (!data) return null;
  const a = data.assumptions;
  const monitored = Object.values(a).reduce((x, y) => x + y, 0);
  const compromised = (a.CHALLENGED ?? 0) + (a.INVALIDATED ?? 0);

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-ink-200">Decision health</h2>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Assumptions monitored" value={monitored} />
        <Tile label="Challenged / invalidated" value={`${a.CHALLENGED ?? 0} / ${a.INVALIDATED ?? 0}`} tone={compromised ? "risk" : undefined} href="/at-risk" />
        <Tile label="Awaiting a person" value={data.pendingApprovals} tone={data.pendingApprovals ? "warn" : undefined} href="/approvals" />
        <Tile label="Open constraint findings" value={data.openFindings} tone={data.openFindings ? "warn" : undefined} href="/triggers" />
        <Tile label="Evidence (24h)" value={data.eventsSince} href="/triggers" />
        <Tile label="Agent context requests (24h)" value={data.contextRequestsSince} href="/agents" />
      </div>
      {(data.failedEvents > 0 || data.deadJobs > 0) && (
        <p className="text-sm text-risk-600">
          {data.failedEvents} event(s) failed processing and {data.deadJobs} job(s) exhausted their retries — see{" "}
          <Link href="/triggers" className="underline">
            Triggers
          </Link>
          .
        </p>
      )}
      {data.recentRecalls.length > 0 && (
        <div className="card divide-y divide-ink-800">
          <p className="px-4 py-2 text-xs uppercase tracking-wide text-ink-500">Recent recalls by agents</p>
          {data.recentRecalls.map((r) => (
            <div key={r.runId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
              <span className="w-16 shrink-0 text-xs text-ink-500">{timeAgo(r.at)}</span>
              <span className="min-w-0 flex-1 truncate text-ink-300">{r.request}</span>
              {r.decisions.map((d) => (
                <Link key={d.id} href={`/decisions/${d.id}`} className={`text-xs ${d.status === "AT_RISK" ? "text-risk-600" : "text-signal-400"} hover:underline`}>
                  {d.externalRef ?? d.title}
                </Link>
              ))}
              {r.agentSessionId && (
                <Link href={`/agents/${r.agentSessionId}`} className="text-xs text-ink-500 hover:underline">
                  session →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
