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
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { Flame } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  DataGrid,
  DataGridContainer,
} from "@/components/reui/data-grid/data-grid";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Toggle } from "@/components/vendor/shadcn/toggle";

import { makeColumns } from "./columns";

/**
 * Group is an "alpha leak": we are red, target is green. Null `edgeGapUsdc`
 * means we have no target legs to compare against — that's not a leak, it's
 * a solo market.
 * Exported so the predicate can be unit-tested without rendering React.
 */
export function isAlphaLeak(group: WalletExecutionMarketGroup): boolean {
  if (group.edgeGapUsdc === null) return false;
  // edgeGapUsdc = targetPnl − ourPnl. So targetPnl = ourPnl + edgeGapUsdc.
  const targetPnl = group.pnlUsd + group.edgeGapUsdc;
  return group.pnlUsd < 0 && targetPnl > 0;
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
  status: true,
  edgeGap: true,
  pnl: true,
  hedges: true,
};
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
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
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
    state: { columnVisibility, columnFilters, pagination, expanded },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnFiltersChange: setColumnFilters,
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
          aria-label="Show only markets where we lost and the copy target won"
          title="Markets where we are red and the copy target is green"
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
