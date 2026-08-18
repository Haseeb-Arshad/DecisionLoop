"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";

/** Small generic wrapper around TanStack Table — used for the decisions
 * list, the memory trace candidate table, and the audit log. Sorting only;
 * these views are small enough (tens to low hundreds of rows) that
 * client-side pagination/filtering isn't worth the extra chrome. */
export function DataTable<T>({
  columns,
  data,
  onRowClick,
  emptyLabel = "Nothing here yet.",
}: {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyLabel?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);

  // TanStack Table exposes intentionally mutable callbacks; React Compiler
  // cannot safely memoize this third-party hook result.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (data.length === 0) {
    return (
      <div className="card flex items-center justify-center px-6 py-12 text-sm text-ink-400">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-ink-700/60">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  onClick={header.column.getToggleSortingHandler()}
                  className="select-none whitespace-nowrap px-4 py-3 text-xs font-medium uppercase
                    tracking-wide text-ink-400"
                  style={{ cursor: header.column.getCanSort() ? "pointer" : undefined }}
                >
                  <span className="inline-flex items-center gap-1">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: "↑", desc: "↓" }[header.column.getIsSorted() as string] ?? ""}
                  </span>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onRowClick?.(row.original)}
              className={`border-b border-ink-800/60 last:border-0 ${
                onRowClick ? "cursor-pointer hover:bg-ink-800/40" : ""
              }`}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3 align-top">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
