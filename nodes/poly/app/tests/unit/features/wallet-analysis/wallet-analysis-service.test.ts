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
import {
  computeWalletMetrics,
  type MarketResolutionInput,
  type WalletTradeInput,
} from "@cogni/poly-market-provider/analysis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTtlCache } from "@/features/wallet-analysis/server/coalesce";
import {
  __setClientsForTests,
  composeSnapshotFromAggregates,
  getBalanceSlice,
  getDistributionsSlice,
  getExecutionSlice,
  getSnapshotSlice,
  type PositionAggregate,
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
function makeFakeDb(opts: { positions: FakeDbRow[]; fills: FakeFillRow[] }) {
  return {
    /**
     * Execution slice now reads fills via raw `sql` template through `db.execute(...)`
     * (readFillsForActivePositionsFromDb). Match the field shape the helper expects
     * — already-aliased keys per the SELECT — and project from `opts.fills`.
     */
    execute() {
      return Promise.resolve(
        opts.fills.map((f) => ({
          conditionId: f.conditionId,
          tokenId: f.tokenId,
          side: f.side,
          price: f.price,
          shares: f.shares,
          observedAt: f.observedAt,
          raw: f.raw,
        }))
      );
    },
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
          // Chain shapes used by the slice queries:
          //   .where(...) (positions)                                                         → resolves rows
          //   .where(...).orderBy(...) (legacy)                                               → resolves rows
          //   .where(...).orderBy(...).limit(N) (bounded fill read, snapshot/dist/execution)  → resolves rows.slice(0, N)
          return Object.assign(Promise.resolve(rows), {
            orderBy: () =>
              Object.assign(Promise.resolve(rows), {
                limit: (n: number) => Promise.resolve(rows.slice(0, n)),
              }),
          });
        },
        orderBy() {
          return Object.assign(Promise.resolve(rows), {
            limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          });
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
        ...openAssets.map((a) => makeFill(a, "BUY", new Date(NOW - 3_600_000))),
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
    // task.5012 CP4: getDistributionsSlice now reads resolutions from
    // poly_market_outcomes via a second drizzle SELECT (no CLOB call). Build a
    // fresh chain per `select()` call so `state.joined` is per-query.
    const outcomeRows = [
      { conditionId: "cid-a", tokenId: "asset-win", outcome: "winner" },
      { conditionId: "cid-a", tokenId: "asset-loss", outcome: "loser" },
    ];
    const fakeDb = {
      select: () => {
        const state = { joined: false };
        const chain: Record<string, unknown> = {};
        chain.from = () => chain;
        chain.innerJoin = () => {
          state.joined = true;
          return chain;
        };
        chain.where = () => {
          // Outcomes branch resolves immediately (no orderBy/limit).
          if (!state.joined)
            return outcomeRows as unknown as Record<string, unknown>;
          // Joined fill branch supports .orderBy().limit() as the temp
          // distributions read uses (readWalletFillsTodoCp9).
          return Object.assign(Promise.resolve(rows), {
            orderBy: () =>
              Object.assign(Promise.resolve(rows), {
                limit: (n: number) => Promise.resolve(rows.slice(0, n)),
              }),
          });
        };
        chain.orderBy = async () => rows;
        return chain;
      },
    };

    const result = await getDistributionsSlice(
      fakeDb as never,
      addr,
      "historical"
    );

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

describe("getSnapshotSlice — DB-backed (task.5012 CP4)", () => {
  afterEach(() => {
    __setClientsForTests({});
    clearTtlCache();
  });

  it("computes snapshot metrics from SQL aggregates + poly_market_outcomes", async () => {
    // Snapshot now reads SQL aggregates (positions / dailyCounts / activity)
    // via db.execute(sql`...`); resolutions still through .select().from().where().
    // Fake injects canned aggregate rows in execute-call order matching the slice.
    const addr = "0xabcdef1234567890abcdef1234567890abcdef12";
    const fakeDb = makeSqlAggregateFakeDb({
      positionAggs: [
        // resolved winner: held=0 (10 buy / 10 sell), pnl = sellUsdc - buyUsdc = +4
        {
          conditionId: "cid-a",
          tokenId: "asset-win",
          buyUsdc: 4,
          sellUsdc: 8,
          buyShares: 10,
          sellShares: 10,
          firstBuyTs: 1761998400, // 2026-05-01T12:00 UTC
          lastTs: 1762084800,
        },
        // open: no outcome row
        {
          conditionId: "cid-b",
          tokenId: "asset-pending",
          buyUsdc: 6,
          sellUsdc: 0,
          buyShares: 20,
          sellShares: 0,
          firstBuyTs: 1762171200,
          lastTs: 1762171200,
        },
      ],
      dailyCounts: [{ day: "2026-05-03", n: 1 }],
      activity: { recent30: 3, latestTs: 1762171200 },
      outcomes: [
        { conditionId: "cid-a", tokenId: "asset-win", outcome: "winner" },
        { conditionId: "cid-a", tokenId: "asset-loss", outcome: "loser" },
      ],
      titles: [
        { conditionId: "cid-b", title: "Market B" },
        { conditionId: "cid-a", title: "Market A" },
      ],
    });

    const result = await getSnapshotSlice(fakeDb as never, addr);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.resolvedPositions).toBe(1);
    expect(result.value.openPositions).toBe(1);
    expect(result.value.uniqueMarkets).toBe(2);
    // resolvedPositions=1 < SNAPSHOT_MIN_RESOLVED (5) → trueWinRatePct null.
    expect(result.value.trueWinRatePct).toBeNull();
    // topMarkets sourced from the separate title fetch, ordered by recency
    // (cid-b lastTs > cid-a lastTs → cid-b's title surfaces first).
    expect(result.value.topMarkets).toEqual(["Market B", "Market A"]);
  });

  it("returns warning on DB read failure", async () => {
    const failingDb = {
      execute: () => {
        throw new Error("db down");
      },
    };
    const result = await getSnapshotSlice(
      failingDb as never,
      "0xabcdef1234567890abcdef1234567890abcdef12"
    );
    expect(result.kind).toBe("warn");
    if (result.kind !== "warn") return;
    expect(result.warning.slice).toBe("snapshot");
  });

  it("scales to 100K positions without truncation (SQL aggregation, not raw fills)", async () => {
    // Simulates a whale wallet whose fills compress to many distinct markets.
    // The architectural test: even with 100K position aggregates, the slice
    // returns ok and uniqueMarkets reflects EVERY market — no truncation cap.
    // (Pre-CP4-architecture this path loaded raw fills and OOMed; SQL pre-agg
    // means JS only sees ≈uniqueMarkets rows.)
    const positionAggs = Array.from({ length: 100_000 }, (_, i) => ({
      conditionId: `cid-${i}`,
      tokenId: `tok-${i}`,
      buyUsdc: 1,
      sellUsdc: 0,
      buyShares: 1,
      sellShares: 0,
      firstBuyTs: 1761998400 + i,
      lastTs: 1761998400 + i,
    }));
    const fakeDb = makeSqlAggregateFakeDb({
      positionAggs,
      dailyCounts: [],
      activity: { recent30: 100_000, latestTs: 1762000000 },
      outcomes: [],
    });
    const result = await getSnapshotSlice(fakeDb as never, ADDR);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.uniqueMarkets).toBe(100_000);
    expect(result.value.openPositions).toBe(100_000);
  });
});

/**
 * Parity oracle — asserts `composeSnapshotFromAggregates(SQL-aggs, …)` is
 * output-equivalent to `computeWalletMetrics(raw-fills, …)` for the snapshot
 * surface fields, across several synthetic wallet shapes. Catches subtle
 * SQL-vs-JS drift (off-by-one rounding, sort-order differences, etc.) that
 * RN1's own data wouldn't surface.
 *
 * The oracle is a pure-JS test: we synthesize raw fills, then build the
 * `PositionAggregate[]` exactly as the SQL helper would, then run both paths
 * and compare. No fake DB shape involved.
 */
describe("snapshot parity — SQL-aggregated path matches computeWalletMetrics", () => {
  const NOW_SEC = 1_762_000_000; // fixed clock for both paths

  /** Build PositionAggregate[] from raw fills, mirroring readPositionAggregatesFromDb. */
  function jsAggregate(
    fills: ReadonlyArray<WalletTradeInput>
  ): PositionAggregate[] {
    const byToken = new Map<string, PositionAggregate>();
    for (const t of fills) {
      const a = byToken.get(t.asset) ?? {
        conditionId: t.conditionId,
        tokenId: t.asset,
        buyUsdc: 0,
        sellUsdc: 0,
        buyShares: 0,
        sellShares: 0,
        firstBuyTs: -1,
        lastTs: 0,
      };
      const usd = t.size * t.price;
      if (t.side.toUpperCase() === "BUY") {
        a.buyUsdc += usd;
        a.buyShares += t.size;
        a.firstBuyTs =
          a.firstBuyTs < 0 ? t.timestamp : Math.min(a.firstBuyTs, t.timestamp);
      } else {
        a.sellUsdc += usd;
        a.sellShares += t.size;
      }
      a.lastTs = Math.max(a.lastTs, t.timestamp);
      byToken.set(t.asset, a);
    }
    return [...byToken.values()];
  }

  /** Build a {conditionId → title} map from raw fills (mirrors readTopMarketTitlesFromDb). */
  function jsTitles(
    fills: ReadonlyArray<WalletTradeInput>
  ): Map<string, string> {
    const byCid = new Map<string, string>();
    for (const t of fills) {
      if (!t.title) continue;
      const existing = byCid.get(t.conditionId);
      if (!existing || t.title > existing) byCid.set(t.conditionId, t.title);
    }
    return byCid;
  }

  function jsDailyCounts(
    fills: ReadonlyArray<WalletTradeInput>,
    windowDays: number
  ): Array<{ day: string; n: number }> {
    const cutoff = NOW_SEC - windowDays * 86_400;
    const byDay = new Map<string, number>();
    for (const f of fills) {
      if (f.timestamp < cutoff) continue;
      const day = new Date(f.timestamp * 1_000).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    return [...byDay.entries()].map(([day, n]) => ({ day, n }));
  }

  function jsActivity(fills: ReadonlyArray<WalletTradeInput>): {
    recent30: number;
    latestTs: number;
  } {
    const cutoff = NOW_SEC - 30 * 86_400;
    let recent30 = 0;
    let latestTs = 0;
    for (const f of fills) {
      if (f.timestamp >= cutoff) recent30++;
      if (f.timestamp > latestTs) latestTs = f.timestamp;
    }
    return { recent30, latestTs };
  }

  type Scenario = {
    name: string;
    fills: ReadonlyArray<WalletTradeInput>;
    resolutions: Map<string, MarketResolutionInput>;
  };

  const scenarios: Scenario[] = [
    {
      // 6 resolved (5 wins, 1 loss) so trueWinRatePct surfaces past
      // SNAPSHOT_MIN_RESOLVED=5; 2 still-open positions on different markets.
      name: "mixed wins/losses + open positions",
      fills: (() => {
        const out: WalletTradeInput[] = [];
        for (let i = 0; i < 6; i++) {
          const cid = `cid-w${i}`;
          const tok = `tok-w${i}`;
          out.push({
            conditionId: cid,
            asset: tok,
            side: "BUY",
            size: 10,
            price: 0.4,
            timestamp: NOW_SEC - (10 - i) * 3600,
            title: `Won market ${i}`,
          });
          out.push({
            conditionId: cid,
            asset: tok,
            side: "SELL",
            size: 10,
            price: i === 0 ? 0.1 : 0.7, // first one is the loss
            timestamp: NOW_SEC - (9 - i) * 3600,
            title: `Won market ${i}`,
          });
        }
        out.push({
          conditionId: "cid-open-1",
          asset: "tok-open-1",
          side: "BUY",
          size: 5,
          price: 0.6,
          timestamp: NOW_SEC - 7200,
          title: "Open A",
        });
        out.push({
          conditionId: "cid-open-2",
          asset: "tok-open-2",
          side: "BUY",
          size: 8,
          price: 0.3,
          timestamp: NOW_SEC - 3600,
          title: "Open B",
        });
        return out;
      })(),
      resolutions: new Map(
        Array.from({ length: 6 }, (_, i) => [
          `cid-w${i}`,
          {
            closed: true,
            tokens: [
              { token_id: `tok-w${i}`, winner: i !== 0 }, // loss for i=0, wins for i=1..5
            ],
          } satisfies MarketResolutionInput,
        ])
      ),
    },
    {
      // No resolved positions → metrics that gate on minResolved should be null.
      name: "all-open wallet (cold start)",
      fills: [
        {
          conditionId: "cid-x",
          asset: "tok-x",
          side: "BUY",
          size: 10,
          price: 0.4,
          timestamp: NOW_SEC - 3600,
          title: "Open Only",
        },
      ],
      resolutions: new Map(),
    },
    {
      // Empty wallet — both paths should agree on zeroed shape.
      name: "empty wallet",
      fills: [],
      resolutions: new Map(),
    },
  ];

  for (const sc of scenarios) {
    it(`parity: ${sc.name}`, () => {
      const positions = jsAggregate(sc.fills);
      const titles = jsTitles(sc.fills);
      const dailyRows = jsDailyCounts(sc.fills, 14);
      const activity = jsActivity(sc.fills);

      // SQL path
      const sqlOut = composeSnapshotFromAggregates({
        positions,
        titles,
        dailyRows,
        activity,
        resolutions: sc.resolutions,
        window: 14,
        topLimit: 4,
        minResolved: 5,
      });

      // JS reference path
      const jsOut = computeWalletMetrics(sc.fills, sc.resolutions, {
        nowSec: NOW_SEC,
        minResolvedForMetrics: 5,
        dailyWindow: 14,
        topMarketsLimit: 4,
      });

      // Field-by-field equality across the snapshot surface (PnL fields are
      // intentionally not surfaced by snapshot per PNL_NOT_IN_SNAPSHOT).
      expect(sqlOut.resolvedPositions).toBe(jsOut.resolvedPositions);
      expect(sqlOut.wins).toBe(jsOut.wins);
      expect(sqlOut.losses).toBe(jsOut.losses);
      expect(sqlOut.trueWinRatePct).toBe(jsOut.trueWinRatePct);
      expect(sqlOut.medianDurationHours).toBe(jsOut.medianDurationHours);
      expect(sqlOut.openPositions).toBe(jsOut.openPositions);
      expect(sqlOut.openNetCostUsdc).toBe(jsOut.openNetCostUsdc);
      expect(sqlOut.uniqueMarkets).toBe(jsOut.uniqueMarkets);
      expect(sqlOut.tradesPerDay30d).toBe(jsOut.tradesPerDay30d);
      expect([...sqlOut.topMarkets]).toEqual([...jsOut.topMarkets]);
      // dailyCounts: SQL path produces the SAME 14-day window from the same
      // pre-aggregated input, so day-by-day comparison should hold.
      // (Both implementations clamp days-since-last-trade similarly.)
      expect(sqlOut.dailyCounts.length).toBe(jsOut.dailyCounts.length);
    });
  }
});

/**
 * Fake DB used by the SQL-aggregated snapshot path. Implements:
 *   - db.execute(sql`...`)  →  returns canned aggregate rows in call order:
 *       1st call: positionAggs   (readPositionAggregatesFromDb)
 *       2nd call: dailyCounts    (readDailyCountsFromDb)
 *       3rd call: activity-row   (readActivityCountsFromDb)
 *       4th call: titles         (readTopMarketTitlesFromDb)
 *   - db.select().from().where()  →  outcome rows (readResolutionsForConditions)
 * Order assumption matches the slice's call sequence:
 *   Promise.all([positions, dailyRows, activity])  →  Promise.all([resolutions, titles])
 * If the slice is reordered, adjust this fake.
 */
function makeSqlAggregateFakeDb(opts: {
  positionAggs: ReadonlyArray<{
    conditionId: string;
    tokenId: string;
    buyUsdc: number;
    sellUsdc: number;
    buyShares: number;
    sellShares: number;
    firstBuyTs: number;
    lastTs: number;
  }>;
  dailyCounts: ReadonlyArray<{ day: string; n: number }>;
  activity: { recent30: number; latestTs: number };
  outcomes: ReadonlyArray<{
    conditionId: string;
    tokenId: string;
    outcome: string;
  }>;
  titles?: ReadonlyArray<{ conditionId: string; title: string }>;
}) {
  const executeQueue: Array<unknown> = [
    opts.positionAggs,
    opts.dailyCounts,
    [opts.activity],
    opts.titles ?? [],
  ];
  return {
    execute() {
      const next = executeQueue.shift() ?? [];
      // postgres-js shape: array directly. node-pg shape: { rows: [...] }.
      // Slice handlers are tolerant of both — return array form.
      return Promise.resolve(next);
    },
    select() {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => Promise.resolve(opts.outcomes);
      return chain;
    },
  };
}
