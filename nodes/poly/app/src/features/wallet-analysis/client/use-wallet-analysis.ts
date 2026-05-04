// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/client/use-wallet-analysis`
 * Purpose: React Query hook fanning out to the wallet-analysis slices on `GET /api/v1/poly/wallets/{addr}` — snapshot, trades, balance, and pnl — each with its own loading state so molecules can render the moment their slice arrives.
 * Scope: Client-side data hook. Maps the contract response to `WalletAnalysisData`. Does not render UI; does not perform mutations.
 * Invariants: Independent React Query keys per slice. Skeleton-first behaviour: callers receive `isLoading: true` immediately and a partial `data` shape that fills in as slices land.
 * Side-effects: IO (HTTP fetch).
 * Notes: The address is lowercased before fetch; coalesce + p-limit live server-side in `wallet-analysis-service`.
 * Links: docs/design/wallet-analysis-components.md, work/items/task.0344.wallet-row-drawer.md
 * @public
 */

"use client";

import type {
  PolyWalletOverviewInterval,
  WalletAnalysisBalance,
  WalletAnalysisBenchmark,
  WalletAnalysisDistributions,
  WalletAnalysisPnl,
  WalletAnalysisResponse,
  WalletAnalysisSnapshot,
  WalletAnalysisTrades,
} from "@cogni/poly-node-contracts";
import { useQuery } from "@tanstack/react-query";

import type {
  WalletAnalysisData,
  WalletDistributionsRangeMode,
} from "../types/wallet-analysis";

/** 30s cache mirrors the server-side coalesce TTL — refetches naturally on window focus. */
const SLICE_STALE_MS = 30_000;

async function fetchSlice<
  TKey extends
    | "snapshot"
    | "trades"
    | "balance"
    | "pnl"
    | "distributions"
    | "benchmark",
>(
  addr: string,
  slice: TKey,
  interval: PolyWalletOverviewInterval,
  distributionMode?: WalletDistributionsRangeMode
): Promise<WalletAnalysisResponse> {
  const params = new URLSearchParams({ include: slice, interval });
  if (slice === "distributions" && distributionMode) {
    params.set("distributionMode", distributionMode);
  }
  const url = `/api/v1/poly/wallets/${addr.toLowerCase()}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${slice} fetch failed: ${res.status}`);
  return (await res.json()) as WalletAnalysisResponse;
}

export type UseWalletAnalysisOptions = {
  /** Defaults to "ALL". */
  interval?: PolyWalletOverviewInterval;
  /** When true, the hook also fetches the `distributions` slice. Default false. */
  includeDistributions?: boolean;
  /** Live (24-48h on-demand) or historical (Doltgres). Default "live". */
  distributionMode?: WalletDistributionsRangeMode;
};

export type UseWalletAnalysisResult = {
  /** Always non-null — partial fields stream in as slices arrive. */
  data: WalletAnalysisData;
  isLoading: {
    snapshot: boolean;
    trades: boolean;
    balance: boolean;
    pnl: boolean;
    distributions: boolean;
    benchmark: boolean;
  };
  isError: {
    snapshot: boolean;
    trades: boolean;
    balance: boolean;
    pnl: boolean;
    distributions: boolean;
    benchmark: boolean;
  };
};

/**
 * Independent React Query calls keyed by addr + slice. Returns a
 * `WalletAnalysisData` whose fields populate as each slice resolves.
 *
 * @param addr  0x wallet (lowercased internally)
 * @param enabled  pause fetches when the consumer (e.g. drawer) is closed
 */
export function useWalletAnalysis(
  addr: string | null,
  enabled = true,
  intervalOrOpts: PolyWalletOverviewInterval | UseWalletAnalysisOptions = "ALL"
): UseWalletAnalysisResult {
  const opts: UseWalletAnalysisOptions =
    typeof intervalOrOpts === "string"
      ? { interval: intervalOrOpts }
      : intervalOrOpts;
  const interval = opts.interval ?? "ALL";
  const includeDistributions = opts.includeDistributions ?? false;
  const distributionMode = opts.distributionMode ?? "live";
  const lower = addr?.toLowerCase() ?? "";
  const active = enabled && Boolean(lower);

  const snapshot = useQuery({
    queryKey: ["wallet", lower, "snapshot"],
    queryFn: () => fetchSlice(lower, "snapshot", interval),
    enabled: active,
    staleTime: SLICE_STALE_MS,
  });
  const trades = useQuery({
    queryKey: ["wallet", lower, "trades"],
    queryFn: () => fetchSlice(lower, "trades", interval),
    enabled: active,
    staleTime: SLICE_STALE_MS,
  });
  const balance = useQuery({
    queryKey: ["wallet", lower, "balance"],
    queryFn: () => fetchSlice(lower, "balance", interval),
    enabled: active,
    staleTime: SLICE_STALE_MS,
  });
  const pnl = useQuery({
    queryKey: ["wallet", lower, "pnl", interval],
    queryFn: () => fetchSlice(lower, "pnl", interval),
    enabled: active,
    staleTime: SLICE_STALE_MS,
  });
  const distributions = useQuery({
    queryKey: ["wallet", lower, "distributions", distributionMode],
    queryFn: () =>
      fetchSlice(lower, "distributions", interval, distributionMode),
    enabled: active && includeDistributions,
    staleTime: SLICE_STALE_MS,
  });
  const benchmark = useQuery({
    queryKey: ["wallet", lower, "benchmark", interval],
    queryFn: () => fetchSlice(lower, "benchmark", interval),
    enabled: active,
    staleTime: SLICE_STALE_MS,
  });

  const data = mapToView(
    lower,
    snapshot.data,
    trades.data,
    balance.data,
    pnl.data,
    distributions.data,
    benchmark.data
  );

  return {
    data,
    isLoading: {
      snapshot: snapshot.isLoading,
      trades: trades.isLoading,
      balance: balance.isLoading,
      pnl: pnl.isLoading,
      distributions: includeDistributions ? distributions.isLoading : false,
      benchmark: benchmark.isLoading,
    },
    isError: {
      snapshot: snapshot.isError,
      trades: trades.isError,
      balance: balance.isError,
      pnl: pnl.isError,
      distributions: includeDistributions ? distributions.isError : false,
      benchmark: benchmark.isError,
    },
  };
}

