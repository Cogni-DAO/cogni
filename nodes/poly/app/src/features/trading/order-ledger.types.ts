// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/trading/order-ledger.types`
 * Purpose: Port interface + row/snapshot types for the Postgres-backed order ledger. Every placement path reads/writes through this port; adapter is the Drizzle implementation in `order-ledger.ts`.
 * Scope: Pure type surface. No drizzle imports, no I/O.
 * Invariants: LEDGER_PORT_SHAPE_IS_STABLE — adding fields is a breaking change. INSERT_BEFORE_PLACE is a caller invariant, not a ledger one.
 * Side-effects: none
 * Public types: `LedgerRow` (includes `synced_at`), `LedgerStatus`, `StateSnapshot`, `InsertPendingInput`, `RecordDecisionInput`, `ListRecentOptions`, `ListOpenOrPendingOptions`, `UpdateStatusInput` (includes `reason?`), `SyncHealthSummary`, `OrderLedger`.
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (CP4.3b), work/items/task.0328.poly-sync-truth-ledger-cache.md
 * @public
 */

import type { OrderIntent, OrderReceipt } from "@cogni/market-provider";

/** Canonical status set for `poly_copy_trade_fills.status` (migration 0027 CHECK). */
export type LedgerStatus =
  | "pending"
  | "open"
  | "filled"
  | "partial"
  | "canceled"
  | "error";

/**
 * Row shape returned by `listRecent` — mirrors `polyCopyTradeFills` $inferSelect
 * but with the fields the read APIs + mirror-coordinator actually consume.
 * Extra columns (`attributes`, `created_at`, `updated_at`, `synced_at`) surface as-is.
 *
 * `synced_at` is NULL until the reconciler first touches the row
 * (SYNCED_AT_WRITTEN_ON_EVERY_SYNC invariant — see task.0328 CP3).
 */
export interface LedgerRow {
  target_id: string;
  fill_id: string;
  observed_at: Date;
  client_order_id: string;
  order_id: string | null;
  status: LedgerStatus;
  attributes: Record<string, unknown> | null;
  /** Last time the reconciler received a typed CLOB response for this row. NULL = never checked. */
  synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * State snapshot the mirror-coordinator hands to `decide()`. Caller translates
 * into `RuntimeState` + `TargetConfig.enabled`. The ledger owns the SELECTs;
 * `decide()` stays pure.
 *
 * `enabled` is the kill-switch singleton. **Fail-closed**: on DB error the
 * adapter returns `enabled: false` and empty arrays — never throws into the
 * coordinator.
 */
export interface StateSnapshot {
  enabled: boolean;
  today_spent_usdc: number;
  fills_last_hour: number;
  already_placed_ids: string[];
}

/** Input to `insertPending` — shape captured at decide-time. */
export interface InsertPendingInput {
  target_id: string;
  fill_id: string;
  observed_at: Date;
  intent: OrderIntent;
}

/** Input to `recordDecision` — one row per `decide()` outcome, including skips. */
export interface RecordDecisionInput {
  target_id: string;
  fill_id: string;
  outcome: "placed" | "skipped" | "error";
  reason: string | null;
  intent: Record<string, unknown>;
  receipt: Record<string, unknown> | null;
  decided_at: Date;
}

/** Options for `listRecent` — used by the read API + dashboard. */
export interface ListRecentOptions {
  limit?: number;
  target_id?: string;
}

/** Options for `listOpenOrPending` — used by the reconciler tick. */
export interface ListOpenOrPendingOptions {
  /** Only return rows older than this many milliseconds. Default 30000. */
  olderThanMs?: number;
  /** Max rows to return. Default 200. */
  limit?: number;
}

/** Input to `updateStatus` — reconciler writes new CLOB-derived status. */
export interface UpdateStatusInput {
  client_order_id: string;
  status: LedgerStatus;
  /** Updated filled size in USDC — stored into `attributes.filled_size_usdc`. */
  filled_size_usdc?: number;
  /** Stamp order_id if the adapter returns it on a late acknowledgement. */
  order_id?: string;
  /**
   * Machine-readable promotion reason stored in `attributes.reason`.
   * Used by the reconciler to distinguish "clob_not_found" cancelations from
   * normal user/market cancelations. Mirrors the pattern of `markError` →
   * `attributes.error`.
   */
  reason?: string;
}

/**
 * Aggregate freshness stats returned by `syncHealthSummary`.
 * Used by GET /api/v1/poly/internal/sync-health.
 *
 * `oldest_synced_row_age_ms` — age in ms of the least-recently-synced row
 *   that HAS a non-null `synced_at`. Null when no row has ever been synced.
 *   Never-synced rows are counted in `rows_never_synced` instead.
 *
 * SYNC_HEALTH_IS_PUBLIC invariant (task.0328 CP4).
 */
export interface SyncHealthSummary {
  oldest_synced_row_age_ms: number | null;
  rows_stale_over_60s: number;
  rows_never_synced: number;
}

/**
 * Order ledger port. Production adapter is `createOrderLedger({ db })` in
 * `order-ledger.ts`; tests use `FakeOrderLedger` from
 * `adapters/test/trading/fake-order-ledger`. Every placement path in the poly
 * app reads + writes through this interface.
 *
 * @public
 */
export interface OrderLedger {
  /**
   * Read kill-switch + runtime state for a target. Fail-closed on DB error:
   * returns `{enabled: false, ...zeroes}` plus an error log on the caller's
   * logger — never throws.
   */
  snapshotState(target_id: string): Promise<StateSnapshot>;

