// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/adapters/polymarket/polymarket.ws.client`
 * Purpose: Thin Polymarket Market-channel WebSocket connection manager. Subscribes to a dynamic set of `asset_id`s and emits normalized `WsTradeEvent`s on every `last_trade_price`/`trade` frame, with auto-reconnect + heartbeat. No business logic — buffering, dedupe, and Data-API enrichment live in the feature-layer source.
 * Scope: HTTP-less. Loose Zod parse at the WS boundary so unknown frame types log + drop instead of crashing the connection. Does not load env, does not own a logger schema beyond `LoggerPort`, does not know about wallets (the public Market channel does NOT expose maker/taker addresses — see WS_NO_WALLET_IDENTITY in the consuming source).
 * Invariants:
 *   - PACKAGES_NO_ENV — endpoint and reconnect timings are constructor args.
 *   - WS_LOOSE_PARSE — unknown event_type is logged at debug, never throws.
 *   - HEARTBEAT_10S — the underlying CLOB WS expects client `PING` text frames every 10s; missing pings trigger disconnect.
 *   - SHARED_ASSET_REFCOUNT — a single Polymarket socket is multiplexed across N per-wallet `WalletActivitySource` instances. The asset-subscription set is refcounted: a remote subscribe is sent only when the count goes 0→1 and a remote unsubscribe is sent only when it returns 1→0. Without this, two wallets holding the same outcome token would have one wallet's `unsubscribeAsset` silently kill the other wallet's subscription.
 * Side-effects: opens a single TCP/TLS WS to `wss://ws-subscriptions-clob.polymarket.com/ws/market`; logger emissions; setInterval/setTimeout for heartbeat + backoff.
 * Links: docs https://docs.polymarket.com/developers/CLOB/websocket/wss-overview ; task.0322
 * @public
 */

import { z } from "zod";
import type { LoggerPort } from "../../port/observability.port.js";

/**
 * Loose schema for the only event we care about — `last_trade_price`.
 * `passthrough()` so future additions don't break parsing. Wallet identity
 * (maker/taker) is not present in this channel; that is `WS_NO_WALLET_IDENTITY`.
 */
export const WsLastTradePriceSchema = z
  .object({
    event_type: z.literal("last_trade_price"),
    asset_id: z.string(),
    market: z.string().optional().default(""),
    side: z.enum(["BUY", "SELL"]),
    price: z.coerce.number(),
    size: z.coerce.number(),
    timestamp: z.coerce.number(),
    fee_rate_bps: z.coerce.number().optional().default(0),
  })
  .passthrough();
export type WsLastTradePrice = z.infer<typeof WsLastTradePriceSchema>;

export type WsTradeEvent = WsLastTradePrice;

export interface PolymarketWsClientConfig {
  /** Override for tests / staging. Default: production market channel. */
  endpoint?: string;
  /** Heartbeat ping interval (ms). Default 10 000 per Polymarket docs. Set lower in tests. */
  heartbeatIntervalMs?: number;
  /** Initial reconnect delay (ms). Doubles each failure up to `maxReconnectDelayMs`. */
  initialReconnectDelayMs?: number;
  /** Cap on reconnect backoff (ms). Default 30 000. */
  maxReconnectDelayMs?: number;
  /** Logger sink — wired to pino at the boundary. */
  logger: LoggerPort;
  /** Hook for tests to substitute a fake `WebSocket` constructor. */
  // biome-ignore lint/suspicious/noExplicitAny: WebSocket constructor surface
  webSocketCtor?: new (url: string) => any;
}

export interface PolymarketWsClientHandle {
  /** Add an asset to the subscription set. Idempotent. Triggers a re-subscribe. */
  subscribeAsset(assetId: string): void;
  /** Remove an asset from the subscription set. Idempotent. */
  unsubscribeAsset(assetId: string): void;
  /** Currently-subscribed asset_ids. */
  listAssets(): readonly string[];
  /** Register a trade-event listener. Returns an unsubscribe fn. */
  onTrade(listener: (event: WsTradeEvent) => void): () => void;
  /** Register a connection-state listener (connect/disconnect/reconnect). Returns unsubscribe. */
  onState(listener: (state: WsConnectionState) => void): () => void;
  /** Close socket + cancel timers. Idempotent. */
  close(): Promise<void>;
}

