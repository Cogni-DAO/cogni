// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/trading/order-ledger.types`
 * Purpose: Port interface + row/snapshot types for the Postgres-backed order ledger. Every placement path reads/writes through this port; adapter is the Drizzle implementation in `order-ledger.ts`.
 * Scope: Pure type surface. No drizzle imports, no I/O.
 * Invariants: LEDGER_PORT_SHAPE_IS_STABLE — adding fields is a breaking change. INSERT_BEFORE_PLACE is a caller invariant, not a ledger one.
 * Side-effects: none
 * Public types: `LedgerRow` (includes `synced_at` + `position_lifecycle`), `LedgerStatus`, `LedgerPositionLifecycle`, `StateSnapshot`, `TenantBinding`, `InsertPendingInput` (extends TenantBinding), `RecordDecisionInput` (extends TenantBinding), `ListRecentOptions`, `ListOpenOrPendingOptions`, `UpdateStatusInput` (includes `reason?`), `SyncHealthSummary`, `OrderLedger` (snapshotState takes `(target_id, billing_account_id)`).
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (CP4.3b), work/items/task.0328.poly-sync-truth-ledger-cache.md, docs/spec/poly-multi-tenant-auth.md
 * @public
 */

import type { OrderIntent, OrderReceipt } from "@cogni/poly-market-provider";

/** Canonical status set for `poly_copy_trade_fills.status` (migration 0027 CHECK). */
export type LedgerStatus =
  | "pending"
  | "open"
  | "filled"
  | "partial"
  | "canceled"
  | "error";

/**
 * Typed position lifecycle for rows that have or had wallet exposure. NULL
 * means the order row has not produced a position yet.
 */
export type LedgerPositionLifecycle =
  | "unresolved"
  | "open"
  | "closing"
  | "closed"
  | "resolving"
  | "winner"
  | "redeem_pending"
  | "redeemed"
  | "loser"
  | "dust"
  | "abandoned";

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
  position_lifecycle: LedgerPositionLifecycle | null;
  attributes: Record<string, unknown> | null;
  /** Last time the reconciler received a typed CLOB response for this row. NULL = never checked. */
  synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
  /**
   * Tenant the row belongs to. Required by the per-tenant order-reconciler so
   * it can route `getOrder` through the correct `PolyTradeExecutor` (each
   * tenant has their own CLOB API creds derived from their Privy signer).
   */
  billing_account_id: string;
}

/**
 * Generic per-(market_id, token_id) intent-aggregate row. Trading-vocabulary
 * only — names "intent," "shares," "usdc." Consumers (copy-trade) overlay
 * mirror-specific shape (`MirrorPositionView`) on top via their own aggregator.
 *
 * Quantities are intent-based (computed from `attributes.size_usdc /
 * attributes.limit_price`) and include rows in `pending | open | filled |
 * partial`, excluding `canceled | error | closed` and `position_lifecycle`
 * past `closing`. TRADING_IS_GENERIC: this type knows nothing about mirrors.
 */
export interface PositionIntentAggregate {
  market_id: string;
  token_id: string;
  /** BUY shares minus SELL shares on this `(market_id, token_id)`. */
  net_shares: number;
  /** Sum of `size_usdc` on BUY rows only. */
  gross_usdc_in: number;
  /** Sum of `size_usdc / limit_price` on BUY rows only. */
  gross_shares_in: number;
}

/**
 * State snapshot the mirror-coordinator hands to `decide()`. Caller translates
 * into `RuntimeState`. The ledger owns the SELECTs; `decide()` stays pure.
 *
 * **Fail-closed**: on DB error the adapter returns zeroes/empty arrays —
 * never throws into the coordinator.
 */
export interface StateSnapshot {
  today_spent_usdc: number;
  fills_last_hour: number;
  already_placed_ids: string[];
  /**
   * Per-(market_id, token_id) intent aggregates for the target's active fills.
   * Empty array on fail-closed read OR when the target has no active fills.
   * Generic shape — copy-trade's mirror-pipeline overlays mirror semantics
   * on top via `aggregatePositionRows()` from `@/features/copy-trade`.
   */
  position_aggregates: PositionIntentAggregate[];
}

