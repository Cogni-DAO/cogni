// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/research/view`
 * Purpose: Wallets browse dashboard — search + faceted filters + clickable data grid, modelled on `/work` for component consistency.
 * Scope: Client view. Joins live leaderboard (fetchTopWallets) with the user's tracked targets (fetchCopyTargets) and renders a TanStack data grid. Click row → /research/w/[addr]. Does not place orders.
 * Invariants: KIT_IS_ONLY_API, MOBILE_FIRST, URL_DRIVEN_STATE, COPY_TARGETS_QUERY_KEY shared with TopWalletsCard so flips reflect across surfaces.
 * Side-effects: IO (React Query — fetchTopWallets + fetchCopyTargets).
 * Links: [ResearchPage](./page.tsx), work/items/task.0343.wallets-dashboard-page.md
 * @public
 */

"use client";

import type { WalletTimePeriod } from "@cogni/ai-tools";
import { useQuery } from "@tanstack/react-query";
import {
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { Ban, Shield } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { Input } from "@/components";
import {
  DataGrid,
  DataGridContainer,
} from "@/components/reui/data-grid/data-grid";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import {
  WalletDetailDrawer,
  WalletQuickJump,
} from "@/features/wallet-analysis";

import { fetchCopyTargets } from "../dashboard/_api/fetchCopyTargets";
import { fetchTopWallets } from "../dashboard/_api/fetchTopWallets";

// NOTE: when PR #965 (copy-trade toggle) merges, both the helper and the
// shared query key will move into `@/features/wallet-analysis/client/
// copy-trade-targets`. Rebase swaps these two imports for one.
const COPY_TARGETS_QUERY_KEY = ["dashboard-copy-targets"] as const;

import { FacetedFilter } from "../work/_components/FacetedFilter";
import {
  buildWalletRows,
  columns,
  WALLET_CATEGORIES,
} from "./_components/columns";

const PERIOD_OPTIONS: readonly WalletTimePeriod[] = [
  "DAY",
  "WEEK",
  "MONTH",
  "ALL",
] as const;
const TRACKED_OPTIONS = ["Tracked", "Not tracked"] as const;
const TOP_N = 50;

export function ResearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── URL-driven state ──────────────────────────────────────────────
  const initialPeriod = useMemo<WalletTimePeriod>(() => {
    const p = searchParams.get("period");
    return PERIOD_OPTIONS.includes(p as WalletTimePeriod)
      ? (p as WalletTimePeriod)
      : "WEEK";
  }, [searchParams]);

  const initialFilters = useMemo<ColumnFiltersState>(() => {
    const out: ColumnFiltersState = [];
    const cat = searchParams.get("category");
    if (cat) out.push({ id: "category", value: cat.split(",") });
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
  const { data: walletsData, isLoading: walletsLoading } = useQuery({
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

  const rows = useMemo(
    () => buildWalletRows(walletsData?.traders ?? [], trackedSet),
    [walletsData, trackedSet]
  );

  // ── Table ─────────────────────────────────────────────────────────
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      setSorting(next);
      syncUrl({ sorting: next });
    },
    onColumnFiltersChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(columnFilters) : updater;
      setColumnFilters(next);
      syncUrl({ filters: next });
    },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: (row, _id, filterValue: string) => {
      const q = filterValue.toLowerCase().trim();
      if (!q) return true;
      const r = row.original;
      return (
        r.proxyWallet.toLowerCase().includes(q) ||
        (r.userName ?? "").toLowerCase().includes(q)
      );
    },
  });

  const setFacet = (id: string, values: string[]): void => {
    const next = columnFilters.filter((f) => f.id !== id);
    if (values.length > 0) next.push({ id, value: values });
    setColumnFilters(next);
    syncUrl({ filters: next });
  };

  const activeCategoryFilter =
    (columnFilters.find((f) => f.id === "category")?.value as string[]) ?? [];
  const activeTrackedFilter =
    (columnFilters.find((f) => f.id === "tracked")?.value as string[]) ?? [];

  return (
    <div className="flex flex-col gap-4 p-5 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="font-semibold text-xl tracking-tight md:text-2xl">
          Wallets · Research
        </h1>
        <p className="max-w-2xl text-muted-foreground text-sm">
          Browse top Polymarket wallets. Filter by category or tracked status,
          search by address. Click any row to open its full live analysis.
        </p>
      </div>

      {/* Quick-jump for off-roster addresses */}
      <WalletQuickJump className="max-w-xl" />

      {/* Toolbar — same shape as /work */}
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
        <FacetedFilter
          title="Period"
          options={[...PERIOD_OPTIONS]}
          selected={[period]}
          onChange={(v) => {
            const next = (v[0] as WalletTimePeriod | undefined) ?? "WEEK";
            setPeriod(next);
            syncUrl({ period: next });
          }}
        />
        <FacetedFilter
          title="Category"
          options={[...WALLET_CATEGORIES]}
          selected={activeCategoryFilter}
          onChange={(v) => setFacet("category", v)}
        />
        <FacetedFilter
          title="Tracked"
          options={[...TRACKED_OPTIONS]}
          selected={activeTrackedFilter}
          onChange={(v) => setFacet("tracked", v)}
        />
        {(columnFilters.length > 0 || globalFilter || period !== "WEEK") && (
          <button
            type="button"
            className="text-muted-foreground text-xs underline hover:text-foreground"
            onClick={() => {
              setColumnFilters([]);
              setGlobalFilter("");
              setPeriod("WEEK");
              router.replace("/research", { scroll: false });
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Grid */}
      {walletsLoading ? (
        <p className="py-8 text-center text-muted-foreground">
          Loading wallets…
        </p>
      ) : (
        <DataGrid
          table={table}
          recordCount={rows.length}
          isLoading={walletsLoading}
          onRowClick={(row) => setSelectedAddr(row.proxyWallet.toLowerCase())}
          tableLayout={{
            headerSticky: true,
            headerBackground: true,
            rowBorder: true,
            dense: true,
          }}
          tableClassNames={{ bodyRow: "cursor-pointer" }}
          emptyMessage="No wallets match the current filters."
        >
          <DataGridContainer className="overflow-x-auto">
            <DataGridTable />
          </DataGridContainer>
          <DataGridPagination sizes={[25, 50, 100]} />
        </DataGrid>
      )}

      {/* Compact no-fly footer (replaces the old multi-section dossier) */}
      <NoFlyFooter />

      {/* Inline drawer — keeps the table context, skeletons render instantly. */}
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
