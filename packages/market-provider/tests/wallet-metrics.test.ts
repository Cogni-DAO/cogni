// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/tests/wallet-metrics`
 * Purpose: Unit tests for `computeWalletMetrics` — determinism, insufficient-data null behaviour, math on small worked examples.
 * Scope: Pure function tests; no I/O. Does not hit network, does not spin up a server.
 * Invariants: Math agrees with spike.0323 research fixtures on the pinned worked example.
 * Side-effects: none
 * Links: docs/design/wallet-analysis-components.md, work/items/task.0329.wallet-analysis-component-extraction.md
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  computeWalletMetrics,
  type MarketResolutionInput,
  type WalletTradeInput,
} from "../src/analysis/wallet-metrics.js";

// Reference clock — 2026-04-19T00:00:00Z
const NOW = 1_776_556_800;

describe("computeWalletMetrics", () => {
  it("returns zero-state with empty trades + empty resolutions", () => {
    const m = computeWalletMetrics([], new Map(), { nowSec: NOW });
    expect(m.resolvedPositions).toBe(0);
    expect(m.wins).toBe(0);
    expect(m.trueWinRatePct).toBeNull();
    expect(m.realizedPnlUsdc).toBeNull();
    expect(m.realizedRoiPct).toBeNull();
    expect(m.maxDrawdownUsdc).toBeNull();
    expect(m.uniqueMarkets).toBe(0);
    expect(m.dailyCounts).toHaveLength(14);
    expect(m.dailyCounts.every((d) => d.n === 0)).toBe(true);
  });

  it("returns null metrics when resolved count is under threshold", () => {
    // One buy-only position, market resolved winner → one resolved win
    const trades: WalletTradeInput[] = [
      {
        side: "BUY",
        asset: "tok-yes",
        conditionId: "cid-1",
        size: 100,
        price: 0.5,
        timestamp: NOW - 3600,
      },
    ];
    const resolutions = new Map<string, MarketResolutionInput>([
      [
        "cid-1",
        {
          closed: true,
          tokens: [
            { token_id: "tok-yes", winner: true },
            { token_id: "tok-no", winner: false },
          ],
        },
      ],
    ]);
    const m = computeWalletMetrics(trades, resolutions, { nowSec: NOW });
    expect(m.resolvedPositions).toBe(1);
    expect(m.wins).toBe(1);
    // under default minResolvedForMetrics=5 → nulls
    expect(m.trueWinRatePct).toBeNull();
    expect(m.realizedPnlUsdc).toBeNull();
  });

  it("computes WR, ROI, PnL, DD on a 5-position worked example", () => {
    // 5 resolved positions, 3 wins, 2 losses.
    // Wins: +$10 net each × 3 = +$30.  Losses: -$5 net each × 2 = -$10.  Net +$20.
    // Deployed: 5 × $20 buy = $100. ROI = 20%.
    // Equity curve oldest → newest: +10, +10, -5, +10, -5 → cum 10, 20, 15, 25, 20.
    //   peak = 25 (after 4th), final = 20, maxDD = 5 → 5/25 = 20%.
    const mk = (
      tokenId: string,
      cid: string,
      buyUsdc: number,
      _sellUsdc: number,
      tsSec: number
    ) => {
      const out: WalletTradeInput[] = [];
      // BUY at price 1 for size=buyUsdc → $buyUsdc deployed
      out.push({
        side: "BUY",
        asset: tokenId,
        conditionId: cid,
        size: buyUsdc,
        price: 1,
        timestamp: tsSec,
      });
      // No SELL — resolve via winner payout when sellUsdc model = buyUsdc+profit
      return out;
    };

    const trades: WalletTradeInput[] = [
      ...mk("t1-yes", "c1", 20, 30, NOW - 5 * 86_400),
      ...mk("t2-yes", "c2", 20, 30, NOW - 4 * 86_400),
      ...mk("t3-yes", "c3", 20, 15, NOW - 3 * 86_400),
      ...mk("t4-yes", "c4", 20, 30, NOW - 2 * 86_400),
      ...mk("t5-yes", "c5", 20, 15, NOW - 1 * 86_400),
    ];

    // Resolution: winning positions pay held × $1 (shares = 20 each).
    // For wins we want net +10: bought 20 shares at $1 = $20 deployed; payout 20 shares × $1 = $20; net $0.
    // We need a +10 profit. Model: buy 20 shares at $0.5 = $10 deployed; payout 20 × $1 = $20; net +10.
    // Rewrite with prices:
    const trades2: WalletTradeInput[] = [
      // wins: $10 deployed, wins 20 payout
      {
        side: "BUY",
        asset: "t1-yes",
        conditionId: "c1",
        size: 20,
        price: 0.5,
        timestamp: NOW - 5 * 86_400,
      },
      {
        side: "BUY",
        asset: "t2-yes",
        conditionId: "c2",
        size: 20,
        price: 0.5,
        timestamp: NOW - 4 * 86_400,
      },
      // loss: $20 deployed on a losing token — payout 0, net -20… we want -5.
      // adjust: $5 deployed on losing side, payout 0, net -5
      {
        side: "BUY",
        asset: "t3-no",
        conditionId: "c3",
        size: 10,
        price: 0.5,
        timestamp: NOW - 3 * 86_400,
      },
      // win: $10 deployed, wins 20 payout → +10
      {
        side: "BUY",
        asset: "t4-yes",
        conditionId: "c4",
        size: 20,
        price: 0.5,
        timestamp: NOW - 2 * 86_400,
      },
      // loss: $5 deployed losing → -5
      {
        side: "BUY",
        asset: "t5-no",
        conditionId: "c5",
        size: 10,
        price: 0.5,
        timestamp: NOW - 1 * 86_400,
      },
    ];
    void trades; // reference kept for readability
    const resolutions = new Map<string, MarketResolutionInput>([
      [
        "c1",
        {
          closed: true,
          tokens: [
            { token_id: "t1-yes", winner: true },
            { token_id: "t1-no", winner: false },
          ],
        },
      ],
      [
        "c2",
        {
          closed: true,
          tokens: [
            { token_id: "t2-yes", winner: true },
            { token_id: "t2-no", winner: false },
          ],
        },
      ],
      [
        "c3",
        {
          closed: true,
          tokens: [
            { token_id: "t3-yes", winner: true },
            { token_id: "t3-no", winner: false },
          ],
        },
      ],
      [
        "c4",
        {
          closed: true,
          tokens: [
            { token_id: "t4-yes", winner: true },
            { token_id: "t4-no", winner: false },
          ],
        },
      ],
      [
        "c5",
        {
          closed: true,
          tokens: [
            { token_id: "t5-yes", winner: true },
            { token_id: "t5-no", winner: false },
          ],
        },
      ],
    ]);

    const m = computeWalletMetrics(trades2, resolutions, { nowSec: NOW });
    expect(m.resolvedPositions).toBe(5);
    expect(m.wins).toBe(3);
    expect(m.losses).toBe(2);
    expect(m.trueWinRatePct).toBe(60);
    // PnL: (+10)+(+10)+(-5)+(+10)+(-5) = +20.  Deployed = $10+$10+$5+$10+$5 = $40.  ROI = +50%.
    expect(m.realizedPnlUsdc).toBe(20);
    expect(m.realizedRoiPct).toBe(50);
    // Equity: 10,20,15,25,20 → peak 25, maxDD 5, 20%
    expect(m.maxDrawdownUsdc).toBe(5);
    expect(m.maxDrawdownPctOfPeak).toBe(20);
    expect(m.peakEquityUsdc).toBe(25);
  });

  it("is deterministic — same inputs → same outputs", () => {
    const trades: WalletTradeInput[] = [
      {
        side: "BUY",
        asset: "a",
        conditionId: "c",
        size: 10,
        price: 0.3,
        timestamp: NOW - 3600,
      },
    ];
    const a = computeWalletMetrics(trades, new Map(), { nowSec: NOW });
    const b = computeWalletMetrics(trades, new Map(), { nowSec: NOW });
    expect(a).toEqual(b);
  });

  it("daily counts span exactly dailyWindow days ending today (UTC)", () => {
    const trades: WalletTradeInput[] = [
      {
        side: "BUY",
        asset: "a",
        conditionId: "c",
        size: 1,
        price: 1,
        timestamp: NOW - 0, // today
      },
      {
        side: "BUY",
        asset: "a",
        conditionId: "c",
        size: 1,
        price: 1,
        timestamp: NOW - 1 * 86_400, // yesterday
      },
      {
        side: "BUY",
        asset: "a",
        conditionId: "c",
        size: 1,
        price: 1,
        timestamp: NOW - 1 * 86_400,
      },
    ];
    const m = computeWalletMetrics(trades, new Map(), {
      nowSec: NOW,
      dailyWindow: 7,
    });
    expect(m.dailyCounts).toHaveLength(7);
    expect(m.dailyCounts.at(-1)?.n).toBe(1); // today
    expect(m.dailyCounts.at(-2)?.n).toBe(2); // yesterday
  });

  it("topMarkets dedupes on conditionId and is bounded by limit", () => {
    // asset (token_id) is globally unique per market+side; use distinct ids.
    const trades: WalletTradeInput[] = [
      {
        side: "BUY",
        asset: "c1-yes",
        conditionId: "c1",
        size: 1,
        price: 1,
        timestamp: NOW - 0,
        title: "Alpha",
      },
      {
        side: "SELL",
        asset: "c1-yes",
        conditionId: "c1",
        size: 1,
        price: 1,
        timestamp: NOW - 1,
        title: "Alpha",
      },
      {
        side: "BUY",
        asset: "c2-yes",
        conditionId: "c2",
        size: 1,
        price: 1,
        timestamp: NOW - 100,
        title: "Beta",
      },
    ];
    const m = computeWalletMetrics(trades, new Map(), {
      nowSec: NOW,
      topMarketsLimit: 3,
    });
    expect(m.topMarkets).toEqual(["Alpha", "Beta"]);
  });
});
