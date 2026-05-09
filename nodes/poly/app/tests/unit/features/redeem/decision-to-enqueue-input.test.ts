// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: tests/unit/features/redeem/decision-to-enqueue-input
 * Purpose: Pin the boundary between transient and terminal `skip` reasons.
 *   The earlier shape persisted ALL skip reasons including `market_not_resolved`
 *   and `read_failed`. That collided with `enqueue`'s `onConflictDoNothing`
 *   on the unique `(funder, conditionId)` key: when the market later resolved,
 *   the subscriber's `redeem` enqueue silently no-op'd against the stale
 *   `skipped/resolving` row, and the worker (which filters
 *   `status='pending'|'failed_transient'`) never saw the row → user clicks
 *   Redeem forever, dust never clears. See task.0388 § Static review Blocker #2.
 *
 *   These tests are the regression teeth: transient skip reasons MUST return
 *   null; terminal skip reasons MUST return a row.
 * Scope: Pure logic. No I/O, no DB, no chain.
 * Links: src/features/redeem/decision-to-enqueue-input.ts, work/items/task.0388
 */

import type { RedeemDecision } from "@cogni/poly-market-provider/policy";
import { describe, expect, it } from "vitest";

import { decisionToEnqueueInput } from "@/features/redeem/decision-to-enqueue-input";
import type { ResolvedRedeemCandidate } from "@/features/redeem/resolve-redeem-decision";

const FUNDER = "0xaaaa000000000000000000000000000000000001" as const;
const COND =
  "0x86c171b757d290aebed1d5a22e63da3c06900e6e9f42e84ac27baf89fcf09e4b" as const;

function candidate(
  decision: RedeemDecision,
  overrides: Partial<ResolvedRedeemCandidate> = {}
): ResolvedRedeemCandidate {
  return {
    conditionId: COND,
    outcomeIndex: 0,
    positionId: 12345678901234567890n,
    negativeRisk: false,
    decision,
    collateralToken: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    payoutNumerator: decision.kind === "redeem" ? 1n : 0n,
    payoutDenominator: 1n,
    ...overrides,
  };
}

describe("decisionToEnqueueInput: redeem decisions", () => {
  it("translates a binary redeem decision into a pending/winner row", () => {
    const out = decisionToEnqueueInput(
      FUNDER,
      candidate({
        kind: "redeem",
        flavor: "binary",
        parentCollectionId:
          "0x0000000000000000000000000000000000000000000000000000000000000000",
        indexSet: [1n, 2n],
        expectedShares: 5_000_000n,
        expectedPayoutUsdc: 5_000_000n,
      })
    );
    expect(out).not.toBeNull();
    if (out === null) throw new Error("unreachable");
    expect(out.flavor).toBe("binary");
    expect(out.indexSet).toEqual(["1", "2"]);
    expect(out.lifecycleState).toBe("winner");
    // status omitted ⇒ port defaults to 'pending' (see RedeemJobsPort).
    expect(out.status).toBeUndefined();
    expect(out.expectedShares).toBe("5000000");
  });
});

describe("decisionToEnqueueInput: TRANSIENT skip reasons (no row persisted)", () => {
  // These reasons MUST NOT produce a row, because the unique-key UPSERT would
  // block the future `redeem` enqueue when the market resolves OR when the
  // wallet re-acquires shares (bug.5040).

  it("market_not_resolved → null (no row written)", () => {
    const out = decisionToEnqueueInput(
      FUNDER,
      candidate({ kind: "skip", reason: "market_not_resolved" })
    );
    expect(out).toBeNull();
  });

  it("read_failed → null (no row written)", () => {
    const out = decisionToEnqueueInput(
      FUNDER,
      candidate({ kind: "skip", reason: "read_failed" })
    );
    expect(out).toBeNull();
  });

  it("zero_balance → null (bug.5040: must not lock dashboard to currentValue=0)", () => {
    const out = decisionToEnqueueInput(
      FUNDER,
      candidate({ kind: "skip", reason: "zero_balance" })
    );
    expect(out).toBeNull();
  });
});

describe("decisionToEnqueueInput: TERMINAL skip reasons", () => {
  // Only `losing_outcome` is terminal: payoutNumerator=0 never flips back.

  it("losing_outcome → skipped/loser row, binary flavor by default", () => {
    const out = decisionToEnqueueInput(
      FUNDER,
      candidate({ kind: "skip", reason: "losing_outcome" })
    );
    expect(out).not.toBeNull();
    if (out === null) throw new Error("unreachable");
    expect(out.status).toBe("skipped");
    expect(out.lifecycleState).toBe("loser");
    expect(out.flavor).toBe("binary");
    expect(out.expectedShares).toBe("0");
    expect(out.expectedPayoutUsdc).toBe("0");
    expect(out.indexSet).toEqual([]);
  });

  it("losing_outcome on a neg-risk market routes flavor to neg-risk-parent", () => {
    const out = decisionToEnqueueInput(
      FUNDER,
      candidate(
        { kind: "skip", reason: "losing_outcome" },
        { negativeRisk: true }
      )
    );
    expect(out?.flavor).toBe("neg-risk-parent");
  });
});

describe("decisionToEnqueueInput: malformed", () => {
  it("returns null (Class-A page, not a row)", () => {
    const out = decisionToEnqueueInput(
      FUNDER,
      candidate({ kind: "malformed", reason: "invalid_outcome_index" })
    );
    expect(out).toBeNull();
  });
});
