// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/CopyTradedWalletsCard`
 * Purpose: Dashboard card that shows ONLY the wallets the calling user is copy-trading
 *          (rows from `poly_copy_trade_targets`), enriched with current-week leaderboard
 *          metrics when available and falling back to the all-time leaderboard for
 *          copy-traded wallets that are not in this week's top-50 (clearly labeled).
 *          Discovery lives on /research — this card is a readout.
 * Scope: Client component. Renders via the app-wide `WalletsTable` (variant="copy-traded").
 *        No per-row navigation: clicking a row opens the shared `WalletDetailDrawer` in
 *        place, matching the /research interaction. The green Radio icon in the Tracked
 *        column IS the untrack button — one cell, one affordance.
 * Invariants:
 *   - WALLET_TABLE_SINGLETON: renders through `@/app/(app)/_components/wallets-table`.
 *   - COPY_TARGETS_ONLY: every row maps to a `poly_copy_trade_targets` row. No Polymarket
 *     leaderboard bleed-through.
 *   - HONEST_STATS_LABELING: rows sourced from the all-time fallback render an "all-time"
 *     pill instead of pretending to be weekly numbers.
 *   - RLS-scoped: reads go through `/api/v1/poly/copy-trade/targets`; operator sees only
 *     their own targets.
 * Side-effects: IO (React Query — fetchCopyTargets, fetchTopWallets ×2, deleteCopyTarget).
 * Follow-up: work/items/task.0346.poly-wallet-stats-data-api-first.md replaces the two
 *            leaderboard fan-outs with a single batched Data-API-first per-wallet
 *            windowed-stats endpoint. Until then the two-tier fallback is the honest
 *            compromise.
 * @public
 */

"use client";

import type { WalletTopTraderItem } from "@cogni/poly-ai-tools";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";
import { useMemo, useState } from "react";

import {
  buildCopyTradedWalletRows,
  type WalletRow,
  WalletsTable,
} from "@/app/(app)/_components/wallets-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components";
import { WalletDetailDrawer } from "@/features/wallet-analysis";

import { deleteCopyTarget, fetchCopyTargets } from "../_api/fetchCopyTargets";
import { fetchTopWallets } from "../_api/fetchTopWallets";

const WEEK_ENRICHMENT_LIMIT = 50;
const ALLTIME_FALLBACK_LIMIT = 200;

export function CopyTradedWalletsCard(): ReactElement {
  const queryClient = useQueryClient();
  const [selectedAddr, setSelectedAddr] = useState<string | null>(null);

  const COPY_TARGETS_KEY = ["dashboard-copy-targets"] as const;

  const { data: targetsData, isLoading: targetsLoading } = useQuery({
    queryKey: COPY_TARGETS_KEY,
    queryFn: fetchCopyTargets,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const { data: weekData } = useQuery({
    queryKey: ["dashboard-copy-traded-week", WEEK_ENRICHMENT_LIMIT],
    queryFn: () =>
      fetchTopWallets({ timePeriod: "WEEK", limit: WEEK_ENRICHMENT_LIMIT }),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const { data: allTimeData } = useQuery({
    queryKey: ["dashboard-copy-traded-alltime", ALLTIME_FALLBACK_LIMIT],
    queryFn: () =>
      fetchTopWallets({ timePeriod: "ALL", limit: ALLTIME_FALLBACK_LIMIT }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });

  const deleteTargetMutation = useMutation({
    mutationFn: (id: string) => deleteCopyTarget(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: COPY_TARGETS_KEY }),
  });

  const weekByWallet = useMemo(
    () => toLowerMap(weekData?.traders ?? []),
    [weekData]
  );
  const allTimeByWallet = useMemo(
    () => toLowerMap(allTimeData?.traders ?? []),
    [allTimeData]
  );

  const rows = useMemo(
    () =>
      buildCopyTradedWalletRows(
        targetsData?.targets ?? [],
        weekByWallet,
        allTimeByWallet
      ),
    [targetsData, weekByWallet, allTimeByWallet]
  );

  // Merged tracked column owns the untrack button; clicking it unfollows.
  const renderActions = (row: WalletRow): ReactElement | null => {
    if (!row.targetId) return null;
    const targetId = row.targetId;
    return (
      <button
        type="button"
        aria-label={`Untrack ${row.proxyWallet}`}
        title="Stop copy-trading this wallet (click the green icon to unfollow)"
        disabled={deleteTargetMutation.isPending}
        onClick={(e) => {
          e.stopPropagation();
          deleteTargetMutation.mutate(targetId);
        }}
        className="inline-flex size-7 items-center justify-center rounded text-success hover:bg-destructive/10 hover:text-destructive disabled:cursor-wait disabled:opacity-40"
      >
        <Radio className="size-3.5 animate-pulse" />
      </button>
    );
  };

  return (
    <Card>
      <CardHeader className="px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Copy-Traded Wallets · this week
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <WalletsTable
          rows={rows}
          variant="copy-traded"
          isLoading={targetsLoading}
          onRowClick={(row) => setSelectedAddr(row.proxyWallet.toLowerCase())}
          renderActions={renderActions}
          emptyMessage={
            <span>
              No copy-traded wallets yet.{" "}
              <Link
                href="/research"
                className="underline decoration-muted-foreground/50 hover:decoration-foreground"
              >
                Pick a wallet to copy — browse top traders →
              </Link>
            </span>
          }
        />
      </CardContent>

      <WalletDetailDrawer
        addr={selectedAddr}
        open={selectedAddr !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedAddr(null);
        }}
      />
    </Card>
  );
}

function toLowerMap(
  traders: ReadonlyArray<WalletTopTraderItem>
): Map<string, WalletTopTraderItem> {
  const m = new Map<string, WalletTopTraderItem>();
  for (const t of traders) m.set(t.proxyWallet.toLowerCase(), t);
  return m;
}
