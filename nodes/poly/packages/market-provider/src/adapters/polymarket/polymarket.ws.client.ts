// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/adapters/polymarket/polymarket.ws.client`
 * Purpose: Thin Polymarket Market-channel WebSocket connection manager. Subscribes to a dynamic set of `asset_id`s and emits normalized `WsTradeEvent`s on every `last_trade_price`/`trade` frame, with auto-reconnect + heartbeat. No business logic — buffering, dedupe, and Data-API enrichment live in the feature-layer source.
 * Scope: HTTP-less. Loose Zod parse at the WS boundary so unknown frame types log + drop instead of crashing the connection. Does not load env, does not own a logger schema beyond `LoggerPort`, does not know about wallets (the public Market channel does NOT expose maker/taker addresses — see WS_NO_WALLET_IDENTITY in the consuming source).
 * Invariants:
 *   - PACKAGES_NO_ENV — endpoint and reconnect timings are constructor args.
 *   - WS_LOOSE_PARSE — unknown event_type is logged at debug, never throws.
 *   - HEARTBEAT_30S — the underlying CLOB WS expects client `PING` text frames every ~30s; missing pongs trigger reconnect.
 * Side-effects: opens a single TCP/TLS WS to `wss://ws-subscriptions-clob.polymarket.com/ws/market`; logger emissions; setInterval/setTimeout for heartbeat + backoff.
 * Links: docs https://docs.polymarket.com/developers/CLOB/websocket/wss-overview ; task.0322
 * @public
 */

import WebSocket from "ws";
import { z } from "zod";
import type { LoggerPort } from "../../port/observability.js";

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
  /** Heartbeat ping interval (ms). Default 30 000. Set lower in tests. */
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
  const heartbeatMs = config.heartbeatIntervalMs ?? 30_000;
  const initialBackoff = config.initialReconnectDelayMs ?? 1_000;
  const maxBackoff = config.maxReconnectDelayMs ?? 30_000;
  // biome-ignore lint/suspicious/noExplicitAny: ctor injection for tests
  const Ctor = (config.webSocketCtor ?? WebSocket) as any;
  const log = config.logger.child({
    component: "wallet-watch",
    subcomponent: "polymarket-ws-client",
  });

  const assets = new Set<string>();
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

  function sendSubscribeFrame() {
    if (!socket || socket.readyState !== 1 /* OPEN */) return;
    if (assets.size === 0) return;
    const frame = JSON.stringify({
      assets_ids: [...assets],
      type: "market",
    });
    try {
      socket.send(frame);
      log.info(
        {
          event: "poly.wallet_watch.ws.subscribe",
          assets_count: assets.size,
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

  function handleMessage(raw: unknown) {
    let text: string;
    if (typeof raw === "string") text = raw;
    else if (raw instanceof Buffer) text = raw.toString("utf8");
    else if (Array.isArray(raw)) text = Buffer.concat(raw).toString("utf8");
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
    socket.on("open", () => {
      reconnectAttempts = 0;
      emitState({ phase: "connect" });
      log.info(
        { event: "poly.wallet_watch.ws.connect", phase: "open" },
        "ws connected"
      );
      sendSubscribeFrame();
      heartbeat = setInterval(() => {
        try {
          if (socket && socket.readyState === 1) socket.send("PING");
        } catch {
          /* ignore — socket close path will handle */
        }
      }, heartbeatMs);
    });
    socket.on("message", handleMessage);
    socket.on("close", (code: number, reason: Buffer) => {
      const reasonText = reason?.toString?.("utf8") ?? "";
      emitState({ phase: "disconnect", reason: `code=${code} ${reasonText}` });
      log.warn(
        {
          event: "poly.wallet_watch.ws.disconnect",
          code,
          reason: reasonText,
        },
        "ws closed"
      );
      clearTimers();
      socket = null;
      scheduleReconnect();
    });
    socket.on("error", (err: Error) => {
      log.warn(
        {
          event: "poly.wallet_watch.ws.disconnect",
          phase: "error",
          err: err?.message ?? String(err),
        },
        "ws error"
      );
    });
  }

  connect();

  return {
    subscribeAsset(assetId) {
      if (assets.has(assetId)) return;
      assets.add(assetId);
      sendSubscribeFrame();
    },
    unsubscribeAsset(assetId) {
      if (!assets.delete(assetId)) return;
      sendSubscribeFrame();
    },
    listAssets() {
      return [...assets];
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
