// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/redeem/types`
 * Purpose: Pure domain types for the event-driven CTF redeem pipeline (task.0388).
 *   Mirrors the `poly_redeem_jobs` schema row but lives in `core/` so transitions
 *   and consumers can typecheck without depending on drizzle.
 * Scope: Type definitions only. No functions, no I/O.
 * Invariants:
 *   - No imports from `ports`, `adapters`, `features`, `app`, `shared` — `core` boundary.
 *   - The `RedeemJobStatus` and `RedeemLifecycleState` enums are mirrored
 *     verbatim by the SQL CHECK constraints in migration 0033.
 * Side-effects: none
 * Links: docs/design/poly-positions.md, work/items/task.0388
 * @public
 */

import type { RedeemFlavor } from "@cogni/poly-market-provider/policy";

export type { RedeemFlavor } from "@cogni/poly-market-provider/policy";

/**
 * Job lifecycle status — drives the worker state machine.
 *
 * Authority for each transition:
 *  - `pending` → `claimed`           : adapter (atomic UPDATE … FOR UPDATE SKIP LOCKED)
 *  - `claimed` → `submitted`         : worker (post-receipt + burn-decode)
 *  - `claimed` → `failed_transient`  : worker (tx-submit threw; transient)
 *  - `claimed` → `abandoned`         : worker on `attempt_count >= 3` (transient_exhausted)
 *  - `failed_transient` → `claimed`  : adapter (next tick re-claims for retry)
 *  - `submitted` → `confirmed`       : subscriber (observed `PayoutRedemption` from funder at N=5)
 *  - `submitted` → `failed_transient`: reaper at N=5 when burn was real but reorged out
 *  - `submitted` → `abandoned`       : reaper at N=5 when no burn observed (malformed routing)
 *  - `confirmed` → `submitted`       : subscriber on reorg (removed log) — re-evaluated by reaper
 */
export type RedeemJobStatus =
  | "pending"
  | "claimed"
  | "submitted"
  | "confirmed"
  | "failed_transient"
  | "abandoned"
  | "skipped";

/** Why a job was abandoned. NULL while non-terminal or transient-retryable. */
export type RedeemFailureClass = "transient_exhausted" | "malformed";

/**
 * Position lifecycle state, surfaced to the dashboard for Open vs History
 * tab membership (CP2 of task.0388). Mirrors `docs/design/poly-positions.md`.
 *
 * Worker writes one of these on every `decideRedeem` evaluation; subscriber
 * advances it on observed events.
 */
export type RedeemLifecycleState =
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

/** Terminal lifecycle states — Dashboard "History" tab membership. */
export const REDEEM_TERMINAL_LIFECYCLE_STATES: ReadonlySet<RedeemLifecycleState> =
  new Set<RedeemLifecycleState>([
    "closed",
    "redeemed",
    "loser",
    "dust",
    "abandoned",
  ]);

/**
 * Domain row shape — matches the drizzle `polyRedeemJobs` row but stays in
 * `core/` so the transitions module can take it as input.
 */
export interface RedeemJob {
  id: string;
  funderAddress: `0x${string}`;
  conditionId: `0x${string}`;
  positionId: string;
  outcomeIndex: number;
  status: RedeemJobStatus;
  flavor: RedeemFlavor;
  /** Stringified bigint[] (jsonb in DB; precision-preserved). */
  indexSet: readonly string[];
  /** Collateral that minted the position; forwarded to `redeemPositions`. bug.0428. */
  collateralToken: `0x${string}`;
  /** Stringified bigint. */
  expectedShares: string;
  /** Stringified bigint (USDC.e raw, 6-dp). */
  expectedPayoutUsdc: string;
  txHashes: readonly `0x${string}`[];
  attemptCount: number;
  lastError: string | null;
  errorClass: RedeemFailureClass | null;
  lifecycleState: RedeemLifecycleState;
  receiptBurnObserved: boolean | null;
  submittedAtBlock: bigint | null;
  enqueuedAt: Date;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  abandonedAt: Date | null;
  updatedAt: Date;
}