/** Bounded enum of cancel reasons. Stored on `attributes.reason`. */
export type LedgerCancelReason = "target_exited_market" | "ttl_expired";

/**
 * Thrown by `insertPending` when the partial unique index
 * `poly_copy_trade_fills_one_open_per_market` rejects a second open row for
 * the same `(billing_account_id, target_id, market_id)` where the existing row
 * has not been position-closed (`attributes.closed_at IS NULL`). Pipeline
 * converts to `skip/already_resting`. task.5001 / task.5006.
 */
export class AlreadyRestingError extends Error {
  readonly code = "already_resting" as const;
  constructor(
    readonly billing_account_id: string,
    readonly target_id: string,
    readonly market_id: string
  ) {
    super(
      `AlreadyRestingError: open mirror order exists for (${billing_account_id}, ${target_id}, ${market_id})`
    );
    this.name = "AlreadyRestingError";
  }
}

/**
 * Thrown by `insertPending` when the tenant's active intent for a market would
 * exceed the caller-provided per-market cap. Unlike the target-scoped
 * `AlreadyRestingError`, this protects aggregate exposure across all copy
 * targets for the same billing account.
 */
export class PositionCapReachedError extends Error {
  readonly code = "position_cap_reached" as const;
  constructor(
    readonly billing_account_id: string,
    readonly market_id: string,
    readonly current_intent_usdc: number,
    readonly proposed_intent_usdc: number,
    readonly max_intent_usdc: number
  ) {
    super(
      `PositionCapReachedError: active intent ${current_intent_usdc} + ${proposed_intent_usdc} exceeds ${max_intent_usdc} for (${billing_account_id}, ${market_id})`
    );
    this.name = "PositionCapReachedError";
  }
}

/** Subset of `LedgerRow` returned by `findOpenForMarket` / `findStaleOpen`. */
export interface OpenOrderRow {
  client_order_id: string;
  /** Null until placement returns and `markOrderId` runs. */
  order_id: string | null;
  status: LedgerStatus;
  billing_account_id: string;
  target_id: string;
  market_id: string;
  created_at: Date;
}

/** Tenant attribution required by every write into `poly_copy_trade_*`. */
export interface TenantBinding {
  /** Data column. FK → billing_accounts.id. */
  billing_account_id: string;
  /** RLS key column. FK → users.id. */
  created_by_user_id: string;
}

/** Input to `insertPending` — shape captured at decide-time. */
export interface InsertPendingInput extends TenantBinding {
  target_id: string;
  fill_id: string;
  observed_at: Date;
  intent: OrderIntent;
  /**
   * Optional atomic cap for active tenant × market intent. When present, the
   * DB adapter locks `(billing_account_id, market_id)`, re-sums active intent,
   * and rejects the insert with `PositionCapReachedError` if it would exceed
   * this bound. Copy-trading passes `max_usdc_per_trade` here so concurrent
   * target pollers cannot race through the read-side pre-check.
   */
  max_market_intent_usdc?: number;
}

/** Input to `recordDecision` — one row per `decide()` outcome, including skips. */
export interface RecordDecisionInput extends TenantBinding {
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

/** Options for the tenant-scoped dashboard position read model. */
export interface ListTenantPositionsOptions {
  billing_account_id: string;
  statuses?: LedgerStatus[];
  limit?: number;
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

/** Input to clear ledger exposure after a token is no longer held. */
export interface MarkPositionClosedByAssetInput {
  billing_account_id: string;
  token_id: string;
  close_order_id?: string;
  close_client_order_id?: string;
  reason?: "manual_close" | "refresh_no_position";
  closed_at: Date;
}

/** Input to mirror redeem/resolution lifecycle into the ledger read model. */
export interface MarkPositionLifecycleByConditionIdInput {
  billing_account_id: string;
  condition_id: string;
  lifecycle: LedgerPositionLifecycle;
  updated_at: Date;
}

/** Input to mirror asset-scoped redeem lifecycle into the ledger read model. */
export interface MarkPositionLifecycleByAssetInput {
  billing_account_id: string;
  token_id: string;
  lifecycle: LedgerPositionLifecycle;
  updated_at: Date;
  terminal_correction?: "redeem_reorg";
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
   * Read runtime state for a target. Fail-closed on DB error: returns
   * zeroes/empty arrays plus an error log on the caller's logger — never throws.
   */
  snapshotState(
    target_id: string,
    billing_account_id: string
  ): Promise<StateSnapshot>;

