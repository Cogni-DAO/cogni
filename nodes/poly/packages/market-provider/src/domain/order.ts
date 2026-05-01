// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/domain/order`
 * Purpose: Zod schemas and pure helpers for Run-phase order types — OrderIntent, OrderReceipt, OrderStatus, Fill, GetOrderResult, and limit-price tick normalization.
 * Scope: Pure type definitions used by the MarketProviderPort Run methods and by node-level copy-trade decision logic. Does not contain I/O or adapter dependencies.
 * Invariants:
 *   - IDEMPOTENT_BY_CLIENT_ID: every OrderIntent carries a caller-provided client_order_id.
 *   - PROVIDER_AGNOSTIC: provider-specific fields live under `attributes`, never as first-class fields.
 *   - FILL_ID_COMPOSITE: Fill.fill_id is `"<source>:<native_id>"` per P0.2 (task.0315 Phase 0 Findings).
 *   - GETORDER_NEVER_NULL: `getOrder` callers receive a discriminated `GetOrderResult`; null is
 *     never a valid return. Callers MUST branch on the discriminant. (task.0328 CP1)
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 — First live order)
 * @public
 */

import { z } from "zod";
import { MarketProviderSchema } from "./schemas.js";

/** Fill observation source — composite key namespace for `Fill.fill_id`. */
export const FillSourceSchema = z.enum(["data-api", "clob-ws"]);
export type FillSource = z.infer<typeof FillSourceSchema>;

/** Buy or sell side on a market outcome. */
export const OrderSideSchema = z.enum(["BUY", "SELL"]);
export type OrderSide = z.infer<typeof OrderSideSchema>;

/**
 * Order lifecycle status returned by a platform.
 * Mapped from platform-specific states to this canonical set by adapters.
 */
