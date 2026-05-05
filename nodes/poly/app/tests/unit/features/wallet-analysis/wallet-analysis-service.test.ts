// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/wallet-analysis-service` (unit)
 * Purpose: Verifies `getExecutionSlice` reads positions/trades from the DB
 *   mirrors (task.5012 CP5) and `getBalanceSlice` aggregates the same
 *   `poly_trader_current_positions` rows. Live/closed split, EXECUTION_OPEN_LIMIT,
 *   EXECUTION_HISTORY_LIMIT, and the CLOB-history-open-only invariant remain.
 * Scope: Covers the DB-only page-load contract (no Data API hit) and the v0
 *   `PAGE_LOAD_DB_ONLY_EXCEPT_PRICE_HISTORY` carve-out for CLOB price-history.
 * Invariants:
 *   - PAGE_LOAD_DB_ONLY (task.5012 CP5): no `listUserPositions` / `listUserTrades`.
 *   - PAGE_LOAD_DB_ONLY_EXCEPT_PRICE_HISTORY: `getPriceHistory` only on open rows.
 *   - live_positions contains only open/redeemable rows (cap 18); closed_positions only closed rows (cap 30).
 * Side-effects: none (DB calls go through a fake drizzle, CLOB through __setClientsForTests)
 * Notes: TTL cache cleared in afterEach to prevent inter-test coalescing.
 * Links: nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts, work/items/task.5012, work/items/task.5015
 * @public
 */

import {
  polyTraderCurrentPositions,
  polyTraderFills,
} from "@cogni/poly-db-schema/trader-activity";
import { PolymarketClobPublicClient } from "@cogni/poly-market-provider/adapters/polymarket";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTtlCache } from "@/features/wallet-analysis/server/coalesce";
import {
  __setClientsForTests,
  getBalanceSlice,
  getDistributionsSlice,
  getExecutionSlice,
} from "@/features/wallet-analysis/server/wallet-analysis-service";

type FakeDbRow = {
  conditionId: string;
  tokenId: string;
  shares: string;
  costBasisUsdc: string;
  currentValueUsdc: string;
  avgPrice: string;
  lastObservedAt: Date;
  firstObservedAt: Date;
  raw: Record<string, unknown> | null;
};

type FakeFillRow = {
  conditionId: string;
  tokenId: string;
  side: "BUY" | "SELL";
  price: string;
  shares: string;
  observedAt: Date;
  raw: Record<string, unknown> | null;
};

/**
 * Drizzle's chained builder is fluent and thenable. Both call shapes here are
 *   db.select(...).from(table).innerJoin(...).where(...)                  (positions)
 *   db.select(...).from(table).innerJoin(...).where(...).orderBy(...)     (fills)
 * Identity-compare the table to dispatch fake rows; both terminal steps
 * (`.where(...)` and `.orderBy(...)`) resolve to the same row set.
 */
function makeFakeDb(opts: {
  positions: FakeDbRow[];
  fills: FakeFillRow[];
}) {
  return {
    select() {
      let rows: unknown[] = [];
      const builder = {
        from(table: unknown) {
          if (table === polyTraderFills) rows = opts.fills as unknown[];
          else if (table === polyTraderCurrentPositions)
            rows = opts.positions as unknown[];
          else rows = [];
          return builder;
        },
        innerJoin() {
          return builder;
        },
        where() {
          return Object.assign(Promise.resolve(rows), {
            orderBy: () => Promise.resolve(rows),
          });
        },
        orderBy() {
          return Promise.resolve(rows);
        },
      };
      return builder;
    },
  } as never;
}

const ADDR = "0xabcdef1234567890abcdef1234567890abcdef12";

function makePosition(
  asset: string,
  overrides: Partial<FakeDbRow> = {}
): FakeDbRow {
  return {
    conditionId: `cid-${asset}`,
    tokenId: asset,
    shares: "5",
    costBasisUsdc: "2.5",
    currentValueUsdc: "3",
    avgPrice: "0.5",
    lastObservedAt: new Date(),
    firstObservedAt: new Date(Date.now() - 3_600_000),
    raw: {
      title: `Market ${asset}`,
      outcome: "YES",
      curPrice: 0.6,
    },
    ...overrides,
  };
}

