// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/_components/wallets-table/WalletsTable`
 * Purpose: THE single wallets-table organism. Any surface that renders a list of
 *          Polymarket wallets (dashboard copy-traded card, research discovery grid,
 *          future admin views) MUST render this component — no hand-rolled tables.
 * Scope: Client component. Thin wrapper over the vendored `reui` DataGrid kit
 *        (`components/reui/data-grid`) — sort, filter, and column-visibility
 *        controls live inside each column header via `DataGridColumnHeader`,
 *        not in a bespoke toolbar. Does not fetch data; callers pass pre-built
 *        `WalletRow[]` and state.
 * Invariants:
 *   - WALLET_TABLE_SINGLETON: every table-of-wallets in the app renders via this module.
 *   - HEADER_OWNS_CONTROLS: sort + filter + hide live on the column header dropdown;
 *     no parallel toolbar chips. Add new controls there, not as top-bar buttons.
 *   - variant="full": rank + tracked + pagination + search visible.
 *   - variant="copy-traded": drops rank + pagination; list is the user's copy-trade
 *     targets, nothing more.
 *   - Row click bubbles up via `onRowClick`; the tracked-action cell stops propagation
 *     so track/untrack buttons do not also open a detail drawer.
 * Side-effects: none (pure render; caller owns fetching)
 * @public
 */

"use client";

import {
  type ColumnFiltersState,
  getCoreRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import type { ReactNode } from "react";
import { useMemo } from "react";

import {
  DataGrid,
  DataGridContainer,
} from "@/components/reui/data-grid/data-grid";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";

import { makeColumns, type WalletRow } from "./columns";

export type WalletsTableVariant = "full" | "copy-traded";

/** Full-variant callers drive sorting/filters/search externally so URL state can be synced. */
export type WalletsTableFullState = {
  sorting: SortingState;
  onSortingChange: (next: SortingState) => void;
  columnFilters: ColumnFiltersState;
  onColumnFiltersChange: (next: ColumnFiltersState) => void;
  globalFilter: string;
  onGlobalFilterChange: (next: string) => void;
};

export type WalletsTableProps = {
  rows: WalletRow[];
  variant: WalletsTableVariant;
  isLoading?: boolean;
  onRowClick?: (row: WalletRow) => void;
  /** Per-row action content for the Tracked column (click to track/untrack). */
  renderActions?: (row: WalletRow) => ReactNode;
  /** Required for `variant="full"` — drives URL-synced sorting/filters/search. */
  fullState?: WalletsTableFullState;
  emptyMessage?: string;
};

const FULL_COLUMN_VISIBILITY: VisibilityState = {
  rank: true,
  tracked: true,
  wallet: true,
  volumeUsdc: true,
  pnlUsdc: true,
  roiPct: true,
  numTrades: true,
};

const COPY_TRADED_COLUMN_VISIBILITY: VisibilityState = {
  rank: false,
  tracked: true,
  wallet: true,
  volumeUsdc: true,
  pnlUsdc: true,
  roiPct: true,
  numTrades: true,
};

export function WalletsTable(props: WalletsTableProps) {
  const {
    rows,
    variant,
    isLoading = false,
    onRowClick,
    renderActions,
    fullState,
    emptyMessage,
  } = props;

  const columns = useMemo(
    () => makeColumns({ ...(renderActions && { renderActions }) }),
    [renderActions]
  );

  const columnVisibility =
    variant === "full" ? FULL_COLUMN_VISIBILITY : COPY_TRADED_COLUMN_VISIBILITY;

  const fullStateHandlers =
    variant === "full" && fullState
      ? {
          state: {
            columnVisibility,
            sorting: fullState.sorting,
            columnFilters: fullState.columnFilters,
            globalFilter: fullState.globalFilter,
          },
          onSortingChange: (
            updater: SortingState | ((prev: SortingState) => SortingState)
          ) => {
            const next =
              typeof updater === "function"
                ? updater(fullState.sorting)
                : updater;
            fullState.onSortingChange(next);
          },
          onColumnFiltersChange: (
            updater:
              | ColumnFiltersState
              | ((prev: ColumnFiltersState) => ColumnFiltersState)
          ) => {
            const next =
              typeof updater === "function"
                ? updater(fullState.columnFilters)
                : updater;
            fullState.onColumnFiltersChange(next);
          },
          onGlobalFilterChange: fullState.onGlobalFilterChange,
          getPaginationRowModel: getPaginationRowModel(),
        }
      : { state: { columnVisibility } };

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    globalFilterFn: (row, _id, filterValue: string) => {
      const q = (filterValue ?? "").toLowerCase().trim();
      if (!q) return true;
      const r = row.original;
      return (
        r.proxyWallet.toLowerCase().includes(q) ||
        (r.userName ?? "").toLowerCase().includes(q)
      );
    },
    ...fullStateHandlers,
  });

  return (
    <DataGrid
      table={table}
      recordCount={rows.length}
      isLoading={isLoading}
      loadingMode="skeleton"
      {...(onRowClick && { onRowClick })}
      tableLayout={{
        headerSticky: true,
        headerBackground: true,
        rowBorder: true,
        dense: true,
        columnsVisibility: true,
      }}
      tableClassNames={{ bodyRow: onRowClick ? "cursor-pointer" : "" }}
      emptyMessage={emptyMessage ?? "No wallets to show."}
    >
      <DataGridContainer className="overflow-x-auto">
        <DataGridTable />
      </DataGridContainer>
      {variant === "full" ? <DataGridPagination sizes={[25, 50, 100]} /> : null}
    </DataGrid>
  );
}
