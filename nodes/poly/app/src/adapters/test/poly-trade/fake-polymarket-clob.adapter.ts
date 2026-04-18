// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/test/poly-trade/fake-polymarket-clob`
 * Purpose: Deterministic test double for the Polymarket CLOB `placeOrder` port. Test mode of `createPolyTradeCapability` returns a capability backed by this fake so stack + unit tests never load `@polymarket/clob-client`, `@privy-io/node`, or touch the network.
 * Scope: In-memory. Configurable canned receipt and/or canned error; records every call for assertions. Does not validate intents beyond what `OrderIntent` already enforces upstream.
 * Invariants:
 *   - PORT_SHAPE_ONLY — implements `placeOrder` only. Does not know about LoggerPort, MetricsPort, or the PolyTradeCapability shape; the capability factory wraps this in the executor + metrics.
 *   - DETERMINISTIC — same config + same intent → same result. No random data, no clock reads.
 * Side-effects: none (in-memory only; records calls on `this.calls`).
 * Links: Used by `nodes/poly/app/src/bootstrap/capabilities/poly-trade.ts` when `env.isTestMode === true`.
 * @internal
 */

import type { OrderIntent, OrderReceipt } from "@cogni/market-provider";

export interface FakePolymarketClobConfig {
  /** Canned happy-path receipt. Defaults to a generic "filled" shape. */
  receipt?: OrderReceipt;
  /**
   * If set, `placeOrder` rejects with this error instead of returning the
   * receipt. Useful for exercising the executor's `rejected` vs `error`
   * classification (message containing "CLOB rejected order" → rejected).
   */
  rejectWith?: Error;
  /** Canned open-orders list for `listOpenOrders`. Defaults to empty. */
  openOrders?: OrderReceipt[];
  /** If set, `listOpenOrders` rejects with this error. */
  listRejectWith?: Error;
  /** If set, `cancelOrder` rejects with this error. */
  cancelRejectWith?: Error;
}

/**
 * `client_order_id` is always overwritten in `placeOrder` to echo the intent's
 * key (matches how the real adapter maps CLOB responses). Keeping it out of
 * the default avoids implying the default value would ever reach a caller.
 */
const DEFAULT_RECEIPT: Omit<OrderReceipt, "client_order_id"> = {
  order_id:
    "0xfake000000000000000000000000000000000000000000000000000000000001",
  status: "filled",
  filled_size_usdc: 1,
  submitted_at: "2026-04-17T00:00:00.000Z",
  attributes: { rawStatus: "matched", fake: true },
};

/**
 * Fake implementation of the `MarketProviderPort.placeOrder` function. Pass
 * `adapter.placeOrder.bind(adapter)` to `createPolyTradeCapabilityFromAdapter`.
 */
export class FakePolymarketClobAdapter {
  public calls: OrderIntent[] = [];
  public cancelCalls: string[] = [];
  private readonly config: FakePolymarketClobConfig;

  constructor(config: FakePolymarketClobConfig = {}) {
    this.config = config;
  }

  async placeOrder(intent: OrderIntent): Promise<OrderReceipt> {
    this.calls.push(intent);
    if (this.config.rejectWith) throw this.config.rejectWith;
    const base = this.config.receipt ?? DEFAULT_RECEIPT;
    // Echo the intent's client_order_id on the receipt — matches how the real
    // adapter maps response → OrderReceipt via `mapOrderResponseToReceipt`.
    return { ...base, client_order_id: intent.client_order_id };
  }

  async listOpenOrders(_params?: {
    tokenId?: string;
    market?: string;
  }): Promise<OrderReceipt[]> {
    if (this.config.listRejectWith) throw this.config.listRejectWith;
    return this.config.openOrders ?? [];
  }

  async cancelOrder(orderId: string): Promise<void> {
    this.cancelCalls.push(orderId);
    if (this.config.cancelRejectWith) throw this.config.cancelRejectWith;
  }
}
