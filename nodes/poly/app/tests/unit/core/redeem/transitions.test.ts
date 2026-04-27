// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: tests/unit/core/redeem/transitions
 * Purpose: Exhaustive coverage of the redeem job state machine. Every
 *   invariant in `core/redeem/transitions.ts` has at least one fixture here.
 * Scope: Pure logic only. No DB, no chain, no time.
 * Links: src/core/redeem/transitions.ts, work/items/task.0388
 */

import { describe, expect, it } from "vitest";

import type { RedeemJob } from "@/core";
import { REDEEM_MAX_TRANSIENT_ATTEMPTS, transition } from "@/core";

type JobInput = Pick<
  RedeemJob,
  "status" | "attemptCount" | "receiptBurnObserved" | "txHashes"
>;

const baseJob: JobInput = {
  status: "pending",
  attemptCount: 0,
  receiptBurnObserved: null,
  txHashes: [],
};

const TX_A =
  "0xaaaa000000000000000000000000000000000000000000000000000000000001" as const;
const TX_B =
  "0xbbbb000000000000000000000000000000000000000000000000000000000002" as const;

describe("transition: submission_recorded", () => {
  it("flips pending → submitted, records block + burn flag, increments attempts", () => {
    const result = transition(baseJob, {
      kind: "submission_recorded",
      txHash: TX_A,
      submittedAtBlock: 12345n,
      receiptBurnObserved: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition).toEqual({
      nextStatus: "submitted",
      appendTxHash: TX_A,
      submittedAtBlock: 12345n,
      receiptBurnObserved: true,
      lastError: null,
      incrementAttemptCount: true,
    });
  });

  it("allows resubmission from failed_transient (the retry path)", () => {
    const result = transition(
      { ...baseJob, status: "failed_transient", attemptCount: 1 },
      {
        kind: "submission_recorded",
        txHash: TX_B,
        submittedAtBlock: 999n,
        receiptBurnObserved: false,
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.nextStatus).toBe("submitted");
    expect(result.transition.receiptBurnObserved).toBe(false);
  });

  it("rejects submission from submitted (already in flight)", () => {
    const result = transition(
      { ...baseJob, status: "submitted" },
      {
        kind: "submission_recorded",
        txHash: TX_A,
        submittedAtBlock: 1n,
        receiptBurnObserved: true,
      }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection).toBe("wrong_status_for_event");
  });
});

describe("transition: payout_redemption_observed", () => {
  it("flips submitted → confirmed (subscriber at N=5)", () => {
    const result = transition(
      { ...baseJob, status: "submitted", receiptBurnObserved: true },
      { kind: "payout_redemption_observed", txHash: TX_A }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.nextStatus).toBe("confirmed");
  });

  it("is a no-op when already confirmed (idempotency for replayed logs)", () => {
    const result = transition(
      { ...baseJob, status: "confirmed" },
      { kind: "payout_redemption_observed", txHash: TX_A }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection).toBe("no_op");
  });

  it("rejects payout from pending (can't confirm what was never submitted)", () => {
    const result = transition(baseJob, {
      kind: "payout_redemption_observed",
      txHash: TX_A,
    });
    expect(result.ok).toBe(false);
  });
});

describe("transition: payout_redemption_reorged (REDEEM_COMPLETION_IS_EVENT_OBSERVED teeth)", () => {
  it("rolls confirmed → submitted on removed log", () => {
    const result = transition(
      { ...baseJob, status: "confirmed", receiptBurnObserved: true },
      { kind: "payout_redemption_reorged", removedTxHash: TX_A }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.nextStatus).toBe("submitted");
  });

  it("rejects reorg from non-confirmed", () => {
    const result = transition(
      { ...baseJob, status: "submitted" },
      { kind: "payout_redemption_reorged", removedTxHash: TX_A }
    );
    expect(result.ok).toBe(false);
  });
});

describe("transition: transient_failure (REDEEM_HAS_CIRCUIT_BREAKER)", () => {
  it("first failure → failed_transient", () => {
    const result = transition(baseJob, {
      kind: "transient_failure",
      error: "rpc timeout",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.nextStatus).toBe("failed_transient");
    expect(result.transition.incrementAttemptCount).toBe(true);
  });

  it("3rd failure escalates to abandoned/transient_exhausted", () => {
    const result = transition(
      {
        ...baseJob,
        status: "failed_transient",
        attemptCount: REDEEM_MAX_TRANSIENT_ATTEMPTS - 1,
      },
      { kind: "transient_failure", error: "gas underpriced" }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.nextStatus).toBe("abandoned");
    expect(result.transition.errorClass).toBe("transient_exhausted");
  });

  it("rejects transient from submitted (worker shouldn't be running tx for in-flight job)", () => {
    const result = transition(
      { ...baseJob, status: "submitted" },
      { kind: "transient_failure", error: "weird" }
    );
    expect(result.ok).toBe(false);
  });
});

describe("transition: reaper_finality_elapsed (REDEEM_REQUIRES_BURN_OBSERVATION)", () => {
  it("burn-not-observed (false) → abandoned/malformed", () => {
    const result = transition(
      { ...baseJob, status: "submitted", receiptBurnObserved: false },
      { kind: "reaper_finality_elapsed" }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.nextStatus).toBe("abandoned");
    expect(result.transition.errorClass).toBe("malformed");
    expect(result.transition.lastError).toMatch(
      /REDEEM_REQUIRES_BURN_OBSERVATION/
    );
  });

  it("burn-observed (true) but no PayoutRedemption at N=5 → failed_transient (reorged out)", () => {
    const result = transition(
      { ...baseJob, status: "submitted", receiptBurnObserved: true },
      { kind: "reaper_finality_elapsed" }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.nextStatus).toBe("failed_transient");
    expect(result.transition.lastError).toBe("burn_reorged_out");
  });

  it("null receiptBurnObserved is treated as burn-not-observed (defensive)", () => {
    const result = transition(
      { ...baseJob, status: "submitted", receiptBurnObserved: null },
      { kind: "reaper_finality_elapsed" }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transition.nextStatus).toBe("abandoned");
    expect(result.transition.errorClass).toBe("malformed");
  });

  it("rejects reaper from non-submitted", () => {
    const result = transition(
      { ...baseJob, status: "pending" },
      { kind: "reaper_finality_elapsed" }
    );
    expect(result.ok).toBe(false);
  });
});

describe("transition: terminal `abandoned` rows accept nothing", () => {
  it.each<RedeemJob["status"]>([
    "abandoned",
  ])("rejects every event from %s", (status) => {
    const job: JobInput = { ...baseJob, status };
    const events = [
      {
        kind: "submission_recorded" as const,
        txHash: TX_A,
        submittedAtBlock: 1n,
        receiptBurnObserved: true,
      },
      { kind: "payout_redemption_observed" as const, txHash: TX_A },
      { kind: "payout_redemption_reorged" as const, removedTxHash: TX_A },
      { kind: "transient_failure" as const, error: "x" },
      { kind: "reaper_finality_elapsed" as const },
    ];
    for (const event of events) {
      const result = transition(job, event);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejection).toBe("already_terminal");
    }
  });
});
