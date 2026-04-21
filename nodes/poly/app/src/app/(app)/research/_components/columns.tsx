// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/research/_components/columns`
 * Purpose: TanStack column definitions for the research wallets browse grid. Mirrors `app/(app)/work/_components/columns.tsx` shape so the same `DataGrid` primitives render both surfaces.
 * Scope: Pure column descriptors + small inline cells. No fetching, no router.
 * Invariants: Header titles and column ids are stable identifiers used for filter-state URL serialization.
 * Side-effects: none
 * Links: work/items/task.0343.wallets-dashboard-page.md
 * @internal
 */

"use client";

import type { WalletTopTraderItem } from "@cogni/ai-tools";
import { createColumnHelper } from "@tanstack/react-table";
import { Eye, Radio } from "lucide-react";

import {
  formatNumTrades,
  formatPnl,
  formatRoi,
  formatShortWallet,
  formatUsdc,
} from "@/app/(app)/dashboard/_components/wallet-format";
import { inferWalletCategory } from "./category";

export type WalletRow = WalletTopTraderItem & {
  /** True when the calling user has this wallet in poly_copy_trade_targets. */
  tracked: boolean;
  /** v0 heuristic label; replaced by Dolt-stored category in task.0333. */
  category: string;
};

const col = createColumnHelper<WalletRow>();

export const columns = [
  col.accessor("rank", {
    header: "#",
    size: 50,
    cell: (info) => (
      <span className="font-mono text-muted-foreground text-xs tabular-nums">
        {info.getValue()}
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
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5 py-0.5">
        <span className="line-clamp-1 text-sm">
          {row.original.userName || "(anonymous)"}
        </span>
        <span className="font-mono text-muted-foreground text-xs">
          {formatShortWallet(row.original.proxyWallet)}
        </span>
      </div>
    ),
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
    cell: (info) => (
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
    cell: (info) => (
      <span className="text-right text-muted-foreground text-sm tabular-nums">
        {formatRoi(info.getValue())}
      </span>
    ),
    meta: { headerTitle: "ROI" },
  }),

  col.accessor("numTrades", {
    header: "# Trades",
    size: 90,
    cell: ({ row }) => (
      <span className="text-right text-muted-foreground text-sm tabular-nums">
        {formatNumTrades(row.original.numTrades, row.original.numTradesCapped)}
      </span>
    ),
    meta: { headerTitle: "# Trades" },
  }),
];

/** Build rows by joining leaderboard traders against the user's tracked targets. */
export function buildWalletRows(
  traders: ReadonlyArray<WalletTopTraderItem>,
  trackedWalletsLower: ReadonlySet<string>
): WalletRow[] {
  return traders.map((t) => ({
    ...t,
    tracked: trackedWalletsLower.has(t.proxyWallet.toLowerCase()),
    category: inferWalletCategory({
      userName: t.userName,
      proxyWallet: t.proxyWallet,
    }),
  }));
}

export { WALLET_CATEGORIES } from "./category";
