// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/_components/wallets-table/WalletsTable`
 * Purpose: THE single wallets-table organism. Any surface that renders a list of
 *          Polymarket wallets (dashboard copy-traded card, research discovery grid,
 *          future admin views) MUST render this component — no hand-rolled tables.
 * Scope: Client component. Wraps TanStack + `DataGrid` with a variant switch that
 *        toggles column visibility, pagination, and search. Does not fetch data;
 *        callers pass pre-built `WalletRow[]` and state.
 * Invariants:
 *   - WALLET_TABLE_SINGLETON: every table-of-wallets in the app renders via this module.
 *   - variant="full": rank + tracked + category + pagination + search visible.
 *   - variant="copy-traded": drops rank/tracked/category/pagination; list is the user's
 *     copy-trade targets, nothing more.
 *   - Row click bubbles up via `onRowClick`; the actions column stops propagation so
 *     track/untrack buttons do not also open a detail drawer.
 * Side-effects: none (pure render; caller owns fetching)
 * Links: work/items (unify-wallets-table-research design)
 * @public
 */

"use client";

import {
  type ColumnFiltersState,
  getCoreRowModel,
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
  /** Per-row action buttons (e.g. track/untrack). Rendered in the last column. */
  renderActions?: (row: WalletRow) => ReactNode;
  /** Required for `variant="full"` — drives URL-synced sorting/filters/search. */
  fullState?: WalletsTableFullState;
  emptyMessage?: string;
};

const FULL_COLUMN_VISIBILITY: VisibilityState = {
  rank: true,
  tracked: true,
  wallet: true,
  category: true,
  volumeUsdc: true,
  pnlUsdc: true,
  roiPct: true,
  numTrades: true,
  actions: true,
};

const COPY_TRADED_COLUMN_VISIBILITY: VisibilityState = {
  rank: false,
  tracked: false,
  wallet: true,
  category: false,
  volumeUsdc: true,
  pnlUsdc: true,
  roiPct: true,
  numTrades: true,
  actions: true,
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
      {...(onRowClick && { onRowClick })}
      tableLayout={{
        headerSticky: true,
        headerBackground: true,
        rowBorder: true,
        dense: true,
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
