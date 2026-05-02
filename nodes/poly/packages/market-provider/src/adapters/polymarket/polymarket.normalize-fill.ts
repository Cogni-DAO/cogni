// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/adapters/polymarket/polymarket.normalize-fill`
 * Purpose: Pure normalizer — maps Polymarket Data-API `/trades` rows to the canonical `Fill` shape that the copy-trade feature layer consumes. Rejects empty-transactionHash rows so they cannot be placed into the copy-trade pipeline.
 * Scope: Pure function + Zod validation. Does not perform I/O, does not emit metrics itself, does not know the container. Callers decide what to do with the `skipped` reason.
 * Invariants:
 *   - FILL_ID_SHAPE_DECIDED — `fill_id = "data-api:" + transactionHash + ":" + asset + ":" + side + ":" + timestamp` per task.0315 P0.2.
 *   - DA_EMPTY_HASH_REJECTED — rows with `transactionHash === ""` are never normalized; the caller MUST increment `data_api_empty_tx_hash_total` on its own MetricsPort when it observes a skipped return.
 *   - SIZE_IS_USDC_NOTIONAL — `size_usdc = shares × price` (Data-API `size` is in outcome shares).
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP4.1 — pure decide/normalize layer)
 * @public
 */

import { type Fill, FillSchema } from "../../domain/order.js";
import type { PolymarketUserTrade } from "./polymarket.data-api.types.js";

/**
 * Why a row was skipped. Enumerated so callers bucket metric labels safely
 * (Prom cardinality bound).
 */
export type PolymarketNormalizeSkipReason =
  | "empty_transaction_hash"
  | "non_positive_price"
  | "non_positive_size"
  | "invalid_side"
  | "missing_asset"
  | "missing_condition_id";

export type PolymarketNormalizeResult =
  | { ok: true; fill: Fill }
  | { ok: false; reason: PolymarketNormalizeSkipReason };

/**
 * Build the canonical `fill_id` for a Data-API trade.
 * Pinned — `poly_copy_trade_fills_fill_id_shape` CHECK and the composite-PK
 * invariant depend on this shape. If you need to change it, write a migration.
 */
export function polymarketDataApiFillId(
  trade: Pick<
    PolymarketUserTrade,
    "transactionHash" | "asset" | "side" | "timestamp"
  >
): string {
  return `data-api:${trade.transactionHash}:${trade.asset}:${trade.side}:${trade.timestamp}`;
}

/**
 * Normalize one Polymarket Data-API `/trades` row to a canonical `Fill`.
 *
 * Returns `{ok: false, reason}` for rejected rows instead of throwing so
 * callers can bucket skip reasons into a bounded metric label.
 */
export function normalizePolymarketDataApiFill(
  trade: PolymarketUserTrade
): PolymarketNormalizeResult {
  if (!trade.transactionHash || trade.transactionHash === "") {
    // DA_EMPTY_HASH_REJECTED — a trade with no settlement tx hash cannot be
    // reliably deduped cross-source and cannot have been mirrored.
    return { ok: false, reason: "empty_transaction_hash" };
  }
  if (!trade.asset) return { ok: false, reason: "missing_asset" };
  if (!trade.conditionId) return { ok: false, reason: "missing_condition_id" };
  if (!(trade.price > 0)) return { ok: false, reason: "non_positive_price" };
  if (!(trade.size > 0)) return { ok: false, reason: "non_positive_size" };
  if (trade.side !== "BUY" && trade.side !== "SELL") {
    return { ok: false, reason: "invalid_side" };
  }

  const size_usdc = Number((trade.size * trade.price).toFixed(6));
  const observed_at = new Date(trade.timestamp * 1000).toISOString();

  const fill: Fill = {
    target_wallet: trade.proxyWallet as `0x${string}`,
    fill_id: polymarketDataApiFillId(trade),
    source: "data-api",
    market_id: `prediction-market:polymarket:${trade.conditionId}`,
    outcome: trade.outcome || "YES",
    side: trade.side,
    price: trade.price,
    size_usdc,
    observed_at,
    attributes: {
      asset: trade.asset,
      condition_id: trade.conditionId,
      transaction_hash: trade.transactionHash,
      title: trade.title,
      slug: trade.slug,
      event_slug: trade.eventSlug,
      event_title: readOptionalString(trade, "eventTitle"),
      end_date: readOptionalString(trade, "endDate"),
      game_start_time: readOptionalString(trade, "gameStartTime"),
      timestamp_unix: trade.timestamp,
    },
  };

  // Defensive Zod check — catches drift from the PolymarketUserTrade schema
  // that would otherwise pass a malformed Fill into decide(). Throwing here
  // is correct: it indicates a type/shape bug, not a skippable data row.
  return { ok: true, fill: FillSchema.parse(fill) };
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string
): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}
