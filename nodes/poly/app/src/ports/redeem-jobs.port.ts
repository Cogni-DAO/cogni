// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/redeem-jobs`
 * Purpose: Persistence contract for the event-driven CTF redeem pipeline (task.0388).
 *   The port owns persisted job rows + subscription block cursors. State-machine
 *   logic lives in `@core/redeem/transitions`; this port is the boundary between
 *   that pure module and the drizzle/Postgres adapter.
 * Scope: Interface + port-level error types. No persistence logic, no chain reads.
 * Invariants:
 *   - REDEEM_DEDUP_IS_PERSISTED — `enqueue` UPSERTs on `(funder_address, condition_id)`.
 *   - SWEEP_IS_NOT_AN_ARCHITECTURE — only legitimate sweep is `getLastProcessedBlock`-bounded
 *     event-replay catch-up; this port carries the cursor.
 * Side-effects: none (interface definition only).
 * Notes: Adapters throw port-level errors; feature/worker layer translates as needed.
 * Links: Implemented by `DrizzleRedeemJobsAdapter`; consumed by
 *   `features/redeem/{redeem-subscriber,redeem-worker,redeem-catchup}.ts`.
 * @public
 */

import type {
  RedeemFailureClass,
  RedeemFlavor,
  RedeemJob,
  RedeemJobStatus,
  RedeemLifecycleState,
} from "@/core";

/** Stable identifiers for the three viem `watchContractEvent` subscriptions. */
export type RedeemSubscriptionId =
  | "ctf_resolution"
  | "ctf_payout"
  | "negrisk_payout";

/** Inputs the subscriber + manual-route + catchup all use to UPSERT a job. */
export interface EnqueueRedeemJobInput {
  funderAddress: `0x${string}`;
  conditionId: `0x${string}`;
  positionId: string;
  outcomeIndex: number;
  flavor: RedeemFlavor;
  /** bigint[] from `decideRedeem`; stringified to preserve precision. */
  indexSet: readonly string[];
  /** Stringified bigint. */
  expectedShares: string;
  /** Stringified bigint (USDC.e raw, 6-dp). */
  expectedPayoutUsdc: string;
  lifecycleState: RedeemLifecycleState;
  /** Defaults to `'pending'` (worker will pick up). Use `'skipped'` for
   * non-redeem classifications (loser / dust / not-yet-resolved) so the
   * dashboard projection has a row to read but the worker has nothing to do. */
  status?: RedeemJobStatus;
}

export interface EnqueueRedeemJobResult {
  jobId: string;
  alreadyExisted: boolean;
}

/** Adapter throws this when a job row referenced by id doesn't exist. */
export class RedeemJobNotFoundPortError extends Error {
  constructor(public readonly jobId: string) {
    super(`redeem job ${jobId} not found`);
    this.name = "RedeemJobNotFoundPortError";
  }
}

/**
 * Persistence contract for the redeem pipeline.
 *
 * One adapter implementation: `DrizzleRedeemJobsAdapter` (Postgres,
 * `FOR UPDATE SKIP LOCKED` for `claimNextPending`).
 */
export interface RedeemJobsPort {
  /**
   * UPSERT a job row. Returns `alreadyExisted: true` if a row already exists
   * for `(funder_address, condition_id)`; the existing row is left untouched.
   */
  enqueue(input: EnqueueRedeemJobInput): Promise<EnqueueRedeemJobResult>;

  /**
   * Atomically claim the next `status='pending'` row for `funderAddress` using
   * `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1`. Two concurrent workers — even
   * for the same funder — never claim the same row. Cross-tenant claims are
   * impossible because the predicate is funder-scoped: a worker bound to
   * funder A never picks up a job for funder B (the calling worker would sign
   * with the wrong wallet, which is the bug the multi-tenant fan-out closes).
   */
  claimNextPending(funderAddress: `0x${string}`): Promise<RedeemJob | null>;

  /**
   * Reaper — rows in `status='submitted'` whose `submitted_at_block + N <= head`
   * and that have no observed `PayoutRedemption` yet. Caller branches on
   * `receiptBurnObserved` per the transition state machine.
   */
  claimReaperCandidates(
    headBlock: bigint,
    finalityBlocks: bigint
  ): Promise<RedeemJob[]>;

  markSubmitted(input: {
    jobId: string;
    txHash: `0x${string}`;
    submittedAtBlock: bigint;
    receiptBurnObserved: boolean;
  }): Promise<void>;

  markConfirmed(input: { jobId: string; txHash: `0x${string}` }): Promise<void>;

  markTransientFailure(input: { jobId: string; error: string }): Promise<void>;

  markAbandoned(input: {
    jobId: string;
    errorClass: RedeemFailureClass;
    error: string;
  }): Promise<void>;

  /**
   * Reorg path — flips a `confirmed` job back to `submitted`. Caller (subscriber)
   * has already verified the removed log corresponds to a tx in this row's
   * `tx_hashes`.
   */
  revertConfirmedToSubmitted(input: {
    jobId: string;
    removedTxHash: `0x${string}`;
  }): Promise<void>;

  /** Update `lifecycle_state` independently of status — used by CP2 surface. */
  setLifecycleState(input: {
    jobId: string;
    lifecycleState: RedeemLifecycleState;
  }): Promise<void>;

  findByKey(
    funderAddress: `0x${string}`,
    conditionId: `0x${string}`
  ): Promise<RedeemJob | null>;

  listForFunder(funderAddress: `0x${string}`): Promise<RedeemJob[]>;

  /** Block cursor read for catch-up replay. Returns `null` on first run. */
  getLastProcessedBlock(
    subscriptionId: RedeemSubscriptionId
  ): Promise<bigint | null>;

  /** Block cursor write — UPSERT on `subscription_id` PK. */
  setLastProcessedBlock(
    subscriptionId: RedeemSubscriptionId,
    block: bigint
  ): Promise<void>;
}
