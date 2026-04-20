// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/wallet-analysis-service`
 * Purpose: Service layer feeding the `/api/v1/poly/wallets/[addr]` route — fetches the three slices (snapshot, trades, balance) via the existing `PolymarketDataApiClient` + CLOB public client, joined by `computeWalletMetrics`. All upstream calls are bounded by a process-wide `p-limit(4)` and per-(slice, addr) coalesced under a 30 s TTL.
 * Scope: Compute + I/O only. Does not authenticate, does not parse HTTP. Returns Zod-validated slice values per the wallet-analysis v1 contract.
 * Invariants:
 *   - REUSE_PACKAGE_CLIENTS: all upstream HTTP goes through `@cogni/market-provider` clients — no fetch in this file.
 *   - DETERMINISTIC_METRICS: snapshot math is identical to `computeWalletMetrics` (spike.0323 v3).
 *   - PARTIAL_FAILURE_NEVER_THROWS: each slice returns a `{ value | warning }` result; the route surfaces warnings without 5xx-ing.
 * Side-effects: IO (Polymarket Data API + Polymarket CLOB public).
 * Notes: Cache is process-scoped — see `instrumentation.ts` single-replica boot assert.
 * Links: docs/design/wallet-analysis-components.md, packages/market-provider/src/analysis/wallet-metrics.ts, packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts
 * @public
 */

import {
  PolymarketClobPublicClient,
  PolymarketDataApiClient,
} from "@cogni/market-provider/adapters/polymarket";
import {
  computeWalletMetrics,
  type MarketResolutionInput,
} from "@cogni/market-provider/analysis";
import type {
  WalletAnalysisBalance,
  WalletAnalysisSnapshot,
  WalletAnalysisTrades,
  WalletAnalysisWarning,
} from "@cogni/node-contracts";
import pLimit from "p-limit";
import { coalesce } from "./coalesce";

/** Cache TTL for every slice. Matches design doc 30 s. */
const SLICE_TTL_MS = 30_000;

/** Per-process upstream concurrency cap — design invariant `p-limit(4)`. */
const upstreamLimit = pLimit(4);

/** Trades fetched per analysis request (`computeWalletMetrics` accepts up to ~500 per the Data API cap). */
const TRADE_FETCH_LIMIT = 500;

/** Operator wallet from env, lowercased (or undefined when unset). Read once per call to stay test-friendly. */
function getOperatorAddrLower(): string | undefined {
  // biome-ignore lint/style/noProcessEnv: hot-read for test isolation; full env framework would be over-engineering for one var
  return process.env.POLY_PROTO_WALLET_ADDRESS?.toLowerCase();
}

/**
 * Module-singleton clients — created lazily so test code can `vi.mock` either of them
 * before first use. Public-only access; no auth/credentials involved.
 */
let dataApiClient: PolymarketDataApiClient | undefined;
let clobPublicClient: PolymarketClobPublicClient | undefined;

function getDataApiClient(): PolymarketDataApiClient {
  if (!dataApiClient) dataApiClient = new PolymarketDataApiClient();
  return dataApiClient;
}
function getClobPublicClient(): PolymarketClobPublicClient {
  if (!clobPublicClient) clobPublicClient = new PolymarketClobPublicClient();
  return clobPublicClient;
}

/** Test-only: replace the module-singleton clients with stubs. */
export function __setClientsForTests(opts: {
  dataApi?: PolymarketDataApiClient;
  clobPublic?: PolymarketClobPublicClient;
}): void {
  dataApiClient = opts.dataApi ?? dataApiClient;
  clobPublicClient = opts.clobPublic ?? clobPublicClient;
}

export type SliceResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "warn"; warning: WalletAnalysisWarning };

