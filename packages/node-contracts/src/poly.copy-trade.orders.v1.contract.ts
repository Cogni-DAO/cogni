// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.copy-trade.orders.v1.contract`
 * Purpose: Contract for the order ledger read — copy-trade placements the operator's autonomous mirror + agent tool have submitted.
 * Scope: GET /api/v1/poly/copy-trade/orders. Supports `limit`, `status`, `target_id` filters. Does not execute trades, does not modify state, does not own DB queries.
 * Invariants: Rows ordered by `observed_at` DESC. `order_id` null for pending/error rows. `polymarket_profile_url` null on non-live rows.
 * Side-effects: none
 * Notes: HARDCODED_USER — response is not user-scoped in v0. Agent-tool placements are NOT in the ledger in v0 (follow-up tracked).
 * Links: work/items/task.0315.poly-copy-trade-prototype.md, docs/spec/poly-copy-trade-phase1.md
 * @public
 */

import { z } from "zod";

const ledgerStatusSchema = z.enum([
  "pending",
  "open",
  "filled",
  "partial",
  "canceled",
  "error",
]);
const sideSchema = z.enum(["BUY", "SELL"]);

const orderRowSchema = z.object({
  target_id: z.string().uuid(),
  target_wallet: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .nullable(),
  fill_id: z.string(),
  client_order_id: z.string(),
  order_id: z.string().nullable(),
  status: ledgerStatusSchema,
  market_id: z.string().nullable(),
  /** Human-readable market question (Polymarket Data API `title`). Denormalized at write time. Null for rows written before the title-stash was added. */
  market_title: z.string().nullable(),
  /** Polygon tx hash of the *target's* fill that triggered this mirror — authoritative on-chain proof. Null for non-Polymarket sources. */
  market_tx_hash: z.string().nullable(),
  outcome: z.string().nullable(),
  side: sideSchema.nullable(),
  size_usdc: z.number().nullable(),
  limit_price: z.number().nullable(),
  filled_size_usdc: z.number().nullable(),
  error: z.string().nullable(),
  observed_at: z.string(), // ISO-8601
  created_at: z.string(),
  updated_at: z.string(),
  /** Polymarket profile URL for this order; null when there's no `order_id` yet. */
  polymarket_profile_url: z.string().url().nullable(),
  /**
   * ISO-8601 timestamp of the last reconciler tick that received a typed CLOB
   * response (found OR not_found) for this row. Null = never re-checked.
   * SYNCED_AT_WRITTEN_ON_EVERY_SYNC invariant (task.0328 CP3).
   */
  synced_at: z.string().datetime().nullable(),
  /**
   * Milliseconds since `synced_at`. Null when `synced_at` is null.
   * Computed at response time — use as a freshness signal only.
   * STALENESS_VISIBLE_IN_UI invariant (task.0328 CP3).
   */
  staleness_ms: z.number().int().min(0).nullable(),
});

export const polyCopyTradeOrdersOperation = {
  id: "poly.copy-trade.orders.v1",
  summary: "List copy-trade order ledger rows",
  description:
    "Returns recent order-ledger rows (mirror placements). Filter by status or target_id; default limit 50, max 200.",
  input: z.object({
    limit: z.number().int().positive().max(200).optional(),
    status: z.enum(["all", ...ledgerStatusSchema.options]).optional(),
    target_id: z.string().uuid().optional(),
  }),
  output: z.object({
    orders: z.array(orderRowSchema),
  }),
} as const;

export type PolyCopyTradeOrderRow = z.infer<typeof orderRowSchema>;
export type PolyCopyTradeOrdersInput = z.infer<
  typeof polyCopyTradeOrdersOperation.input
>;
export type PolyCopyTradeOrdersOutput = z.infer<
  typeof polyCopyTradeOrdersOperation.output
>;
