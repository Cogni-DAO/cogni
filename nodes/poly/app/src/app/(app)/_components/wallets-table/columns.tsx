// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/_components/wallets-table/columns`
 * Purpose: TanStack column definitions for the single app-wide wallets table.
 * Scope: Pure column descriptors + inline cells. No fetching, no router.
 * Invariants:
 *   - Column ids are stable identifiers used for filter-state URL serialization on /research.
 *   - Every header renders via reui `DataGridColumnHeader` → sort + filter + hide
 *     live inside the column's own dropdown; there is no bespoke toolbar anywhere.
 *   - The `tracked` column doubles as the row-action control. When the caller
 *     passes `renderActions`, the cell renders it (click to track/untrack);
 *     otherwise it renders a read-only Radio/em-dash indicator.
 *   - `statsSource === "fallback"` cells render a small "all-time" pill so the
 *     UI is honest that the row came from the non-windowed all-time leaderboard.
 * Side-effects: none
 * @internal
 */

"use client";

import type { WalletTopTraderItem } from "@cogni/poly-ai-tools";
import { createColumnHelper } from "@tanstack/react-table";
import { Eye, Radio } from "lucide-react";
import type { ReactNode } from "react";

import {
  formatNumTrades,
  formatPnl,
  formatRoi,
  formatShortWallet,
  formatUsdc,
} from "@/app/(app)/dashboard/_components/wallet-format";
import { Skeleton } from "@/components";
import { DataGridColumnFilter } from "@/components/reui/data-grid/data-grid-column-filter";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";

export type WalletStatsSource = "leaderboard" | "fallback" | "none";

export type WalletRow = WalletTopTraderItem & {
  /** True when the calling user has this wallet in poly_copy_trade_targets. */
  tracked: boolean;
  /** Present when the row maps to a `poly_copy_trade_targets` row (copy-traded variant). */
  targetId?: string | undefined;
  /**
   * Where the metrics came from. `leaderboard` = windowed (trustworthy for the
   * selected period). `fallback` = all-time leaderboard enrichment (labeled
   * "all-time est." in the UI). `none` = no data available.
   */
  statsSource?: WalletStatsSource;
};

const col = createColumnHelper<WalletRow>();

const em = <span className="text-muted-foreground/60">—</span>;

const allTimePill = (
  <span
    className="ms-1 rounded bg-muted px-1 py-px align-middle font-normal text-muted-foreground text-xs uppercase tracking-wide"
    title="All-time estimate from the wallet snapshot — this wallet is not in the current window's top leaderboard."
  >
    all-time
  </span>
);

function isFallback(row: WalletRow): boolean {
  return row.statsSource === "fallback";
}

function hasStats(row: WalletRow): boolean {
  return row.statsSource !== "none";
}