function makeFill(
  asset: string,
  side: "BUY" | "SELL",
  observedAt: Date,
  shares = "10",
  price = "0.5"
): FakeFillRow {
  return {
    conditionId: `cid-${asset}`,
    tokenId: asset,
    side,
    price,
    shares,
    observedAt,
    raw: { title: `Market ${asset}`, outcome: "YES" },
  };
}

describe("getExecutionSlice — DB-backed live/closed split", () => {
  afterEach(() => {
    __setClientsForTests({});
    clearTtlCache();
  });

  it("puts open positions in live_positions and closed in closed_positions", async () => {
    const NOW = Date.now();
    const openAssets = ["a1", "a2", "a3"];
    const closedAssets = ["c1", "c2"];

    const db = makeFakeDb({
      positions: openAssets.map((asset) => makePosition(asset)),
      fills: [
        ...openAssets.map((a) =>
          makeFill(a, "BUY", new Date(NOW - 3_600_000))
        ),
        ...closedAssets.flatMap((a) => [
          makeFill(a, "BUY", new Date(NOW - 7_200_000)),
          makeFill(a, "SELL", new Date(NOW - 3_600_000), "10", "0.55"),
        ]),
      ],
    });

    const clobPublic = new PolymarketClobPublicClient({
      fetch: vi.fn().mockResolvedValue({ ok: true, json: () => [] }),
    });
    __setClientsForTests({ clobPublic });

    const result = await getExecutionSlice(db as never, ADDR);

    expect(result.live_positions).toHaveLength(3);
    expect(result.closed_positions).toHaveLength(2);
    for (const p of result.live_positions) {
      expect(["open", "redeemable"]).toContain(p.status);
    }
    for (const p of result.closed_positions) {
      expect(p.status).toBe("closed");
    }
  });

  it("caps live_positions at EXECUTION_OPEN_LIMIT (18)", async () => {
    const NOW = Date.now();
    const assets = Array.from({ length: 25 }, (_, i) => `asset${i}`);
    const db = makeFakeDb({
      positions: assets.map((a) => makePosition(a)),
      fills: assets.map((a) => makeFill(a, "BUY", new Date(NOW - 3_600_000))),
    });
    const clobPublic = new PolymarketClobPublicClient({
      fetch: vi.fn().mockResolvedValue({ ok: true, json: () => [] }),
    });
    __setClientsForTests({ clobPublic });

    const result = await getExecutionSlice(db as never, ADDR);

    expect(result.live_positions.length).toBeLessThanOrEqual(18);
    expect(result.closed_positions).toHaveLength(0);
  });

  it("caps closed_positions at EXECUTION_HISTORY_LIMIT (30)", async () => {
    const NOW = Date.now();
    const assets = Array.from({ length: 40 }, (_, i) => `closed${i}`);
    const db = makeFakeDb({
      positions: [],
      fills: assets.flatMap((a) => [
        makeFill(a, "BUY", new Date(NOW - 7_200_000)),
        makeFill(a, "SELL", new Date(NOW - 3_600_000), "10", "0.55"),
      ]),
    });
    const clobPublic = new PolymarketClobPublicClient({
      fetch: vi.fn().mockResolvedValue({ ok: true, json: () => [] }),
    });
    __setClientsForTests({ clobPublic });

    const result = await getExecutionSlice(db as never, ADDR);

    expect(result.live_positions).toHaveLength(0);
    expect(result.closed_positions.length).toBeLessThanOrEqual(30);
  });

  it("does not fetch CLOB price history for closed positions", async () => {
    const NOW = Date.now();
    const db = makeFakeDb({
      positions: [makePosition("open1")],
      fills: [
        makeFill("open1", "BUY", new Date(NOW - 3_600_000)),
        makeFill("closed1", "BUY", new Date(NOW - 7_200_000)),
        makeFill("closed1", "SELL", new Date(NOW - 3_600_000), "10", "0.55"),
      ],
    });

    const clobFetch = vi.fn().mockResolvedValue({ ok: true, json: () => [] });
    const clobPublic = new PolymarketClobPublicClient({ fetch: clobFetch });
    __setClientsForTests({ clobPublic });

    await getExecutionSlice(db as never, ADDR);

    const clobUrls: string[] = clobFetch.mock.calls.map(
      (call: [string, ...unknown[]]) => call[0]
    );
    const historyUrlsForClosed = clobUrls.filter(
      (u) => u.includes("prices-history") && u.includes("closed1")
    );
    expect(historyUrlsForClosed).toHaveLength(0);
  });

  it("can return current positions without trades, and never reads the Data API", async () => {
    const db = makeFakeDb({
      positions: [makePosition("open1")],
      fills: [],
    });
    // CLOB client must not be hit for closed-side history; it's still allowed
    // for the open row but only when includePriceHistory=true.
    const clobFetch = vi.fn().mockResolvedValue({ ok: true, json: () => [] });
    const clobPublic = new PolymarketClobPublicClient({ fetch: clobFetch });
    __setClientsForTests({ clobPublic });

    const result = await getExecutionSlice(db as never, ADDR, {
      includePriceHistory: false,
      includeTrades: false,
    });

    expect(result.live_positions).toHaveLength(1);
    expect(result.closed_positions).toHaveLength(0);
    expect(result.dailyTradeCounts.every((point) => point.n === 0)).toBe(true);
    expect(clobFetch).not.toHaveBeenCalled();
  });
});

