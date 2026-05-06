// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/_components/markets-table/MarketsTable`
 * Purpose: THE single markets-aggregation table organism. Any surface that
 *   renders the dashboard "Markets" view (today: `ExecutionActivityCard`,
 *   future research surfaces) MUST render this component — no hand-rolled
 *   `<details>` lists.
 * Scope: Client component. Thin wrapper over the vendored `reui` DataGrid kit;
 *   inline expansion is wired through TanStack `getExpandedRowModel` and the
 *   reui `meta.expandedContent` slot. Mirrors the singleton positions-table
 *   organism pattern (`@app/(app)/_components/positions-table/PositionsTable`).
 * Invariants:
 *   - HEADER_OWNS_CONTROLS: sort + hide live on column-header dropdown.
 *   - SINGLE_TABLE_EXPANSION: expanded children render inside one rendered row
 *     of the same table (colspan body), not a sibling card or sheet.
 *   - PIVOTED_PARTICIPANT_ROW: relies on the server-side participant pivot in
 *     `market-exposure-service.ts`; the client never reshapes legs.
 *   - DEFAULT_EXPAND_FIRST: the first group is expanded on mount so the user
 *     sees the deepest exposure immediately, matching the legacy `<details>`
 *     behavior.
 * Side-effects: none
 * @public
 */

"use client";

import type { WalletExecutionMarketGroup } from "@cogni/poly-node-contracts";
import {
  type ColumnFiltersState,
  type ExpandedState,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { Flame } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { Toggle } from "@/components";
import {
  DataGrid,
  DataGridContainer,
} from "@/components/reui/data-grid/data-grid";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";

import { makeColumns } from "./columns";

/**
 * Threshold for "this is a meaningful pick-quality gap, not noise."
 * 5 percentage points. Exposed for the test suite to lock the constant.
 */
export const ALPHA_LEAK_RATE_GAP_THRESHOLD = 0.05;

/**
 * Group is an "alpha leak" when targets are ahead of us by both:
 *   - a meaningful rate-of-return gap (>= 5pp pick-quality signal), AND
 *   - a positive dollar gap on our book (some real money is at stake).
 *
 * Both gates are required so we don't flag $0.10 leaks on a +0.01pp gap or
 * 50pp gaps where our position size is zero. Either-side null → not a leak
 * (no target legs / undefined comparison).
 *
 * Exported so the predicate can be unit-tested without rendering React.
 */
export function isAlphaLeak(group: WalletExecutionMarketGroup): boolean {
  const { rateGapPct, sizeScaledGapUsdc } = group;
  if (rateGapPct === null || sizeScaledGapUsdc === null) return false;
  return rateGapPct >= ALPHA_LEAK_RATE_GAP_THRESHOLD && sizeScaledGapUsdc > 0;
}

export type MarketsTableProps = {
  groups?: readonly WalletExecutionMarketGroup[] | undefined;
  isLoading?: boolean | undefined;
  emptyMessage?: ReactNode;
};

const DEFAULT_VISIBILITY: VisibilityState = {
  expand: true,
  market: true,
  ourValue: true,
  targets: true,
  ourReturn: true,
  targetReturn: true,
  rateGap: true,
  sizeScaledGap: true,
  // Tertiary, hidden by default per redesign §4.4 (visual rules). The
  // `status` column is hidden but its filter is still applied (§6
  // Decision #4 — default Live-only) — re-show via column dropdown to
  // toggle to closed.
  status: false,
  pnl: false,
  hedges: false,
};
const DEFAULT_SORT: SortingState = [{ id: "sizeScaledGap", desc: true }];
// Default to Live only — "what's bleeding now" is the headline question;
// closed positions become visible by re-showing + clearing the Status
// column filter. Per redesign §6 Decision #4.
const DEFAULT_FILTERS: ColumnFiltersState = [{ id: "status", value: ["live"] }];
const PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export function MarketsTable({
  groups,
  isLoading = false,
  emptyMessage = "No open market exposure.",
}: MarketsTableProps): ReactElement {
  const allGroups = useMemo(() => (groups ? Array.from(groups) : []), [groups]);
  const [alphaLeakOnly, setAlphaLeakOnly] = useState(false);
  const { data, alphaLeakCount } = useMemo(() => {
    const leaks = allGroups.filter(isAlphaLeak);
    return {
      data: alphaLeakOnly ? leaks : allGroups,
      alphaLeakCount: leaks.length,
    };
  }, [allGroups, alphaLeakOnly]);

  const columns = useMemo(() => makeColumns(), []);

  const [columnVisibility, setColumnVisibility] =
    useState<VisibilityState>(DEFAULT_VISIBILITY);
  const [columnFilters, setColumnFilters] =
    useState<ColumnFiltersState>(DEFAULT_FILTERS);
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORT);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });
  const [expanded, setExpanded] = useState<ExpandedState>(() =>
    data.length > 0 ? { 0: true } : {}
  );

  // Keep the first row expanded on first mount when data first arrives.
  useEffect(() => {
    setExpanded((current) => {
      if (data.length === 0) return current;
      if (Object.keys(current).length > 0) return current;
      return { 0: true };
    });
  }, [data.length]);

  useEffect(() => {
    setPagination((prev) => {
      const pageCount = Math.max(1, Math.ceil(data.length / prev.pageSize));
      if (prev.pageIndex < pageCount) return prev;
      return { ...prev, pageIndex: pageCount - 1 };
    });
  }, [data.length]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    state: { columnVisibility, columnFilters, sorting, pagination, expanded },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onExpandedChange: setExpanded,
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <Toggle
          size="sm"
          variant="outline"
          pressed={alphaLeakOnly}
          onPressedChange={setAlphaLeakOnly}
          disabled={isLoading || allGroups.length === 0}
          aria-label="Show only markets where targets are meaningfully ahead of us"
          title="Markets where targets beat us by ≥5pp on a position with positive dollar gap"
          className="gap-1.5"
        >
          <Flame className="size-3.5" aria-hidden="true" />
          <span className="text-xs">Alpha leak only</span>
          <span className="font-mono text-muted-foreground text-xs tabular-nums">
            ({alphaLeakCount})
          </span>
        </Toggle>
      </div>
      <DataGrid
        table={table}
        recordCount={data.length}
        isLoading={isLoading}
        loadingMode="skeleton"
        tableLayout={{
          headerSticky: true,
          headerBackground: true,
          rowBorder: true,
          dense: true,
          columnsVisibility: true,
        }}
        emptyMessage={
          alphaLeakOnly ? "No alpha-leak markets right now." : emptyMessage
        }
      >
        <DataGridContainer className="overflow-x-auto">
          <DataGridTable />
        </DataGridContainer>
        {data.length >= PAGE_SIZE ? (
          <DataGridPagination sizes={[...PAGE_SIZE_OPTIONS]} />
        ) : null}
      </DataGrid>
    </div>
  );
}
