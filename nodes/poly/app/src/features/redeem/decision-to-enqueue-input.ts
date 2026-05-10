// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `features/redeem/decision-to-enqueue-input`
 * Purpose: Translate a Capability A `ResolvedRedeemCandidate` into the
 *   `EnqueueRedeemJobInput` shape consumed by the port. `redeem` decisions
 *   become work the worker will pick up; **terminal** `skip` decisions become
 *   `'skipped'` rows and are also mirrored into the ledger lifecycle read
 *   model. **Transient** skip reasons intentionally produce no row.
 *   `malformed` returns `null` — those are code defects that need a Class-A
 *   page, not a row.
 * Scope: Pure function. No I/O.
 * Invariants:
 *   - TRANSIENT_SKIP_REASONS_NOT_PERSISTED — `market_not_resolved`,
 *     `read_failed`, and `zero_balance` are transient: a future
 *     `ConditionResolution` event or a re-acquisition of shares will
 *     re-evaluate `decideRedeem` and produce a `redeem` decision. The
 *     `(funder, conditionId)` unique key + `enqueue`'s `onConflictDoNothing`
 *     means any row written for a transient reason would block the future
 *     `pending/winner` enqueue, leaving the worker permanently unable to
 *     pick up the redeem (claimNextPending filters `status='pending'`, not
 *     `'skipped'`). `zero_balance` was previously persisted as terminal
 *     `lifecycle="redeemed"`; that locked the dashboard `currentValue` to
 *     0 for any condition the wallet later re-acquired shares in. (bug.5040)
 *     Only `losing_outcome` is genuinely terminal — chain payoutNumerator=0
 *     never flips back.
 * Side-effects: none
 * Links: docs/spec/poly-copy-trade-execution.md § Dust-state UI semantics, work/items/task.0388 § Static review Blocker #2, work/items/bug.5040
 * @public
 */

import type { RedeemLifecycleState } from "@/core";
import type { EnqueueRedeemJobInput } from "@/ports";

import type { ResolvedRedeemCandidate } from "./resolve-redeem-decision";

export function decisionToEnqueueInput(
  funderAddress: `0x${string}`,
  c: ResolvedRedeemCandidate
): EnqueueRedeemJobInput | null {
  const base = {
    funderAddress,
    conditionId: c.conditionId,
    positionId: c.positionId.toString(),
    outcomeIndex: c.outcomeIndex,
  };

  if (c.decision.kind === "redeem") {
    return {
      ...base,
      flavor: c.decision.flavor,
      indexSet: c.decision.indexSet.map((b) => b.toString()),
      collateralToken: c.collateralToken,
      expectedShares: c.decision.expectedShares.toString(),
      expectedPayoutUsdc: c.decision.expectedPayoutUsdc.toString(),
      lifecycleState: "winner",
    };
  }

  if (c.decision.kind === "skip") {
    // TRANSIENT_SKIP_REASONS_NOT_PERSISTED: see module docstring.
    if (c.decision.reason !== "losing_outcome") return null;
    const lifecycleState: RedeemLifecycleState = "loser";
    return {
      ...base,
      flavor: c.negativeRisk ? "neg-risk-parent" : "binary",
      indexSet: [],
      collateralToken: c.collateralToken,
      expectedShares: "0",
      expectedPayoutUsdc: "0",
      lifecycleState,
      status: "skipped",
    };
  }

  return null;
}
