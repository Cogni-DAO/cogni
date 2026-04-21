// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/_components/wallets-table/columns`
 * Purpose: TanStack column definitions for the single app-wide wallets table.
 * Scope: Pure column descriptors + inline cells. No fetching, no router.
 * Invariants:
 *   - Column ids are stable identifiers used for filter-state URL serialization on /research.
 *   - The actions column is always present; pages inject row-specific buttons via `renderActions`.
 *   - `outsideWindow` rows render `—` for metric columns so they sort to the bottom under normal orderings.
 * Side-effects: none
 * @internal
 */

"use client";

import type { WalletTopTraderItem } from "@cogni/ai-tools";
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

export type WalletRow = WalletTopTraderItem & {
  /** True when the calling user has this wallet in poly_copy_trade_targets. */
  tracked: boolean;
  /** v0 heuristic label; replaced by Dolt-stored category in task.0333. */
  category: string;
  /** Present when the row maps to a `poly_copy_trade_targets` row (copy-traded variant). */
  targetId?: string | undefined;
  /** Copy-traded wallet not present in the current leaderboard window — metrics should render as `—`. */
  outsideWindow?: boolean | undefined;
};

const col = createColumnHelper<WalletRow>();

const em = <span className="text-muted-foreground/60">—</span>;

export function makeColumns(opts: {
  /** Renders per-row action buttons (track/untrack). Optional; omitted → empty cell. */
  renderActions?: (row: WalletRow) => ReactNode;
}) {
  const { renderActions } = opts;

  return [
    col.accessor("rank", {
      header: "#",
      size: 50,
      cell: (info) => (
        <span className="font-mono text-muted-foreground text-xs tabular-nums">
          {info.row.original.outsideWindow ? "★" : info.getValue()}
        </span>
      ),
      meta: { headerTitle: "Rank" },
    }),

    col.accessor("tracked", {
      id: "tracked",
      header: () => (
        <Eye className="size-3.5 text-muted-foreground" aria-hidden />
      ),
      size: 36,
      cell: (info) =>
        info.getValue() ? (
          <Radio
            className="size-3.5 animate-pulse text-success"
            aria-label="Copy-trading this wallet"
          />
        ) : (
          <span className="text-muted-foreground/40">—</span>
        ),
      filterFn: (row, _id, value: string[]) => {
        if (!value || value.length === 0) return true;
        const t = row.getValue<boolean>("tracked");
        return value.includes(t ? "Tracked" : "Not tracked");
      },
      meta: { headerTitle: "Tracked" },
    }),

    col.display({
      id: "wallet",
      header: "Wallet",
      minSize: 240,
      cell: ({ row }) => {
        const r = row.original;
        const display = r.userName?.trim()
          ? r.userName
          : r.outsideWindow
            ? "(outside window)"
            : "(anonymous)";
        return (
          <div className="flex flex-col gap-0.5 py-0.5">
            <span
              className={`line-clamp-1 text-sm ${
                r.outsideWindow ? "text-muted-foreground italic" : ""
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
      meta: { headerTitle: "Wallet" },
    }),

    col.accessor("category", {
      header: "Category",
      size: 110,
      cell: (info) => (
        <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
          {info.getValue()}
        </span>
      ),
      filterFn: "arrIncludesSome",
      meta: { headerTitle: "Category" },
    }),

    col.accessor("volumeUsdc", {
      header: "Volume",
      size: 100,
      cell: (info) =>
        info.row.original.outsideWindow ? (
          em
        ) : (
          <span className="text-right text-sm tabular-nums">
            {formatUsdc(info.getValue())}
          </span>
        ),
      meta: { headerTitle: "Volume" },
    }),

    col.accessor("pnlUsdc", {
      header: "PnL (MTM)",
      size: 110,
      cell: (info) => {
        if (info.row.original.outsideWindow) return em;
        const v = info.getValue();
        return (
          <span
            className={`text-right text-sm tabular-nums ${
              v >= 0 ? "text-success" : "text-destructive"
            }`}
          >
            {formatPnl(v)}
          </span>
        );
      },
      meta: { headerTitle: "PnL (MTM)" },
    }),

    col.accessor("roiPct", {
      header: "ROI",
      size: 80,
      cell: (info) =>
        info.row.original.outsideWindow ? (
          em
        ) : (
          <span className="text-right text-muted-foreground text-sm tabular-nums">
            {formatRoi(info.getValue())}
          </span>
        ),
      meta: { headerTitle: "ROI" },
    }),

    col.accessor("numTrades", {
      header: "# Trades",
      size: 90,
      cell: ({ row }) =>
        row.original.outsideWindow ? (
          em
        ) : (
          <span className="text-right text-muted-foreground text-sm tabular-nums">
            {formatNumTrades(
              row.original.numTrades,
              row.original.numTradesCapped
            )}
          </span>
        ),
      meta: { headerTitle: "# Trades" },
    }),

    col.display({
      id: "actions",
      header: "",
      size: 60,
      cell: ({ row }) =>
        renderActions ? (
          <div className="flex justify-end">{renderActions(row.original)}</div>
        ) : null,
      meta: { headerTitle: "Actions" },
    }),
  ];
}
