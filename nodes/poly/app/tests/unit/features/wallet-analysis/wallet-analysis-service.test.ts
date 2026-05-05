// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/wallet-analysis-service` (unit)
 * Purpose: Verifies `getExecutionSlice` splits positions into `live_positions` and `closed_positions`, applies separate caps, and skips CLOB price history for closed assets.
 * Scope: Covers live/closed split logic, EXECUTION_OPEN_LIMIT (18), EXECUTION_HISTORY_LIMIT (30), and CLOB-skip-for-closed invariant. Does NOT cover snapshot/trades/balance slices.
 * Invariants:
 *   - live_positions contains only open/redeemable rows; closed_positions contains only closed rows.
 *   - live_positions is capped at 18; closed_positions is capped at 30.
 *   - CLOB `prices-history` is not fetched for assets whose position is closed.
 * Side-effects: none (all upstream clients mocked via __setClientsForTests)
 * Notes: TTL cache cleared in afterEach to prevent inter-test coalescing.
 * Links: nodes/poly/app/src/features/wallet-analysis/server/wallet-analysis-service.ts
 * @public
 */

import {
  PolymarketClobPublicClient,
  PolymarketDataApiClient,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTtlCache } from "@/features/wallet-analysis/server/coalesce";
import {
  __setClientsForTests,
  getDistributionsSlice,
  getExecutionSlice,
  getSnapshotSlice,
} from "@/features/wallet-analysis/server/wallet-analysis-service";

function makeTrade(
  asset: string,
  side: "BUY" | "SELL",
  ts: number,
  size = 10,
  price = 0.5
) {
  return {
    asset,
    proxyWallet: "0xproxy",
    side,
    size,
    price,
    timestamp: ts,
    conditionId: `cid-${asset}`,
    title: `Market ${asset}`,
    outcome: "YES",
    slug: null,
    eventSlug: null,
  };
}

function makePosition(asset: string, currentSize = 5) {
  return {
    asset,
    proxyWallet: "0xproxy",
    conditionId: `cid-${asset}`,
    size: currentSize,
    initialValue: currentSize * 0.5,
    currentValue: currentSize * 0.6,
    cashPnl: 0.5,
    percentPnl: 5,
    realizedPnl: 0,
    avgPrice: 0.5,
    curPrice: 0.6,
    title: `Market ${asset}`,
    outcome: "YES",
    slug: null,
    eventSlug: null,
    redeemable: false,
  };
}

describe("getExecutionSlice — live/closed split", () => {
  afterEach(() => {
    __setClientsForTests({});
    clearTtlCache();
  });

  it("puts open positions in live_positions and closed in closed_positions", async () => {
    const NOW = Math.floor(Date.now() / 1000);

    // 3 open assets (have current positions), 2 closed (trade-only, no position)
    const openAssets = ["a1", "a2", "a3"];
    const closedAssets = ["c1", "c2"];

    const dataApi = new PolymarketDataApiClient({
      fetch: vi
        .fn()
        .mockImplementation(
          async (
            url: string
          ): Promise<{ ok: boolean; json: () => unknown }> => {
            if (url.includes("/positions")) {
              return {
                ok: true,
                json: () => openAssets.map((a) => makePosition(a)),
              };
            }
            // trades: BUY + SELL for closed, BUY-only for open
            const trades = [
              ...openAssets.map((a) => makeTrade(a, "BUY", NOW - 3600)),
              ...closedAssets.flatMap((a) => [
                makeTrade(a, "BUY", NOW - 7200),
                makeTrade(a, "SELL", NOW - 3600, 10, 0.55),
              ]),
            ];
            return { ok: true, json: () => trades };
          }
        ),
    });

    const clobPublic = new PolymarketClobPublicClient({
      fetch: vi.fn().mockResolvedValue({ ok: true, json: () => [] }),
    });

    __setClientsForTests({ dataApi, clobPublic });

    const result = await getExecutionSlice(
      "0xabcdef1234567890abcdef1234567890abcdef12"
    );

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
    const NOW = Math.floor(Date.now() / 1000);
    const assets = Array.from({ length: 25 }, (_, i) => `asset${i}`);

    const dataApi = new PolymarketDataApiClient({
      fetch: vi
        .fn()
        .mockImplementation(
          async (
            url: string
          ): Promise<{ ok: boolean; json: () => unknown }> => {
            if (url.includes("/positions")) {
              return {
                ok: true,
                json: () => assets.map((a) => makePosition(a)),
              };
            }
            return {
              ok: true,
              json: () => assets.map((a) => makeTrade(a, "BUY", NOW - 3600)),
            };
          }
        ),
    });

    const clobPublic = new PolymarketClobPublicClient({
      fetch: vi.fn().mockResolvedValue({ ok: true, json: () => [] }),
    });

    __setClientsForTests({ dataApi, clobPublic });

    const result = await getExecutionSlice(
      "0xabcdef1234567890abcdef1234567890abcdef12"
    );

    expect(result.live_positions.length).toBeLessThanOrEqual(18);
    expect(result.closed_positions).toHaveLength(0);
  });

  it("caps closed_positions at EXECUTION_HISTORY_LIMIT (30)", async () => {
    const NOW = Math.floor(Date.now() / 1000);
    const assets = Array.from({ length: 40 }, (_, i) => `closed${i}`);

    const dataApi = new PolymarketDataApiClient({
      fetch: vi
        .fn()
        .mockImplementation(
          async (
            url: string
          ): Promise<{ ok: boolean; json: () => unknown }> => {
            if (url.includes("/positions")) {
              return { ok: true, json: () => [] };
            }
            // All closed: BUY + SELL
            const trades = assets.flatMap((a) => [
              makeTrade(a, "BUY", NOW - 7200),
              makeTrade(a, "SELL", NOW - 3600, 10, 0.55),
            ]);
            return { ok: true, json: () => trades };
          }
        ),
    });

    const clobPublic = new PolymarketClobPublicClient({
      fetch: vi.fn().mockResolvedValue({ ok: true, json: () => [] }),
    });

    __setClientsForTests({ dataApi, clobPublic });

    const result = await getExecutionSlice(
      "0xabcdef1234567890abcdef1234567890abcdef12"
    );

    expect(result.live_positions).toHaveLength(0);
    expect(result.closed_positions.length).toBeLessThanOrEqual(30);
  });

  it("does not fetch CLOB price history for closed positions", async () => {
    const NOW = Math.floor(Date.now() / 1000);

    const dataApi = new PolymarketDataApiClient({
      fetch: vi
        .fn()
        .mockImplementation(
          async (
            url: string
          ): Promise<{ ok: boolean; json: () => unknown }> => {
            if (url.includes("/positions")) {
              return { ok: true, json: () => [makePosition("open1")] };
            }
            return {
              ok: true,
              json: () => [
                makeTrade("open1", "BUY", NOW - 3600),
                makeTrade("closed1", "BUY", NOW - 7200),
                makeTrade("closed1", "SELL", NOW - 3600, 10, 0.55),
              ],
            };
          }
        ),
    });

    const clobFetch = vi.fn().mockResolvedValue({ ok: true, json: () => [] });
    const clobPublic = new PolymarketClobPublicClient({ fetch: clobFetch });

    __setClientsForTests({ dataApi, clobPublic });

    await getExecutionSlice("0xabcdef1234567890abcdef1234567890abcdef12");

    // CLOB history should be fetched for open1 but NOT for closed1
    const clobUrls: string[] = clobFetch.mock.calls.map(
      (call: [string, ...unknown[]]) => call[0]
    );
    const historyUrlsForClosed = clobUrls.filter(
      (u) => u.includes("prices-history") && u.includes("closed1")
    );
    expect(historyUrlsForClosed).toHaveLength(0);
  });

  it("can return current positions without fetching trade history", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async (url: string): Promise<{ ok: boolean; json: () => unknown }> => {
          if (url.includes("/positions")) {
            return { ok: true, json: () => [makePosition("open1")] };
          }
          throw new Error("trade history should not be fetched");
        }
      );
    const dataApi = new PolymarketDataApiClient({ fetch: fetchMock });
    const clobPublic = new PolymarketClobPublicClient({
      fetch: vi.fn().mockResolvedValue({ ok: true, json: () => [] }),
    });

    __setClientsForTests({ dataApi, clobPublic });

    const result = await getExecutionSlice(
      "0xabcdef1234567890abcdef1234567890abcdef12",
      { includePriceHistory: false, includeTrades: false }
    );

    expect(result.live_positions).toHaveLength(1);
    expect(result.closed_positions).toHaveLength(0);
    expect(result.dailyTradeCounts.every((point) => point.n === 0)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/positions");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("limit=500");
  });
});

