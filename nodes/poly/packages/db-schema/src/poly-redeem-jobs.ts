// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-db-schema/poly-redeem-jobs`
 * Purpose: Persisted state for the event-driven CTF redeem pipeline (task.0388).
 *   `poly_redeem_jobs` is the durable backing store for the redeem state machine
 *   (pending → submitted → confirmed | failed_transient | abandoned). Replaces
 *   the deleted in-process cooldown Map + sweep mutex, removing the
 *   single-pod assumption.
 *   `poly_subscription_cursors` persists the `last_processed_block` per viem
 *   `watchContractEvent` subscription so the catch-up replay can resume after
 *   restart without re-scanning chain history.
 * Scope: Drizzle table definitions only. No queries, no RLS policy (service-role
 *   only writes today; not yet exposed to RLS-scoped reads).
 * Invariants:
 *   - REDEEM_DEDUP_IS_PERSISTED: unique index `(funder_address, condition_id)`
 *     is the canonical dedup key. No in-memory dedup anywhere.
 *   - FINALITY_IS_FIXED_N: `submitted_at_block` lets the worker's reaper compare
 *     against `head` for the hard-pinned N=5-block finality window without
 *     consulting receipts twice.
 *   - REDEEM_REQUIRES_BURN_OBSERVATION: `receipt_burn_observed` is the
 *     load-bearing flag the reaper reads at N=5 to branch malformed (no burn)
 *     vs transient (burn was reorged out).
 *   - POSITION_ID_IS_PERSISTED: `position_id` (ERC-1155 token id) and
 *     `outcome_index` are captured at enqueue so the worker can re-read
 *     `balanceOf(funder, positionId)` at submit time for the neg-risk
 *     dispatch path. v0.1 derived a sentinel from `condition_id` alone,
 *     producing zero-amount no-op redemption txs against the NegRiskAdapter.
 *   - SWEEP_IS_NOT_AN_ARCHITECTURE: only legitimate sweep is the catch-up
 *     replay bounded by `poly_subscription_cursors.last_processed_block`.
 * Side-effects: none (schema only).
 * Links: docs/design/poly-positions.md, work/items/task.0388.poly-redeem-job-queue-capability-b.md
 * @public
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const polyRedeemJobs = pgTable(
  "poly_redeem_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    funderAddress: text("funder_address").notNull(),
    conditionId: text("condition_id").notNull(),
    positionId: text("position_id").notNull(),
    outcomeIndex: integer("outcome_index").notNull(),
    status: text("status").notNull().default("pending"),
    flavor: text("flavor").notNull(),
    indexSet: jsonb("index_set").notNull(),
    /** Collateral that minted the position; default = USDC.e (V1 legacy). bug.0428. */
    collateralToken: text("collateral_token")
      .notNull()
      .default("0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"),
    expectedShares: text("expected_shares").notNull(),
    expectedPayoutUsdc: text("expected_payout_usdc").notNull(),
    txHashes: text("tx_hashes")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    errorClass: text("error_class"),
    lifecycleState: text("lifecycle_state").notNull().default("unresolved"),
    receiptBurnObserved: boolean("receipt_burn_observed"),
    submittedAtBlock: bigint("submitted_at_block", { mode: "bigint" }),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    abandonedAt: timestamp("abandoned_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    funderAddressShape: check(
      "poly_redeem_jobs_funder_address_shape",
      sql`${table.funderAddress} ~ '^0x[a-fA-F0-9]{40}$'`,
    ),
    conditionIdShape: check(
      "poly_redeem_jobs_condition_id_shape",
      sql`${table.conditionId} ~ '^0x[a-fA-F0-9]{64}$'`,
    ),
    statusShape: check(
      "poly_redeem_jobs_status_shape",
      sql`${table.status} IN ('pending', 'claimed', 'submitted', 'confirmed', 'failed_transient', 'abandoned', 'skipped')`,
    ),
    flavorShape: check(
      "poly_redeem_jobs_flavor_shape",
      sql`${table.flavor} IN ('binary', 'multi-outcome', 'neg-risk-parent', 'neg-risk-adapter')`,
    ),
    collateralTokenShape: check(
      "poly_redeem_jobs_collateral_token_shape",
      sql`${table.collateralToken} ~ '^0x[a-fA-F0-9]{40}$'`,
    ),
    errorClassShape: check(
      "poly_redeem_jobs_error_class_shape",
      sql`${table.errorClass} IS NULL OR ${table.errorClass} IN ('transient_exhausted', 'malformed')`,
    ),
    lifecycleStateShape: check(
      "poly_redeem_jobs_lifecycle_state_shape",
      sql`${table.lifecycleState} IN (
        'unresolved', 'open', 'closing', 'closed', 'resolving',
        'winner', 'redeem_pending', 'redeemed', 'loser', 'dust', 'abandoned'
      )`,
    ),
    funderConditionUnique: uniqueIndex(
      "poly_redeem_jobs_funder_condition_uq",
    ).on(table.funderAddress, table.conditionId),
    pendingIdx: index("poly_redeem_jobs_pending_idx")
      .on(table.enqueuedAt)
      .where(sql`status = 'pending'`),
    submittedFinalityIdx: index("poly_redeem_jobs_submitted_finality_idx")
      .on(table.submittedAtBlock)
      .where(sql`status = 'submitted'`),
  }),
);

export type PolyRedeemJobRow = typeof polyRedeemJobs.$inferSelect;
export type PolyRedeemJobInsert = typeof polyRedeemJobs.$inferInsert;

export const polySubscriptionCursors = pgTable("poly_subscription_cursors", {
  subscriptionId: text("subscription_id").primaryKey(),
  lastProcessedBlock: bigint("last_processed_block", {
    mode: "bigint",
  }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PolySubscriptionCursorRow =
  typeof polySubscriptionCursors.$inferSelect;
export type PolySubscriptionCursorInsert =
  typeof polySubscriptionCursors.$inferInsert;
