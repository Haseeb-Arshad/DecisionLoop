"use client";
import Link from "next/link";
import { PageHeader, QueryState, EmptyState, When } from "@/components/Workspace";
import { useV1 } from "@/lib/v1";

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

/** Every agent session that asked for context, checked an action or proposed a decision. */
export default function AgentsPage() {
  const { data, isLoading, error } = useV1<SessionRow[]>(["sessions"], "/sessions", { refetchInterval: 10_000 });
  const sessions = data ?? [];

  return (
    <div>
      <PageHeader
        title="Agent sessions"
        description="Each agent that consulted DecisionLoop. Open one to see what it asked and what it was told before it acted."
      />
      <QueryState loading={isLoading} error={error as Error | null} />
      {!isLoading &&
        !error &&
        (sessions.length === 0 ? (
          <EmptyState title="No agent sessions yet">Connect an agent over MCP or the HTTP API. See docs/v2/agents.md.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded border border-ink-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-800 text-xs text-ink-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 font-medium">Session</th>
                  <th className="px-3 py-2 font-medium">Working on</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-t border-ink-700/60 hover:bg-ink-800">
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/agents/${s.id}`} className="hover:underline">
                        {s.agent}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-300">{s.externalSessionId}</td>
                    <td className="max-w-xs truncate px-3 py-2 text-ink-300">{s.intent ?? s.repository ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-300">{s.status.toLowerCase()}</td>
                    <td className="px-3 py-2 text-xs">
                      <When iso={s.lastSeenAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
