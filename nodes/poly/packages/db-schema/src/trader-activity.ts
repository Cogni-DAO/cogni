// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-db-schema/trader-activity`
 * Purpose: Operational read-model tables for continuously observed Polymarket trader wallets.
 * Scope: Drizzle table definitions only. Runtime observation, attribution, and UI aggregation live in the app.
 * Invariants:
 *   - SAME_OBSERVED_TRADE_TABLE: copy-target and Cogni wallet public trades share `poly_trader_fills`.
 *   - OBSERVATION_INDEPENDENT_OF_COPYING: `active_for_research` is research state, not copy-trade policy.
 *   - NO_FULL_HISTORY_CRAWL: ingestion cursors store forward watermarks; historical backfill is a separate v2 concern.
 * Side-effects: none
 * Links: docs/design/poly-copy-target-performance-benchmark.md, work/items/task.5005
 * @public
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const polyTraderWallets = pgTable(
  "poly_trader_wallets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    activeForResearch: boolean("active_for_research").notNull().default(true),
    firstObservedAt: timestamp("first_observed_at", {
      withTimezone: true,
    }).defaultNow(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "poly_trader_wallets_wallet_shape",
      sql`${table.walletAddress} ~ '^0x[a-fA-F0-9]{40}$'`
    ),
    check(
      "poly_trader_wallets_kind_check",
      sql`${table.kind} IN ('copy_target','cogni_wallet')`
    ),
    uniqueIndex("poly_trader_wallets_wallet_address_idx").on(
      table.walletAddress
    ),
    index("poly_trader_wallets_observe_idx").on(
      table.activeForResearch,
      table.disabledAt
    ),
  ]
);

export const polyTraderIngestionCursors = pgTable(
  "poly_trader_ingestion_cursors",
  {
    traderWalletId: uuid("trader_wallet_id")
      .notNull()
      .references(() => polyTraderWallets.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastSeenNativeId: text("last_seen_native_id"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.traderWalletId, table.source] }),
    check(
      "poly_trader_ingestion_cursors_source_check",
      sql`${table.source} IN ('data-api','data-api-trades','data-api-positions','clob-ws')`
    ),
    check(
      "poly_trader_ingestion_cursors_status_check",
      sql`${table.status} IN ('pending','ok','partial','stale','error')`
    ),
    index("poly_trader_ingestion_cursors_status_idx").on(table.status),
  ]
);

export const polyTraderFills = pgTable(
  "poly_trader_fills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traderWalletId: uuid("trader_wallet_id")
      .notNull()
      .references(() => polyTraderWallets.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    nativeId: text("native_id").notNull(),
    conditionId: text("condition_id").notNull(),
    tokenId: text("token_id").notNull(),
    side: text("side").notNull(),
    price: numeric("price", { precision: 18, scale: 8 }).notNull(),
    shares: numeric("shares", { precision: 20, scale: 8 }).notNull(),
    sizeUsdc: numeric("size_usdc", { precision: 20, scale: 8 }).notNull(),
    txHash: text("tx_hash"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "poly_trader_fills_source_check",
      sql`${table.source} IN ('data-api','clob-ws')`
    ),
    check("poly_trader_fills_side_check", sql`${table.side} IN ('BUY','SELL')`),
    check("poly_trader_fills_price_positive", sql`${table.price} > 0`),
    check("poly_trader_fills_shares_positive", sql`${table.shares} > 0`),
    check("poly_trader_fills_size_positive", sql`${table.sizeUsdc} > 0`),
    uniqueIndex("poly_trader_fills_trader_source_native_idx").on(
      table.traderWalletId,
      table.source,
      table.nativeId
    ),
    index("poly_trader_fills_trader_observed_idx").on(
      table.traderWalletId,
      table.observedAt
    ),
    index("poly_trader_fills_market_token_idx").on(
      table.conditionId,
      table.tokenId
    ),
  ]
);

export const polyTraderPositionSnapshots = pgTable(
  "poly_trader_position_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traderWalletId: uuid("trader_wallet_id")
      .notNull()
      .references(() => polyTraderWallets.id, { onDelete: "cascade" }),
    conditionId: text("condition_id").notNull(),
    tokenId: text("token_id").notNull(),
    shares: numeric("shares", { precision: 20, scale: 8 }).notNull(),
    costBasisUsdc: numeric("cost_basis_usdc", {
      precision: 20,
      scale: 8,
    }).notNull(),
    currentValueUsdc: numeric("current_value_usdc", {
      precision: 20,
      scale: 8,
    }).notNull(),
    avgPrice: numeric("avg_price", { precision: 18, scale: 8 }).notNull(),
    contentHash: text("content_hash").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
  },
  (table) => [
    check(
      "poly_trader_position_snapshots_shares_nonnegative",
      sql`${table.shares} >= 0`
    ),
    check(
      "poly_trader_position_snapshots_cost_nonnegative",
      sql`${table.costBasisUsdc} >= 0`
    ),
    check(
      "poly_trader_position_snapshots_value_nonnegative",
      sql`${table.currentValueUsdc} >= 0`
    ),
    uniqueIndex("poly_trader_position_snapshots_hash_idx").on(
      table.traderWalletId,
      table.conditionId,
      table.tokenId,
      table.contentHash
    ),
    index("poly_trader_position_snapshots_latest_idx").on(
      table.traderWalletId,
      table.capturedAt
    ),
  ]
);

