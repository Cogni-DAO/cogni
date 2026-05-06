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
 *   - URL_DRIVEN_STATE: q / period / tracked / sort round-trip through the
 *     URL for shareable views. `pageInterval` (the research benchmark board's
 *     time window) is intentionally session-only today — adding it to the URL
 *     requires lifting state out of `ResearchBenchmarkBoard`; see bug.5026.
 *   - COPY_TARGETS_QUERY_KEY shared with the dashboard copy-target controls so flips
 *     reflect across surfaces.
 * Side-effects: IO (React Query — fetchTopWallets, fetchCopyTargets,
 *               createCopyTarget, deleteCopyTarget).
 * @public
 */

"use client";

import type { WalletTimePeriod } from "@cogni/poly-ai-tools";
import {
  PolyAddressSchema,
  type PolyResearchTargetOverlapResponse,
  type PolyResearchTraderComparisonResponse,
  type PolyWalletOverviewInterval,
  type PolyWalletStatusOutput,
  type WalletAnalysisDistributions,
  type WalletAnalysisResponse,
} from "@cogni/poly-node-contracts";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ColumnFiltersState, SortingState } from "@tanstack/react-table";
import { Ban, Plus, Radio, Search, Shield } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  buildWalletRows,
  type WalletRow,
  WalletsTable,
} from "@/app/(app)/_components/wallets-table";
import { Input, ToggleGroup, ToggleGroupItem } from "@/components";
import {
  DistributionComparisonBlock,
  type DistributionComparisonSeries,
  type ResearchComparisonViewKey,
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
const PRIMARY_RESEARCH_WALLETS = [
  {
    label: "RN1",
    address: "0x2005d16a84ceefa912d4e380cd32e7ff827875ea",
  },
  {
    label: "swisstony",
    address: "0x204f72f35326db932158cba6adff0b9a1da95e14",
  },
] as const;

type ResearchComparisonWallet = {
  label: string;
  address: string;
};

async function fetchWalletStatus(): Promise<PolyWalletStatusOutput> {
  const res = await fetch("/api/v1/poly/wallet/status", {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`wallet status failed: ${res.status}`);
  }
  return (await res.json()) as PolyWalletStatusOutput;
}

async function fetchWalletDistributions(
  address: string
): Promise<WalletAnalysisDistributions | undefined> {
  const params = new URLSearchParams({
    include: "distributions",
    interval: "ALL",
    distributionMode: "historical",
  });
  const res = await fetch(
    `/api/v1/poly/wallets/${address.toLowerCase()}?${params.toString()}`
  );
  if (!res.ok) {
    throw new Error(`wallet distributions failed: ${res.status}`);
  }
  const json = (await res.json()) as WalletAnalysisResponse;
  return json.distributions;
}

async function fetchTraderComparison(params: {
  wallets: readonly ResearchComparisonWallet[];
  interval: PolyWalletOverviewInterval;
}): Promise<PolyResearchTraderComparisonResponse> {
  const search = new URLSearchParams({ interval: params.interval });
  for (const wallet of params.wallets.slice(0, 3)) {
    search.append("wallet", wallet.address);
    search.append("label", wallet.label);
  }
  const res = await fetch(
    `/api/v1/poly/research/trader-comparison?${search.toString()}`,
    {
      credentials: "include",
    }
  );
  if (!res.ok) {
    throw new Error(`trader comparison failed: ${res.status}`);
  }
  return (await res.json()) as PolyResearchTraderComparisonResponse;
}

async function fetchTargetOverlap(
  interval: PolyWalletOverviewInterval
): Promise<PolyResearchTargetOverlapResponse> {
  const params = new URLSearchParams({ interval });
  const res = await fetch(
    `/api/v1/poly/research/target-overlap?${params.toString()}`,
    {
      credentials: "include",
    }
  );
  if (!res.ok) {
    throw new Error(`target overlap failed: ${res.status}`);
  }
  return (await res.json()) as PolyResearchTargetOverlapResponse;
}

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

  const { data: walletStatus } = useQuery({
    queryKey: ["poly-wallet-status"],
    queryFn: fetchWalletStatus,
    staleTime: 10_000,
    gcTime: 60_000,
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
    <div className="flex flex-col gap-6 p-5 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="font-semibold text-xl tracking-tight md:text-2xl">
          Research
        </h1>
      </div>

      <ResearchBenchmarkBoard
        userWalletAddress={walletStatus?.funder_address ?? null}
        userWalletConnected={walletStatus?.connected === true}
        targets={targetsData?.targets ?? []}
      />

      <section className="flex flex-col gap-4 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
              <Search className="size-3.5" />
              Wallet Discovery
            </div>
            <h2 className="font-semibold text-lg">Search Polymarket wallets</h2>
          </div>
          <WalletQuickJump className="w-full max-w-xl sm:w-96" />
        </div>

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
      </section>

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

function ResearchBenchmarkBoard({
  userWalletAddress,
  userWalletConnected,
  targets,
}: {
  userWalletAddress: string | null;
  userWalletConnected: boolean;
  targets: readonly { target_wallet: string }[];
}) {
  const [activeResearchView, setActiveResearchView] =
    useState<ResearchComparisonViewKey>("targetOverlap");
  // PAGE_LEVEL_INTERVAL: one toggle drives every block on the research benchmark
  // board (target overlap, trader comparison, size/PnL). Per-block intervals are
  // a known anti-pattern — they let two charts on the same screen disagree about
  // "the time window" and erode trust on adjacent numbers.
  const [pageInterval, setPageInterval] =
    useState<PolyWalletOverviewInterval>("1W");
  const comparisonWallets = useMemo(
    () => buildComparisonWallets(userWalletAddress, targets),
    [userWalletAddress, targets]
  );
  const headlineWallets = useMemo(
    () => comparisonWallets.slice(0, 3),
    [comparisonWallets]
  );
  const traderComparisonActive = isTraderComparisonView(activeResearchView);
  const distributionComparisonActive =
    isDistributionComparisonView(activeResearchView);
  const {
    data: traderComparison,
    isLoading: traderComparisonLoading,
    isError: traderComparisonError,
  } = useQuery({
    queryKey: [
      "research-trader-comparison",
      pageInterval,
      headlineWallets.map((wallet) => wallet.address).join(","),
    ],
    queryFn: () =>
      fetchTraderComparison({
        wallets: headlineWallets,
        interval: pageInterval,
      }),
    enabled: traderComparisonActive && headlineWallets.length > 0,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
  const overlapQuery = useQuery({
    queryKey: ["research-target-overlap", pageInterval],
    queryFn: () => fetchTargetOverlap(pageInterval),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
  const distributionQueries = useQueries({
    queries: comparisonWallets.map((wallet) => ({
      queryKey: [
        "research-distribution-comparison",
        wallet.address.toLowerCase(),
      ],
      queryFn: () => fetchWalletDistributions(wallet.address),
      enabled: distributionComparisonActive,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    })),
  });
  const distributionSeries: readonly DistributionComparisonSeries[] =
    comparisonWallets.map((wallet, i) => ({
      label: wallet.label,
      data: distributionQueries[i]?.data,
      isLoading: distributionQueries[i]?.isLoading,
      isError: distributionQueries[i]?.isError,
    }));
  return (
    <section className="flex flex-col gap-3">
      {!userWalletAddress ? (
        <div className="flex justify-end">
          <Link
            href="/credits"
            className="rounded border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Add your wallet
          </Link>
        </div>
      ) : null}

      <div className="rounded-lg border bg-card p-4">
        <DistributionComparisonBlock
          activeView={activeResearchView}
          onActiveViewChange={setActiveResearchView}
          series={distributionSeries}
          targetOverlap={overlapQuery.data}
          targetOverlapLoading={overlapQuery.isLoading}
          targetOverlapError={overlapQuery.isError}
          targetOverlapInterval={pageInterval}
          onTargetOverlapIntervalChange={setPageInterval}
          traderComparison={traderComparison}
          traderComparisonLoading={traderComparisonLoading}
          traderComparisonError={traderComparisonError}
          traderInterval={pageInterval}
          onTraderIntervalChange={setPageInterval}
        />
        {!userWalletAddress ? (
          <p className="mt-3 text-muted-foreground text-xs">
            {userWalletConnected
              ? "Wallet is connected, but the funder address is not available yet."
              : "Add your wallet to include it in overlays."}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function isTraderComparisonView(view: ResearchComparisonViewKey): boolean {
  return (
    view === "traderPnl" ||
    view === "traderFills" ||
    view === "traderFlow" ||
    view === "traderSizePnl"
  );
}

function isDistributionComparisonView(
  view: ResearchComparisonViewKey
): boolean {
  return (
    view === "tradeSize" ||
    view === "entryPrice" ||
    view === "timeInPosition" ||
    view === "entriesPerOutcome" ||
    view === "hourOfDay" ||
    view === "betsPerMarket"
  );
}

function buildComparisonWallets(
  userWalletAddress: string | null,
  targets: readonly { target_wallet: string }[]
): readonly ResearchComparisonWallet[] {
  const wallets: ResearchComparisonWallet[] = [];
  const seen = new Set<string>();
  const addWallet = (wallet: ResearchComparisonWallet) => {
    const lower = wallet.address.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    wallets.push({ ...wallet, address: lower });
  };

  if (userWalletAddress) {
    addWallet({ label: "You", address: userWalletAddress });
  }
  for (const wallet of PRIMARY_RESEARCH_WALLETS) {
    addWallet(wallet);
  }
  for (const target of targets) {
    addWallet({
      label: shortAddress(target.target_wallet),
      address: target.target_wallet,
    });
  }

  return wallets;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
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
