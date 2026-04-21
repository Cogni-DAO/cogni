// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/CopyTradedWalletsCard`
 * Purpose: Dashboard card that shows ONLY the wallets the calling user is copy-trading
 *          (rows from `poly_copy_trade_targets`), enriched with current-window leaderboard
 *          metrics when available. Discovery lives on /research — this card is a readout.
 * Scope: Client component. Fetches copy targets + top wallets for the selected window,
 *        merges them via the shared `buildCopyTradedWalletRows` helper, and renders via
 *        the app-wide `WalletsTable` (variant="copy-traded"). No track/+ button here —
 *        new wallets are discovered and added from /research.
 * Invariants:
 *   - WALLET_TABLE_SINGLETON: renders through `@/app/(app)/_components/wallets-table`.
 *   - COPY_TARGETS_ONLY: every row maps to a `poly_copy_trade_targets` row. No Polymarket
 *     leaderboard bleed-through.
 *   - RLS-scoped: reads go through `/api/v1/poly/copy-trade/targets`; operator sees only
 *     their own targets.
 * Side-effects: IO (React Query — fetchCopyTargets, fetchTopWallets, deleteCopyTarget).
 * Links: [fetchCopyTargets](../_api/fetchCopyTargets.ts), [fetchTopWallets](../_api/fetchTopWallets.ts),
 *        docs/spec/poly-multi-tenant-auth.md
 * @public
 */

"use client";

import type { WalletTimePeriod, WalletTopTraderItem } from "@cogni/ai-tools";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactElement } from "react";
import { useMemo, useState } from "react";

import {
  buildCopyTradedWalletRows,
  type WalletRow,
  WalletsTable,
} from "@/app/(app)/_components/wallets-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ToggleGroup,
  ToggleGroupItem,
} from "@/components";

import { deleteCopyTarget, fetchCopyTargets } from "../_api/fetchCopyTargets";
import { fetchTopWallets } from "../_api/fetchTopWallets";

const TIME_PERIOD_OPTIONS: readonly {
  value: WalletTimePeriod;
  label: string;
}[] = [
  { value: "DAY", label: "Day" },
  { value: "WEEK", label: "Week" },
  { value: "MONTH", label: "Month" },
  { value: "ALL", label: "All" },
] as const;

// Enrich copy-traded wallets with leaderboard data when they happen to be in the
// top of the window. Size chosen to cover the common case without enlarging the
// Polymarket fan-out beyond what we already do.
const LEADERBOARD_ENRICHMENT_LIMIT = 50;

export function CopyTradedWalletsCard(): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [timePeriod, setTimePeriod] = useState<WalletTimePeriod>("WEEK");

  const navigateToWallet = (addr: string): void => {
    router.push(`/research/w/${addr.toLowerCase()}`);
  };

  const COPY_TARGETS_KEY = ["dashboard-copy-targets"] as const;

  const { data: targetsData, isLoading: targetsLoading } = useQuery({
    queryKey: COPY_TARGETS_KEY,
    queryFn: fetchCopyTargets,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const { data: walletsData } = useQuery({
    queryKey: ["dashboard-copy-traded-enrichment", timePeriod],
    queryFn: () =>
      fetchTopWallets({
        timePeriod,
        limit: LEADERBOARD_ENRICHMENT_LIMIT,
      }),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const deleteTargetMutation = useMutation({
    mutationFn: (id: string) => deleteCopyTarget(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: COPY_TARGETS_KEY }),
  });

  const tradersByWallet = useMemo(() => {
    const m = new Map<string, WalletTopTraderItem>();
    for (const t of walletsData?.traders ?? []) {
      m.set(t.proxyWallet.toLowerCase(), t);
    }
    return m;
  }, [walletsData]);

  const rows = useMemo(
    () =>
      buildCopyTradedWalletRows(targetsData?.targets ?? [], tradersByWallet),
    [targetsData, tradersByWallet]
  );

  const renderActions = (row: WalletRow): ReactElement | null => {
    if (!row.targetId) return null;
    const targetId = row.targetId;
    return (
      <button
        type="button"
        aria-label={`Untrack ${row.proxyWallet}`}
        title="Stop copy-trading this wallet"
        disabled={deleteTargetMutation.isPending}
        onClick={(e) => {
          e.stopPropagation();
          deleteTargetMutation.mutate(targetId);
        }}
        className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-success/20 hover:text-success disabled:cursor-wait disabled:opacity-40"
      >
        <Minus className="size-3.5" />
      </button>
    );
  };

  return (
    <Card>
      <CardHeader className="px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Copy-Traded Wallets
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
          wallets and isolated execution ship in Phase B (task.0318). Discover
          new wallets on{" "}
          <a
            href="/research"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Research
          </a>
          .
        </p>
        <WalletsTable
          rows={rows}
          variant="copy-traded"
          isLoading={targetsLoading}
          onRowClick={(row) => navigateToWallet(row.proxyWallet)}
          renderActions={renderActions}
          emptyMessage="No copy-traded wallets yet. Track some from Research."
        />
      </CardContent>
    </Card>
  );
}