export type WsConnectionState =
  | { phase: "connect" }
  | { phase: "disconnect"; reason: string }
  | { phase: "reconnect"; attempt: number; delayMs: number };

const DEFAULT_ENDPOINT = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

export function createPolymarketWsClient(
  config: PolymarketWsClientConfig
): PolymarketWsClientHandle {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const heartbeatMs = config.heartbeatIntervalMs ?? 10_000;
  const initialBackoff = config.initialReconnectDelayMs ?? 1_000;
  const maxBackoff = config.maxReconnectDelayMs ?? 30_000;
  // biome-ignore lint/suspicious/noExplicitAny: ctor injection for tests
  const Ctor = (config.webSocketCtor ?? WebSocket) as any;
  const log = config.logger.child({
    component: "wallet-watch",
    subcomponent: "polymarket-ws-client",
  });

  // Refcount map per SHARED_ASSET_REFCOUNT — a single socket is multiplexed
  // across many per-wallet sources. Two wallets owning the same outcome token
  // would otherwise see one wallet's unsubscribe silently drop the other.
  const assetRefCounts = new Map<string, number>();
  const tradeListeners = new Set<(event: WsTradeEvent) => void>();
  const stateListeners = new Set<(state: WsConnectionState) => void>();

  // biome-ignore lint/suspicious/noExplicitAny: dynamic ws instance
  let socket: any = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let closed = false;

  function emitState(state: WsConnectionState) {
    for (const l of stateListeners) l(state);
  }

  function clearTimers() {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function sendInitialSubscribeFrame() {
    if (!socket || socket.readyState !== 1 /* OPEN */) return;
    if (assetRefCounts.size === 0) return;
    const frame = JSON.stringify({
      assets_ids: [...assetRefCounts.keys()],
      type: "market",
    });
    try {
      socket.send(frame);
      log.info(
        {
          event: "poly.wallet_watch.ws.subscribe",
          phase: "initial",
          assets_count: assetRefCounts.size,
        },
        "ws subscribe sent"
      );
    } catch (err) {
      log.warn(
        {
          event: "poly.wallet_watch.ws.subscribe",
          phase: "send_failed",
          err: err instanceof Error ? err.message : String(err),
        },
        "ws subscribe send failed"
      );
    }
  }

  function sendSubscriptionUpdate(
    operation: "subscribe" | "unsubscribe",
    assetIds: readonly string[]
  ) {
    if (!socket || socket.readyState !== 1 /* OPEN */) return;
    if (assetIds.length === 0) return;
    const frame = JSON.stringify({
      assets_ids: assetIds,
      operation,
    });
    try {
      socket.send(frame);
      log.info(
        {
          event: "poly.wallet_watch.ws.subscribe",
          phase: operation,
          assets_count: assetRefCounts.size,
          update_assets_count: assetIds.length,
        },
        "ws subscription update sent"
      );
    } catch (err) {
      log.warn(
        {
          event: "poly.wallet_watch.ws.subscribe",
          phase: `${operation}_failed`,
          err: err instanceof Error ? err.message : String(err),
        },
        "ws subscription update failed"
      );
    }
  }

  function handleMessage(raw: unknown) {
    let text: string;
    if (typeof raw === "string") text = raw;
    else if (raw instanceof ArrayBuffer)
      text = new TextDecoder().decode(raw);
    else if (raw instanceof Uint8Array)
      text = new TextDecoder().decode(raw);
    else return;

    if (text === "PONG" || text === "pong") return;

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      log.debug(
        { event: "poly.wallet_watch.ws.message", phase: "non_json" },
        "ws non-JSON frame"
      );
      return;
    }

    const messages = Array.isArray(payload) ? payload : [payload];
    for (const msg of messages) {
      const parsed = WsLastTradePriceSchema.safeParse(msg);
      if (!parsed.success) {
        log.debug(
          {
            event: "poly.wallet_watch.ws.message",
            phase: "unhandled_event_type",
            event_type:
              typeof msg === "object" && msg !== null && "event_type" in msg
                ? (msg as { event_type: unknown }).event_type
                : null,
          },
          "ws frame did not match a handled event"
        );
        continue;
      }
      log.debug(
        {
          event: "poly.wallet_watch.ws.message",
          asset_id: parsed.data.asset_id,
          side: parsed.data.side,
        },
        "ws trade frame"
      );
      for (const l of tradeListeners) l(parsed.data);
    }
  }

  function scheduleReconnect() {
    if (closed) return;
    reconnectAttempts += 1;
    const delay = Math.min(
      initialBackoff * 2 ** (reconnectAttempts - 1),
      maxBackoff
    );
    emitState({ phase: "reconnect", attempt: reconnectAttempts, delayMs: delay });
    log.warn(
      {
        event: "poly.wallet_watch.ws.reconnect",
        attempt: reconnectAttempts,
        delay_ms: delay,
      },
      "ws reconnect scheduled"
    );
    reconnectTimer = setTimeout(() => connect(), delay);
  }

  function connect() {
    if (closed) return;
    clearTimers();
    log.info({ event: "poly.wallet_watch.ws.connect", endpoint }, "ws connecting");
    socket = new Ctor(endpoint);
    socket.addEventListener("open", () => {
      reconnectAttempts = 0;
      emitState({ phase: "connect" });
      log.info(
        { event: "poly.wallet_watch.ws.connect", phase: "open" },
        "ws connected"
      );
      sendInitialSubscribeFrame();
      heartbeat = setInterval(() => {
        try {
          if (socket && socket.readyState === 1) socket.send("PING");
        } catch {
          /* ignore — socket close path will handle */
        }
      }, heartbeatMs);
    });
    socket.addEventListener("message", (ev: { data: unknown }) =>
      handleMessage(ev.data)
    );
    socket.addEventListener(
      "close",
      (ev: { code: number; reason: string }) => {
        const reasonText = ev?.reason ?? "";
        emitState({
          phase: "disconnect",
          reason: `code=${ev?.code} ${reasonText}`,
        });
        log.warn(
          {
            event: "poly.wallet_watch.ws.disconnect",
            code: ev?.code,
            reason: reasonText,
          },
          "ws closed"
        );
        clearTimers();
        socket = null;
        scheduleReconnect();
      }
    );
    socket.addEventListener("error", (ev: { message?: string }) => {
      log.warn(
        {
          event: "poly.wallet_watch.ws.disconnect",
          phase: "error",
          err: ev?.message ?? "ws error",
        },
        "ws error"
      );
    });
  }

  connect();

  return {
    subscribeAsset(assetId) {
      const next = (assetRefCounts.get(assetId) ?? 0) + 1;
      assetRefCounts.set(assetId, next);
      // Only emit a remote subscribe on the 0→1 transition; subsequent
      // callers ride the existing subscription per SHARED_ASSET_REFCOUNT.
      if (next === 1) sendSubscriptionUpdate("subscribe", [assetId]);
    },
    unsubscribeAsset(assetId) {
      const current = assetRefCounts.get(assetId);
      if (current === undefined) return;
      if (current > 1) {
        assetRefCounts.set(assetId, current - 1);
        return;
      }
      assetRefCounts.delete(assetId);
      sendSubscriptionUpdate("unsubscribe", [assetId]);
    },
    listAssets() {
      return [...assetRefCounts.keys()];
    },
    onTrade(listener) {
      tradeListeners.add(listener);
      return () => {
        tradeListeners.delete(listener);
      };
    },
    onState(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      clearTimers();
      if (socket) {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        socket = null;
      }
    },
  };
}
