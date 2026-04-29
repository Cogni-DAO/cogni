// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/analysis/position-timelines` tests
 * Purpose: Pin the execution-position mapper against the three lifecycle
 * states the dashboard depends on: open, closed round-trip, and redeemable.
 * Scope: Pure unit tests only. No network, no file I/O.
 * Side-effects: none
 * @internal
 */

import { describe, expect, it } from "vitest";

import type {
  ClobPriceHistoryPoint,
  PolymarketUserPosition,
  PolymarketUserTrade,
} from "../../../../../../../nodes/poly/packages/market-provider/src/adapters/polymarket/index.ts";
import { mapExecutionPositions } from "../../../../../../../nodes/poly/packages/market-provider/src/analysis/position-timelines.ts";

describe("mapExecutionPositions", () => {
  it("keeps open positions open and builds the real market URL", () => {
    const positions = [
      {
        proxyWallet: "0x1111111111111111111111111111111111111111",
        asset: "asset-open",
        conditionId: "condition-open",
        size: 248651.2632,
        avgPrice: 0.0402,
        initialValue: 10014.6782,
        currentValue: 4600.0483,
        cashPnl: -5414.6299,
        percentPnl: -54.0669,
        totalBought: 248651.2632,
        realizedPnl: 0,
        percentRealizedPnl: -54.0669,
        curPrice: 0.0185,
        redeemable: false,
        mergeable: false,
        title:
          "Will Donald Trump win the 2028 Republican presidential nomination?",
        slug: "will-donald-trump-win-the-2028-republican-presidential-nomination",
        eventId: "31875",
        eventSlug: "republican-presidential-nominee-2028",
        outcome: "Yes",
        outcomeIndex: 0,
        oppositeOutcome: "No",
        oppositeAsset: "asset-no",
        endDate: "2028-11-07",
        negativeRisk: true,
      },
    ] satisfies PolymarketUserPosition[];
    const trades = [
      trade({
        asset: "asset-open",
        conditionId: "condition-open",
        timestamp: 1765741803,
        price: 0.05229372063968918,
        size: 9561.377406,
        title:
          "Will Donald Trump win the 2028 Republican presidential nomination?",
        slug: "will-donald-trump-win-the-2028-republican-presidential-nomination",
        eventSlug: "republican-presidential-nominee-2028",
        outcome: "Yes",
      }),
      trade({
        asset: "asset-open",
        conditionId: "condition-open",
        timestamp: 1769810738,
        price: 0.04290069084017058,
        size: 2330.964771,
        title:
          "Will Donald Trump win the 2028 Republican presidential nomination?",
        slug: "will-donald-trump-win-the-2028-republican-presidential-nomination",
        eventSlug: "republican-presidential-nominee-2028",
        outcome: "Yes",
      }),
    ];
    const priceHistoryByAsset = new Map<
      string,
      readonly ClobPriceHistoryPoint[]
    >([
      [
        "asset-open",
        [
          { t: 1765741803, p: 0.05229372063968918 },
          { t: 1767000000, p: 0.046 },
          { t: 1769000000, p: 0.032 },
        ],
      ],
    ]);

    const positionsOut = mapExecutionPositions({
      positions,
      trades,
      priceHistoryByAsset,
      asOfIso: "2026-04-22T08:30:17.372Z",
    });

    expect(positionsOut).toHaveLength(1);
    expect(positionsOut[0]?.status).toBe("open");
    expect(positionsOut[0]?.marketUrl).toBe(
      "https://polymarket.com/event/republican-presidential-nominee-2028/will-donald-trump-win-the-2028-republican-presidential-nomination"
    );
    expect(
      positionsOut[0]?.events.some((event) => event.kind === "close")
    ).toBe(false);
    expect(positionsOut[0]?.timeline.at(-1)?.price).toBeCloseTo(0.0185, 6);
  });

  it("marks a round-trip as closed and emits a close event", () => {
    const trades = [
      trade({
        asset: "asset-closed",
        conditionId: "condition-closed",
        timestamp: 1768756886,
        price: 0.5088289170889014,
        size: 43115.82,
        title: "Will Aston Villa FC win on 2026-01-18?",
        slug: "epl-ast-eve-2026-01-18-ast",
        eventSlug: "epl-ast-eve-2026-01-18",
        outcome: "Yes",
      }),
      trade({
        asset: "asset-closed",
        conditionId: "condition-closed",
        timestamp: 1768757568,
        side: "SELL",
        price: 0.473154875,
        size: 500000,
        title: "Will Aston Villa FC win on 2026-01-18?",
        slug: "epl-ast-eve-2026-01-18-ast",
        eventSlug: "epl-ast-eve-2026-01-18",
        outcome: "Yes",
      }),
    ];

    const positionsOut = mapExecutionPositions({
      positions: [],
      trades,
      priceHistoryByAsset: new Map([
        [
          "asset-closed",
          [
            { t: 1768756886, p: 0.5088289170889014 },
            { t: 1768757568, p: 0.473154875 },
          ],
        ],
      ]),
      asOfIso: "2026-04-22T08:30:18.907Z",
    });

    expect(positionsOut[0]?.status).toBe("closed");
    expect(positionsOut[0]?.closedAt).toBe("2026-01-18T17:32:48.000Z");
    expect(positionsOut[0]?.events.at(-1)?.kind).toBe("close");
    expect(positionsOut[0]?.currentValue).toBe(0);
  });

  it("marks redeemable positions explicitly instead of pretending they are still open", () => {
    const positions = [
      {
        proxyWallet: "0x492442eab586f242b53bda933fd5de859c8a3782",
        asset: "asset-redeemable",
        conditionId: "condition-redeemable",
        size: 371399.0722,
        avgPrice: 0.4958,
        initialValue: 184163.0581,
        currentValue: 0,
        cashPnl: -184163.0581,
        percentPnl: -99.9999,
        totalBought: 377102.4099,
        realizedPnl: 0,
        percentRealizedPnl: -100,
        curPrice: 0,
        redeemable: true,
        mergeable: false,
        title: "Trail Blazers vs. Spurs: O/U 220.5",
        slug: "nba-por-sas-2026-04-21-total-220pt5",
        eventId: "382092",
        eventSlug: "nba-por-sas-2026-04-21",
        outcome: "Over",
        outcomeIndex: 0,
        oppositeOutcome: "Under",
        oppositeAsset: "asset-under",
        endDate: "2026-04-22",
        negativeRisk: false,
      },
    ] satisfies PolymarketUserPosition[];
    const trades = [
      trade({
        asset: "asset-redeemable",
        conditionId: "condition-redeemable",
        timestamp: 1776787694,
        price: 0.49,
        size: 55993.44907,
        title: "Trail Blazers vs. Spurs: O/U 220.5",
        slug: "nba-por-sas-2026-04-21-total-220pt5",
        eventSlug: "nba-por-sas-2026-04-21",
        outcome: "Over",
      }),
    ];

    const positionsOut = mapExecutionPositions({
      positions,
      trades,
      priceHistoryByAsset: new Map([
        ["asset-redeemable", [{ t: 1776788134, p: 0.495 }]],
      ]),
      asOfIso: "2026-04-22T08:30:19.976Z",
    });

    expect(positionsOut[0]?.status).toBe("redeemable");
    expect(positionsOut[0]?.events.at(-1)?.kind).toBe("redeemable");
    expect(positionsOut[0]?.timeline.at(-1)?.price).toBe(0);
  });
});

function trade(
  overrides: Partial<PolymarketUserTrade> &
    Pick<
      PolymarketUserTrade,
      "asset" | "conditionId" | "timestamp" | "price" | "size"
    >
): PolymarketUserTrade {
  return {
    proxyWallet: "0x1111111111111111111111111111111111111111",
    side: "BUY",
    title: "",
    slug: "",
    eventSlug: "",
    icon: "",
    outcome: "",
    outcomeIndex: 0,
    transactionHash: "",
    ...overrides,
  };
}
