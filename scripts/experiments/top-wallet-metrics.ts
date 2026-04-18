// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/top-wallet-metrics`
 * Purpose: spike.0323 Phase 2 — for the union of top leaderboard wallets across {DAY,WEEK,MONTH} × {PNL,VOL}, fetch ~500 recent trades each and compute per-wallet metrics (trade freq, specialization, recency, BUY/SELL mix, realized round-trip PnL from trade history).
 * Scope: Read-only public Data API analytics. Does not authenticate, does not place orders, does not modify any on-chain state.
 * Invariants: Public Data API only (no keys required); TRADE_FETCH_LIMIT bounds per-wallet fetch at 500; gentle 120ms pacing between wallets.
 * Side-effects: IO (unauthenticated HTTPS to data-api.polymarket.com; writes JSON fixture at docs/research/fixtures/poly-wallet-metrics.json).
 * Links: work/items/spike.0323.poly-copy-trade-candidate-identification.md, docs/research/polymarket-copy-trade-candidates.md
 * @internal — spike research, not production code.
 */

import fs from "node:fs";
import path from "node:path";
import {
  PolymarketDataApiClient,
  type PolymarketLeaderboardEntry,
  type PolymarketUserTrade,
} from "@cogni/market-provider/adapters/polymarket";

const TRADE_FETCH_LIMIT = 500;
const LEADERBOARD_TOP_N = 25;
const NOW_SEC = Math.floor(Date.now() / 1000);
const SEC_PER_DAY = 86400;

type TimePeriod = "DAY" | "WEEK" | "MONTH";
type OrderBy = "PNL" | "VOL";

interface LeaderboardSlot {
  timePeriod: TimePeriod;
  orderBy: OrderBy;
  entry: PolymarketLeaderboardEntry;
}

interface WalletMetrics {
  wallet: string;
  userName: string;
  leaderboardAppearances: Array<{
    timePeriod: TimePeriod;
    orderBy: OrderBy;
    rank: string;
  }>;
  lbMaxVol: number;
  lbMaxPnl: number;
  lbRoiPct: number; // pnl/vol × 100 from leaderboard (whichever window maxed vol)
  tradeCount: number;
  tradeCount7d: number;
  tradeCount30d: number;
  tradesPerDay30d: number;
  daysSinceLastTrade: number;
  uniqueMarkets: number;
  top3Markets: Array<{ title: string; trades: number }>;
  categoryMix: Record<string, number>; // heuristic tag → trade share
  buyShare: number;
  sellShare: number;
  medianTradeUsdc: number;
  p90TradeUsdc: number;
  realizedRoundTripPnlUsdc: number; // per-conditionId net cashflow within observed trades
  roundTripCoverageMarkets: number; // # markets where both BUY & SELL observed
  notes: string[];
}

