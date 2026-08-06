"use client";

import * as React from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./Skeleton";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  loading?: boolean;
  density?: "compact" | "comfortable";
  className?: string;
  caption?: string;
  /** Optional leading "select all" checkbox in the header row (#32). */
  headerCheckbox?: {
    label: string;
    checked: boolean;
    indeterminate?: boolean;
    onChange: () => void;
  };
  /** Optional leading per-row checkbox cell, keyed by row id (#32). */
  rowCheckbox?: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  empty,
  loading = false,
  density = "comfortable",
  className,
  caption,
  headerCheckbox,
  rowCheckbox,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const headerCheckboxRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (headerCheckboxRef.current && headerCheckbox) {
      headerCheckboxRef.current.indeterminate = !!headerCheckbox.indeterminate;
    }
  }, [headerCheckbox?.checked, headerCheckbox?.indeterminate]);

  const leadingCols = headerCheckbox || rowCheckbox ? 1 : 0;
  const colCount = columns.length + leadingCols;

  const sorted = React.useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return data;
    const getter = col.sortValue;
    return [...data].sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, sortKey, sortDir, columns]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const cellPad = density === "compact" ? "px-4 py-2.5" : "px-5 py-3.5";
  const alignCls = (a?: string) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-low",
        className
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-surface-container-high">
            <tr>
              {headerCheckbox && (
                <th scope="col" className={cn("border-b border-outline-variant", cellPad)}>
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    aria-label={headerCheckbox.label}
                    checked={headerCheckbox.checked}
                    onChange={headerCheckbox.onChange}
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    "border-b border-outline-variant font-medium text-on-surface-variant",
                    cellPad,
                    alignCls(col.align),
                    "text-[11px] uppercase tracking-wide",
                    col.headerClassName
                  )}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded transition-colors hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        col.align === "right" && "flex-row-reverse"
                      )}
                    >
                      {col.header}
                      {sortKey === col.key ? (
                        sortDir === "asc" ? (
                          <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" strokeWidth={2} aria-hidden />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colCount} className="p-4">
                  <Skeleton variant="list" lines={4} />
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  {empty ?? (
                    <div className="py-12 text-center text-sm text-on-surface-variant">
                      No records to display.
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-outline-variant last:border-0 transition-colors",
                    onRowClick &&
                      "cursor-pointer hover:bg-surface-container focus-within:bg-surface-container"
                  )}
                >
                  {rowCheckbox && (
                    <td className={cn(cellPad, "text-on-surface")}>{rowCheckbox(row)}</td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        cellPad,
                        alignCls(col.align),
                        "text-on-surface",
                        col.className
                      )}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