describe("getBalanceSlice — DB-backed positions aggregate", () => {
  afterEach(() => {
    __setClientsForTests({});
    clearTtlCache();
  });

  it("sums currentValueUsdc across active rows from the DB", async () => {
    const db = makeFakeDb({
      positions: [
        makePosition("a", { currentValueUsdc: "12.5" }),
        makePosition("b", { currentValueUsdc: "0.49" }),
        makePosition("c", { currentValueUsdc: "100" }),
      ],
      fills: [],
    });

    const result = await getBalanceSlice(db as never, ADDR);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.positions).toBeCloseTo(112.99, 2);
    expect(result.value.total).toBeCloseTo(112.99, 2);
    expect(result.value.isOperator).toBe(false);
  });

  it("returns zero when the wallet has no DB-mirrored positions", async () => {
    const db = makeFakeDb({ positions: [], fills: [] });

    const result = await getBalanceSlice(db as never, ADDR);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.positions).toBe(0);
    expect(result.value.total).toBe(0);
  });
});

describe("getDistributionsSlice — historical observed fills", () => {
  afterEach(() => {
    __setClientsForTests({});
    clearTtlCache();
  });

  it("builds PR 1137 histograms from saved trader-fill history", async () => {
    const addr = ADDR;
    const rows = [
      {
        conditionId: "cid-a",
        tokenId: "asset-win",
        side: "BUY",
        price: "0.50000000",
        shares: "20.00000000",
        observedAt: new Date("2026-05-01T12:00:00.000Z"),
        raw: {
          outcome: "YES",
          attributes: {
            title: "Will histograms render?",
            slug: "histograms-render",
            event_slug: "wallet-research",
          },
        },
      },
      {
        conditionId: "cid-a",
        tokenId: "asset-loss",
        side: "BUY",
        price: "0.25000000",
        shares: "40.00000000",
        observedAt: new Date("2026-05-02T18:00:00.000Z"),
        raw: {
          outcome: "NO",
          attributes: {
            title: "Will histograms render?",
            slug: "histograms-render",
            event_slug: "wallet-research",
          },
        },
      },
    ];
    const fakeDb = {
      select: () => fakeDb,
      from: () => fakeDb,
      innerJoin: () => fakeDb,
      where: () => fakeDb,
      orderBy: async () => rows,
    };
    __setClientsForTests({
      clobPublic: {
        async getMarketResolution() {
          return {
            closed: true,
            tokens: [
              { token_id: "asset-win", winner: true },
              { token_id: "asset-loss", winner: false },
            ],
          };
        },
      } as unknown as PolymarketClobPublicClient,
    });

    const result = await getDistributionsSlice(addr, "historical", {
      db: fakeDb as never,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.mode).toBe("historical");
    expect(result.value.range.n).toBe(2);
    expect(result.value.pendingShare.byCount).toBe(0);
    expect(
      result.value.tradeSize.buckets.reduce(
        (sum, bucket) =>
          sum +
          bucket.values.count.won +
          bucket.values.count.lost +
          bucket.values.count.pending,
        0
      )
    ).toBe(2);
  });
});
