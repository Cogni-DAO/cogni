// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/poly-copy-trade`
 * Purpose: Schema for the Polymarket copy-trade prototype — fills ledger, global kill-switch singleton, append-only decisions log.
 * Scope: Table definitions only (task.0315 Phase 1 CP3.3). Does not contain queries, RLS policies, or runtime logic. System-owned tables (single-operator prototype) — no tenant-scoped RLS.
 * Invariants:
 *   - FILL_ID_SHAPE_DECIDED: composite `<source>:<native_id>` per task.0315 P0.2, enforced by CHECK.
 *   - IDEMPOTENT_BY_CLIENT_ID: `client_order_id = clientOrderIdFor(target_id, fill_id)` (pinned helper).
 *   - GLOBAL_KILL_DB_ROW: `config.enabled DEFAULT false` = fail-closed; SELECT failure treated as false.
 * Side-effects: none (schema definitions only)
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 1 CP3.3)
 * @public
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Observed fills from tracked target wallets + their mirror placement state.
 * Composite PK `(target_id, fill_id)` is the canonical dedupe gate —
 * idempotent inserts collapse to the same row; `order_id` is non-null only
 * after the executor successfully placed the mirror order.
 *
 * `client_order_id` is deterministic from `(target_id, fill_id)` — see
 * IDEMPOTENT_BY_CLIENT_ID above. It is stored so the executor's post-placement
 * receipt correlation doesn't need to recompute it.
 */
export const polyCopyTradeFills = pgTable(
  "poly_copy_trade_fills",
  {
    /** P1: synthetic UUID per env target wallet. P2: FK to `poly_copy_trade_targets`. */
    targetId: uuid("target_id").notNull(),
    /** Composite `"<source>:<native_id>"` per FILL_ID_SHAPE_DECIDED. */
    fillId: text("fill_id").notNull(),
    /** ISO timestamp the fill was observed (match-time for WS, settlement-time for DA). */
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    /** Deterministic from `(target_id, fill_id)` — see IDEMPOTENT_BY_CLIENT_ID. */
    clientOrderId: text("client_order_id").notNull(),
    /** Platform-assigned order id. Non-null iff the mirror order was placed. */
    orderId: text("order_id"),
    /** Canonical OrderStatus: pending | open | filled | partial | canceled | error. */
    status: text("status").notNull(),
    /** Provenance + mirror amount + raw normalized fill for debugging. */
    attributes: jsonb("attributes").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.targetId, table.fillId] }),
    // Dashboard card query: `SELECT ... ORDER BY observed_at DESC LIMIT 50`.
    index("poly_copy_trade_fills_observed_at_idx").on(table.observedAt),
    // `client_order_id` is unique-by-construction across all rows (deterministic
    // from the PK pair); index lets the executor detect repeat submits.
    index("poly_copy_trade_fills_client_order_id_idx").on(table.clientOrderId),
    // Executor-bug canary — Polymarket order ids are unique by construction, so
    // two fills ever carrying the same `order_id` indicates the mirror path
    // double-submitted. Partial index skips the (common) null rows.
    uniqueIndex("poly_copy_trade_fills_order_id_unique")
      .on(table.orderId)
      .where(sql`${table.orderId} IS NOT NULL`),
    // Defend the dedupe gate — fill_id MUST be "<source>:<native_id>" with a
    // known source (FILL_ID_SHAPE_DECIDED). A typo like "dataapi:..." would
    // silently bypass cross-source dedupe; this CHECK makes that impossible.
    check(
      "poly_copy_trade_fills_fill_id_shape",
      sql`${table.fillId} ~ '^(data-api|clob-ws):.+'`
    ),
    // Enumerate the canonical OrderStatus set at the schema layer so a buggy
    // writer can't silently persist, e.g., "LIVE" or "Placed".
    check(
      "poly_copy_trade_fills_status_check",
      sql`${table.status} IN ('pending','open','filled','partial','canceled','error')`
    ),
  ]
);

/**
 * Global kill-switch singleton. `singleton_id = 1` enforced by CHECK.
 * `enabled DEFAULT false` is **fail-closed**: a freshly-migrated node will
 * refuse to place orders until an operator explicitly flips the row to true.
 * The poll's config SELECT treats any error as `enabled = false`.
 */
export const polyCopyTradeConfig = pgTable(
  "poly_copy_trade_config",
  {
    singletonId: smallint("singleton_id").notNull().primaryKey(),
    enabled: boolean("enabled").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Operator identity for audit — free-form text ('system' for seed). */
    updatedBy: text("updated_by").notNull().default("system"),
  },
  (table) => [
    check("poly_copy_trade_config_singleton", sql`${table.singletonId} = 1`),
  ]
);

/**
 * Append-only log of every `decide()` outcome — `place`, `skip`, or `error`.
 * Rows are never updated or deleted from application code. Used for
 * divergence analysis at the P4 cutover and for debugging.
 *
 * `fill_id` duplicates `poly_copy_trade_fills.fill_id` intentionally: some
 * decisions (`skip` branches) do not create a fills row, so this log must
 * stand on its own.
 */
export const polyCopyTradeDecisions = pgTable(
  "poly_copy_trade_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetId: uuid("target_id").notNull(),
    fillId: text("fill_id").notNull(),
    /** 'placed' | 'skipped' | 'error' — mirrors the `decide()` return branch. */
    outcome: text("outcome").notNull(),
    /** Null for `placed`; holds the skip-reason or error class otherwise. */
    reason: text("reason"),
    /** Full MirrorIntent snapshot (or the OrderIntent if one was built). */
    intent: jsonb("intent").$type<Record<string, unknown>>().notNull(),
    /** Non-null iff an order was placed; carries OrderReceipt shape. */
    receipt: jsonb("receipt").$type<Record<string, unknown>>(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("poly_copy_trade_decisions_decided_at_idx").on(table.decidedAt),
    index("poly_copy_trade_decisions_target_fill_idx").on(
      table.targetId,
      table.fillId
    ),
    // Enumerate the `decide()` return branches at the schema layer.
    check(
      "poly_copy_trade_decisions_outcome_check",
      sql`${table.outcome} IN ('placed','skipped','error')`
    ),
  ]
);

export type PolyCopyTradeFill = typeof polyCopyTradeFills.$inferSelect;
export type NewPolyCopyTradeFill = typeof polyCopyTradeFills.$inferInsert;
export type PolyCopyTradeConfig = typeof polyCopyTradeConfig.$inferSelect;
export type PolyCopyTradeDecision = typeof polyCopyTradeDecisions.$inferSelect;
export type NewPolyCopyTradeDecision =
  typeof polyCopyTradeDecisions.$inferInsert;
