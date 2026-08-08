"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/DataTable";
import { useAuditEvents } from "@/lib/queries";
import type { AuditEvent } from "@/lib/types";

const columns: ColumnDef<AuditEvent, unknown>[] = [
  {
    accessorKey: "createdAt",
    header: "When",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-xs text-ink-400">
        {new Date(row.original.createdAt).toLocaleString()}
      </span>
    ),
  },
  {
    accessorKey: "action",
    header: "Action",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-ink-100">{row.original.action}</span>
    ),
  },
  {
    id: "actor",
    header: "Actor",
    accessorFn: (e) => e.actorLabel ?? e.actorUserId ?? "system",
    cell: ({ row }) => (
      <span className="text-xs text-ink-300">
        {row.original.actorLabel ?? (row.original.actorUserId ? "user" : "system")}
      </span>
    ),
  },
  {
    id: "entity",
    header: "Entity",
    accessorFn: (e) => `${e.entityType ?? ""}:${e.entityId ?? ""}`,
    cell: ({ row }) => (
      <span className="text-xs text-ink-400">
        {row.original.entityType ?? "—"}
        {row.original.entityId ? ` (${row.original.entityId.slice(0, 8)}…)` : ""}
      </span>
    ),
  },
];

export default function AuditPage() {
  const { data, isLoading } = useAuditEvents();
  const events = data?.events ?? [];

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-50">Audit log</h1>
        <p className="mt-1 text-sm text-ink-400">
          Every mutating action in this workspace — who (or what system process) did it, and to
          what.
        </p>
      </div>
      {isLoading ? (
        <div className="card px-6 py-12 text-center text-sm text-ink-400">Loading…</div>
      ) : (
        <DataTable columns={columns} data={events} emptyLabel="No audit events recorded yet." />
      )}
    </div>
  );
}
