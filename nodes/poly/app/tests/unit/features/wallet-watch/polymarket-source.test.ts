// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/wallet-watch/polymarket-source.test`
 * Purpose: Unit tests for `createPolymarketActivitySource`. Validates cursor advance, empty-tx rejection + counter, fill-shape correctness, and skip bucketing.
 * Scope: Mocked `PolymarketDataApiClient` — no network. Uses real `createRecordingMetrics` + `noopLogger` from `@cogni/poly-market-provider`.
 * Invariants: CURSOR_IS_MAX_TIMESTAMP; DA_EMPTY_HASH_REJECTED; WALLET_WATCH_IS_GENERIC.
 * Side-effects: none
 * Links: src/features/wallet-watch/polymarket-source.ts
 * @internal
 */

import {
  createRecordingMetrics,
  noopLogger,
} from "@cogni/poly-market-provider";
import type {
  PolymarketDataApiClient,
  PolymarketUserTrade,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { describe, expect, it } from "vitest";

import {
  createPolymarketActivitySource,
  WALLET_WATCH_METRICS,
} from "@/features/wallet-watch/polymarket-source";

const TARGET_WALLET = "0xAAaaaaaAAaAaAaAAaAaaaAaaAaaAAaAaAaaAAaaa" as const;

/** Minimal stub of the Data-API client — only the methods the source calls. */
function makeStubClient(
  trades: PolymarketUserTrade[]
): PolymarketDataApiClient {
  return {
    async listUserActivity() {
      return trades;
    },
  } as unknown as PolymarketDataApiClient;
}

function makePagedStubClient(
  pages: PolymarketUserTrade[][]
): PolymarketDataApiClient & {
  calls: Array<{ limit?: number; offset?: number; sinceTs?: number }>;
} {
  const calls: Array<{ limit?: number; offset?: number; sinceTs?: number }> =
    [];
  return {
    calls,
    async listUserActivity(_wallet, params) {
      calls.push({
        limit: params?.limit,
        offset: params?.offset,
        sinceTs: params?.sinceTs,
      });
      return pages[calls.length - 1] ?? [];
    },
  } as unknown as PolymarketDataApiClient & {
    calls: Array<{ limit?: number; offset?: number; sinceTs?: number }>;
  };
}

function makeTrade(
  overrides: Partial<PolymarketUserTrade> & { timestamp: number }
): PolymarketUserTrade {
  return {
    proxyWallet: TARGET_WALLET,
    side: "BUY",
    asset: "12345",
    conditionId:
      "0x302f5a4e8b475db09ef63f2df542ce3330599c3c4b4aa58173208a60229e1374",
    size: 10,
    price: 0.5,
    timestamp: overrides.timestamp,
    title: "Some market",
    outcome: "YES",
    transactionHash: "0xdeadbeef",
    ...overrides,
  };
}

describe("createPolymarketActivitySource.fetchSince", () => {
  it("normalizes a valid Data-API trade into a Fill with the canonical fill_id", async () => {
    const trade = makeTrade({ timestamp: 1_713_302_400 });
    const metrics = createRecordingMetrics();
    const source = createPolymarketActivitySource({
      client: makeStubClient([trade]),
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics,
    });

    const { fills, newSince } = await source.fetchSince();
    expect(fills).toHaveLength(1);
    const fill = fills[0];
    expect(fill?.source).toBe("data-api");
    expect(fill?.fill_id).toBe(
      `data-api:${trade.transactionHash}:${trade.asset}:${trade.side}:${trade.timestamp}`
    );
    expect(fill?.target_wallet).toBe(TARGET_WALLET);
    expect(fill?.market_id).toBe(
      `prediction-market:polymarket:${trade.conditionId}`
    );
    // notional = size * price
    expect(fill?.size_usdc).toBeCloseTo(5, 6);
    expect(newSince).toBe(trade.timestamp);
  });

  it("rejects empty-transactionHash rows and increments skip counter", async () => {
    const badTrade = makeTrade({
      timestamp: 1_713_302_401,
      transactionHash: "",
    });
    const goodTrade = makeTrade({ timestamp: 1_713_302_402 });
    const metrics = createRecordingMetrics();
    const source = createPolymarketActivitySource({
      client: makeStubClient([badTrade, goodTrade]),
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics,
    });

    const { fills, newSince } = await source.fetchSince();
    expect(fills).toHaveLength(1);
    expect(fills[0]?.fill_id).toContain(goodTrade.transactionHash);
    // newSince includes the skipped row's timestamp — rejection is about
    // de-duping, not about ignoring cursor advance.
    expect(newSince).toBe(1_713_302_402);

    const skipCounter = metrics.emissions.find(
      (c) =>
        c.kind === "counter" &&
        c.name === WALLET_WATCH_METRICS.skipTotal &&
        c.labels.reason === "empty_transaction_hash"
    );
    expect(skipCounter).toBeDefined();
  });

  it("advances newSince to max(trade.timestamp) across the page", async () => {
    const metrics = createRecordingMetrics();
    const source = createPolymarketActivitySource({
      client: makeStubClient([
        makeTrade({ timestamp: 100 }),
        makeTrade({ timestamp: 300 }),
        makeTrade({ timestamp: 200 }),
      ]),
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics,
    });
    const { newSince } = await source.fetchSince(50);
    expect(newSince).toBe(300);
  });

  it("returns the input since when the page is empty", async () => {
    const metrics = createRecordingMetrics();
    const source = createPolymarketActivitySource({
      client: makeStubClient([]),
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics,
    });
    const { fills, newSince } = await source.fetchSince(42);
    expect(fills).toHaveLength(0);
    expect(newSince).toBe(42);
  });

  it("paginates until it reaches a short page for bursty observed wallets", async () => {
    const client = makePagedStubClient([
      [makeTrade({ timestamp: 300 }), makeTrade({ timestamp: 290 })],
      [makeTrade({ timestamp: 280 }), makeTrade({ timestamp: 270 })],
      [makeTrade({ timestamp: 260 })],
    ]);
    const metrics = createRecordingMetrics();
    const source = createPolymarketActivitySource({
      client,
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics,
      limit: 2,
      maxPages: 10,
    });

    const { fills, newSince } = await source.fetchSince(250);

    expect(fills).toHaveLength(5);
    expect(newSince).toBe(300);
    expect(client.calls).toEqual([
      { limit: 2, offset: 0, sinceTs: 250 },
      { limit: 2, offset: 2, sinceTs: 250 },
      { limit: 2, offset: 4, sinceTs: 250 },
    ]);
  });

  it("normalizer throw is caught — cursor advances, counter increments, loop not wedged", async () => {
    // Regression for B2 in review: a normalizer throw (schema drift, Zod
    // validation failure) previously aborted the page, left the cursor
    // unchanged, and the next tick re-crashed on the same row.
    const stubClient = {
      async listUserActivity() {
        // A "good" trade + a trade that would pass normalizer skip-checks
        // (non-empty tx, positive size/price, valid side, has asset/cond) but
        // produces an invalid `Fill` via schema drift. We simulate that by
        // injecting a proxyWallet that fails the `/^0x[a-fA-F0-9]{40}$/` regex
        // on FillSchema — the normalizer's defensive `FillSchema.parse` throws.
        return [
          makeTrade({ timestamp: 100 }),
          makeTrade({
            timestamp: 200,
            // Malformed wallet address — normalizer's `FillSchema.parse` throws.
            proxyWallet: "not-a-wallet",
          }),
          makeTrade({ timestamp: 300 }),
        ];
      },
    } as unknown as PolymarketDataApiClient;

    const metrics = createRecordingMetrics();
    const source = createPolymarketActivitySource({
      client: stubClient,
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics,
    });

    const { fills, newSince } = await source.fetchSince();
    // Two good rows normalized; one bad row skipped via catch.
    expect(fills).toHaveLength(2);
    // Cursor advances past ALL rows, including the crashing one — loop isn't wedged.
    expect(newSince).toBe(300);
    const normErr = metrics.emissions.find(
      (e) =>
        e.kind === "counter" &&
        e.name === WALLET_WATCH_METRICS.normalizeErrorsTotal
    );
    expect(normErr).toBeDefined();
  });

  it("buckets skip reasons with bounded labels", async () => {
    const metrics = createRecordingMetrics();
    const source = createPolymarketActivitySource({
      client: makeStubClient([
        makeTrade({ timestamp: 1, transactionHash: "" }),
        makeTrade({ timestamp: 2, price: 0 }),
        makeTrade({ timestamp: 3, size: 0 }),
      ]),
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics,
    });
    await source.fetchSince();
    const reasons = metrics.emissions
      .filter(
        (c) => c.kind === "counter" && c.name === WALLET_WATCH_METRICS.skipTotal
      )
      .map((c) => c.labels.reason);
    expect(reasons).toContain("empty_transaction_hash");
    expect(reasons).toContain("non_positive_price");
    expect(reasons).toContain("non_positive_size");
  });
});
