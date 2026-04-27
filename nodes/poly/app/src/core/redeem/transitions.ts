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
 *   - REDEEM_COMPLETION_IS_EVENT_OBSERVED — both `payout_redemption_observed`
 *     (subscriber) and `reaper_chain_evidence` (reaper, with `payoutObserved`)
 *     can flip a row to `confirmed`. Receipt-burn flag alone never confirms.
 *   - REAPER_QUERIES_CHAIN_TRUTH — at N=5, the reaper consults `getLogs` for
 *     `PayoutRedemption` and `balanceOf` for the position. The local
 *     `receiptBurnObserved` flag is observational only and never decides
 *     confirm-vs-bleed (bug.0403 — flag was previously corrupted by no-op
 *     retries, producing false bleed alerts).
 *   - REDEEM_REQUIRES_BURN_OBSERVATION — bleed is detected by the reaper when
 *     no `PayoutRedemption` was emitted AND the funder still holds the
 *     position (`balance > 0`). Balance-zero with no payout is treated as
 *     "redeemed off-pipeline" and confirmed defensively.
 *   - REDEEM_HAS_CIRCUIT_BREAKER — three transient failures escalate to
 *     `abandoned/transient_exhausted`.
 *   - REDEEM_RETRY_IS_TRANSIENT_ONLY — malformed-class events skip the retry loop.
 * Side-effects: none
 * Links: docs/design/poly-positions.md § Lifecycle, work/items/task.0388,
 *   work/items/bug.0403
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
 * - `reaper_chain_evidence` — N=5 blocks elapsed; reaper queried chain truth.
 *   `payoutObserved` ⇒ confirmed; `!payoutObserved && balance>0` ⇒ bleed →
 *   abandoned/malformed; `!payoutObserved && balance==0` ⇒ confirmed
 *   defensively (position settled off-pipeline; no money owed).
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
      kind: "reaper_chain_evidence";
      /** True iff `getLogs` found a `PayoutRedemption(redeemer=funder)` for
       *  this conditionId on the appropriate contract (CTF or NegRiskAdapter). */
      payoutObserved: boolean;
      /** Funder's current `balanceOf` for the position. */
      balance: bigint;
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
      if (job.status !== "claimed") {
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
      if (job.status !== "claimed") {
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

    case "reaper_chain_evidence": {
      if (job.status !== "submitted") {
        return {
          ok: false,
          rejection: "wrong_status_for_event",
          reason: `reaper from status=${job.status}`,
        };
      }
      // Happy path — chain emitted PayoutRedemption from funder.
      if (event.payoutObserved) {
        return {
          ok: true,
          transition: { nextStatus: "confirmed" },
        };
      }
      // Bleed — no payout AND funder still holds the position.
      if (event.balance > 0n) {
        return {
          ok: true,
          transition: {
            nextStatus: "abandoned",
            errorClass: "malformed",
            lastError:
              "REDEEM_REQUIRES_BURN_OBSERVATION: no payout + balance>0",
          },
        };
      }
      // Defensive confirm — no payout but balance is zero. The position
      // settled outside the pipeline (legacy sweep, manual redeem, off-pod
      // tx). No money is owed; mark `confirmed` so the row exits the
      // submitted set. Caller logs at warn for audit visibility.
      return {
        ok: true,
        transition: {
          nextStatus: "confirmed",
          lastError: "balance_zero_no_payout",
        },
      };
    }
  }
}
