// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/research/view`
 * Purpose: Wallets research portal — search, per-column sort/filter, pagination,
 *          track/untrack actions, and the side-sheet drawer drill-in. Full
 *          discovery surface for Polymarket wallets. Renders the app-wide
 *          `WalletsTable` component (variant="full").
 * Scope: Client view. Joins live leaderboard (`fetchTopWallets`) with the user's
 *        tracked targets (`fetchCopyTargets`) and passes rows into the shared
 *        table. Track/untrack mutations live here. Does not place orders.
 * Invariants:
 *   - WALLET_TABLE_SINGLETON: renders via `@app/(app)/_components/wallets-table`.
 *     Sort/filter/hide controls live in each column header (reui kit) —
 *     no parallel toolbar chips.
 *   - URL_DRIVEN_STATE: q / period / tracked / sort all round-trip through
 *     the URL for shareable views.
 *   - COPY_TARGETS_QUERY_KEY shared with the dashboard's CopyTradedWalletsCard so
 *     flips reflect across surfaces.
 * Side-effects: IO (React Query — fetchTopWallets, fetchCopyTargets,
 *               createCopyTarget, deleteCopyTarget).
 * @public
 */

"use client";

import { PolyAddressSchema } from "@cogni/node-contracts";
import type { WalletTimePeriod } from "@cogni/poly-ai-tools";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";
import { Ban, Plus, Radio, Shield } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  buildWalletRows,
  type WalletRow,
  WalletsTable,
} from "@/app/(app)/_components/wallets-table";
import { Input, ToggleGroup, ToggleGroupItem } from "@/components";
import {
  WalletDetailDrawer,
  WalletQuickJump,
} from "@/features/wallet-analysis";

import {
  createCopyTarget,
  deleteCopyTarget,
  fetchCopyTargets,
} from "../dashboard/_api/fetchCopyTargets";
import { fetchTopWallets } from "../dashboard/_api/fetchTopWallets";

const COPY_TARGETS_QUERY_KEY = ["dashboard-copy-targets"] as const;

const PERIOD_OPTIONS: readonly WalletTimePeriod[] = [
  "DAY",
  "WEEK",
  "MONTH",
  "ALL",
] as const;
const TOP_N = 100;

