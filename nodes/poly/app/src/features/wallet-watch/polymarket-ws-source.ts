// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-watch/polymarket-ws-source`
 * Purpose: `WalletActivitySource` implementation that uses a shared Polymarket Market-channel WebSocket as a wake-up signal, with a Data-API safety-net drain at parity-with-polling cadence. The only wallet-watch source as of task.0322 (replaced the prior unconditional 30s Data-API page-poll). Drain is triggered by either (a) a WS frame on a subscribed asset OR (b) the safety-net staleness threshold being crossed.
 * Scope: Composes a shared `PolymarketWsClientHandle` (one socket per pod) + the per-wallet `PolymarketDataApiClient`. Discovers the watched wallet's open-position assets at construction + on a refresh interval; subscribes those assets on the shared socket. Emits the same `Fill[]` shape and event names as the polling source so dashboards/alerts keep working.
 * Invariants:
 *   - WS_NO_WALLET_IDENTITY — Polymarket's public Market channel does NOT carry maker/taker addresses (verified against docs.polymarket.com 2026-05-01). The WS therefore acts as a wake-up signal; canonical fields (transactionHash, proxyWallet, exact size_usdc) come from the Data-API drain. This keeps `Fill.fill_id` shape identical to the polling source so dedupe in the mirror coordinator is preserved.
 *   - CURSOR_IS_MAX_TIMESTAMP — `newSince` semantics identical to polling source.
 *   - SHARED_SOCKET — one WS connection per pod, multiplexed across watched wallets via the asset-subscription set inside the client handle.
 *   - SAFETY_NET_DRAIN — `fetchSince` drains whenever `now - lastDrainAt >= safetyNetDrainIntervalMs`, even with no WS wake. Required because the WS Market channel only fires for assets we have already subscribed to, and `ownedAssets` is rebuilt from `listUserPositions` only on the asset-refresh interval. Without the safety net, a target's first BUY into a market they don't already hold would not be detected until the next asset-refresh tick (regression vs polling source). With the safety net set to the coordinator tick interval, worst-case detection latency matches the polling source for both new- and known-market trades.
 * Side-effects: subscribes to assets on the shared WS handle (constructor + refresh); HTTPS GETs to data-api.polymarket.com on each drain (wake-driven OR safety-net); logger + metrics; periodic heartbeat info log.
 * Links: docs https://docs.polymarket.com/developers/CLOB/websocket/wss-overview ; task.0322
 * @public
 */

