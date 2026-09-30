"use client";
import Link from "next/link";
import { useState } from "react";
import { PageHeader, QueryState, EmptyState } from "@/components/Workspace";
import { DecisionStatusBadge } from "@/components/StatusBadge";
import { useWorkspace } from "@/lib/workspace";
import { timeAgo } from "@/lib/v1";
export default function DecisionsPage() {
  const q = useWorkspace();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const all = q.data?.decisions ?? [];
  const decisions = all.filter(
    (d) =>
      (status === "ALL" || d.status === status) &&
      [d.title, d.externalRef, d.reasoning, ...d.options.map((o) => o.name)]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Shared organizational memory"
        title="Decision register"
        description="A clear record of what you chose, why you chose it, and what that choice depends on."
        action={
          <Link href="/decisions/new" className="btn-primary">
            + Record a decision
          </Link>
        }
      />
      <div className="mb-5 flex flex-wrap gap-3">
        <input
          aria-label="Search decisions"
          className="input max-w-md"
          placeholder="Search choices, rationale or references…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Filter decision status"
          className="input max-w-[185px]"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {[
            "ALL",
            "ACTIVE",
            "AT_RISK",
            "REOPENED",
            "DRAFT",
            "SUPERSEDED",
            "ARCHIVED",
          ].map((s) => (
            <option key={s} value={s}>
              {s === "ALL"
                ? "All statuses"
                : s.replaceAll("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
        <span className="ml-auto self-center text-xs text-ink-400">
          {decisions.length} records
        </span>
      </div>
      <QueryState loading={q.isLoading} error={q.error} retry={q.refetch} />
      {q.data &&
        (decisions.length ? (
          <div className="card overflow-hidden">
            <div className="flex justify-between bg-ink-800/40 px-6 py-3 text-[10px] uppercase tracking-wider text-ink-400">
              <span>Choice & rationale</span>
              <span>State / Updated</span>
            </div>
            {decisions.map((d) => (
              <Link
                href={`/decisions/${d.id}`}
                className="record-row"
                key={d.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="record-reference mb-1">
                    {d.externalRef ?? d.id.slice(0, 8)} ·{" "}
                    {d.domain ?? "engineering"}
                  </p>
                  <p className="record-title">{d.title}</p>
                  <p className="record-subtitle line-clamp-1">
                    {d.options.find((o) => o.isChosen)?.name}{" "}
                    {d.reasoning ? "· " + d.reasoning : ""}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-ink-400">
                    <span>{d.assumptions.length} assumptions</span>
                    {d.resources?.length ? (
                      <span>· {d.resources.length} governed resources</span>
                    ) : null}
                  </div>
                </div>
                <div className="text-right">
                  <DecisionStatusBadge status={d.status} />
                  <p className="mt-3 text-[10px] text-ink-500">
                    {timeAgo(d.updatedAt)}
                  </p>
                </div>
                <span className="hidden text-ink-500 sm:block">↗</span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title={
              all.length
                ? "No decisions match your search"
                : "Make the reasoning part of the record"
            }
            href={all.length ? undefined : "/decisions/new"}
            action="Record a decision"
          >
            {all.length
              ? "Try another phrase or clear the status filter."
              : "Start with a real choice your team made. Record the alternatives and conditions while they're still fresh."}
          </EmptyState>
        ))}
    </div>
  );
}
