// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/_components/positions-table/PositionsTable`
 * Purpose: THE single positions-table organism. Any surface that renders a list
 *          of poly wallet positions (dashboard `ExecutionActivityCard`, future
 *          history drawers, future admin views) MUST render this component —
 *          no hand-rolled tables.
 * Scope: Client component. Thin wrapper over the vendored `reui` DataGrid kit
 *        (`components/reui/data-grid`). Sort + column-visibility live inside
 *        each column header via `DataGridColumnHeader`, not in a bespoke
 *        toolbar — same pattern as the sibling `wallets-table` module.
 * Invariants:
 *   - HEADER_OWNS_CONTROLS: sort + hide live on the column header dropdown.
 *   - variant="default": Current value + Action columns visible.
 *   - variant="history": Closed-at column replaces Current; no Action column.
 *   - PositionsTable does not fetch; callers pass `WalletPosition[]` and
 *     `pendingActionPositionId`.
 * Side-effects: none
 * @public
 */

"use client";

import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  DataGrid,
  DataGridContainer,
} from "@/components/reui/data-grid/data-grid";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import type { WalletPosition } from "@/features/wallet-analysis/types/wallet-analysis";

import {
  type MakeColumnsOpts,
  makeColumns,
  type PositionAction,
  type PositionsTableVariant,
} from "./columns";

export type { PositionsTableVariant, PositionAction };

export type PositionsTableProps = {
  positions?: readonly WalletPosition[] | undefined;
  isLoading?: boolean | undefined;
  emptyMessage?: ReactNode;
  /**
   * "default" — shows Current value + Action columns (Close/Redeem buttons).
   * "history" — shows Closed timestamp instead; no Action column.
   */
  variant?: PositionsTableVariant;
  /** When set, clicking Close / Redeem invokes this. */
  onPositionAction?: MakeColumnsOpts["onPositionAction"];
  /** Row `positionId` while an action request is in flight. */
  pendingActionPositionId?: string | null;
};

const DEFAULT_VISIBILITY: VisibilityState = {
  market: true,
  bet: true,
  endsAt: true,
  heldMinutes: true,
  trace: true,
  currentValue: true,
  pnlUsd: true,
  pnlPct: true,
  action: true,
};

const HISTORY_VISIBILITY: VisibilityState = {
  market: true,
  bet: true,
  endsAt: true,
  heldMinutes: true,
  trace: true,
  closedAt: true,
  pnlUsd: true,
  pnlPct: true,
};

export function PositionsTable({
  positions,
  isLoading = false,
  emptyMessage = "No positions yet.",
  variant = "default",
  onPositionAction,
  pendingActionPositionId = null,
}: PositionsTableProps): ReactElement {
  const data = useMemo(
    () => (positions ? Array.from(positions) : []),
    [positions]
  );

  const columns = useMemo(
    () =>
      makeColumns({
        variant,
        ...(onPositionAction && { onPositionAction }),
        pendingActionPositionId,
      }),
    [variant, onPositionAction, pendingActionPositionId]
  );

  const variantVisibility =
    variant === "history" ? HISTORY_VISIBILITY : DEFAULT_VISIBILITY;

  // Variant determines which columns are visible by default; user toggles in
  // the column-header dropdown override that. Reset to variant defaults when
  // the variant changes so switching default↔history doesn't strand a hidden
  // column from the previous variant.
  const [columnVisibility, setColumnVisibility] =
    useState<VisibilityState>(variantVisibility);
  useEffect(() => {
    setColumnVisibility(variantVisibility);
  }, [variantVisibility]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
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
    </DataGrid>
  );
}