export function ResearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // ── URL-driven state ──────────────────────────────────────────────
  const initialPeriod = useMemo<WalletTimePeriod>(() => {
    const p = searchParams.get("period");
    return PERIOD_OPTIONS.includes(p as WalletTimePeriod)
      ? (p as WalletTimePeriod)
      : "WEEK";
  }, [searchParams]);

  const initialFilters = useMemo<ColumnFiltersState>(() => {
    const out: ColumnFiltersState = [];
    const trk = searchParams.get("tracked");
    if (trk) out.push({ id: "tracked", value: trk.split(",") });
    return out;
  }, [searchParams]);

  const initialSort = useMemo<SortingState>(() => {
    const s = searchParams.get("sort");
    if (!s) return [{ id: "rank", desc: false }];
    const desc = s.startsWith("-");
    return [{ id: desc ? s.slice(1) : s, desc }];
  }, [searchParams]);

  const [period, setPeriod] = useState<WalletTimePeriod>(initialPeriod);
  const [columnFilters, setColumnFilters] =
    useState<ColumnFiltersState>(initialFilters);
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [globalFilter, setGlobalFilter] = useState(searchParams.get("q") ?? "");
  const [selectedAddr, setSelectedAddr] = useState<string | null>(null);

  const syncUrl = useCallback(
    (next: {
      period?: WalletTimePeriod;
      filters?: ColumnFiltersState;
      sorting?: SortingState;
      q?: string;
    }) => {
      const params = new URLSearchParams();
      const p = next.period ?? period;
      if (p !== "WEEK") params.set("period", p);
      for (const f of next.filters ?? columnFilters) {
        if (Array.isArray(f.value) && f.value.length > 0) {
          params.set(f.id, (f.value as string[]).join(","));
        }
      }
      const s = (next.sorting ?? sorting)[0];
      if (s && !(s.id === "rank" && !s.desc)) {
        params.set("sort", s.desc ? `-${s.id}` : s.id);
      }
      const q = next.q ?? globalFilter;
      if (q) params.set("q", q);
      const qs = params.toString();
      router.replace(qs ? `/research?${qs}` : "/research", { scroll: false });
    },
    [period, columnFilters, sorting, globalFilter, router]
  );

  // ── Data ──────────────────────────────────────────────────────────
  const {
    data: walletsData,
    isLoading: walletsLoading,
    isError: walletsError,
  } = useQuery({
    queryKey: ["research-top-wallets", period],
    queryFn: () => fetchTopWallets({ timePeriod: period, limit: TOP_N }),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const { data: targetsData } = useQuery({
    queryKey: COPY_TARGETS_QUERY_KEY,
    queryFn: fetchCopyTargets,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const trackedSet = useMemo(
    () =>
      new Set(
        (targetsData?.targets ?? []).map((t) => t.target_wallet.toLowerCase())
      ),
    [targetsData]
  );

  const targetsByWallet = useMemo(
    () =>
      new Map(
        (targetsData?.targets ?? []).map((t) => [
          t.target_wallet.toLowerCase(),
          t,
        ])
      ),
    [targetsData]
  );

  const rows = useMemo(
    () => buildWalletRows(walletsData?.traders ?? [], trackedSet),
    [walletsData, trackedSet]
  );

  // ── Mutations (track / untrack) ───────────────────────────────────
  const createTargetMutation = useMutation({
    mutationFn: (targetWallet: string) =>
      createCopyTarget({ target_wallet: targetWallet }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: COPY_TARGETS_QUERY_KEY }),
  });

  const deleteTargetMutation = useMutation({
    mutationFn: (id: string) => deleteCopyTarget(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: COPY_TARGETS_QUERY_KEY }),
  });

  const renderActions = useCallback(
    (row: WalletRow) => {
      const target = targetsByWallet.get(row.proxyWallet.toLowerCase());
      if (row.tracked && target) {
        return (
          <button
            type="button"
            aria-label={`Untrack ${row.proxyWallet}`}
            title="Stop copy-trading this wallet (click the green icon to unfollow)"
            disabled={deleteTargetMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              deleteTargetMutation.mutate(target.target_id);
            }}
            className="inline-flex size-7 items-center justify-center rounded text-success hover:bg-destructive/10 hover:text-destructive disabled:cursor-wait disabled:opacity-40"
          >
            <Radio className="size-3.5 animate-pulse" />
          </button>
        );
      }
      return (
        <button
          type="button"
          aria-label={`Track ${row.proxyWallet}`}
          title="Track this wallet (mirror its fills)"
          disabled={createTargetMutation.isPending}
          onClick={(e) => {
            e.stopPropagation();
            createTargetMutation.mutate(row.proxyWallet);
          }}
          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:cursor-wait disabled:opacity-40"
        >
          <Plus className="size-3.5" />
        </button>
      );
    },
    [createTargetMutation, deleteTargetMutation, targetsByWallet]
  );

  // ── Off-roster address jump ───────────────────────────────────────
  // If the search box contains a full valid 0x address not present in the
  // current leaderboard window, surface a direct-analyze affordance so the
  // user is never limited to the in-memory top-N.
  const addressMatch = useMemo(
    () => PolyAddressSchema.safeParse(globalFilter.trim()),
    [globalFilter]
  );
  const offRosterAddress =
    addressMatch.success &&
    !rows.some(
      (r) => r.proxyWallet.toLowerCase() === addressMatch.data.toLowerCase()
    )
      ? addressMatch.data
      : null;

  return (
    <div className="flex flex-col gap-4 p-5 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="font-semibold text-xl tracking-tight md:text-2xl">
          Wallets · Research
        </h1>
        <p className="max-w-2xl text-muted-foreground text-sm">
          Browse top Polymarket wallets. Click any column header to sort,
          filter, or hide — all controls live on the column itself.
        </p>
      </div>

      {/* Quick-jump for off-roster addresses (persistent affordance) */}
      <WalletQuickJump className="max-w-xl" />

      {/* Minimal toolbar: search + period (drives the leaderboard query).
          Sort/filter/hide are in the column headers — not here. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          data-search-input
          className="h-9 w-full sm:w-72"
          placeholder="Search wallet address or name…"
          value={globalFilter}
          onChange={(e) => {
            setGlobalFilter(e.target.value);
            syncUrl({ q: e.target.value });
          }}
        />
        <ToggleGroup
          type="single"
          value={period}
          onValueChange={(v) => {
            const next = (v as WalletTimePeriod | "") || "WEEK";
            if (!PERIOD_OPTIONS.includes(next)) return;
            setPeriod(next);
            syncUrl({ period: next });
          }}
          className="rounded-lg border"
        >
          {PERIOD_OPTIONS.map((p) => (
            <ToggleGroupItem key={p} value={p} className="px-3 text-xs">
              {p === "ALL" ? "All" : p.charAt(0) + p.slice(1).toLowerCase()}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Off-roster address hint — "you pasted a valid 0x, open its analysis" */}
      {offRosterAddress && (
        <button
          type="button"
          onClick={() => setSelectedAddr(offRosterAddress)}
          className="self-start rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-left text-sm hover:bg-primary/10"
        >
          Open wallet analysis for{" "}
          <code className="font-mono">{offRosterAddress}</code> · not in top{" "}
          {TOP_N} for this window →
        </button>
      )}

      {/* Grid — single shared component, same on /dashboard */}
      <WalletsTable
        rows={rows}
        variant="full"
        isLoading={walletsLoading}
        onRowClick={(row) => setSelectedAddr(row.proxyWallet.toLowerCase())}
        renderActions={renderActions}
        emptyMessage={
          walletsError
            ? "Failed to load wallets — Polymarket may be slow. Try refreshing."
            : "No wallets match the current filters."
        }
        fullState={{
          sorting,
          onSortingChange: (next) => {
            setSorting(next);
            syncUrl({ sorting: next });
          },
          columnFilters,
          onColumnFiltersChange: (next) => {
            setColumnFilters(next);
            syncUrl({ filters: next });
          },
          globalFilter,
          onGlobalFilterChange: setGlobalFilter,
        }}
      />

      {/* Compact no-fly footer */}
      <NoFlyFooter />

      {/* Inline drawer — skeletons render instantly. */}
      <WalletDetailDrawer
        addr={selectedAddr}
        open={selectedAddr !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedAddr(null);
        }}
      />
    </div>
  );
}

