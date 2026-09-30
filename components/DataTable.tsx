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

/** A plain sortable table: header row, hairlines, nothing decorative. */
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
    return <div className="empty-state text-sm">{emptyLabel}</div>;
  }

  return (
    <div className="overflow-x-auto rounded border border-ink-700">
      <table className="w-full text-left text-sm">
        <thead className="bg-ink-800">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-ink-700">
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    tabIndex={header.column.getCanSort() ? 0 : undefined}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
                    onKeyDown={(event) => {
                      if (header.column.getCanSort() && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        header.column.toggleSorting();
                      }
                    }}
                    className="select-none whitespace-nowrap px-3 py-2 text-xs font-medium text-ink-400"
                    style={{ cursor: header.column.getCanSort() ? "pointer" : undefined }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {sorted === "asc" ? " ↑" : sorted === "desc" ? " ↓" : ""}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onRowClick?.(row.original)}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={(event) => {
                if (onRowClick && event.key === "Enter") onRowClick(row.original);
              }}
              className={`border-b border-ink-700/60 last:border-0 ${onRowClick ? "cursor-pointer hover:bg-ink-800" : ""}`}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2 align-top">
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
