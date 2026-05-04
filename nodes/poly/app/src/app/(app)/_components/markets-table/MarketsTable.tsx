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
  type ExpandedState,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  DataGrid,
  DataGridContainer,
} from "@/components/reui/data-grid/data-grid";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";

import { makeColumns } from "./columns";

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
  const data = useMemo(() => (groups ? Array.from(groups) : []), [groups]);

  const columns = useMemo(() => makeColumns(), []);

  const [columnVisibility, setColumnVisibility] =
    useState<VisibilityState>(DEFAULT_VISIBILITY);
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
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    state: { columnVisibility, pagination, expanded },
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    onExpandedChange: setExpanded,
  });

  return (
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
      emptyMessage={emptyMessage}
    >
      <DataGridContainer className="overflow-x-auto">
        <DataGridTable />
      </DataGridContainer>
      {data.length >= PAGE_SIZE ? (
        <DataGridPagination sizes={[...PAGE_SIZE_OPTIONS]} />
      ) : null}
    </DataGrid>
  );
}
