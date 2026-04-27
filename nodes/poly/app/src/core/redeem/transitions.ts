// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/redeem/transitions`
 * Purpose: Pure state machine for the redeem job lifecycle (task.0388).
 *   Given the current row + an event, returns the next status (or rejects the
 *   transition). The worker, subscriber, and reaper all funnel through this
 *   so the rules live in exactly one place and are exhaustively unit-testable.
 * Scope: Pure function. No DB, no chain, no time. The DB writes are the
 *   adapter's job; this module decides *what* to write.
 * Invariants:
 *   - REDEEM_COMPLETION_IS_EVENT_OBSERVED — only the `payout_redemption_observed`
 *     event flips a row to `confirmed`.
 *   - REDEEM_REQUIRES_BURN_OBSERVATION — `reaper_finality_elapsed` branches on
 *     `receiptBurnObserved`: false → abandoned/malformed; true → failed_transient.
 *   - REDEEM_HAS_CIRCUIT_BREAKER — three transient failures escalate to
 *     `abandoned/transient_exhausted`.
 *   - REDEEM_RETRY_IS_TRANSIENT_ONLY — malformed-class events skip the retry loop.
 * Side-effects: none
 * Links: docs/design/poly-positions.md § Lifecycle, work/items/task.0388
 * @public
 */

import type { RedeemFailureClass, RedeemJob, RedeemJobStatus } from "./types";

/** Maximum number of transient retries before escalating to abandoned. */
export const REDEEM_MAX_TRANSIENT_ATTEMPTS = 3;

/**
 * Discriminated event union the state machine accepts.
 *
 * - `submission_recorded` — worker successfully called `writeContract` and
 *   parsed the receipt. `receiptBurnObserved` is the load-bearing flag the
 *   reaper will use later.
 * - `payout_redemption_observed` — subscriber matched a `PayoutRedemption`
 *   event from funder at N=5 finality.
 * - `payout_redemption_reorged` — subscriber observed a removed log: a
 *   `PayoutRedemption` we'd already counted just got rolled back.
 * - `transient_failure` — worker hit RPC/gas/reorg-class error during submit.
 * - `reaper_finality_elapsed` — N=5 blocks elapsed since `submitted_at_block`
 *   without an observed `PayoutRedemption`. Reaper branches on `receiptBurnObserved`.
 */
export type RedeemEvent =
  | {
      kind: "submission_recorded";
      txHash: `0x${string}`;
      submittedAtBlock: bigint;
      receiptBurnObserved: boolean;
    }
  | {
      kind: "payout_redemption_observed";
      txHash: `0x${string}`;
    }
  | {
      kind: "payout_redemption_reorged";
      removedTxHash: `0x${string}`;
    }
  | {
      kind: "transient_failure";
      error: string;
    }
  | {
      kind: "reaper_finality_elapsed";
    };

/** Why a transition was rejected. Caller should log + ignore. */
export type TransitionRejection =
  | "already_terminal"
  | "wrong_status_for_event"
  | "no_op";

/**
 * Side-effect descriptor — tells the adapter which UPDATE to issue.
 *
 * The transition function does not run the UPDATE itself. Adapter pattern-matches
 * on `nextStatus` + the supplied fields to compose the right SQL.
 */
export interface RedeemTransition {
  nextStatus: RedeemJobStatus;
  /** Append this hash to `tx_hashes`. */
  appendTxHash?: `0x${string}`;
  /** Set `submitted_at_block` (only on `submission_recorded`). */
  submittedAtBlock?: bigint;
  /** Set `receipt_burn_observed` (only on `submission_recorded`). */
  receiptBurnObserved?: boolean;
  /** Free-text last-error to record. */
  lastError?: string | null;
  /** Failure-class on terminal abandonment. */
  errorClass?: RedeemFailureClass;
  /** Whether to bump `attempt_count` by 1. */
  incrementAttemptCount?: boolean;
}

export type TransitionResult =
  | { ok: true; transition: RedeemTransition }
  | { ok: false; rejection: TransitionRejection; reason: string };

const isTerminal = (status: RedeemJobStatus): boolean => status === "abandoned";

