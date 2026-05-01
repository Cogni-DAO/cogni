// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-watch/polymarket-ws-source`
 * Purpose: `WalletActivitySource` implementation that uses a shared Polymarket Market-channel WebSocket as a wake-up signal, then drains fresh trades for the watched wallet via the Data-API. Drop-in replacement for `polymarket-source.ts` behind the `POLY_WALLET_WATCH_SOURCE=websocket` env flag (task.0322). Solves the polling adapter's `limit>20` stale-cache symptom by fetching only when a relevant market actually trades.
 * Scope: Composes a shared `PolymarketWsClientHandle` (one socket per pod) + the per-wallet `PolymarketDataApiClient`. Discovers the watched wallet's open-position assets at construction + on a refresh interval; subscribes those assets on the shared socket. Emits the same `Fill[]` shape and event names as the polling source so dashboards/alerts keep working.
 * Invariants:
 *   - WS_NO_WALLET_IDENTITY — Polymarket's public Market channel does NOT carry maker/taker addresses (verified against docs.polymarket.com 2026-05-01). The WS therefore acts as a wake-up signal; canonical fields (transactionHash, proxyWallet, exact size_usdc) come from the Data-API drain. This keeps `Fill.fill_id` shape identical to the polling source so dedupe in the mirror coordinator is preserved.
 *   - CURSOR_IS_MAX_TIMESTAMP — `newSince` semantics identical to polling source.
 *   - SHARED_SOCKET — one WS connection per pod, multiplexed across watched wallets via the asset-subscription set inside the client handle.
 * Side-effects: subscribes to assets on the shared WS handle (constructor + refresh); HTTPS GETs to data-api.polymarket.com on every drain triggered by a WS wake; logger + metrics.
 * Links: docs https://docs.polymarket.com/developers/CLOB/websocket/wss-overview ; task.0322
 * @public
 */

import { EVENT_NAMES } from "@cogni/node-shared";
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

import {
  type NextFillsResult,
  WALLET_WATCH_METRICS,
  type WalletActivitySource,
} from "./polymarket-source";

/** Counter name extension specific to the WS source. */
export const WALLET_WATCH_WS_METRICS = {
  /** `poly_mirror_ws_wakeup_total{wallet}` — WS frame received on a watched asset. */
  wakeupTotal: "poly_mirror_ws_wakeup_total",
  /** `poly_mirror_ws_subscriptions` — gauge-as-counter on subscribe events. */
  subscriptionsTotal: "poly_mirror_ws_subscriptions_total",
} as const;

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

  const ownedAssets = new Set<string>();
  let pendingWakeup = true;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let unsubscribeTrade: (() => void) | null = null;
  let unsubscribeState: (() => void) | null = null;
  let stopped = false;

  function onTrade(event: WsTradeEvent) {
    if (!ownedAssets.has(event.asset_id)) return;
    pendingWakeup = true;
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

      for (const asset of next) {
        if (!ownedAssets.has(asset)) {
          ownedAssets.add(asset);
          deps.ws.subscribeAsset(asset);
        }
      }
      for (const asset of [...ownedAssets]) {
        if (!next.has(asset)) {
          ownedAssets.delete(asset);
          deps.ws.unsubscribeAsset(asset);
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
      // First refresh primes the loop — make sure first `fetchSince` runs a Data-API
      // drain even if no WS frame has arrived yet (covers the cold-start gap).
      pendingWakeup = true;
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

  return {
    async fetchSince(since?: number): Promise<NextFillsResult> {
      const start = Date.now();
      const baseFields = {
        event: EVENT_NAMES.POLY_WALLET_WATCH_FETCH,
        wallet: deps.wallet,
        since: since ?? null,
        source_mode: "websocket" as const,
      };

      // Fast path — no WS wake-up since last drain. Cursor unchanged.
      if (!pendingWakeup) {
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
          "wallet-watch ws fetch: idle (no wakeup)"
        );
        return { fills: [], newSince: since ?? 0 };
      }
      pendingWakeup = false;

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
        },
        "wallet-watch ws fetch: ok"
      );

      return { fills, newSince };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
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
    },
  };
}
