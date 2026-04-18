// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/experiments/top-wallet-recent-trades`
 * Purpose: spike.0323 v0 read-only probe — pick one top-PNL wallet from the Polymarket leaderboard and print its ~10 most recent trades as a table.
 * Scope: Read-only inspection of one wallet. Does not authenticate, does not sign, does not place orders, does not modify state.
 * Invariants: Public Data API only (no keys required); prints to stdout only.
 * Side-effects: IO (two unauthenticated HTTPS calls to data-api.polymarket.com; writes to stdout).
 * Links: work/items/spike.0323.poly-copy-trade-candidate-identification.md
 * @internal — experiment code, not shipped to production
 */

import {
  PolymarketDataApiClient,
  type PolymarketUserTrade,
} from "@cogni/market-provider/adapters/polymarket";

const TRADE_LIMIT = 10;

function fmtTs(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s.padEnd(n);
  return `${s.slice(0, n - 1)}…`;
}

async function main(): Promise<void> {
  const data = new PolymarketDataApiClient();

  const leaderboard = await data.listTopTraders({
    timePeriod: "WEEK",
    orderBy: "PNL",
    limit: 5,
  });
  if (leaderboard.length === 0) {
    console.error("[v0] leaderboard empty");
    process.exit(1);
  }

  const pick = leaderboard[0];
  console.log(
    `\n[v0] Top wallet (WEEK/PNL rank ${pick.rank}): ${pick.userName || "(anon)"}  ${pick.proxyWallet}`
  );
  console.log(
    `     vol=$${pick.vol.toLocaleString()}   pnl=$${pick.pnl.toLocaleString()}\n`
  );

  const trades: PolymarketUserTrade[] = await data.listUserActivity(
    pick.proxyWallet,
    { limit: TRADE_LIMIT }
  );
  if (trades.length === 0) {
    console.log("[v0] no trades returned");
    return;
  }

  const header = [
    truncate("time (UTC)", 19),
    truncate("side", 4),
    truncate("outcome", 8),
    truncate("size", 10),
    truncate("price", 7),
    truncate("usdc", 10),
    "title",
  ].join("  ");
  console.log(header);
  console.log("-".repeat(header.length + 40));

  for (const t of trades.slice(0, TRADE_LIMIT)) {
    const usdc = (t.size * t.price).toFixed(2);
    console.log(
      [
        truncate(fmtTs(t.timestamp), 19),
        truncate(t.side, 4),
        truncate(t.outcome || "-", 8),
        truncate(t.size.toFixed(2), 10),
        truncate(t.price.toFixed(4), 7),
        truncate(`$${usdc}`, 10),
        truncate(t.title || "-", 60),
      ].join("  ")
    );
  }
  console.log("");
}

main().catch((err: unknown) => {
  console.error("[v0] unhandled:", err);
  process.exit(1);
});