/**
 * Decide the next state for `job` given `event`. Pure.
 *
 * Callers MUST handle the rejection cases — they aren't errors, they're
 * idempotency / late-event guards.
 */
export function transition(
  job: Pick<
    RedeemJob,
    "status" | "attemptCount" | "receiptBurnObserved" | "txHashes"
  >,
  event: RedeemEvent
): TransitionResult {
  // Terminal `abandoned` rows accept nothing — once we've paged on-call we
  // require manual re-enqueue (Class-A runbook). `confirmed` is the one
  // "terminal" status that can be reverted by a reorged payout event.
  if (isTerminal(job.status)) {
    return {
      ok: false,
      rejection: "already_terminal",
      reason: `job is ${job.status}`,
    };
  }

  switch (event.kind) {
    case "submission_recorded": {
      if (job.status !== "pending" && job.status !== "failed_transient") {
        return {
          ok: false,
          rejection: "wrong_status_for_event",
          reason: `submission from status=${job.status}`,
        };
      }
      return {
        ok: true,
        transition: {
          nextStatus: "submitted",
          appendTxHash: event.txHash,
          submittedAtBlock: event.submittedAtBlock,
          receiptBurnObserved: event.receiptBurnObserved,
          lastError: null,
          incrementAttemptCount: true,
        },
      };
    }

    case "payout_redemption_observed": {
      if (job.status !== "submitted" && job.status !== "confirmed") {
        return {
          ok: false,
          rejection: "wrong_status_for_event",
          reason: `payout from status=${job.status}`,
        };
      }
      // Idempotent: same event re-arriving on a `confirmed` row is a no-op.
      if (job.status === "confirmed") {
        return {
          ok: false,
          rejection: "no_op",
          reason: "already confirmed",
        };
      }
      return {
        ok: true,
        transition: {
          nextStatus: "confirmed",
        },
      };
    }

    case "payout_redemption_reorged": {
      // A previously-confirmed row whose payout log was removed from chain.
      // Roll back to `submitted` so the reaper re-evaluates at next N=5 window.
      if (job.status !== "confirmed") {
        return {
          ok: false,
          rejection: "wrong_status_for_event",
          reason: `reorg from status=${job.status}`,
        };
      }
      return {
        ok: true,
        transition: {
          nextStatus: "submitted",
        },
      };
    }

    case "transient_failure": {
      if (job.status !== "pending" && job.status !== "failed_transient") {
        return {
          ok: false,
          rejection: "wrong_status_for_event",
          reason: `transient from status=${job.status}`,
        };
      }
      // Circuit breaker: attemptCount is post-increment of last attempt; if
      // we've already failed 3 times, escalate.
      const nextAttempts = job.attemptCount + 1;
      if (nextAttempts >= REDEEM_MAX_TRANSIENT_ATTEMPTS) {
        return {
          ok: true,
          transition: {
            nextStatus: "abandoned",
            lastError: event.error,
            errorClass: "transient_exhausted",
            incrementAttemptCount: true,
          },
        };
      }
      return {
        ok: true,
        transition: {
          nextStatus: "failed_transient",
          lastError: event.error,
          incrementAttemptCount: true,
        },
      };
    }

    case "reaper_finality_elapsed": {
      if (job.status !== "submitted") {
        return {
          ok: false,
          rejection: "wrong_status_for_event",
          reason: `reaper from status=${job.status}`,
        };
      }
      // The load-bearing branch — see REDEEM_REQUIRES_BURN_OBSERVATION.
      // `null` should never happen in practice (the worker always writes the
      // flag at submission_recorded time), but treat it defensively as
      // "burn missing" — same routing-mistake hazard.
      if (job.receiptBurnObserved !== true) {
        return {
          ok: true,
          transition: {
            nextStatus: "abandoned",
            errorClass: "malformed",
            lastError:
              "REDEEM_REQUIRES_BURN_OBSERVATION: no funder burn in receipt",
          },
        };
      }
      // Burn was real but we never saw the corresponding PayoutRedemption at
      // N=5 — it was reorged out. Retry as transient.
      return {
        ok: true,
        transition: {
          nextStatus: "failed_transient",
          lastError: "burn_reorged_out",
        },
      };
    }
  }
}
