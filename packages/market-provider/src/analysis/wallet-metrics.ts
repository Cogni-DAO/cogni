// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/analysis/wallet-metrics`
 * Purpose: Pure function that turns a wallet's raw trades + a map of resolved markets into realized metrics (win rate, ROI, PnL, max DD, median hold, trades/day, daily counts).
 * Scope: No I/O, no time, no randomness (now() injected for testability). Does not fetch trades, does not call CLOB, does not mutate inputs.
 * Invariants:
 *   - PURE: same inputs → same outputs.
 *   - Metric fields return `null` when `resolved.length < minResolvedForMetrics` (default 5) — callers decide how to render insufficient-data state.
 *   - Follows math frozen in `scripts/experiments/wallet-screen-resolved.ts` (spike.0323 v3 screen) so metrics displayed in the app agree with research fixtures.
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md, work/items/task.0329.wallet-analysis-component-extraction.md
 * @public
 */

/** Minimum fields of a Polymarket Data-API trade required for realized-metrics math. */
export type WalletTradeInput = {
  /** "BUY" or "SELL" — string to stay tolerant of upstream casing. */
  readonly side: string;
  /** ERC-1155 token id (YES or NO side of a conditionId). */
  readonly asset: string;
  /** Polymarket conditionId. */
  readonly conditionId: string;
  readonly size: number;
  readonly price: number;
  /** Unix seconds. */
  readonly timestamp: number;
  readonly title?: string | undefined;
  readonly outcome?: string | undefined;
};

/** Minimum fields of a CLOB `/markets/{conditionId}` response required for resolution math. */
export type MarketResolutionInput = {
  readonly closed: boolean;
  readonly tokens: ReadonlyArray<{
    readonly token_id: string;
    readonly winner: boolean;
  }>;
};

/** Computed per-wallet metrics. Null on all numeric metrics when resolved sample is too small. */
export type WalletMetrics = {
  readonly resolvedPositions: number;
  readonly wins: number;
  readonly losses: number;
  readonly trueWinRatePct: number | null;
  readonly realizedPnlUsdc: number | null;
  readonly realizedRoiPct: number | null;
  readonly maxDrawdownUsdc: number | null;
  readonly maxDrawdownPctOfPeak: number | null;
  readonly peakEquityUsdc: number | null;
  readonly medianDurationHours: number | null;
  readonly openPositions: number;
  readonly openNetCostUsdc: number;
  readonly uniqueMarkets: number;
  readonly tradesPerDay30d: number;
  readonly daysSinceLastTrade: number;
  /** Top N market titles, newest-first, deduped. */
  readonly topMarkets: ReadonlyArray<string>;
  /** Trades-per-day count for each of the last N calendar days (UTC), oldest → newest. */
  readonly dailyCounts: ReadonlyArray<{
    readonly day: string;
    readonly n: number;
  }>;
};

export type ComputeWalletMetricsOptions = {
  /** Injected clock (unix seconds) for deterministic tests. Defaults to Date.now. */
  readonly nowSec?: number | undefined;
  /** Minimum resolved positions before WR/ROI/DD/duration return non-null. Default 5. */
  readonly minResolvedForMetrics?: number | undefined;
  /** Number of days covered by `dailyCounts`. Default 14. */
  readonly dailyWindow?: number | undefined;
  /** Max entries in `topMarkets`. Default 4. */
  readonly topMarketsLimit?: number | undefined;
};

const SEC_PER_DAY = 86_400;

/**
 * Compute realized metrics from a wallet's trade log joined against CLOB market resolutions.
 * Pure function — identical inputs always produce identical outputs.
 */
