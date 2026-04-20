// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/TopWalletsCard`
 * Purpose: "Monitored Wallets" card — live leaderboard of top Polymarket wallets with
 *          a per-row + button to track and a − button to untrack on user-owned rows.
 *          Reads + writes go through the per-user, RLS-scoped API.
 * Scope: Client component. React Query polls + mutates against the internal API.
 *        Does not place orders.
 * Invariants:
 *   - PER_USER: list shows only the calling user's tracked wallets; create/delete
 *     are RLS-scoped to the session user (enforced server-side, not here).
 *   - POOLED_EXECUTION_DISCLAIMER: the card explicitly states that mirror execution
 *     is shared across all operators in this node until per-user wallets ship in
 *     Phase B (per docs/spec/poly-multi-tenant-auth.md § Phase A scope clarification).
 * Side-effects: IO (via React Query — fetch/mutate against /api/v1/poly/copy-trade/targets).
 * Links: [fetchCopyTargets](../_api/fetchCopyTargets.ts), [fetchTopWallets](../_api/fetchTopWallets.ts),
 *        docs/spec/poly-multi-tenant-auth.md, work/items/task.0318
 * @public
 */

"use client";

import type { WalletTimePeriod } from "@cogni/ai-tools";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import type { KeyboardEvent, ReactElement } from "react";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from "@/components";
import { cn } from "@/shared/util/cn";
import {
  createCopyTarget,
  deleteCopyTarget,
  fetchCopyTargets,
} from "../_api/fetchCopyTargets";
import { fetchTopWallets } from "../_api/fetchTopWallets";
import {
  formatNumTrades,
  formatPnl,
  formatRoi,
  formatShortWallet,
  formatUsdc,
} from "./wallet-format";

const TIME_PERIOD_OPTIONS: readonly {
  value: WalletTimePeriod;
  label: string;
}[] = [
  { value: "DAY", label: "Day" },
  { value: "WEEK", label: "Week" },
  { value: "MONTH", label: "Month" },
  { value: "ALL", label: "All" },
] as const;

const TOP_WALLETS_LIMIT = 10;