export const polyTraderCurrentPositions = pgTable(
  "poly_trader_current_positions",
  {
    traderWalletId: uuid("trader_wallet_id")
      .notNull()
      .references(() => polyTraderWallets.id, { onDelete: "cascade" }),
    conditionId: text("condition_id").notNull(),
    tokenId: text("token_id").notNull(),
    active: boolean("active").notNull().default(true),
    shares: numeric("shares", { precision: 20, scale: 8 }).notNull(),
    costBasisUsdc: numeric("cost_basis_usdc", {
      precision: 20,
      scale: 8,
    }).notNull(),
    currentValueUsdc: numeric("current_value_usdc", {
      precision: 20,
      scale: 8,
    }).notNull(),
    avgPrice: numeric("avg_price", { precision: 18, scale: 8 }).notNull(),
    contentHash: text("content_hash").notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
  },
  (table) => [
    primaryKey({
      columns: [table.traderWalletId, table.conditionId, table.tokenId],
    }),
    check(
      "poly_trader_current_positions_shares_nonnegative",
      sql`${table.shares} >= 0`
    ),
    check(
      "poly_trader_current_positions_cost_nonnegative",
      sql`${table.costBasisUsdc} >= 0`
    ),
    check(
      "poly_trader_current_positions_value_nonnegative",
      sql`${table.currentValueUsdc} >= 0`
    ),
    index("poly_trader_current_positions_active_idx").on(
      table.traderWalletId,
      table.active,
      table.currentValueUsdc
    ),
    index("poly_trader_current_positions_market_idx").on(
      table.conditionId,
      table.tokenId
    ),
  ]
);

export const polyCopyTradeAttribution = pgTable(
  "poly_copy_trade_attribution",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    targetTraderWalletId: uuid("target_trader_wallet_id")
      .notNull()
      .references(() => polyTraderWallets.id, { onDelete: "cascade" }),
    cogniTraderWalletId: uuid("cogni_trader_wallet_id").references(
      () => polyTraderWallets.id,
      { onDelete: "set null" }
    ),
    targetFillId: uuid("target_fill_id").references(() => polyTraderFills.id, {
      onDelete: "set null",
    }),
    cogniFillId: uuid("cogni_fill_id").references(() => polyTraderFills.id, {
      onDelete: "set null",
    }),
    copyTradeTargetId: uuid("copy_trade_target_id"),
    copyTradeFillId: text("copy_trade_fill_id"),
    copyTradeDecisionId: uuid("copy_trade_decision_id"),
    conditionId: text("condition_id").notNull(),
    tokenId: text("token_id").notNull(),
    status: text("status").notNull(),
    reason: text("reason").notNull(),
    targetVwap: numeric("target_vwap", { precision: 18, scale: 8 }),
    cogniVwap: numeric("cogni_vwap", { precision: 18, scale: 8 }),
    targetSizeUsdc: numeric("target_size_usdc", { precision: 20, scale: 8 }),
    cogniSizeUsdc: numeric("cogni_size_usdc", { precision: 20, scale: 8 }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
  },
  (table) => [
    check(
      "poly_copy_trade_attribution_status_check",
      sql`${table.status} IN ('copied','partial','missed','resting','skipped','error','no_response_yet')`
    ),
    index("poly_copy_trade_attribution_target_window_idx").on(
      table.targetTraderWalletId,
      table.windowStart,
      table.windowEnd
    ),
    index("poly_copy_trade_attribution_market_idx").on(
      table.conditionId,
      table.tokenId
    ),
  ]
);

export const polyMarketOutcomes = pgTable(
  "poly_market_outcomes",
  {
    conditionId: text("condition_id").notNull(),
    tokenId: text("token_id").notNull(),
    outcome: text("outcome").notNull(),
    payout: numeric("payout", { precision: 18, scale: 8 }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.conditionId, table.tokenId] }),
    check(
      "poly_market_outcomes_outcome_check",
      sql`${table.outcome} IN ('winner','loser','unknown')`
    ),
  ]
);

export type PolyTraderWallet = typeof polyTraderWallets.$inferSelect;
export type NewPolyTraderWallet = typeof polyTraderWallets.$inferInsert;
export type PolyTraderFill = typeof polyTraderFills.$inferSelect;
export type NewPolyTraderFill = typeof polyTraderFills.$inferInsert;
export type PolyTraderPositionSnapshot =
  typeof polyTraderPositionSnapshots.$inferSelect;
export type NewPolyTraderPositionSnapshot =
  typeof polyTraderPositionSnapshots.$inferInsert;
export type PolyTraderCurrentPosition =
  typeof polyTraderCurrentPositions.$inferSelect;
export type NewPolyTraderCurrentPosition =
  typeof polyTraderCurrentPositions.$inferInsert;