export function computeWalletMetrics(
  trades: ReadonlyArray<WalletTradeInput>,
  resolutions: ReadonlyMap<string, MarketResolutionInput>,
  options?: ComputeWalletMetricsOptions
): WalletMetrics {
  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  const minResolved = options?.minResolvedForMetrics ?? 5;
  const window = options?.dailyWindow ?? 14;
  const topLimit = options?.topMarketsLimit ?? 4;

  // ─── Aggregate per-token BUY/SELL activity ───────────────────────────
  type TokenAgg = {
    buyUsdc: number;
    sellUsdc: number;
    buyShares: number;
    sellShares: number;
    conditionId: string;
    title: string;
    firstTs: number;
    lastTs: number;
  };
  const tokens = new Map<string, TokenAgg>();
  const marketTitles = new Map<string, string>();

  for (const t of trades) {
    const existing = tokens.get(t.asset);
    const agg: TokenAgg = existing ?? {
      buyUsdc: 0,
      sellUsdc: 0,
      buyShares: 0,
      sellShares: 0,
      conditionId: t.conditionId,
      title: t.title ?? "",
      firstTs: Number.POSITIVE_INFINITY,
      lastTs: 0,
    };
    const usd = t.size * t.price;
    if (t.side.toUpperCase() === "BUY") {
      agg.buyUsdc += usd;
      agg.buyShares += t.size;
      agg.firstTs = Math.min(agg.firstTs, t.timestamp);
    } else {
      agg.sellUsdc += usd;
      agg.sellShares += t.size;
    }
    agg.lastTs = Math.max(agg.lastTs, t.timestamp);
    tokens.set(t.asset, agg);
    if (t.title) marketTitles.set(t.conditionId, t.title);
  }

  // ─── Resolve each token position (won/lost PnL) ──────────────────────
  type Resolved = {
    pnl: number;
    won: boolean;
    closeTs: number;
    durationSec: number;
    buyUsdc: number;
  };
  const resolved: Resolved[] = [];
  let openNetCost = 0;
  let openCount = 0;

  for (const [tokenId, a] of tokens.entries()) {
    const m = resolutions.get(a.conditionId);
    const tokenInfo = m?.tokens.find((x) => x.token_id === tokenId);
    if (m?.closed && tokenInfo) {
      const held = a.buyShares - a.sellShares;
      const payout = held > 0 && tokenInfo.winner ? held : 0;
      const pnl = a.sellUsdc + payout - a.buyUsdc;
      const duration =
        a.firstTs !== Number.POSITIVE_INFINITY ? a.lastTs - a.firstTs : 0;
      resolved.push({
        pnl,
        won: pnl > 0.5,
        closeTs: a.lastTs,
        durationSec: duration,
        buyUsdc: a.buyUsdc,
      });
    } else {
      openNetCost += a.buyUsdc - a.sellUsdc;
      openCount++;
    }
  }

  // ─── WR / ROI / equity-curve max DD ──────────────────────────────────
  const wins = resolved.filter((r) => r.won).length;
  const losses = resolved.filter((r) => r.pnl < -0.5).length;
  const enough = resolved.length >= minResolved;

  const trueWinRatePct = enough
    ? +((wins / resolved.length) * 100).toFixed(1)
    : null;
  const totalPnl = resolved.reduce((s, r) => s + r.pnl, 0);
  const deployed = resolved.reduce((s, r) => s + r.buyUsdc, 0);
  const realizedPnlUsdc = enough ? Math.round(totalPnl) : null;
  const realizedRoiPct =
    enough && deployed > 0 ? +((totalPnl / deployed) * 100).toFixed(1) : null;

  // Chronological equity curve → peak and max drawdown.
  const chrono = [...resolved].sort((a, b) => a.closeTs - b.closeTs);
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  for (const r of chrono) {
    equity += r.pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  const maxDrawdownUsdc = enough ? Math.round(maxDD) : null;
  const peakEquityUsdc = enough ? Math.round(peak) : null;
  const maxDrawdownPctOfPeak = enough
    ? peak > 0
      ? +((maxDD / peak) * 100).toFixed(1)
      : 0
    : null;

  // ─── Median round-trip duration (hours) ──────────────────────────────
  const durations = resolved
    .map((r) => r.durationSec)
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
  const medianDurationHours =
    enough && durations.length > 0
      ? +((durations[Math.floor(durations.length / 2)] ?? 0) / 3_600).toFixed(2)
      : null;

  // ─── Activity metrics (always non-null; cheap) ───────────────────────
  const cutoff30 = nowSec - 30 * SEC_PER_DAY;
  const tradesLast30 = trades.filter((t) => t.timestamp >= cutoff30).length;
  const latestTs = trades.reduce((m, t) => Math.max(m, t.timestamp), 0);
  const daysSinceLastTrade = latestTs
    ? +((nowSec - latestTs) / SEC_PER_DAY).toFixed(2)
    : Number.POSITIVE_INFINITY;

  // Top markets by most-recent touch (dedupe by conditionId).
  const byRecent = [...tokens.values()].sort((a, b) => b.lastTs - a.lastTs);
  const topMarkets: string[] = [];
  const seenCond = new Set<string>();
  for (const tok of byRecent) {
    if (seenCond.has(tok.conditionId)) continue;
    const title = marketTitles.get(tok.conditionId) ?? tok.title;
    if (!title) continue;
    seenCond.add(tok.conditionId);
    topMarkets.push(title);
    if (topMarkets.length >= topLimit) break;
  }

  // ─── Daily counts (last N calendar days UTC, oldest → newest) ─────────
  const dailyCounts = buildDailyCounts(trades, nowSec, window);

  return {
    resolvedPositions: resolved.length,
    wins,
    losses,
    trueWinRatePct,
    realizedPnlUsdc,
    realizedRoiPct,
    maxDrawdownUsdc,
    maxDrawdownPctOfPeak,
    peakEquityUsdc,
    medianDurationHours,
    openPositions: openCount,
    openNetCostUsdc: Math.round(openNetCost),
    uniqueMarkets: tokens.size,
    tradesPerDay30d: +(tradesLast30 / 30).toFixed(2),
    daysSinceLastTrade,
    topMarkets,
    dailyCounts,
  };
}

function buildDailyCounts(
  trades: ReadonlyArray<WalletTradeInput>,
  nowSec: number,
  windowDays: number
): ReadonlyArray<{ day: string; n: number }> {
  const bucketByDay = new Map<string, number>();
  for (const t of trades) {
    const day = utcDayStr(t.timestamp);
    bucketByDay.set(day, (bucketByDay.get(day) ?? 0) + 1);
  }
  const out: Array<{ day: string; n: number }> = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const ts = nowSec - i * SEC_PER_DAY;
    const day = utcDayStr(ts);
    out.push({ day, n: bucketByDay.get(day) ?? 0 });
  }
  return out;
}

function utcDayStr(tsSec: number): string {
  return new Date(tsSec * 1_000).toISOString().slice(0, 10);
}
