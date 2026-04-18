// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/copy-trade/clob-executor`
 * Purpose: Thin feature-layer wrapper that adapts `MarketProviderPort.placeOrder` into a single `(intent) => receipt` function with structured logs + bounded-label metrics. The caller supplies the `placeOrder` function (mock seam for tests; real adapter in `bootstrap/capabilities/copy-trade.ts`).
 * Scope: Pure composition. Does not instantiate adapters, does not read env, does not import `@polymarket/clob-client` or `@privy-io/node` (those live behind the `bootstrap/capabilities/copy-trade.ts` dynamic-import boundary).
 * Invariants:
 *   - EXECUTOR_SEAM_IS_PLACE_ORDER_FN — callers inject `placeOrder`, not the adapter instance. Stack tests substitute without monkey-patching.
 *   - NO_STATIC_CLOB_IMPORT — this module MUST NOT import `@polymarket/clob-client`; ESLint enforces at review.
 *   - BOUNDED_METRIC_RESULT — the `result` label is one of {ok, rejected, error}.
 * Side-effects: logger + metrics calls only (both are caller-supplied sinks; default no-op).
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP4.2)
 * @public
 */

import type {
  LoggerPort,
  MetricsPort,
  OrderIntent,
  OrderReceipt,
} from "@cogni/market-provider";

/** Metric names emitted by the executor. Dashboards reference these. */
export const COPY_TRADE_EXECUTOR_METRICS = {
  placeTotal: "poly_copy_trade_execute_total",
  placeDurationMs: "poly_copy_trade_execute_duration_ms",
} as const;

export interface CopyTradeExecutorDeps {
  /**
   * The mockable seam. In production `bootstrap/capabilities/copy-trade.ts`
   * binds `PolymarketClobAdapter.placeOrder`. In stack/unit tests callers
   * substitute a fake fn implementing `MarketProviderPort["placeOrder"]`.
   */
  placeOrder: (intent: OrderIntent) => Promise<OrderReceipt>;
  /** Structured log sink (pino-compatible). Defaults to caller-provided. */
  logger: LoggerPort;
  /** Metrics sink (prom-client via adapter). Defaults to caller-provided. */
  metrics: MetricsPort;
}

export type CopyTradeExecutor = (intent: OrderIntent) => Promise<OrderReceipt>;

/**
 * Build the executor function. Structured-log shape:
 *   {event: "poly.copy_trade.execute", phase: "start|ok|rejected|error",
 *    client_order_id, market_id, side, size_usdc, limit_price,
 *    duration_ms, order_id?, error?}
 *
 * Rejections (CLOB returned `success:false` or missing `orderID`) are
 * distinguished from errors (network/bug) via the `result` metric label.
 * The adapter throws a message containing `"CLOB rejected order"` on
 * rejection — the executor parses that prefix to bucket correctly.
 */
export function createClobExecutor(
  deps: CopyTradeExecutorDeps
): CopyTradeExecutor {
  // `subcomponent` (not `component`) so pino bindings layer cleanly with the
  // downstream adapter's `component: "poly-clob-adapter"` child — we want both
  // fields visible in Loki, not shadowed.
  const log = deps.logger.child({ subcomponent: "copy-trade-executor" });

  return async function executePlacement(
    intent: OrderIntent
  ): Promise<OrderReceipt> {
    const start = Date.now();
    const baseFields = {
      event: "poly.copy_trade.execute",
      client_order_id: intent.client_order_id,
      market_id: intent.market_id,
      side: intent.side,
      size_usdc: intent.size_usdc,
      limit_price: intent.limit_price,
    };
    log.info({ ...baseFields, phase: "start" }, "execute: start");

    try {
      const receipt = await deps.placeOrder(intent);
      const duration_ms = Date.now() - start;
      deps.metrics.incr(COPY_TRADE_EXECUTOR_METRICS.placeTotal, {
        result: "ok",
      });
      deps.metrics.observeDurationMs(
        COPY_TRADE_EXECUTOR_METRICS.placeDurationMs,
        duration_ms,
        { result: "ok" }
      );
      log.info(
        {
          ...baseFields,
          phase: "ok",
          duration_ms,
          order_id: receipt.order_id,
          status: receipt.status,
          filled_size_usdc: receipt.filled_size_usdc,
        },
        "execute: ok"
      );
      return receipt;
    } catch (err: unknown) {
      const duration_ms = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      const result = msg.includes("CLOB rejected order") ? "rejected" : "error";
      deps.metrics.incr(COPY_TRADE_EXECUTOR_METRICS.placeTotal, { result });
      deps.metrics.observeDurationMs(
        COPY_TRADE_EXECUTOR_METRICS.placeDurationMs,
        duration_ms,
        { result }
      );
      // CLOB rejection bodies can contain EIP-712 domain dumps; cap at 512 to
      // keep log lines bounded. Matches adapter's truncation behavior.
      const truncated = msg.length > 512 ? `${msg.slice(0, 512)}…` : msg;
      log.error(
        { ...baseFields, phase: result, duration_ms, error: truncated },
        `execute: ${result}`
      );
      throw err;
    }
  };
}
