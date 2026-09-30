"use client";
import Link from "next/link";
import { PageHeader, QueryState, EmptyState, When } from "@/components/Workspace";
import { DecisionStatusBadge } from "@/components/StatusBadge";
import { useWorkspace } from "@/lib/workspace";

export default function AtRiskPage() {
  const q = useWorkspace();
  const rows = q.data?.decisions.filter((d) => d.status === "AT_RISK" || d.status === "REOPENED") ?? [];

  return (
    <div>
      <PageHeader
        title="Needs attention"
        description="Decisions with a contradicted or expired assumption, or that someone has reopened."
        action={
          <Link href="/documents" className="btn-secondary">
            Submit evidence
          </Link>
        }
      />
      <QueryState loading={q.isLoading} error={q.error} retry={q.refetch} />
      {q.data &&
        (rows.length ? (
          <div className="overflow-x-auto rounded border border-ink-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-800 text-xs text-ink-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Ref</th>
                  <th className="px-3 py-2 font-medium">Decision</th>
                  <th className="px-3 py-2 font-medium">Why it is flagged</th>
                  <th className="px-3 py-2 text-right font-medium">Affected assumptions</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const compromised = d.assumptions.filter((a) => a.validityStatus === "CHALLENGED" || a.validityStatus === "INVALIDATED");
                  return (
                    <tr key={d.id} className="border-t border-ink-700/60 align-top hover:bg-ink-800">
                      <td className="record-reference whitespace-nowrap px-3 py-2">{d.externalRef ?? d.id.slice(0, 8)}</td>
                      <td className="px-3 py-2">
                        <Link href={`/decisions/${d.id}`} className="font-medium hover:underline">
                          {d.title}
                        </Link>
                      </td>
                      <td className="max-w-md px-3 py-2 text-ink-300">{d.riskExplanation ?? "Open for reconsideration."}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{compromised.length}</td>
                      <td className="px-3 py-2">
                        <DecisionStatusBadge status={d.status} />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <When iso={d.updatedAt} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Nothing needs attention">No assumption is contradicted or expired, and no decision is reopened.</EmptyState>
        ))}
    </div>
  );
}