export const OrderStatusSchema = z.enum([
  "pending",
  "open",
  "filled",
  "partial",
  "canceled",
  "error",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/**
 * Caller's request to place an order on a prediction-market platform.
 *
 * Price is the limit price on the outcome share, not USD — for binary markets
 * this is in the closed interval [0, 1] (dollar price per share of the outcome
 * being bought). Size is expressed in USDC dollars (not atomic units) to keep
 * the port surface platform-agnostic; adapters convert to native units.
 *
 * `client_order_id` is the idempotency key. Per task.0315 `IDEMPOTENT_BY_CLIENT_ID`:
 * `client_order_id = hash(target_id || fill_id)` at the copy-trade decision layer,
 * and the platform dedupes repeat submissions server-side at order-placement time.
 */
export const OrderIntentSchema = z.object({
  provider: MarketProviderSchema,
  /** Cogni-normalized market id: "prediction-market:{provider}:{sourceId}" */
  market_id: z.string().min(1),
  /** Outcome label (e.g., "YES" / "NO" for binary markets) */
  outcome: z.string().min(1),
  side: OrderSideSchema,
  /** Size in USDC dollars (not atomic units). Adapters convert to native units. */
  size_usdc: z.number().positive(),
  /** Limit price on the outcome share (0–1 for binary; 0–100 for Kalshi cents). */
  limit_price: z.number().positive(),
  /** Caller idempotency key — adapters pass verbatim to the platform. */
  client_order_id: z.string().min(1),
  /**
   * Platform-specific placement fields (e.g., Polymarket `asset` = ERC1155 token id,
   * `orderType` = GTC/FOK). Adapters interpret; callers do not populate unless
   * they already know the target platform.
   */
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type OrderIntent = z.infer<typeof OrderIntentSchema>;

export type LimitPriceTickNormalization =
  | {
      ok: true;
      price: number;
    }
  | {
      ok: false;
      reason: "price_outside_clob_bounds" | "invalid_tick_size";
      nearestValidPrice: number | null;
    };

/**
 * Normalize a binary-outcome limit price to the venue's tick grid. Prices are
 * valid from one tick through `1 - tick`; a target price may round to the
 * nearest representable tick, but only when it is no farther than half a tick.
 */
export function normalizeLimitPriceToTick(
  price: number,
  tickSize: number
): LimitPriceTickNormalization {
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(tickSize) ||
    tickSize <= 0 ||
    tickSize >= 1
  ) {
    return { ok: false, reason: "invalid_tick_size", nearestValidPrice: null };
  }

  const scale = Math.round(1 / tickSize);
  if (scale <= 1 || Math.abs(1 / scale - tickSize) > 1e-12) {
    return { ok: false, reason: "invalid_tick_size", nearestValidPrice: null };
  }

  const roundedTicks = Math.round(price * scale);
  const validTicks = Math.min(Math.max(roundedTicks, 1), scale - 1);
  const normalized = validTicks / scale;
  const distance = Math.abs(price - normalized);
  const epsilon = 1e-12;

  if (distance > tickSize / 2 + epsilon) {
    return {
      ok: false,
      reason: "price_outside_clob_bounds",
      nearestValidPrice: normalized,
    };
  }

  return { ok: true, price: normalized };
}

/**
 * Platform receipt after order submission. `order_id` is the platform-assigned
 * identifier (distinct from `client_order_id`). `filled_size_usdc` tracks
 * realized fills for status polling; `status` is the canonical mapping.
 */
export const OrderReceiptSchema = z.object({
  /** Platform-assigned order id — used for cancel / status lookup. */
  order_id: z.string().min(1),
  /** Echoes OrderIntent.client_order_id for caller correlation. */
  client_order_id: z.string().min(1),
  status: OrderStatusSchema,
  /** Cumulative filled size in USDC dollars at time of receipt. */
  filled_size_usdc: z.number().min(0),
  /** ISO-8601 — platform-reported submission time (falls back to adapter clock). */
  submitted_at: z.string().min(1),
  /** Platform-specific receipt fields (rawStatus, maker/taker flag, etc.). */
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type OrderReceipt = z.infer<typeof OrderReceiptSchema>;

/**
 * Normalized fill observation — a trade that has happened on a tracked wallet.
 *
 * `fill_id` is composite `"<source>:<native_id>"` per task.0315 P0.2 decision:
 *   - `data-api` source: native_id = `${transactionHash}:${asset}:${side}:${timestamp}`
 *     Empty-transactionHash rows MUST be rejected upstream (DA_EMPTY_HASH_REJECTED invariant)
 *     — they cannot be reliably deduped cross-source and are incapable of being mirrored.
 *   - `clob-ws` source: native_id = operator trade id (shape committed in the P4 migration).
 *
 * `size_usdc` is in USDC dollars (notional on the outcome share, not atomic units).
 * `observed_at` is ISO-8601; adapters normalize unix-seconds inputs.
 */
export const FillSchema = z.object({
  /** Wallet that produced the fill (the target being copied). */
  target_wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** Composite "<source>:<native_id>". See FILL_ID_SHAPE_DECIDED invariant. */
  fill_id: z.string().min(1),
  source: FillSourceSchema,
  /** Cogni-normalized market id. */
  market_id: z.string().min(1),
  outcome: z.string().min(1),
  side: OrderSideSchema,
  /** Executed price on the outcome share (0–1 for binary). */
  price: z.number().positive(),
  /** Notional size in USDC dollars (not atomic units). */
  size_usdc: z.number().positive(),
  /** ISO-8601 timestamp of fill observation (match-time for WS, settlement-time for DA). */
  observed_at: z.string().min(1),
  /** Platform-specific fields (asset/conditionId for Polymarket; trade_id for WS). */
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type Fill = z.infer<typeof FillSchema>;

/**
 * Discriminated-union result for `getOrder` calls.
 *
 * GETORDER_NEVER_NULL invariant (task.0328 CP1): `getOrder` must never return
 * `null`. 404 / empty-body responses from the CLOB produce `{ status: "not_found" }`.
 * Network errors still throw — those are unrelated failure modes.
 *
 * Callers MUST branch on the discriminant:
 *   if (result.status === "not_found") { ... }
 *   const receipt = result.found;
 */
export type GetOrderResult = { found: OrderReceipt } | { status: "not_found" };