  /**
   * Insert a `pending` row. Idempotent by PK `(target_id, fill_id)` — a repeat
   * of the same pair is a no-op (ON CONFLICT DO NOTHING). Stores `size_usdc`
   * / `side` / `market_id` / `limit_price` / `target_wallet` in `attributes`
   * so the read API + dashboard don't need to re-derive from the intent blob.
   */
  insertPending(input: InsertPendingInput): Promise<void>;

  /** Transition pending → filled/open/partial, stamping the `order_id`. */
  markOrderId(params: {
    client_order_id: string;
    receipt: OrderReceipt;
  }): Promise<void>;

  /** Transition pending → error. `error` is stored in `attributes.error`. */
  markError(params: { client_order_id: string; error: string }): Promise<void>;

  /**
   * Append-only `poly_copy_trade_decisions` insert. Called for EVERY decide()
   * outcome — placed, skipped, or error — so divergence analysis at P4 cutover
   * has a complete record independent of what landed in the fills ledger.
   */
  recordDecision(input: RecordDecisionInput): Promise<void>;

  /**
   * Read the N most recent rows — primary surface for the read API + dashboard.
   * Default limit 50. Ordered by `observed_at DESC` to match the dashboard card.
   */
  listRecent(opts?: ListRecentOptions): Promise<LedgerRow[]>;

  /**
   * Return all rows with `status IN ('pending', 'open')` that are older than
   * `olderThanMs` milliseconds (default 30 000). Ordered by `created_at ASC`
   * so the reconciler processes oldest-first. Default limit 200.
   *
   * Used exclusively by the order reconciler job (task.0323 §2).
   */
  listOpenOrPending(opts?: ListOpenOrPendingOptions): Promise<LedgerRow[]>;

  /**
   * Overwrite `status` (and optionally `filled_size_usdc` / `order_id`) on
   * the row identified by `client_order_id`. Touches `updated_at`.
   *
   * Called only by the order reconciler — no other path should drive status
   * after placement (mirror-coordinator owns `markOrderId` / `markError`).
   */
  updateStatus(input: UpdateStatusInput): Promise<void>;

  /**
   * Bulk-stamp `synced_at = now()` on the rows whose `client_order_id` values
   * are in the given array. Called once per reconciler tick after iterating all
   * rows for which `getOrder` returned a typed answer (found OR not_found).
   *
   * Rows where `getOrder` threw (network error) are NOT included — their
   * staleness grows until the next successful check.
   *
   * No-op when the array is empty (no SQL emitted).
   *
   * SYNCED_AT_WRITTEN_ON_EVERY_SYNC invariant (task.0328 CP3).
   */
  markSynced(client_order_ids: string[]): Promise<void>;

  /**
   * Return aggregate sync-freshness stats for the health endpoint.
   * One DB round-trip (three filtered aggregates in a single SELECT).
   *
   * SYNC_HEALTH_IS_PUBLIC invariant (task.0328 CP4).
   */
  syncHealthSummary(): Promise<SyncHealthSummary>;
}