export function makeColumns(opts: {
  /** Renders per-row tracked-column content (track/untrack button). */
  renderActions?: (row: WalletRow) => ReactNode;
}) {
  const { renderActions } = opts;

  return [
    col.accessor("rank", {
      id: "rank",
      header: ({ column }) => (
        <DataGridColumnHeader column={column} title="#" visibility />
      ),
      size: 50,
      cell: (info) => (
        <span className="font-mono text-muted-foreground text-xs tabular-nums">
          {hasStats(info.row.original) ? info.getValue() : "—"}
        </span>
      ),
      meta: {
        headerTitle: "Rank",
        skeleton: <Skeleton className="h-3.5 w-6" />,
      },
    }),

    // Merged tracked + actions column. Header is an eye icon with a faceted
    // filter popover; the cell is the click-to-track/untrack control (or a
    // read-only indicator when no callback is provided).
    col.accessor("tracked", {
      id: "tracked",
      header: ({ column }) => (
        <DataGridColumnHeader
          column={column}
          title=""
          icon={
            <>
              <Eye
                className="size-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="sr-only">Tracked</span>
            </>
          }
          visibility
          filter={
            <DataGridColumnFilter
              column={column}
              title="Tracked"
              options={[
                { label: "Tracked", value: "Tracked" },
                { label: "Not tracked", value: "Not tracked" },
              ]}
            />
          }
        />
      ),
      size: 48,
      enableSorting: true,
      cell: ({ row }) => {
        if (renderActions) {
          return (
            <div className="flex justify-center">
              {renderActions(row.original)}
            </div>
          );
        }
        return row.original.tracked ? (
          <div className="flex justify-center">
            <Radio
              className="size-3.5 animate-pulse text-success"
              aria-label="Copy-trading this wallet"
            />
          </div>
        ) : (
          <div className="flex justify-center text-muted-foreground/40">—</div>
        );
      },
      filterFn: (row, _id, value: string[]) => {
        if (!value || value.length === 0) return true;
        const t = row.getValue<boolean>("tracked");
        return value.includes(t ? "Tracked" : "Not tracked");
      },
      meta: {
        headerTitle: "Tracked",
        skeleton: <Skeleton className="mx-auto size-3.5 rounded-full" />,
      },
    }),

    col.display({
      id: "wallet",
      header: ({ column }) => (
        <DataGridColumnHeader column={column} title="Wallet" visibility />
      ),
      enableSorting: false,
      minSize: 240,
      cell: ({ row }) => {
        const r = row.original;
        const display = r.userName?.trim()
          ? r.userName
          : !hasStats(r)
            ? "(no activity)"
            : "(anonymous)";
        return (
          <div className="flex flex-col gap-0.5 py-0.5">
            <span
              className={`line-clamp-1 text-sm ${
                !hasStats(r) ? "text-muted-foreground italic" : ""
              }`}
            >
              {display}
            </span>
            <a
              href={`https://polymarket.com/profile/${r.proxyWallet}`}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-muted-foreground text-xs hover:underline"
              title={r.proxyWallet}
            >
              {formatShortWallet(r.proxyWallet)}
            </a>
          </div>
        );
      },
      meta: {
        headerTitle: "Wallet",
        skeleton: (
          <div className="flex flex-col gap-1 py-0.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        ),
      },
    }),

    col.accessor("volumeUsdc", {
      id: "volumeUsdc",
      header: ({ column }) => (
        <div className="flex w-full justify-end">
          <DataGridColumnHeader column={column} title="Volume" visibility />
        </div>
      ),
      size: 120,
      cell: (info) => {
        const r = info.row.original;
        if (!hasStats(r)) return <div className="text-right">{em}</div>;
        return (
          <div className="text-right text-sm tabular-nums">
            {formatUsdc(info.getValue())}
            {isFallback(r) ? allTimePill : null}
          </div>
        );
      },
      meta: {
        headerTitle: "Volume",
        skeleton: <Skeleton className="ms-auto h-3.5 w-16" />,
      },
    }),

    col.accessor("pnlUsdc", {
      id: "pnlUsdc",
      header: ({ column }) => (
        <div className="flex w-full justify-end">
          <DataGridColumnHeader column={column} title="PnL (MTM)" visibility />
        </div>
      ),
      size: 130,
      cell: (info) => {
        const r = info.row.original;
        if (!hasStats(r)) return <div className="text-right">{em}</div>;
        const v = info.getValue();
        return (
          <div
            className={`text-right text-sm tabular-nums ${
              v >= 0 ? "text-success" : "text-destructive"
            }`}
          >
            {formatPnl(v)}
            {isFallback(r) ? allTimePill : null}
          </div>
        );
      },
      meta: {
        headerTitle: "PnL (MTM)",
        skeleton: <Skeleton className="ms-auto h-3.5 w-20" />,
      },
    }),

    col.accessor("roiPct", {
      id: "roiPct",
      header: ({ column }) => (
        <div className="flex w-full justify-end">
          <DataGridColumnHeader column={column} title="ROI" visibility />
        </div>
      ),
      size: 90,
      cell: (info) => {
        const r = info.row.original;
        if (!hasStats(r)) return <div className="text-right">{em}</div>;
        return (
          <div className="text-right text-muted-foreground text-sm tabular-nums">
            {formatRoi(info.getValue())}
          </div>
        );
      },
      meta: {
        headerTitle: "ROI",
        skeleton: <Skeleton className="ms-auto h-3.5 w-12" />,
      },
    }),

    col.accessor("numTrades", {
      id: "numTrades",
      header: ({ column }) => (
        <div className="flex w-full justify-end">
          <DataGridColumnHeader column={column} title="# Trades" visibility />
        </div>
      ),
      size: 100,
      cell: ({ row }) => {
        const r = row.original;
        if (!hasStats(r)) return <div className="text-right">{em}</div>;
        return (
          <div className="text-right text-muted-foreground text-sm tabular-nums">
            {formatNumTrades(r.numTrades, r.numTradesCapped)}
            {isFallback(r) ? allTimePill : null}
          </div>
        );
      },
      meta: {
        headerTitle: "# Trades",
        skeleton: <Skeleton className="ms-auto h-3.5 w-10" />,
      },
    }),
  ];
}