function classifyCategory(title: string): string {
  const t = title.toLowerCase();
  if (
    /\b(nba|nfl|nhl|mlb|warriors|lakers|clippers|celtics|patriots|chiefs|spread|moneyline|over\/under|vs\.|heat|hornets|suns|blazers|cowboys|yankees|dodgers|bruins|rangers|knicks)\b/.test(
      t
    )
  )
    return "sports";
  if (/\b(btc|bitcoin|eth|ethereum|solana|sol|crypto|price|reach)\b/.test(t))
    return "crypto";
  if (
    /\b(president|senate|governor|election|trump|biden|republican|democrat|congress|primary|poll|vote)\b/.test(
      t
    )
  )
    return "politics";
  if (/\b(fed|rate|cpi|inflation|jobs|unemployment|fomc|gdp|powell)\b/.test(t))
    return "macro";
  if (/\b(oscar|grammy|emmy|mvp|nobel|award|nominee|winner)\b/.test(t))
    return "awards";
  if (
    /\b(war|ceasefire|putin|zelensky|israel|gaza|taiwan|china|nuclear|treaty)\b/.test(
      t
    )
  )
    return "geopolitics";
  if (
    /\b(movie|box office|album|song|tiktok|celebrity|marriage|divorce)\b/.test(
      t
    )
  )
    return "entertainment";
  return "other";
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function buildLeaderboardUnion(
  client: PolymarketDataApiClient
): Promise<Map<string, LeaderboardSlot[]>> {
  const combos: Array<{ timePeriod: TimePeriod; orderBy: OrderBy }> = [
    { timePeriod: "DAY", orderBy: "PNL" },
    { timePeriod: "DAY", orderBy: "VOL" },
    { timePeriod: "WEEK", orderBy: "PNL" },
    { timePeriod: "WEEK", orderBy: "VOL" },
    { timePeriod: "MONTH", orderBy: "PNL" },
    { timePeriod: "MONTH", orderBy: "VOL" },
  ];
  const union = new Map<string, LeaderboardSlot[]>();
  for (const c of combos) {
    const entries = await client.listTopTraders({
      timePeriod: c.timePeriod,
      orderBy: c.orderBy,
      limit: LEADERBOARD_TOP_N,
    });
    for (const entry of entries) {
      const wallet = entry.proxyWallet.toLowerCase();
      const existing = union.get(wallet) ?? [];
      existing.push({ timePeriod: c.timePeriod, orderBy: c.orderBy, entry });
      union.set(wallet, existing);
    }
    console.error(
      `[collect] leaderboard ${c.timePeriod}/${c.orderBy}: ${entries.length} entries`
    );
  }
  return union;
}

async function fetchTradesForWallet(
  client: PolymarketDataApiClient,
  wallet: string
): Promise<PolymarketUserTrade[]> {
  try {
    return await client.listUserActivity(wallet, { limit: TRADE_FETCH_LIMIT });
  } catch (err) {
    console.error(
      `[collect] listUserActivity failed for ${wallet}: ${(err as Error).message}`
    );
    return [];
  }
}

function computeMetrics(
  wallet: string,
  slots: LeaderboardSlot[],
  trades: PolymarketUserTrade[]
): WalletMetrics {
  const userName = slots[0]?.entry.userName || "";
  const lbMaxVol = Math.max(...slots.map((s) => s.entry.vol));
  const lbMaxPnl = Math.max(...slots.map((s) => s.entry.pnl));
  const slotWithMaxVol = slots.find((s) => s.entry.vol === lbMaxVol);
  const lbRoiPct =
    slotWithMaxVol && slotWithMaxVol.entry.vol > 0
      ? (slotWithMaxVol.entry.pnl / slotWithMaxVol.entry.vol) * 100
      : 0;

  const tradeCount = trades.length;
  const cutoff7 = NOW_SEC - 7 * SEC_PER_DAY;
  const cutoff30 = NOW_SEC - 30 * SEC_PER_DAY;
  const t7 = trades.filter((t) => t.timestamp >= cutoff7).length;
  const t30 = trades.filter((t) => t.timestamp >= cutoff30).length;
  const latestTs = trades.length
    ? Math.max(...trades.map((t) => t.timestamp))
    : 0;
  const daysSinceLast = latestTs
    ? (NOW_SEC - latestTs) / SEC_PER_DAY
    : Infinity;

  // Per-market aggregates
  const byCond = new Map<
    string,
    { title: string; buyUsdc: number; sellUsdc: number; trades: number }
  >();
  for (const t of trades) {
    const usdc = t.size * t.price;
    const prev = byCond.get(t.conditionId) ?? {
      title: t.title || "(untitled)",
      buyUsdc: 0,
      sellUsdc: 0,
      trades: 0,
    };
    if (t.side === "BUY") prev.buyUsdc += usdc;
    else prev.sellUsdc += usdc;
    prev.trades += 1;
    byCond.set(t.conditionId, prev);
  }
  const uniqueMarkets = byCond.size;
  const topMarkets = [...byCond.values()]
    .sort((a, b) => b.trades - a.trades)
    .slice(0, 3)
    .map((m) => ({ title: m.title, trades: m.trades }));

  // Round-trip PnL approximation: for markets where both BUY and SELL observed, net cashflow
  let roundTripPnl = 0;
  let roundTripCoverage = 0;
  for (const m of byCond.values()) {
    if (m.buyUsdc > 0 && m.sellUsdc > 0) {
      roundTripPnl += m.sellUsdc - m.buyUsdc;
      roundTripCoverage += 1;
    }
  }

  // Categories
  const catMix: Record<string, number> = {};
  for (const t of trades) {
    const cat = classifyCategory(t.title || "");
    catMix[cat] = (catMix[cat] ?? 0) + 1;
  }
  if (tradeCount > 0) {
    for (const k of Object.keys(catMix))
      catMix[k] = Number((catMix[k] / tradeCount).toFixed(3));
  }

  const buyCount = trades.filter((t) => t.side === "BUY").length;
  const sellCount = trades.filter((t) => t.side === "SELL").length;

  const sizes = trades.map((t) => t.size * t.price).filter((x) => x > 0);

  return {
    wallet,
    userName,
    leaderboardAppearances: slots.map((s) => ({
      timePeriod: s.timePeriod,
      orderBy: s.orderBy,
      rank: s.entry.rank,
    })),
    lbMaxVol,
    lbMaxPnl,
    lbRoiPct: Number(lbRoiPct.toFixed(2)),
    tradeCount,
    tradeCount7d: t7,
    tradeCount30d: t30,
    tradesPerDay30d: Number((t30 / 30).toFixed(2)),
    daysSinceLastTrade: Number(daysSinceLast.toFixed(1)),
    uniqueMarkets,
    top3Markets: topMarkets,
    categoryMix: catMix,
    buyShare: tradeCount ? Number((buyCount / tradeCount).toFixed(3)) : 0,
    sellShare: tradeCount ? Number((sellCount / tradeCount).toFixed(3)) : 0,
    medianTradeUsdc: Number(median(sizes).toFixed(2)),
    p90TradeUsdc: Number(percentile(sizes, 90).toFixed(2)),
    realizedRoundTripPnlUsdc: Number(roundTripPnl.toFixed(2)),
    roundTripCoverageMarkets: roundTripCoverage,
    notes: [],
  };
}

async function main(): Promise<void> {
  const client = new PolymarketDataApiClient();
  console.error("[collect] building leaderboard union");
  const union = await buildLeaderboardUnion(client);
  console.error(
    `[collect] unique wallets across 6 leaderboards: ${union.size}`
  );

  const metrics: WalletMetrics[] = [];
  let i = 0;
  for (const [wallet, slots] of union) {
    i += 1;
    console.error(`[collect] (${i}/${union.size}) ${wallet} — fetching trades`);
    const trades = await fetchTradesForWallet(client, wallet);
    metrics.push(computeMetrics(wallet, slots, trades));
    await new Promise((r) => setTimeout(r, 120)); // gentle pacing
  }

  // Sort by tradesPerDay30d × roundTripCoverage as a rough "copyability" heuristic
  metrics.sort(
    (a, b) =>
      b.tradesPerDay30d * Math.log1p(b.roundTripCoverageMarkets) -
      a.tradesPerDay30d * Math.log1p(a.roundTripCoverageMarkets)
  );

  const outPath = path.resolve(
    __dirname,
    "../../docs/research/fixtures/poly-wallet-metrics.json"
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify({ collectedAt: new Date().toISOString(), metrics }, null, 2)
  );
  console.error(`[collect] wrote ${metrics.length} wallets to ${outPath}`);

  // Print condensed markdown table for top 20 by heuristic
  console.log(
    "\n### Condensed scorecard (top 20 by freq × round-trip coverage)\n"
  );
  console.log(
    "| wallet | name | lb vol | lb pnl | lb roi% | t/day 30d | days since | markets | round-trip Δusdc (cov) | cat mix |"
  );
  console.log("|---|---|---:|---:|---:|---:|---:|---:|---|---|");
  for (const m of metrics.slice(0, 20)) {
    const catStr = Object.entries(m.categoryMix)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}:${(v * 100).toFixed(0)}%`)
      .join(" ");
    console.log(
      `| \`${m.wallet.slice(0, 10)}…\` | ${(m.userName || "-").slice(0, 16)} | $${(m.lbMaxVol / 1000).toFixed(0)}k | $${(m.lbMaxPnl / 1000).toFixed(0)}k | ${m.lbRoiPct.toFixed(1)} | ${m.tradesPerDay30d} | ${m.daysSinceLastTrade === Infinity ? "∞" : m.daysSinceLastTrade} | ${m.uniqueMarkets} | $${m.realizedRoundTripPnlUsdc.toFixed(0)} (${m.roundTripCoverageMarkets}) | ${catStr} |`
    );
  }
  console.log("");
}

main().catch((err: unknown) => {
  console.error("[collect] unhandled:", err);
  process.exit(1);
});
