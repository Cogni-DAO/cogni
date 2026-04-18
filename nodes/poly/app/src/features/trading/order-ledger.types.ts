// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/trading/order-ledger.types`
 * Purpose: Port interface + row/snapshot types for the Postgres-backed order ledger. Every placement path reads/writes through this port; adapter is the Drizzle implementation in `order-ledger.ts`.
 * Scope: Pure type surface. No drizzle imports, no I/O.
 * Invariants: LEDGER_PORT_SHAPE_IS_STABLE — adding fields is a breaking change. INSERT_BEFORE_PLACE is a caller invariant, not a ledger one.
 * Side-effects: none
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (CP4.3b)
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
 * Extra columns (`attributes`, `created_at`, `updated_at`) surface as-is.
 */
export interface LedgerRow {
  target_id: string;
  fill_id: string;
  observed_at: Date;
  client_order_id: string;
  order_id: string | null;
  status: LedgerStatus;
  attributes: Record<string, unknown> | null;
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
}