import type {
  Fill,
  LoggerPort,
  MetricsPort,
} from "@cogni/poly-market-provider";
import {
  normalizePolymarketDataApiFill,
  type PolymarketDataApiClient,
  type PolymarketNormalizeSkipReason,
  type PolymarketWsClientHandle,
  type WsTradeEvent,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { EVENT_NAMES } from "@/shared/observability/events";

import {
  type NextFillsResult,
  WALLET_WATCH_METRICS,
  type WalletActivitySource,
} from "./types";

/** Counter name extension specific to the WS source. */
export const WALLET_WATCH_WS_METRICS = {
  /** `poly_mirror_ws_wakeup_total{wallet}` — WS frame received on a watched asset. */
  wakeupTotal: "poly_mirror_ws_wakeup_total",
  /** `poly_mirror_ws_subscriptions` — gauge-as-counter on subscribe events. */
  subscriptionsTotal: "poly_mirror_ws_subscriptions_total",
  /** `poly_mirror_ws_safety_net_drain_total{wallet}` — drain forced by staleness threshold (no WS wake within `safetyNetDrainIntervalMs`). */
  safetyNetDrainTotal: "poly_mirror_ws_safety_net_drain_total",
} as const;

/** Default safety-net staleness threshold (ms). Matches the coordinator tick. */
const DEFAULT_SAFETY_NET_DRAIN_INTERVAL_MS = 30_000;
/** Default heartbeat info-log cadence (ms). Loki absence-alert key. */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

export interface PolymarketWsActivitySourceDeps {
  /** Per-wallet Data-API client — used for the post-wake drain. */
  client: PolymarketDataApiClient;
  /** Shared WS handle (one socket per pod, multiplexed across all watched wallets). */
  ws: PolymarketWsClientHandle;
  /** The wallet being watched. 0x-prefixed 40-hex. */
  wallet: `0x${string}`;
  /** Caller-supplied structured log sink. */
  logger: LoggerPort;
  /** Caller-supplied metrics sink. */
  metrics: MetricsPort;
  /**
   * How often (ms) to re-discover the watched wallet's open-position asset set
   * via Data-API and reconcile WS subscriptions. Default 60_000.
   */
  refreshAssetsIntervalMs?: number;
  /** Page size forwarded to the Data-API on each drain. Default: client default. */
  limit?: number;
  /**
   * Maximum staleness (ms) before `fetchSince` drains regardless of WS wake.
   * Bounds worst-case detection latency for trades in markets the target
   * doesn't yet hold (which we have not yet subscribed to on the WS).
   * Default {@link DEFAULT_SAFETY_NET_DRAIN_INTERVAL_MS}.
   */
  safetyNetDrainIntervalMs?: number;
  /**
   * Cadence (ms) for the periodic heartbeat info log. Set to 0 to disable.
   * Default {@link DEFAULT_HEARTBEAT_INTERVAL_MS}. The heartbeat is the Loki
   * absence-alert key for zombie-WS detection.
   */
  heartbeatIntervalMs?: number;
}

export interface PolymarketWsActivitySource extends WalletActivitySource {
  /** Stop the asset-refresh timer + drop WS subscriptions for this wallet. */
  stop(): void;
}

export function createPolymarketWsActivitySource(
  deps: PolymarketWsActivitySourceDeps
): PolymarketWsActivitySource {
  const log = deps.logger.child({
    component: "wallet-watch",
    subcomponent: "polymarket-ws-source",
    wallet: deps.wallet,
  });
  const refreshIntervalMs = deps.refreshAssetsIntervalMs ?? 60_000;
  const safetyNetIntervalMs =
    deps.safetyNetDrainIntervalMs ?? DEFAULT_SAFETY_NET_DRAIN_INTERVAL_MS;
  const heartbeatIntervalMs =
    deps.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

  const ownedAssets = new Set<string>();
  const wakeListeners = new Set<() => void>();
  let pendingWakeup = true;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeTrade: (() => void) | null = null;
  let unsubscribeState: (() => void) | null = null;
  let hasRefreshedAssets = false;
  let stopped = false;
  // Drain bookkeeping. `lastDrainAt = 0` forces the first call to drain even
  // if no WS wake or refresh has fired yet (cold-start prime).
  let lastDrainAt = 0;
  // Heartbeat-window counters. Reset on each emitted heartbeat so the log
  // reports rolling activity, not lifetime totals.
  let framesReceivedWindow = 0;
  let wsWakesWindow = 0;
  let lastFrameAt: number | null = null;

  function onTrade(event: WsTradeEvent) {
    framesReceivedWindow += 1;
    lastFrameAt = Date.now();
    if (!ownedAssets.has(event.asset_id)) return;
    pendingWakeup = true;
    wsWakesWindow += 1;
    deps.metrics.incr(WALLET_WATCH_WS_METRICS.wakeupTotal, {});
    log.debug(
      {
        event: "poly.wallet_watch.ws.message",
        asset_id: event.asset_id,
        side: event.side,
        ws_timestamp: event.timestamp,
      },
      "ws wake-up matched watched asset"
    );
    // Fan out to push-on-wake subscribers. Per-callback isolation: one bad
    // subscriber must not break the others or escape `onTrade`. Snapshot the
    // listener set first so a callback that synchronously (un)subscribes can
    // not skip a sibling.
    for (const cb of [...wakeListeners]) {
      try {
        cb();
      } catch (err) {
        log.warn(
          {
            event: EVENT_NAMES.POLY_WALLET_WATCH_WS_WAKE_CALLBACK_THREW,
            asset_id: event.asset_id,
            err: err instanceof Error ? err.message : String(err),
          },
          "wake callback threw — push degraded to safety-net for this frame"
        );
      }
    }
  }

  unsubscribeTrade = deps.ws.onTrade(onTrade);
  // Reconnect must trigger a drain: trades may have arrived while the socket
  // was down, and the WS protocol does not replay missed frames.
  unsubscribeState = deps.ws.onState((state) => {
    if (state.phase === "connect") pendingWakeup = true;
  });

  async function refreshAssets() {
    try {
      const positions = await deps.client.listUserPositions(deps.wallet);
      const next = new Set<string>();
      for (const p of positions) if (p.asset) next.add(p.asset);

      let assetsChanged = false;
      for (const asset of next) {
        if (!ownedAssets.has(asset)) {
          ownedAssets.add(asset);
          deps.ws.subscribeAsset(asset);
          assetsChanged = true;
        }
      }
      for (const asset of [...ownedAssets]) {
        if (!next.has(asset)) {
          ownedAssets.delete(asset);
          deps.ws.unsubscribeAsset(asset);
          assetsChanged = true;
        }
      }
      deps.metrics.incr(WALLET_WATCH_WS_METRICS.subscriptionsTotal, {});
      log.info(
        {
          event: "poly.wallet_watch.ws.subscribe",
          assets_count: ownedAssets.size,
        },
        "ws assets reconciled"
      );
      // First refresh primes the loop, and later asset-set changes drain once to
      // cover a newly-discovered asset that traded before we subscribed.
      if (!hasRefreshedAssets || assetsChanged) pendingWakeup = true;
      hasRefreshedAssets = true;
    } catch (err) {
      log.warn(
        {
          event: "poly.wallet_watch.ws.subscribe",
          phase: "refresh_failed",
          err: err instanceof Error ? err.message : String(err),
        },
        "ws asset refresh failed"
      );
    }
  }

  void refreshAssets();
  refreshTimer = setInterval(() => void refreshAssets(), refreshIntervalMs);

  function emitHeartbeat() {
    log.info(
      {
        event: EVENT_NAMES.POLY_WALLET_WATCH_WS_HEARTBEAT,
        wallet: deps.wallet,
        frames_received_window: framesReceivedWindow,
        ws_wakes_window: wsWakesWindow,
        owned_assets_count: ownedAssets.size,
        last_frame_at: lastFrameAt,
        last_drain_at: lastDrainAt > 0 ? Math.floor(lastDrainAt / 1000) : null,
        heartbeat_interval_ms: heartbeatIntervalMs,
      },
      "ws source heartbeat"
    );
    framesReceivedWindow = 0;
    wsWakesWindow = 0;
  }

  if (heartbeatIntervalMs > 0) {
    heartbeatTimer = setInterval(emitHeartbeat, heartbeatIntervalMs);
  }

  return {
    async fetchSince(since?: number): Promise<NextFillsResult> {
      const start = Date.now();
      const baseFields = {
        event: EVENT_NAMES.POLY_WALLET_WATCH_FETCH,
        wallet: deps.wallet,
        since: since ?? null,
        source_mode: "websocket" as const,
      };

      const sinceLastDrainMs = start - lastDrainAt;
      const safetyNetDue = sinceLastDrainMs >= safetyNetIntervalMs;

      // Fast path — no WS wake AND not yet stale. Cursor unchanged. Idle
      // wallets land here only briefly each tick; the safety-net guarantees
      // worst-case detection latency stays bounded by `safetyNetIntervalMs`.
      if (!pendingWakeup && !safetyNetDue) {
        const duration_ms = Date.now() - start;
        deps.metrics.observeDurationMs(
          WALLET_WATCH_METRICS.fetchDurationMs,
          duration_ms,
          {}
        );
        log.debug(
          {
            ...baseFields,
            phase: "ok",
            duration_ms,
            raw: 0,
            fills: 0,
            skipped: 0,
            new_since: since ?? 0,
            ws_idle: true,
          },
          "wallet-watch ws fetch: idle (no wakeup, not yet stale)"
        );
        return { fills: [], newSince: since ?? 0 };
      }

      const drainTrigger = pendingWakeup ? "ws_wake" : "safety_net";
      if (drainTrigger === "safety_net") {
        deps.metrics.incr(WALLET_WATCH_WS_METRICS.safetyNetDrainTotal, {});
      }
      pendingWakeup = false;
      lastDrainAt = start;

      const params: { sinceTs?: number; limit?: number } = {};
      if (since !== undefined) params.sinceTs = since;
      if (deps.limit !== undefined) params.limit = deps.limit;
      const trades = await deps.client.listUserActivity(deps.wallet, params);
      const duration_ms = Date.now() - start;
      deps.metrics.observeDurationMs(
        WALLET_WATCH_METRICS.fetchDurationMs,
        duration_ms,
        {}
      );

      let newSince = since ?? 0;
      const fills: Fill[] = [];
      let skipped = 0;
      const skipsByReason: Partial<
        Record<PolymarketNormalizeSkipReason, number>
      > = {};

      for (const trade of trades) {
        if (trade.timestamp > newSince) newSince = trade.timestamp;
        let result: ReturnType<typeof normalizePolymarketDataApiFill>;
        try {
          result = normalizePolymarketDataApiFill(trade);
        } catch (err: unknown) {
          deps.metrics.incr(WALLET_WATCH_METRICS.normalizeErrorsTotal, {});
          log.warn(
            {
              event: EVENT_NAMES.POLY_WALLET_WATCH_NORMALIZE_ERROR,
              errorCode: "normalizer_threw",
              trade_timestamp: trade.timestamp,
              err: err instanceof Error ? err.message : String(err),
            },
            "normalizer threw; skipping row and advancing cursor"
          );
          continue;
        }
        if (result.ok) {
          fills.push(result.fill);
          continue;
        }
        skipped += 1;
        skipsByReason[result.reason] = (skipsByReason[result.reason] ?? 0) + 1;
        deps.metrics.incr(WALLET_WATCH_METRICS.skipTotal, {
          reason: result.reason,
        });
      }

      deps.metrics.incr(WALLET_WATCH_METRICS.fillsTotal, {});

      log.info(
        {
          ...baseFields,
          phase: "ok",
          duration_ms,
          raw: trades.length,
          fills: fills.length,
          skipped,
          skips_by_reason: skipsByReason,
          new_since: newSince,
          ws_idle: false,
          drain_trigger: drainTrigger,
        },
        "wallet-watch ws fetch: ok"
      );

      return { fills, newSince };
    },
    subscribeWake(callback) {
      wakeListeners.add(callback);
      return () => {
        wakeListeners.delete(callback);
      };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (unsubscribeTrade) {
        unsubscribeTrade();
        unsubscribeTrade = null;
      }
      if (unsubscribeState) {
        unsubscribeState();
        unsubscribeState = null;
      }
      for (const asset of ownedAssets) deps.ws.unsubscribeAsset(asset);
      ownedAssets.clear();
      wakeListeners.clear();
    },
  };
}
