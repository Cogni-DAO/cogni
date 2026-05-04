// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/trader-comparison-service` tests
 * Purpose: Pins the research trader-comparison service mapping from saved fill aggregates plus windowed P/L.
 * Scope: Unit coverage with mocked DB and P/L upstream.
 * Invariants:
 *   - WINDOWED_DELTA: comparison P/L is `last.pnl - first.pnl`, matching the wallet-analysis P/L card.
 * Side-effects: none
 * @internal
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeWindowedPnl,
  getTraderComparison,
} from "@/features/wallet-analysis/server/trader-comparison-service";
import { getPnlSlice } from "@/features/wallet-analysis/server/wallet-analysis-service";

vi.mock("@/features/wallet-analysis/server/wallet-analysis-service", () => ({
  getPnlSlice: vi.fn(),
}));

const mockedGetPnlSlice = vi.mocked(getPnlSlice);
const WALLET = "0x1111111111111111111111111111111111111111";

type TestDb = Parameters<typeof getTraderComparison>[0];

function fakeDb(rows: unknown[]): TestDb & {
  execute: ReturnType<typeof vi.fn>;
} {
  return {
    execute: vi.fn().mockResolvedValue(rows),
  } as unknown as TestDb & { execute: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeWindowedPnl", () => {
  it("returns null when a delta cannot be expressed", () => {
    expect(computeWindowedPnl([])).toBeNull();
    expect(
      computeWindowedPnl([{ ts: "2026-05-01T00:00:00.000Z", pnl: 10 }])
    ).toBeNull();
  });

  it("computes last minus first for positive and negative windows", () => {
    expect(
      computeWindowedPnl([
        { ts: "2026-05-01T00:00:00.000Z", pnl: 100 },
        { ts: "2026-05-02T00:00:00.000Z", pnl: 112.25 },
      ])
    ).toBe(12.25);
    expect(
      computeWindowedPnl([
        { ts: "2026-05-01T00:00:00.000Z", pnl: 100 },
        { ts: "2026-05-02T00:00:00.000Z", pnl: 88.5 },
      ])
    ).toBe(-11.5);
  });
});

describe("getTraderComparison", () => {
  it("maps saved trade aggregates and Polymarket P/L into trader rows", async () => {
    const db = fakeDb([
      {
        id: "wallet-1",
        label: "RN1",
        kind: "copy_target",
        first_observed_at: "2026-04-01T00:00:00.000Z",
        last_success_at: "2026-05-01T00:00:00.000Z",
        status: "ok",
        trade_count: "12",
        buy_count: "7",
        sell_count: "5",
        notional_usdc: "150.5",
        buy_usdc: "90.25",
        sell_usdc: "60.25",
        market_count: "4",
      },
    ]);
    mockedGetPnlSlice.mockResolvedValue({
      kind: "ok",
      value: {
        interval: "1W",
        computedAt: "2026-05-01T00:00:00.000Z",
        history: [
          { ts: "2026-04-24T00:00:00.000Z", pnl: 100 },
          { ts: "2026-05-01T00:00:00.000Z", pnl: 125.5 },
        ],
      },
    });

    const result = await getTraderComparison(
      db,
      [{ address: WALLET, label: "override" }],
      "1W"
    );

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(mockedGetPnlSlice).toHaveBeenCalledWith(WALLET, "1W");
    expect(result.traders).toMatchObject([
      {
        address: WALLET,
        label: "override",
        isObserved: true,
        traderKind: "copy_target",
        observedSince: "2026-04-01T00:00:00.000Z",
        lastObservedAt: "2026-05-01T00:00:00.000Z",
        observationStatus: "ok",
        pnl: { usdc: 25.5 },
        trades: {
          count: 12,
          buyCount: 7,
          sellCount: 5,
          notionalUsdc: 150.5,
          buyUsdc: 90.25,
          sellUsdc: 60.25,
          marketCount: 4,
        },
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("returns an unobserved zero-trade row instead of failing when the wallet is not saved", async () => {
    const db = fakeDb([]);
    mockedGetPnlSlice.mockResolvedValue({
      kind: "ok",
      value: {
        interval: "1D",
        computedAt: "2026-05-01T00:00:00.000Z",
        history: [{ ts: "2026-05-01T00:00:00.000Z", pnl: 100 }],
      },
    });

    const result = await getTraderComparison(
      db,
      [{ address: WALLET, label: "Manual" }],
      "1D"
    );

    expect(result.traders[0]).toMatchObject({
      address: WALLET,
      label: "Manual",
      isObserved: false,
      traderKind: null,
      observedSince: null,
      lastObservedAt: null,
      observationStatus: null,
      pnl: { usdc: null },
      trades: {
        count: 0,
        buyCount: 0,
        sellCount: 0,
        notionalUsdc: 0,
        buyUsdc: 0,
        sellUsdc: 0,
        marketCount: 0,
      },
    });
  });

  it("surfaces P/L warnings without dropping saved fill aggregates", async () => {
    const db = fakeDb([
      {
        id: "wallet-1",
        label: "RN1",
        kind: "copy_target",
        first_observed_at: null,
        last_success_at: null,
        status: null,
        trade_count: 3,
        buy_count: 2,
        sell_count: 1,
        notional_usdc: 45,
        buy_usdc: 30,
        sell_usdc: 15,
        market_count: 2,
      },
    ]);
    mockedGetPnlSlice.mockResolvedValue({
      kind: "warn",
      warning: {
        slice: "pnl",
        code: "pnl",
        message: "P/L temporarily unavailable",
      },
    });

    const result = await getTraderComparison(db, [{ address: WALLET }], "1W");

    expect(result.traders[0]?.trades.count).toBe(3);
    expect(result.traders[0]?.pnl.usdc).toBeNull();
    expect(result.warnings).toEqual([
      {
        wallet: WALLET,
        code: "pnl",
        message: "P/L temporarily unavailable",
      },
    ]);
  });
});
