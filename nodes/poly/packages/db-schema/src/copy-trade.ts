// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-db-schema/copy-trade`
 * Purpose: Schema for the Polymarket copy-trade prototype — tracked-wallet records (tenant-scoped),
 *          fills ledger, append-only decisions log.
 * Scope: Poly-local table definitions. Does not contain queries, RLS policies, or runtime logic.
 *        RLS policies live in the SQL migration alongside `ENABLE ROW LEVEL SECURITY`.
 * Invariants:
 *   - TENANT_SCOPED_ROWS: every row has `billing_account_id NOT NULL` (data column, FK → billing_accounts) +
 *     `created_by_user_id NOT NULL` (RLS key, FK → users). Mirrors the `connections` pattern from migration 0025.
 *   - FILL_ID_SHAPE_DECIDED: composite `<source>:<native_id>` per task.0315 P0.2, enforced by CHECK.
 *   - IDEMPOTENT_BY_CLIENT_ID: `client_order_id = clientOrderIdFor(target_id, fill_id)` (pinned helper).
 *   - NO_PER_TARGET_ENABLED: `poly_copy_trade_targets` has no per-row enable flag. Operators add/remove rows.
 *   - NO_KILL_SWITCH (bug.0438): copy-trade has no per-tenant kill-switch table. Active target row +
 *     active wallet connection + active grant is the gate; explicit user opt-in (POST a target) is the
 *     only signal. Per-tenant sizing/caps live on `poly_wallet_grants`, not on a separate config table.
 * Side-effects: none (schema definitions only)
 * Links: docs/spec/poly-multi-tenant-auth.md, work/items/task.0318
 * @public
 */

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Tracked Polymarket wallets the operator is mirroring. One row per (tenant, target_wallet)
 * — disabling is a soft-delete via `disabled_at`, never a hard DELETE (preserves attribution
 * history in the fills ledger).
 *
 * @public
 */
export const polyCopyTradeTargets = pgTable(
  "poly_copy_trade_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Tenant data column. FK → billing_accounts.id. */
    billingAccountId: text("billing_account_id").notNull(),
    /** RLS key column. Authenticated user that owns this tracking record. */
    createdByUserId: text("created_by_user_id").notNull(),
    /** 0x-prefixed 40-hex Polymarket EOA being followed. */
    targetWallet: text("target_wallet").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Soft-delete tombstone. NULL = active. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "poly_copy_trade_targets_wallet_shape",
      sql`${table.targetWallet} ~ '^0x[a-fA-F0-9]{40}$'`
    ),
    // One active row per (tenant, wallet). Soft-deleted rows allowed to coexist
    // so a previously-disabled wallet can be re-added without violating uniqueness.
    uniqueIndex("poly_copy_trade_targets_billing_wallet_active_idx")
      .on(table.billingAccountId, table.targetWallet)
      .where(sql`${table.disabledAt} IS NULL`),
    index("poly_copy_trade_targets_billing_account_idx").on(
      table.billingAccountId
    ),
  ]
);

/**
 * Observed fills from tracked target wallets + their mirror placement state.
 * Composite PK `(target_id, fill_id)` is the canonical dedupe gate. Tenant-scoped
 * via `billing_account_id` (data) + `created_by_user_id` (RLS key).
 *
 * `client_order_id` is deterministic from `(target_id, fill_id)` per IDEMPOTENT_BY_CLIENT_ID.
 */
export const polyCopyTradeFills = pgTable(
  "poly_copy_trade_fills",
  {
    /** Tenant data column. */
    billingAccountId: text("billing_account_id").notNull(),
    /** RLS key column. */
    createdByUserId: text("created_by_user_id").notNull(),
    /** P1: synthetic UUID per env target wallet. P2+: target row id. */
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
    /**
     * Timestamp of the last reconciler tick that received a typed CLOB response
     * (found OR not_found) for this row. NULL until the reconciler first checks
     * this order. Written by `markSynced` — never by the placement path.
     */
    syncedAt: timestamp("synced_at", { withTimezone: true }),
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
    // Supports fast "oldest unsynced" queries for the sync-health endpoint.
    index("idx_poly_copy_trade_fills_synced_at").on(table.syncedAt),
    // Tenant-scoped queries.
    index("poly_copy_trade_fills_billing_account_idx").on(
      table.billingAccountId
    ),
    // Executor-bug canary — Polymarket order ids are unique by construction, so
    // two fills ever carrying the same `order_id` indicates the mirror path
    // double-submitted. Partial index skips the (common) null rows.
    uniqueIndex("poly_copy_trade_fills_order_id_unique")
      .on(table.orderId)
      .where(sql`${table.orderId} IS NOT NULL`),
    check(
      "poly_copy_trade_fills_fill_id_shape",
      sql`${table.fillId} ~ '^(data-api|clob-ws):.+'`
    ),
    check(
      "poly_copy_trade_fills_status_check",
      sql`${table.status} IN ('pending','open','filled','partial','canceled','error')`
    ),
  ]
);

/**
 * Append-only log of every `decide()` outcome — `place`, `skip`, or `error`.
 * Tenant-scoped. Rows are never updated or deleted from application code.
 */
export const polyCopyTradeDecisions = pgTable(
  "poly_copy_trade_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Tenant data column. */
    billingAccountId: text("billing_account_id").notNull(),
    /** RLS key column. */
    createdByUserId: text("created_by_user_id").notNull(),
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
    index("poly_copy_trade_decisions_billing_account_idx").on(
      table.billingAccountId
    ),
    check(
      "poly_copy_trade_decisions_outcome_check",
      sql`${table.outcome} IN ('placed','skipped','error')`
    ),
  ]
);

export type PolyCopyTradeTarget = typeof polyCopyTradeTargets.$inferSelect;
export type NewPolyCopyTradeTarget = typeof polyCopyTradeTargets.$inferInsert;
export type PolyCopyTradeFill = typeof polyCopyTradeFills.$inferSelect;
export type NewPolyCopyTradeFill = typeof polyCopyTradeFills.$inferInsert;
export type PolyCopyTradeDecision = typeof polyCopyTradeDecisions.$inferSelect;
export type NewPolyCopyTradeDecision =
  typeof polyCopyTradeDecisions.$inferInsert;
