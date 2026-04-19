// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/test/poly-trade/fake-polymarket-clob`
 * Purpose: Deterministic test double for the Polymarket CLOB adapter. Test mode of `createPolyTradeCapability` returns a capability backed by this fake so stack + unit tests never load `@polymarket/clob-client`, `@privy-io/node`, or touch the network.
 * Scope: In-memory. Configurable canned receipt and/or canned error; records every call for assertions. Tracks positions: BUY increments size, SELL decrements. `getOrder` returns stored receipt by id. `listPositions` returns injected positions or the tracked in-memory set.
 * Invariants:
 *   - PORT_SHAPE_ONLY — implements adapter methods only; capability factory wraps in executor + metrics.
 *   - DETERMINISTIC — same config + same intent → same result. No random data, no clock reads.
 * Side-effects: none (in-memory only; records calls on `this.calls`).
 * Links: Used by `nodes/poly/app/src/bootstrap/capabilities/poly-trade.ts` when `env.isTestMode === true`.
 * @internal
 */

import type {
  GetOrderResult,
  OrderIntent,
  OrderReceipt,
} from "@cogni/market-provider";
import type { PolymarketUserPosition } from "@cogni/market-provider/adapters/polymarket";

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
  /**
   * Pre-seeded positions for `listPositions`. When set, the fake returns these
   * directly without applying in-memory BUY/SELL tracking. Useful for
   * deterministic `closePosition` test scenarios.
   */
  positions?: PolymarketUserPosition[];
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
 * Fake implementation of the Polymarket CLOB adapter methods. Pass
 * `adapter.placeOrder.bind(adapter)` etc. to `createPolyTradeCapabilityFromAdapter`.
 *
 * Position tracking: BUY intents increment `positions[tokenId].size` by
 * `size_usdc / (limit_price ?? 0.5)`. SELL intents decrement it. Only used
 * when `config.positions` is NOT provided (pre-seeded positions take priority).
 */
export class FakePolymarketClobAdapter {
  public calls: OrderIntent[] = [];
  public cancelCalls: string[] = [];
  /** Indexed by order_id for `getOrder` lookups. */
  public orderStore = new Map<string, OrderReceipt>();
  /** In-memory position tracking (size in shares, keyed by tokenId). */
  private readonly trackedPositions = new Map<
    string,
    { size: number; curPrice: number }
  >();
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
    const receipt: OrderReceipt = {
      ...base,
      client_order_id: intent.client_order_id,
    };
    this.orderStore.set(receipt.order_id, receipt);
    // Track position: BUY adds shares, SELL removes shares.
    const tokenId =
      typeof intent.attributes?.token_id === "string"
        ? intent.attributes.token_id
        : undefined;
    if (tokenId && !this.config.positions) {
      const price = intent.limit_price ?? 0.5;
      const shares = price > 0 ? intent.size_usdc / price : 0;
      const existing = this.trackedPositions.get(tokenId) ?? {
        size: 0,
        curPrice: price,
      };
      if (intent.side === "BUY") {
        this.trackedPositions.set(tokenId, {
          size: existing.size + shares,
          curPrice: price,
        });
      } else {
        this.trackedPositions.set(tokenId, {
          size: Math.max(0, existing.size - shares),
          curPrice: price,
        });
      }
    }
    return receipt;
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

  /**
   * Returns stored receipt by id, or `{ status: "not_found" }` if unknown.
   * GETORDER_NEVER_NULL invariant (task.0328 CP1): null is never returned.
   */
  async getOrder(orderId: string): Promise<GetOrderResult> {
    const receipt = this.orderStore.get(orderId);
    if (receipt === undefined) return { status: "not_found" };
    return { found: receipt };
  }

  /** Returns pre-seeded positions (config) or in-memory tracked positions. */
  async listPositions(_wallet: string): Promise<PolymarketUserPosition[]> {
    if (this.config.positions) return this.config.positions;
    const results: PolymarketUserPosition[] = [];
    for (const [asset, { size, curPrice }] of this.trackedPositions.entries()) {
      if (size > 0) {
        results.push({
          proxyWallet: _wallet,
          asset,
          conditionId: `0x${"0".repeat(64)}`,
          size,
          avgPrice: curPrice,
          initialValue: size * curPrice,
          currentValue: size * curPrice,
          cashPnl: 0,
          percentPnl: 0,
          realizedPnl: 0,
          curPrice,
          redeemable: false,
          title: "",
          outcome: "",
        });
      }
    }
    return results;
  }
}
