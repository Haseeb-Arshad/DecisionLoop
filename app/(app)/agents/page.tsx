"use client";

import Link from "next/link";
import { timeAgo, useV1 } from "@/lib/v1";

interface SessionRow {
  id: string;
  agent: string;
  externalSessionId: string;
  repository: string | null;
  intent: string | null;
  status: "ACTIVE" | "ENDED";
  startedAt: string;
  lastSeenAt: string;
}

/** Agent runs: every external agent session that consulted or wrote to DecisionLoop. */
export default function AgentsPage() {
  const { data, isLoading, error } = useV1<SessionRow[]>(["sessions"], "/sessions", { refetchInterval: 10_000 });
  const sessions = data ?? [];
  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-50">Agents</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-400">
          Coding-agent sessions that asked DecisionLoop for context or proposed decisions. Open one to reconstruct
          what the agent knew when it made a change.
        </p>
      </div>
      {error ? (
        <div className="card px-6 py-6 text-sm text-risk-400">Could not load agent sessions: {(error as Error).message}</div>
      ) : isLoading ? (
        <div className="card px-6 py-12 text-center text-sm text-ink-400">Loading…</div>
      ) : sessions.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="text-sm text-ink-200">No agent sessions yet.</p>
          <p className="mt-1 text-sm text-ink-500">Connect an agent over MCP — see docs/v2/agents.md.</p>
        </div>
      ) : (
        <div className="card divide-y divide-ink-800">
          {sessions.map((s) => (
            <Link key={s.id} href={`/agents/${s.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-ink-900/60">
              <span className="w-28 shrink-0 font-mono text-xs text-signal-400">{s.agent}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-200">{s.intent ?? s.externalSessionId}</span>
              <span className="w-40 shrink-0 truncate text-xs text-ink-500">{s.repository ?? ""}</span>
              <span className="w-20 shrink-0 text-right text-xs text-ink-500">{timeAgo(s.lastSeenAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
