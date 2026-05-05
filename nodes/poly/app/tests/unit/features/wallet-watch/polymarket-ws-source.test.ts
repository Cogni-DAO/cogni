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
import { afterEach, describe, expect, it, vi } from "vitest";

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
    conditionId: `0x${"0".repeat(63)}1`,
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("unchanged scheduled asset refresh does not force a Data-API drain", async () => {
    vi.useFakeTimers();
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
      refreshAssetsIntervalMs: 10,
    });
    await Promise.resolve();
    await Promise.resolve();

    await source.fetchSince(0);
    expect(drainCount).toBe(1);

    await vi.advanceTimersByTimeAsync(10);
    const { fills } = await source.fetchSince(0);

    expect(fills).toHaveLength(0);
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

  it("safety-net drains when stale even with no WS wakeup", async () => {
    // SAFETY_NET_DRAIN — without this, a target's first BUY into a market
    // they don't already hold would not be detected for up to one
    // asset-refresh interval (60s default), a regression vs the polling
    // source. The safety net bounds worst-case detection latency.
    vi.useFakeTimers();
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
      safetyNetDrainIntervalMs: 30_000,
      heartbeatIntervalMs: 0,
    });
    await Promise.resolve();
    await Promise.resolve();

    // Cold-start drain.
    await source.fetchSince(0);
    expect(drainCount).toBe(1);

    // Within the safety-net window, no wake → fast path.
    await vi.advanceTimersByTimeAsync(20_000);
    await source.fetchSince(0);
    expect(drainCount).toBe(1);

    // Past the safety-net threshold, still no wake → forced drain.
    await vi.advanceTimersByTimeAsync(15_000);
    await source.fetchSince(0);
    expect(drainCount).toBe(2);

    source.stop();
  });

  it("WS wake resets the safety-net staleness clock", async () => {
    vi.useFakeTimers();
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
      safetyNetDrainIntervalMs: 30_000,
      heartbeatIntervalMs: 0,
    });
    await Promise.resolve();
    await Promise.resolve();

    await source.fetchSince(0);
    expect(drainCount).toBe(1);

    // 25s in: WS wake fires + drain triggered by wake. lastDrainAt resets.
    await vi.advanceTimersByTimeAsync(25_000);
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
    await source.fetchSince(0);
    expect(drainCount).toBe(2);

    // 20s after the wake-driven drain — still inside the window. No safety-net.
    await vi.advanceTimersByTimeAsync(20_000);
    await source.fetchSince(0);
    expect(drainCount).toBe(2);

    source.stop();
  });

  it("emits a periodic heartbeat info log with rolling counters", async () => {
    vi.useFakeTimers();
    const ws = makeFakeWs();
    const heartbeatLogs: Array<Record<string, unknown>> = [];
    const captureLogger = {
      child: () => captureLogger,
      debug: () => {},
      info: (obj: Record<string, unknown>) => {
        if (obj.event === "poly.wallet_watch.ws.heartbeat") {
          heartbeatLogs.push(obj);
        }
      },
      warn: () => {},
      error: () => {},
    } as unknown as Parameters<
      typeof createPolymarketWsActivitySource
    >[0]["logger"];
    const source = createPolymarketWsActivitySource({
      client: makeStubClient({
        positions: [makePosition(ASSET_ID)],
        trades: [],
      }),
      ws,
      wallet: TARGET_WALLET,
      logger: captureLogger,
      metrics: createRecordingMetrics(),
      heartbeatIntervalMs: 60_000,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(heartbeatLogs).toHaveLength(0);

    // Fire a few WS events between heartbeats so the window counters are
    // observable. Includes one matched + one non-matched asset.
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
    ws.fireTrade({
      event_type: "last_trade_price",
      asset_id: "different-asset",
      market: "",
      side: "BUY",
      price: 0.5,
      size: 10,
      timestamp: 1_700_000_501,
      fee_rate_bps: 0,
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(heartbeatLogs).toHaveLength(1);
    expect(heartbeatLogs[0]).toMatchObject({
      event: "poly.wallet_watch.ws.heartbeat",
      wallet: TARGET_WALLET,
      frames_received_window: 2,
      ws_wakes_window: 1,
      owned_assets_count: 1,
      heartbeat_interval_ms: 60_000,
    });

    // Counters reset between heartbeats — no new frames means zeros next time.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heartbeatLogs).toHaveLength(2);
    expect(heartbeatLogs[1]).toMatchObject({
      frames_received_window: 0,
      ws_wakes_window: 0,
    });

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

  describe("subscribeWake (push-on-wake fanout)", () => {
    it("fires registered callback synchronously on a watched-asset frame", async () => {
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

      let wakes = 0;
      const unsubscribe = source.subscribeWake?.(() => {
        wakes += 1;
      });
      expect(unsubscribe).toBeDefined();

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
      expect(wakes).toBe(1);
      source.stop();
    });

    it("does NOT fire callback for a non-watched asset", async () => {
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

      let wakes = 0;
      source.subscribeWake?.(() => {
        wakes += 1;
      });

      ws.fireTrade({
        event_type: "last_trade_price",
        asset_id: "not-our-asset",
        market: "",
        side: "BUY",
        price: 0.5,
        size: 10,
        timestamp: 1_700_000_500,
        fee_rate_bps: 0,
      });
      expect(wakes).toBe(0);
      source.stop();
    });

    it("returned unsubscribe stops further callbacks", async () => {
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

      let wakes = 0;
      const unsubscribe = source.subscribeWake?.(() => {
        wakes += 1;
      });

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
      expect(wakes).toBe(1);

      unsubscribe?.();

      ws.fireTrade({
        event_type: "last_trade_price",
        asset_id: ASSET_ID,
        market: "",
        side: "BUY",
        price: 0.5,
        size: 10,
        timestamp: 1_700_000_501,
        fee_rate_bps: 0,
      });
      expect(wakes).toBe(1);
      source.stop();
    });

    it("isolates a throwing callback so others still run and onTrade does not throw", async () => {
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

      let goodWakes = 0;
      source.subscribeWake?.(() => {
        throw new Error("first subscriber blew up");
      });
      source.subscribeWake?.(() => {
        goodWakes += 1;
      });

      // Must not throw out of fireTrade.
      expect(() =>
        ws.fireTrade({
          event_type: "last_trade_price",
          asset_id: ASSET_ID,
          market: "",
          side: "BUY",
          price: 0.5,
          size: 10,
          timestamp: 1_700_000_500,
          fee_rate_bps: 0,
        })
      ).not.toThrow();
      expect(goodWakes).toBe(1);
      source.stop();
    });

    it("warn-logs `wake_callback_threw` with asset_id when a callback throws", async () => {
      const ws = makeFakeWs();
      const warnLogs: Array<Record<string, unknown>> = [];
      const captureLogger = {
        child: () => captureLogger,
        debug: () => {},
        info: () => {},
        warn: (obj: Record<string, unknown>) => {
          if (obj.event === "poly.wallet_watch.ws.wake_callback_threw") {
            warnLogs.push(obj);
          }
        },
        error: () => {},
      } as unknown as Parameters<
        typeof createPolymarketWsActivitySource
      >[0]["logger"];

      const source = createPolymarketWsActivitySource({
        client: makeStubClient({
          positions: [makePosition(ASSET_ID)],
          trades: [],
        }),
        ws,
        wallet: TARGET_WALLET,
        logger: captureLogger,
        metrics: createRecordingMetrics(),
      });
      await flushMicrotasks();

      source.subscribeWake?.(() => {
        throw new Error("kaboom");
      });

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

      expect(warnLogs).toHaveLength(1);
      expect(warnLogs[0]).toMatchObject({
        event: "poly.wallet_watch.ws.wake_callback_threw",
        asset_id: ASSET_ID,
        err: "kaboom",
      });
      source.stop();
    });

    it("stop() clears wake listeners (no callback after stop)", async () => {
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

      let wakes = 0;
      source.subscribeWake?.(() => {
        wakes += 1;
      });

      source.stop();

      // Trade listener already removed by stop(); even if a stale frame
      // somehow reached the source, wakeListeners is empty.
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
      expect(wakes).toBe(0);
    });
  });
});
