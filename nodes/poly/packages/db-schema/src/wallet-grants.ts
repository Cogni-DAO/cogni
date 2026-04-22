// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-db-schema/wallet-grants`
 * Purpose: Drizzle schema for per-tenant Polymarket trade-authorization grants
 *   (task.0318 Phase B3). Each row scopes what the tenant's trading wallet is
 *   allowed to spend per-order / per-day / per-hour; `authorizeIntent` reads
 *   it on every intent to mint the branded `AuthorizedSigningContext`.
 * Scope: Table definition only. RLS policy + indexes live in migration
 *   `0031_poly_wallet_grants.sql`.
 * Invariants:
 *   - TENANT_SCOPED: (billing_account_id, created_by_user_id) NOT NULL.
 *   - CAPS_POSITIVE: migration CHECK enforces > 0 on every cap.
 *   - DAILY_GE_PER_ORDER: daily_usdc_cap >= per_order_usdc_cap (CHECK).
 *   - REVOKE_CASCADES_FROM_CONNECTION: `adapter.revoke` flips this row's
 *     `revoked_at` in the same tx as the connection row.
 *   - ACTIVE_GRANT_QUERY_SHAPE: active = revoked_at IS NULL AND
 *     (expires_at IS NULL OR expires_at > now()).
 * Side-effects: none (schema only)
 * Links: docs/spec/poly-trader-wallet-port.md,
 *        .cursor/plans/poly-per-tenant-trade-execution_92073c70.plan.md
 * @public
 */

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Per-tenant trade-authorization grant. Read by
 * `PrivyPolyTraderWalletAdapter.authorizeIntent` on every intent; no active
 * grant row means `placeOrder` is unreachable.
 *
 * @public
 */
export const polyWalletGrants = pgTable(
  "poly_wallet_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Tenant data column. FK → billing_accounts.id (enforced in migration). */
    billingAccountId: text("billing_account_id").notNull(),
    /** FK → poly_wallet_connections.id; cascades on connection delete. */
    walletConnectionId: uuid("wallet_connection_id").notNull(),
    /** Audit metadata: who issued the grant. FK → users.id. */
    createdByUserId: text("created_by_user_id").notNull(),
    /** e.g. ['poly:trade:buy','poly:trade:sell']. Non-empty (CHECK). */
    scopes: text("scopes").array().notNull(),
    /** USDC decimal — per-order ceiling enforced by authorizeIntent. */
    perOrderUsdcCap: numeric("per_order_usdc_cap", {
      precision: 10,
      scale: 2,
    }).notNull(),
    /** USDC decimal — 24h rolling ceiling. */
    dailyUsdcCap: numeric("daily_usdc_cap", {
      precision: 10,
      scale: 2,
    }).notNull(),
    /** Fills-per-hour ceiling. */
    hourlyFillsCap: integer("hourly_fills_cap").notNull(),
    /** Null = never expires. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: text("revoked_by_user_id"),
  },
  (table) => ({
    scopesNonempty: check(
      "poly_wallet_grants_scopes_nonempty",
      sql`array_length(${table.scopes}, 1) > 0`,
    ),
    perOrderCapPositive: check(
      "poly_wallet_grants_per_order_cap_positive",
      sql`${table.perOrderUsdcCap} > 0`,
    ),
    dailyCapPositive: check(
      "poly_wallet_grants_daily_cap_positive",
      sql`${table.dailyUsdcCap} > 0`,
    ),
    hourlyFillsCapPositive: check(
      "poly_wallet_grants_hourly_fills_cap_positive",
      sql`${table.hourlyFillsCap} > 0`,
    ),
    dailyGePerOrder: check(
      "poly_wallet_grants_daily_ge_per_order",
      sql`${table.dailyUsdcCap} >= ${table.perOrderUsdcCap}`,
    ),
    active: index("poly_wallet_grants_active_idx")
      .on(table.billingAccountId, table.createdAt)
      .where(sql`${table.revokedAt} IS NULL`),
    byConnection: index("poly_wallet_grants_connection_idx")
      .on(table.walletConnectionId)
      .where(sql`${table.revokedAt} IS NULL`),
    byCreatedByUser: index("poly_wallet_grants_created_by_user_idx").on(
      table.createdByUserId,
    ),
  }),
);

export type PolyWalletGrantRow = typeof polyWalletGrants.$inferSelect;
export type PolyWalletGrantInsert = typeof polyWalletGrants.$inferInsert;