export function TopWalletsCard(): ReactElement {
  const router = useRouter();
  const [timePeriod, setTimePeriod] = useState<WalletTimePeriod>("WEEK");

  const navigateToWallet = (addr: string): void => {
    router.push(`/research/w/${addr.toLowerCase()}`);
  };
  const rowKeyDown = (addr: string) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigateToWallet(addr);
    }
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-top-wallets", timePeriod],
    queryFn: () => fetchTopWallets({ timePeriod, limit: TOP_WALLETS_LIMIT }),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const queryClient = useQueryClient();
  const COPY_TARGETS_KEY = ["dashboard-copy-targets"] as const;

  const { data: targetsData } = useQuery({
    queryKey: COPY_TARGETS_KEY,
    queryFn: fetchCopyTargets,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const createTargetMutation = useMutation({
    mutationFn: (targetWallet: string) =>
      createCopyTarget({ target_wallet: targetWallet }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: COPY_TARGETS_KEY }),
  });

  const deleteTargetMutation = useMutation({
    mutationFn: (id: string) => deleteCopyTarget(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: COPY_TARGETS_KEY }),
  });

  const targetList = targetsData?.targets ?? [];
  const trackedWallets = new Set(
    targetList.map((t) => t.target_wallet.toLowerCase())
  );
  const targetsByWallet = new Map(
    targetList.map((t) => [t.target_wallet.toLowerCase(), t])
  );

  const traders = data?.traders ?? [];

  // Pin tracked wallets to the top of the table. A tracked wallet may or may
  // not be in the leaderboard's top N; if it's missing, synthesize a minimal
  // row from the target metadata so the operator can always see what they're
  // copying.
  type TraderRow = (typeof traders)[number];
  type MissingTrackedRow = {
    kind: "missing";
    proxyWallet: string;
    targetId: string;
  };
  type DisplayRow =
    | { kind: "present"; tracked: boolean; trader: TraderRow }
    | MissingTrackedRow;

  const presentWalletSet = new Set(
    traders.map((t) => t.proxyWallet.toLowerCase())
  );
  const trackedPresent: DisplayRow[] = [];
  const untrackedPresent: DisplayRow[] = [];
  for (const trader of traders) {
    const isTracked = trackedWallets.has(trader.proxyWallet.toLowerCase());
    (isTracked ? trackedPresent : untrackedPresent).push({
      kind: "present",
      tracked: isTracked,
      trader,
    });
  }
  const trackedMissing: DisplayRow[] = targetList
    .filter((t) => !presentWalletSet.has(t.target_wallet.toLowerCase()))
    .map((t) => ({
      kind: "missing",
      proxyWallet: t.target_wallet,
      targetId: t.target_id,
    }));

  const displayRows: DisplayRow[] = [
    ...trackedMissing,
    ...trackedPresent,
    ...untrackedPresent,
  ];

  return (
    <Card>
      <CardHeader className="px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Monitored Wallets
          </CardTitle>
          <ToggleGroup
            type="single"
            value={timePeriod}
            onValueChange={(v) => {
              if (v) setTimePeriod(v as WalletTimePeriod);
            }}
            className="rounded-lg border"
          >
            {TIME_PERIOD_OPTIONS.map((opt) => (
              <ToggleGroupItem
                key={opt.value}
                value={opt.value}
                className="px-3 text-xs"
              >
                {opt.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <p className="border-warning/30 border-b bg-warning/5 px-5 py-2 text-muted-foreground text-xs">
          Mirror execution is shared across all operators in this node. Per-user
          wallets and isolated execution ship in Phase B (task.0318).
        </p>
        {isLoading ? (
          <div className="animate-pulse space-y-px px-5 pb-4">
            <div className="h-9 rounded bg-muted" />
            <div className="h-9 rounded bg-muted" />
            <div className="h-9 rounded bg-muted" />
          </div>
        ) : isError ? (
          <p className="px-5 py-6 text-center text-muted-foreground text-sm">
            Failed to load top wallets. Try again shortly.
          </p>
        ) : displayRows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead className="w-10 text-center" title="Tracked">
                  {/* eye icon as header */}
                  <Eye className="inline size-3.5 text-muted-foreground" />
                </TableHead>
                <TableHead>User</TableHead>
                <TableHead>Wallet</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead
                  className="text-right"
                  title="Realized + unrealized mark-to-market PnL from the Data API"
                >
                  PnL (MTM)
                </TableHead>
                <TableHead className="text-right">ROI</TableHead>
                <TableHead className="text-right"># Trades</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.map((row) => {
                if (row.kind === "missing") {
                  const target = targetsByWallet.get(
                    row.proxyWallet.toLowerCase()
                  );
                  return (
                    <TableRow
                      key={`tracked-missing-${row.proxyWallet}`}
                      role="link"
                      tabIndex={0}
                      onClick={() => navigateToWallet(row.proxyWallet)}
                      onKeyDown={rowKeyDown(row.proxyWallet)}
                      title={`Open wallet analysis for ${row.proxyWallet}`}
                      className="cursor-pointer border-success/40 border-l-2 bg-success/10 hover:bg-success/20"
                    >
                      <TableCell className="text-muted-foreground text-sm tabular-nums">
                        ★
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className="inline-flex size-2 animate-pulse rounded-full bg-success"
                          title={
                            target
                              ? `Tracked — ${target.mode} · $${target.mirror_usdc}/fill · source=${target.source}`
                              : "Currently tracked"
                          }
                        />
                      </TableCell>
                      <TableCell className="max-w-40 truncate font-medium text-muted-foreground text-sm italic">
                        (outside top {TOP_WALLETS_LIMIT})
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground text-xs">
                        <a
                          href={`https://polymarket.com/profile/${row.proxyWallet}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          onClick={(e) => e.stopPropagation()}
                          className="hover:underline"
                        >
                          {formatShortWallet(row.proxyWallet)}
                        </a>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        —
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        —
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        —
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        —
                      </TableCell>
                      <TableCell className="pl-0 text-right">
                        <button
                          type="button"
                          aria-label={`Untrack ${row.proxyWallet}`}
                          title="Stop tracking this wallet"
                          disabled={deleteTargetMutation.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteTargetMutation.mutate(row.targetId);
                          }}
                          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-success/20 hover:text-success disabled:cursor-wait disabled:opacity-40"
                        >
                          <Minus className="size-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                }
                const t = row.trader;
                const tracked = row.tracked;
                const walletKey = t.proxyWallet.toLowerCase();
                const target = targetsByWallet.get(walletKey);
                return (
                  <TableRow
                    key={t.proxyWallet}
                    role="link"
                    tabIndex={0}
                    onClick={() => navigateToWallet(t.proxyWallet)}
                    onKeyDown={rowKeyDown(t.proxyWallet)}
                    title={`Open wallet analysis for ${t.userName || t.proxyWallet}`}
                    className={cn(
                      "cursor-pointer hover:bg-muted/40",
                      tracked &&
                        "border-success/40 border-l-2 bg-success/10 hover:bg-success/20"
                    )}
                  >
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {t.rank}
                    </TableCell>
                    <TableCell className="text-center">
                      {tracked ? (
                        <span
                          className="inline-flex size-2 animate-pulse rounded-full bg-success"
                          title={
                            target
                              ? `Tracked — ${target.mode} · $${target.mirror_usdc}/fill · source=${target.source}`
                              : "Currently tracked"
                          }
                        />
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-40 truncate font-medium text-sm">
                      {t.userName}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">
                      <a
                        href={`https://polymarket.com/profile/${t.proxyWallet}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(e) => e.stopPropagation()}
                        className="hover:underline"
                      >
                        {formatShortWallet(t.proxyWallet)}
                      </a>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatUsdc(t.volumeUsdc)}
                    </TableCell>
                    <TableCell
                      className={`text-right text-sm tabular-nums ${
                        t.pnlUsdc >= 0 ? "text-success" : "text-destructive"
                      }`}
                    >
                      {formatPnl(t.pnlUsdc)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                      {formatRoi(t.roiPct)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                      {formatNumTrades(t.numTrades, t.numTradesCapped)}
                    </TableCell>
                    <TableCell className="pl-0 text-right">
                      {tracked ? (
                        <button
                          type="button"
                          aria-label={`Untrack ${t.proxyWallet}`}
                          title="Stop tracking this wallet"
                          disabled={deleteTargetMutation.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!target) return;
                            deleteTargetMutation.mutate(target.target_id);
                          }}
                          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-success/20 hover:text-success disabled:cursor-wait disabled:opacity-40"
                        >
                          <Minus className="size-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Track ${t.proxyWallet}`}
                          title="Track this wallet (mirror its fills)"
                          disabled={createTargetMutation.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            createTargetMutation.mutate(t.proxyWallet);
                          }}
                          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:cursor-wait disabled:opacity-40"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="px-5 py-6 text-center text-muted-foreground text-sm">
            No top wallets to show for this window yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