function NoFlyFooter() {
  return (
    <aside className="mt-4 grid gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm md:grid-cols-2">
      <div className="flex gap-3">
        <Ban className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="font-semibold">Do not mirror</p>
          <ul className="text-muted-foreground text-xs leading-relaxed">
            <li>
              <code>JPMorgan101</code> — sub-block latency arb, uncopyable
            </li>
            <li>
              <code>denizz</code> — Iran-ceasefire specialist, Harvard-flagged
              category
            </li>
            <li>
              <code>avenger</code> — single-bet outlier, not skill
            </li>
            <li>generic whales — capital, not edge</li>
          </ul>
        </div>
      </div>
      <div className="flex gap-3">
        <Shield className="mt-0.5 size-4 shrink-0 text-success" />
        <div className="space-y-1 text-xs leading-relaxed">
          <p className="font-semibold text-foreground text-sm">
            Compliance gate
          </p>
          <p className="text-muted-foreground">
            Cross-check every wallet against the{" "}
            <a
              href="https://corpgov.law.harvard.edu/2026/03/25/from-iran-to-taylor-swift-informed-trading-in-prediction-markets/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              Harvard 2026 flagged-wallet dataset
            </a>{" "}
            (210k pairs) before mirroring real money. Single correctness gate,
            zero runtime cost.
          </p>
        </div>
      </div>
    </aside>
  );
}