/** Fetch + return the trades slice. Coalesced + p-limited. */
export async function getTradesSlice(
  addr: string
): Promise<SliceResult<WalletAnalysisTrades>> {
  try {
    const trades = await coalesce(
      `trades:${addr}`,
      () =>
        upstreamLimit(() =>
          getDataApiClient().listUserActivity(addr, {
            limit: TRADE_FETCH_LIMIT,
          })
        ),
      SLICE_TTL_MS
    );
    const dailyCounts = buildDailyCounts(trades, 14);
    const topMarkets = buildTopMarkets(trades, 4);
    const recent = trades.slice(0, 50).map((t) => ({
      timestampSec: t.timestamp,
      side: t.side,
      conditionId: t.conditionId,
      asset: t.asset,
      size: t.size,
      price: t.price,
      marketTitle: t.title || null,
    }));
    return {
      kind: "ok",
      value: {
        recent,
        dailyCounts,
        topMarkets,
        computedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return {
      kind: "warn",
      warning: warning("trades", err),
    };
  }
}

/** Compute the snapshot (deterministic metrics) slice. Coalesced + p-limited. */
export async function getSnapshotSlice(
  addr: string
): Promise<SliceResult<WalletAnalysisSnapshot>> {
  try {
    const trades = await coalesce(
      `trades:${addr}`,
      () =>
        upstreamLimit(() =>
          getDataApiClient().listUserActivity(addr, {
            limit: TRADE_FETCH_LIMIT,
          })
        ),
      SLICE_TTL_MS
    );

    const cids = [...new Set(trades.map((t) => t.conditionId))];
    const resolutions = new Map<string, MarketResolutionInput>();
    await Promise.all(
      cids.map((cid) =>
        coalesce(
          `resolution:${cid}`,
          () =>
            upstreamLimit(() => getClobPublicClient().getMarketResolution(cid)),
          // Resolutions are immutable once `closed=true`, but we keep a short
          // TTL so we re-poll markets that aren't closed yet.
          SLICE_TTL_MS
        ).then((r) => {
          if (r) resolutions.set(cid, r);
        })
      )
    );

    const m = computeWalletMetrics(trades, resolutions);
    return {
      kind: "ok",
      value: {
        resolvedPositions: m.resolvedPositions,
        wins: m.wins,
        losses: m.losses,
        trueWinRatePct: m.trueWinRatePct,
        realizedPnlUsdc: m.realizedPnlUsdc,
        realizedRoiPct: m.realizedRoiPct,
        maxDrawdownUsdc: m.maxDrawdownUsdc,
        maxDrawdownPctOfPeak: m.maxDrawdownPctOfPeak,
        peakEquityUsdc: m.peakEquityUsdc,
        medianDurationHours: m.medianDurationHours,
        openPositions: m.openPositions,
        openNetCostUsdc: m.openNetCostUsdc,
        uniqueMarkets: m.uniqueMarkets,
        tradesPerDay30d: m.tradesPerDay30d,
        daysSinceLastTrade: Number.isFinite(m.daysSinceLastTrade)
          ? m.daysSinceLastTrade
          : 0,
        topMarkets: [...m.topMarkets],
        dailyCounts: m.dailyCounts.map((d) => ({ day: d.day, n: d.n })),
        computedAt: new Date().toISOString(),
        // task.0333 swaps this for a Dolt read; null is a fine v0 default.
        hypothesisMd: null,
      },
    };
  } catch (err) {
    return {
      kind: "warn",
      warning: warning("snapshot", err),
    };
  }
}

/**
 * Dependency-injected hook for operator-only balance signals (USDC.e available, open-order
 * locked, POL gas). App layer owns this because it needs `getContainer()` + viem, which
 * feature layer can't import. Returns `null` fields when the caller can't or shouldn't read.
 */
export type FetchOperatorExtras = (operatorAddr: `0x${string}`) => Promise<{
  available: number | null;
  locked: number | null;
  polGas: number | null;
  errors: string[];
}>;

/** Balance slice — positions for any wallet; operator-only breakdown via injected fetcher. */
export async function getBalanceSlice(
  addr: string,
  fetchOperatorExtras?: FetchOperatorExtras
): Promise<SliceResult<WalletAnalysisBalance>> {
  try {
    const positions = await coalesce(
      `positions:${addr}`,
      () => upstreamLimit(() => getDataApiClient().listUserPositions(addr)),
      SLICE_TTL_MS
    );
    const positionsValue = positions.reduce(
      (s, p) => s + (p.currentValue ?? 0),
      0
    );
    const operator = getOperatorAddrLower();
    const isOperator = !!operator && operator === addr.toLowerCase();

    let available: number | undefined;
    let locked: number | undefined;
    if (isOperator && fetchOperatorExtras) {
      const extras = await fetchOperatorExtras(addr as `0x${string}`);
      if (extras.available !== null) available = extras.available;
      if (extras.locked !== null) locked = extras.locked;
    }

    const total = (available ?? 0) + (locked ?? 0) + positionsValue;
    return {
      kind: "ok",
      value: {
        ...(available !== undefined && { available }),
        ...(locked !== undefined && { locked }),
        positions: positionsValue,
        total,
        isOperator,
        computedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return {
      kind: "warn",
      warning: warning("balance", err),
    };
  }
}

function warning(
  slice: WalletAnalysisWarning["slice"],
  err: unknown
): WalletAnalysisWarning {
  return {
    slice,
    code: "upstream_failed",
    message: err instanceof Error ? err.message : String(err),
  };
}

function buildDailyCounts(
  trades: ReadonlyArray<{ timestamp: number }>,
  windowDays: number
): Array<{ day: string; n: number }> {
  const SEC_PER_DAY = 86_400;
  const nowSec = Math.floor(Date.now() / 1000);
  const buckets = new Map<string, number>();
  for (const t of trades) {
    const day = new Date(t.timestamp * 1_000).toISOString().slice(0, 10);
    buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  const out: Array<{ day: string; n: number }> = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const day = new Date((nowSec - i * SEC_PER_DAY) * 1_000)
      .toISOString()
      .slice(0, 10);
    out.push({ day, n: buckets.get(day) ?? 0 });
  }
  return out;
}

function buildTopMarkets(
  trades: ReadonlyArray<{
    conditionId: string;
    title: string;
    timestamp: number;
  }>,
  limit: number
): string[] {
  // Newest-first dedupe by conditionId.
  const seen = new Set<string>();
  const out: string[] = [];
  const sorted = [...trades].sort((a, b) => b.timestamp - a.timestamp);
  for (const t of sorted) {
    if (seen.has(t.conditionId) || !t.title) continue;
    seen.add(t.conditionId);
    out.push(t.title);
    if (out.length >= limit) break;
  }
  return out;
}
