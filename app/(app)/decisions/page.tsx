"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/DataTable";
import { DecisionStatusBadge } from "@/components/StatusBadge";
import { useDecisions } from "@/lib/queries";
import type { DecisionWithDetails } from "@/lib/types";

const columns: ColumnDef<DecisionWithDetails, unknown>[] = [
  {
    accessorKey: "title",
    header: "Decision",
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-ink-100">{row.original.title}</p>
        <p className="mt-0.5 line-clamp-1 text-xs text-ink-400">
          {row.original.options.find((o) => o.isChosen)?.name ?? "—"}
        </p>
      </div>
    ),
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (d) => d.status,
    cell: ({ row }) => <DecisionStatusBadge status={row.original.status} />,
  },
  {
    id: "assumptions",
    header: "Assumptions",
    accessorFn: (d) => d.assumptions.length,
    cell: ({ row }) => {
      const total = row.original.assumptions.length;
      const invalidated = row.original.assumptions.filter((a) => a.status === "INVALIDATED").length;
      return (
        <span className="text-xs text-ink-300">
          {total - invalidated}/{total} valid
        </span>
      );
    },
  },
  {
    accessorKey: "updatedAt",
    header: "Updated",
    cell: ({ row }) => (
      <span className="text-xs text-ink-400">
        {new Date(row.original.updatedAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    ),
  },
];

export default function DecisionsPage() {
  const router = useRouter();
  const { data, isLoading, isError, error } = useDecisions();
  const decisions = data?.decisions ?? [];
  const atRiskCount = decisions.filter((d) => d.status === "AT_RISK").length;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-50">Decisions</h1>
          <p className="mt-1 text-sm text-ink-400">
            {atRiskCount > 0
              ? `${atRiskCount} decision${atRiskCount === 1 ? "" : "s"} at risk — new evidence contradicts a stored assumption.`
              : "Every stored assumption still holds, as far as DecisionLoop knows."}
          </p>
        </div>
        <Link href="/decisions/new" className="btn-primary">
          Commit a decision
        </Link>
      </div>

      {isLoading && <div className="card px-6 py-12 text-center text-sm text-ink-400">Loading…</div>}
      {isError && (
        <div className="card px-6 py-12 text-center text-sm text-risk-400">
          {(error as Error).message}
        </div>
      )}
      {!isLoading && !isError && (
        <DataTable
          columns={columns}
          data={decisions}
          onRowClick={(d) => router.push(`/decisions/${d.id}`)}
          emptyLabel="No decisions committed yet. Start with 'Commit a decision'."
        />
      )}
    </div>
  );
}
