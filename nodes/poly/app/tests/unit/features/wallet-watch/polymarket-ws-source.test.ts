// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/wallet-watch/polymarket-ws-source.test`
 * Purpose: Unit tests for `createPolymarketWsActivitySource`. Covers WS-driven wakeup → Data-API drain → cursor advance, idle fast-path, and asset-subscription reconciliation. WebSocket itself is mocked through the `PolymarketWsClientHandle` boundary so tests are deterministic and offline.
 * Scope: Pure unit; no network. Uses `createRecordingMetrics` + `noopLogger` from `@cogni/poly-market-provider`.
 * Invariants: WS_NO_WALLET_IDENTITY (Data-API drain is canonical); CURSOR_IS_MAX_TIMESTAMP.
 * Side-effects: none (timers drained synchronously via vi.useFakeTimers when needed)
 * Links: src/features/wallet-watch/polymarket-ws-source.ts
 * @internal
 */

import {
  createRecordingMetrics,
  noopLogger,
} from "@cogni/poly-market-provider";
import type {
  PolymarketDataApiClient,
  PolymarketUserPosition,
  PolymarketUserTrade,
  PolymarketWsClientHandle,
  WsTradeEvent,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { describe, expect, it } from "vitest";

import {
  createPolymarketWsActivitySource,
  WALLET_WATCH_WS_METRICS,
} from "@/features/wallet-watch/polymarket-ws-source";

const TARGET_WALLET = "0xAAaaaaaAAaAaAaAAaAaaaAaaAaaAAaAaAaaAAaaa" as const;
const ASSET_ID = "12345";

function makeTrade(
  overrides: Partial<PolymarketUserTrade> & { timestamp: number }
): PolymarketUserTrade {
  return {
    proxyWallet: TARGET_WALLET,
    side: "BUY",
    asset: ASSET_ID,
    conditionId:
      "0x302f5a4e8b475db09ef63f2df542ce3330599c3c4b4aa58173208a60229e1374",
    size: 10,
    price: 0.5,
    timestamp: overrides.timestamp,
    title: "",
    outcome: "YES",
    transactionHash: "0xdeadbeef",
    ...overrides,
  };
}

function makePosition(asset: string): PolymarketUserPosition {
  return {
    proxyWallet: TARGET_WALLET,
    asset,
    conditionId: "0x" + "0".repeat(63) + "1",
    size: 1,
    avgPrice: 0.5,
    initialValue: 0.5,
    currentValue: 0.5,
    cashPnl: 0,
    percentPnl: 0,
    realizedPnl: 0,
    curPrice: 0.5,
    redeemable: false,
    mergeable: false,
  } as PolymarketUserPosition;
}

interface FakeWs extends PolymarketWsClientHandle {
  fireTrade(event: WsTradeEvent): void;
  subscribed: Set<string>;
  tradeListeners: Set<(e: WsTradeEvent) => void>;
}

function makeFakeWs(): FakeWs {
  const subscribed = new Set<string>();
  const tradeListeners = new Set<(e: WsTradeEvent) => void>();
  const stateListeners = new Set<() => void>();
  return {
    subscribed,
    tradeListeners,
    fireTrade(event) {
      for (const l of tradeListeners) l(event);
    },
    subscribeAsset(id) {
      subscribed.add(id);
    },
    unsubscribeAsset(id) {
      subscribed.delete(id);
    },
    listAssets() {
      return [...subscribed];
    },
    onTrade(listener) {
      tradeListeners.add(listener);
      return () => tradeListeners.delete(listener);
    },
    onState(listener) {
      // biome-ignore lint/suspicious/noExplicitAny: state listener type unused in tests
      stateListeners.add(listener as any);
      // biome-ignore lint/suspicious/noExplicitAny: same
      return () => stateListeners.delete(listener as any);
    },
    async close() {
      tradeListeners.clear();
      subscribed.clear();
    },
  };
}

function makeStubClient(opts: {
  positions: PolymarketUserPosition[];
  trades: PolymarketUserTrade[];
}): PolymarketDataApiClient {
  return {
    async listUserPositions() {
      return opts.positions;
    },
    async listUserActivity() {
      return opts.trades;
    },
  } as unknown as PolymarketDataApiClient;
}

async function flushMicrotasks() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("createPolymarketWsActivitySource", () => {
  it("subscribes to assets discovered from listUserPositions", async () => {
    const ws = makeFakeWs();
    const source = createPolymarketWsActivitySource({
      client: makeStubClient({
        positions: [makePosition(ASSET_ID), makePosition("99999")],
        trades: [],
      }),
      ws,
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics: createRecordingMetrics(),
      refreshAssetsIntervalMs: 60_000,
    });
    await flushMicrotasks();

    expect([...ws.subscribed].sort()).toEqual(["12345", "99999"]);
    source.stop();
    expect(ws.subscribed.size).toBe(0);
  });

  it("first fetchSince after construction drains the Data-API (cold-start prime)", async () => {
    const ws = makeFakeWs();
    const trade = makeTrade({ timestamp: 1_700_000_000 });
    const source = createPolymarketWsActivitySource({
      client: makeStubClient({
        positions: [makePosition(ASSET_ID)],
        trades: [trade],
      }),
      ws,
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics: createRecordingMetrics(),
    });
    await flushMicrotasks();

    const { fills, newSince } = await source.fetchSince();
    expect(fills).toHaveLength(1);
    expect(newSince).toBe(trade.timestamp);
    source.stop();
  });

  it("fetchSince fast-path returns empty when no WS wake-up arrived", async () => {
    const ws = makeFakeWs();
    let drainCount = 0;
    const client = {
      async listUserPositions() {
        return [makePosition(ASSET_ID)];
      },
      async listUserActivity() {
        drainCount += 1;
        return [];
      },
    } as unknown as PolymarketDataApiClient;
    const source = createPolymarketWsActivitySource({
      client,
      ws,
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics: createRecordingMetrics(),
    });
    await flushMicrotasks();

    // First call drains (cold-start prime).
    await source.fetchSince(0);
    expect(drainCount).toBe(1);

    // Second call without a wake-up takes the fast path.
    const { fills, newSince } = await source.fetchSince(100);
    expect(fills).toHaveLength(0);
    expect(newSince).toBe(100);
    expect(drainCount).toBe(1);
    source.stop();
  });

  it("WS wake-up on a watched asset triggers a drain on next fetchSince", async () => {
    const ws = makeFakeWs();
    let drainCount = 0;
    const trade = makeTrade({ timestamp: 1_700_000_500 });
    const client = {
      async listUserPositions() {
        return [makePosition(ASSET_ID)];
      },
      async listUserActivity() {
        drainCount += 1;
        return drainCount === 1 ? [] : [trade];
      },
    } as unknown as PolymarketDataApiClient;
    const metrics = createRecordingMetrics();
    const source = createPolymarketWsActivitySource({
      client,
      ws,
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics,
    });
    await flushMicrotasks();

    // Cold-start drain returns no trades.
    await source.fetchSince(0);
    expect(drainCount).toBe(1);

    // No wakeup yet — fast path.
    await source.fetchSince(0);
    expect(drainCount).toBe(1);

    // WS wakeup on watched asset.
    ws.fireTrade({
      event_type: "last_trade_price",
      asset_id: ASSET_ID,
      market: "",
      side: "BUY",
      price: 0.5,
      size: 10,
      timestamp: 1_700_000_500,
      fee_rate_bps: 0,
    });

    const { fills, newSince } = await source.fetchSince(0);
    expect(drainCount).toBe(2);
    expect(fills).toHaveLength(1);
    expect(newSince).toBe(trade.timestamp);
    expect(metrics.countsByName(WALLET_WATCH_WS_METRICS.wakeupTotal)).toBe(1);
    source.stop();
  });

  it("WS wake-up on a non-watched asset is ignored (no wake)", async () => {
    const ws = makeFakeWs();
    let drainCount = 0;
    const client = {
      async listUserPositions() {
        return [makePosition(ASSET_ID)];
      },
      async listUserActivity() {
        drainCount += 1;
        return [];
      },
    } as unknown as PolymarketDataApiClient;
    const source = createPolymarketWsActivitySource({
      client,
      ws,
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics: createRecordingMetrics(),
    });
    await flushMicrotasks();
    await source.fetchSince(0);
    expect(drainCount).toBe(1);

    ws.fireTrade({
      event_type: "last_trade_price",
      asset_id: "different-asset",
      market: "",
      side: "BUY",
      price: 0.5,
      size: 10,
      timestamp: 1_700_000_500,
      fee_rate_bps: 0,
    });

    const { fills } = await source.fetchSince(0);
    expect(fills).toHaveLength(0);
    expect(drainCount).toBe(1);
    source.stop();
  });

  it("stop() unsubscribes assets and removes the trade listener", async () => {
    const ws = makeFakeWs();
    const source = createPolymarketWsActivitySource({
      client: makeStubClient({
        positions: [makePosition(ASSET_ID)],
        trades: [],
      }),
      ws,
      wallet: TARGET_WALLET,
      logger: noopLogger,
      metrics: createRecordingMetrics(),
    });
    await flushMicrotasks();
    expect(ws.subscribed.size).toBe(1);
    expect(ws.tradeListeners.size).toBe(1);
    source.stop();
    expect(ws.subscribed.size).toBe(0);
    expect(ws.tradeListeners.size).toBe(0);
  });
});