  /**
   * Sum the `intent` `size_usdc` of all `poly_copy_trade_fills` rows for this
   * tenant × market that have not failed. Used by the mirror sizing policy
   * to enforce a per-(tenant, market) position cap.
   *
   * **Intent, not filled.** Reads `attributes->>'size_usdc'` (the intended
   * notional written at `insertPending`), not `attributes->>'filled_size_usdc'`
   * (the on-chain fill written by `markOrderId`). v0 chooses intent because
   * the FOK-heavy mirror regime fills only ~14% of placements; a filled-based
   * cap would let no-match attempts keep firing through the cap. Revisit
   * once task.0427's design pass lands and the miss rate drops.
   *
   * Counts rows with `status` ∈ `pending | open | filled | partial` while
   * `attributes.closed_at IS NULL`; closed positions no longer represent
   * active market exposure. Excludes `canceled | error` except FOK error rows
   * that can race with on-chain minting. Cross-target by design (the cap is on
   * the tenant's exposure to a market, not per-target). Fail-closed: returns
   * `Infinity` on DB error so the caller skips the placement rather than
   * mis-allowing it.
   */
  cumulativeIntentForMarket(
    billing_account_id: string,
    market_id: string
  ): Promise<number>;

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

  /** Transition any → canceled. Writes `attributes.reason`. task.5001. */
  markCanceled(params: {
    client_order_id: string;
    reason: LedgerCancelReason;
  }): Promise<void>;

  /**
   * Clear DB-derived position exposure after a token is no longer held.
   * Keeps historical rows, writes `position_lifecycle='closed'`, and stamps
   * `attributes.closed_at` as close timestamp metadata.
   */
  markPositionClosedByAsset(
    input: MarkPositionClosedByAssetInput
  ): Promise<number>;

  /**
   * Mirror asset-scoped redeem lifecycle into position rows. Redeem burns a
   * concrete CTF positionId/token_id, so this is the canonical write path for
   * redeem pipeline state. Terminal lifecycles are preserved unless the input
   * explicitly represents a chain reorg correction from `redeemed` back to
   * `redeem_pending`.
   */
  markPositionLifecycleByAsset(
    input: MarkPositionLifecycleByAssetInput
  ): Promise<number>;

  /**
   * Mirror a condition-level redeem/resolution lifecycle into position rows so
   * dashboard and automation can agree on one typed DB read model. Matches
   * either explicit `attributes.condition_id` or promoted `market_id` values.
   */
  markPositionLifecycleByConditionId(
    input: MarkPositionLifecycleByConditionIdInput
  ): Promise<number>;

  /**
   * Existence check on the partial unique index slot. True iff any row for
   * `(billing_account_id, target_id, market_id)` has `status IN
   * ('pending','open','partial') AND attributes.closed_at IS NULL`.
   * Fail-closed: returns `true` on DB error.
   */
  hasOpenForMarket(args: {
    billing_account_id: string;
    target_id: string;
    market_id: string;
  }): Promise<boolean>;

  /** All open rows for `(billing_account_id, target_id, market_id)`. */
  findOpenForMarket(args: {
    billing_account_id: string;
    target_id: string;
    market_id: string;
  }): Promise<OpenOrderRow[]>;

  /**
   * All rows across all tenants whose `created_at < now() - max_age_minutes`
   * AND `status IN ('pending','open','partial')`. Used by the TTL sweeper.
   */
  findStaleOpen(args: { max_age_minutes: number }): Promise<OpenOrderRow[]>;

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
   * Tenant-scoped position read model for dashboard page-loads. Reads
   * `poly_copy_trade_fills` only; CLOB is background reconciliation input.
   */
  listTenantPositions(opts: ListTenantPositionsOptions): Promise<LedgerRow[]>;

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
   * Called by the order reconciler and explicit user refresh — no page-load
   * route should drive status after placement.
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
