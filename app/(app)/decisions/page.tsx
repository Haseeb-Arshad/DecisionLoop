"use client";
import Link from "next/link";
import { useState } from "react";
import { PageHeader, QueryState, EmptyState, When } from "@/components/Workspace";
import { DecisionStatusBadge } from "@/components/StatusBadge";
import { useWorkspace } from "@/lib/workspace";

const STATUSES = ["ALL", "ACTIVE", "AT_RISK", "REOPENED", "DRAFT", "SUPERSEDED", "ARCHIVED"];

export default function DecisionsPage() {
  const q = useWorkspace();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const all = q.data?.decisions ?? [];
  const decisions = all.filter(
    (d) =>
      (status === "ALL" || d.status === status) &&
      [d.title, d.externalRef, d.reasoning, d.domain, ...d.options.map((o) => o.name)].join(" ").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <PageHeader
        title="All decisions"
        description="What was chosen, why, and what it depends on."
        action={
          <Link href="/decisions/new" className="btn-primary">
            New decision
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input aria-label="Search decisions" className="input max-w-sm" placeholder="Search title, choice, reference or domain" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Filter by status" className="input max-w-[170px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All statuses" : s.replaceAll("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-ink-400">
          {decisions.length} of {all.length}
        </span>
      </div>
      <QueryState loading={q.isLoading} error={q.error} retry={q.refetch} />
      {q.data &&
        (decisions.length ? (
          <div className="overflow-x-auto rounded border border-ink-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-800 text-xs text-ink-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Ref</th>
                  <th className="px-3 py-2 font-medium">Decision</th>
                  <th className="px-3 py-2 font-medium">Chosen</th>
                  <th className="px-3 py-2 font-medium">Domain</th>
                  <th className="px-3 py-2 text-right font-medium">Assumptions</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => (
                  <tr key={d.id} className="border-t border-ink-700/60 align-top hover:bg-ink-800">
                    <td className="record-reference whitespace-nowrap px-3 py-2">{d.externalRef ?? d.id.slice(0, 8)}</td>
                    <td className="px-3 py-2">
                      <Link href={`/decisions/${d.id}`} className="font-medium hover:underline">
                        {d.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-ink-300">{d.options.find((o) => o.isChosen)?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-300">{d.domain ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.assumptions.length}</td>
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
          <EmptyState
            title={all.length ? "No decision matches" : "No decisions yet"}
            href={all.length ? undefined : "/decisions/new"}
            action="Record a decision"
          >
            {all.length ? "Change the search or clear the status filter." : "Record a real choice your team made, with the alternatives it beat and what has to stay true."}
          </EmptyState>
        ))}
    </div>
  );
}