describe("getDistributionsSlice — historical observed fills", () => {
  afterEach(() => {
    __setClientsForTests({});
    clearTtlCache();
  });

  it("builds PR 1137 histograms from saved trader-fill history", async () => {
    const addr = "0xabcdef1234567890abcdef1234567890abcdef12";
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
        chain.where = () =>
          state.joined
            ? chain
            : (outcomeRows as unknown as Record<string, unknown>);
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

  it("computes snapshot metrics from poly_trader_fills + poly_market_outcomes", async () => {
    const addr = "0xabcdef1234567890abcdef1234567890abcdef12";
    // 1 BUY + 1 SELL on cid-a/asset-win (resolved winner → win),
    // 1 BUY on cid-b/asset-pending (no outcome row → still open).
    const fillRows = [
      {
        conditionId: "cid-a",
        tokenId: "asset-win",
        side: "BUY",
        price: "0.40000000",
        shares: "10.00000000",
        observedAt: new Date("2026-05-01T12:00:00.000Z"),
        raw: { outcome: "YES", attributes: { title: "Market A" } },
      },
      {
        conditionId: "cid-a",
        tokenId: "asset-win",
        side: "SELL",
        price: "0.80000000",
        shares: "10.00000000",
        observedAt: new Date("2026-05-02T12:00:00.000Z"),
        raw: { outcome: "YES", attributes: { title: "Market A" } },
      },
      {
        conditionId: "cid-b",
        tokenId: "asset-pending",
        side: "BUY",
        price: "0.30000000",
        shares: "20.00000000",
        observedAt: new Date("2026-05-03T12:00:00.000Z"),
        raw: { outcome: "YES", attributes: { title: "Market B" } },
      },
    ];
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
        chain.where = () =>
          state.joined
            ? chain
            : (outcomeRows as unknown as Record<string, unknown>);
        chain.orderBy = async () => fillRows;
        return chain;
      },
    };

    const result = await getSnapshotSlice(fakeDb as never, addr);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    // 1 resolved token (asset-win is closed+winner), 1 open token (asset-pending,
    // no outcome row).
    expect(result.value.resolvedPositions).toBe(1);
    expect(result.value.openPositions).toBe(1);
    expect(result.value.uniqueMarkets).toBe(2);
    // resolvedPositions=1 < default minResolvedForMetrics (5) → trueWinRatePct null.
    expect(result.value.trueWinRatePct).toBeNull();
  });

  it("returns warning on DB read failure", async () => {
    const failingDb = {
      select: () => {
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
});
