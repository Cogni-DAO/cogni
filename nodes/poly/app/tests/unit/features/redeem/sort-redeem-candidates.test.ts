// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/features/redeem/sort-redeem-candidates`
 * Purpose: Lock the bug.0431 invariant — when a funder holds both outcomes of a binary market, the `redeem` candidate must enqueue before any sibling `skip:losing_outcome`. The redeem-job table's `(funder, condition_id)` unique key + `ON CONFLICT DO NOTHING` means whichever candidate inserts first locks the row's lifecycle.
 * Scope: Pure helper. No I/O.
 * Side-effects: none
 * Links: work/items/bug.0431.poly-redeem-policy-misclassifies-winners-as-losers.md
 * @internal
 */

import { describe, expect, it } from "vitest";

import {
  type ResolvedRedeemCandidate,
  sortRedeemCandidatesForEnqueue,
} from "@/features/redeem/resolve-redeem-decision";

const CONDITION_ID =
  "0x4eaf52950000000000000000000000000000000000000000000000000000aaaa" as const;

const USDCE = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

function loserCandidate(outcomeIndex: number): ResolvedRedeemCandidate {
  return {
    conditionId: CONDITION_ID,
    outcomeIndex,
    positionId: 1n,
    negativeRisk: false,
    decision: { kind: "skip", reason: "losing_outcome" },
    collateralToken: USDCE,
    payoutNumerator: 0n,
    payoutDenominator: 1n,
  };
}

function winnerCandidate(outcomeIndex: number): ResolvedRedeemCandidate {
  return {
    conditionId: CONDITION_ID,
    outcomeIndex,
    positionId: 2n,
    negativeRisk: false,
    decision: {
      kind: "redeem",
      flavor: "binary",
      parentCollectionId:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      indexSet: [1n, 2n],
      expectedShares: 9_990_000n,
      expectedPayoutUsdc: 9_990_000n,
    },
    collateralToken: USDCE,
    payoutNumerator: 1n,
    payoutDenominator: 1n,
  };
}

describe("sortRedeemCandidatesForEnqueue", () => {
  it("puts redeem candidate before sibling losing_outcome (bug.0431 prod scenario)", () => {
    // Loser-first iteration order is what listUserPositions returned for the
    // Tampa Bay Rays vs Cleveland Guardians condition; the loser then locked
    // the `(funder, condition)` row into lifecycle=loser before the winner
    // enqueue could land.
    const sorted = sortRedeemCandidatesForEnqueue([
      loserCandidate(1),
      winnerCandidate(0),
    ]);
    expect(sorted.map((c) => c.decision.kind)).toEqual(["redeem", "skip"]);
    expect(sorted[0]?.outcomeIndex).toBe(0);
  });

  it("is stable when redeem already first", () => {
    const input = [winnerCandidate(0), loserCandidate(1)];
    const sorted = sortRedeemCandidatesForEnqueue(input);
    expect(sorted.map((c) => c.outcomeIndex)).toEqual([0, 1]);
  });

  it("does not mutate the input array", () => {
    const input = [loserCandidate(1), winnerCandidate(0)];
    const before = input.map((c) => c.outcomeIndex);
    sortRedeemCandidatesForEnqueue(input);
    expect(input.map((c) => c.outcomeIndex)).toEqual(before);
  });

  it("preserves order among non-redeem candidates", () => {
    const sorted = sortRedeemCandidatesForEnqueue([
      loserCandidate(0),
      loserCandidate(1),
    ]);
    expect(sorted.map((c) => c.outcomeIndex)).toEqual([0, 1]);
  });

  it("empty array returns empty", () => {
    expect(sortRedeemCandidatesForEnqueue([])).toEqual([]);
  });
});