function mapToView(
  addr: string,
  snapResp: WalletAnalysisResponse | undefined,
  tradesResp: WalletAnalysisResponse | undefined,
  balanceResp: WalletAnalysisResponse | undefined,
  pnlResp: WalletAnalysisResponse | undefined,
  distributionsResp: WalletAnalysisResponse | undefined,
  benchmarkResp: WalletAnalysisResponse | undefined
): WalletAnalysisData {
  const snapshot = mapSnapshot(snapResp?.snapshot);
  const trades = mapTrades(tradesResp?.trades);
  const balance = mapBalance(balanceResp?.balance);
  const pnl = mapPnl(pnlResp?.pnl);
  const distributions: WalletAnalysisDistributions | undefined =
    distributionsResp?.distributions;
  const benchmark = mapBenchmark(benchmarkResp?.benchmark);
  const inferredCategory = trades
    ? inferCategoryFromMarkets(trades.topMarkets)
    : undefined;
  const isOperator = balance?.isOperator === true;

  return {
    address: addr,
    identity: {
      ...(isOperator
        ? { name: "Operator Wallet" }
        : { name: `Wallet ${addr.slice(0, 6)}…${addr.slice(-4)}` }),
      ...(inferredCategory && { category: inferredCategory }),
      isPrimaryTarget: false,
    },
    ...(snapshot && { snapshot }),
    ...(trades && { trades }),
    ...(balance && { balance: pickBalance(balance) }),
    ...(pnl && { pnl }),
    ...(distributions && { distributions }),
    ...(benchmark && { benchmark }),
  };
}

function mapSnapshot(
  s: WalletAnalysisSnapshot | undefined
): WalletAnalysisData["snapshot"] | undefined {
  if (!s) return undefined;
  return {
    n: s.resolvedPositions,
    wr: s.trueWinRatePct,
    medianDur:
      s.medianDurationHours !== null
        ? formatDuration(s.medianDurationHours)
        : "—",
    avgPerDay: s.tradesPerDay30d > 0 ? Math.round(s.tradesPerDay30d) : null,
    ...(s.hypothesisMd !== null && { hypothesisMd: s.hypothesisMd }),
  };
}

function mapTrades(
  t: WalletAnalysisTrades | undefined
): WalletAnalysisData["trades"] | undefined {
  if (!t) return undefined;
  return {
    last: t.recent.slice(0, 5).map((x) => ({
      ts: formatTs(x.timestampSec),
      side: x.side,
      size: x.size.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      px: x.price.toFixed(3),
      mkt: x.marketTitle ?? `(market ${x.conditionId.slice(0, 6)}…)`,
    })),
    dailyCounts: t.dailyCounts.map((d) => ({ d: d.day.slice(5), n: d.n })),
    topMarkets: t.topMarkets.slice(0, 4),
  };
}

function mapBalance(
  b: WalletAnalysisBalance | undefined
): (WalletAnalysisBalance & { positions: number; total: number }) | undefined {
  if (!b) return undefined;
  return b;
}

function pickBalance(b: WalletAnalysisBalance) {
  return {
    available: b.available ?? 0,
    locked: b.locked ?? 0,
    positions: b.positions,
    total: b.total,
  };
}

function mapPnl(
  pnl: WalletAnalysisPnl | undefined
): WalletAnalysisData["pnl"] | undefined {
  if (!pnl) return undefined;
  return {
    interval: pnl.interval,
    history: pnl.history,
  };
}

function mapBenchmark(
  benchmark: WalletAnalysisBenchmark | undefined
): WalletAnalysisData["benchmark"] | undefined {
  if (!benchmark) return undefined;
  return benchmark;
}

function inferCategoryFromMarkets(
  markets: ReadonlyArray<string>
): string | undefined {
  const t = markets.join(" ").toLowerCase();
  if (t.includes("temperature") || t.includes("high temp")) return "Weather";
  if (t.includes("nba") || t.includes("nfl") || t.includes("mlb"))
    return "Sports";
  if (t.includes("election") || t.includes("trump") || t.includes("biden"))
    return "Politics";
  if (t.includes("btc") || t.includes("eth") || t.includes("bitcoin"))
    return "Crypto";
  return undefined;
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}
function formatTs(sec: number): string {
  return new Date(sec * 1_000)
    .toISOString()
    .slice(5, 16)
    .replace("T", " ")
    .concat("Z");
}
