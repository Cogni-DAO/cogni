// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `features/redeem/decision-to-enqueue-input`
 * Purpose: Translate a Capability A `ResolvedRedeemCandidate` into the
 *   `EnqueueRedeemJobInput` shape consumed by the port. `redeem` decisions
 *   become work the worker will pick up; **terminal** `skip` decisions become
 *   `'skipped'` rows whose only role is to back the dashboard's lifecycle
 *   projection (Open vs History tab membership). **Transient** skip reasons
 *   intentionally produce no row. `malformed` returns `null` — those are code
 *   defects that need a Class-A page, not a row.
 * Scope: Pure function. No I/O.
 * Invariants:
 *   - TRANSIENT_SKIP_REASONS_NOT_PERSISTED — `market_not_resolved` and
 *     `read_failed` are transient: a future `ConditionResolution` event will
 *     re-evaluate `decideRedeem` and produce a `redeem` decision. The
 *     `(funder, conditionId)` unique key + `enqueue`'s `onConflictDoNothing`
 *     means any row written for a transient reason would block the future
 *     `pending/winner` enqueue, leaving the worker permanently unable to
 *     pick up the redeem (claimNextPending filters `status='pending'`, not
 *     `'skipped'`). Persisting only terminal reasons makes that collision
 *     structurally impossible. Edge case (re-acquire shares post-resolution
 *     against a `zero_balance/redeemed` row) is acknowledged and handled by
 *     manual operator row-purge in v0.2 — single-user scope.
 * Side-effects: none
 * Links: docs/design/poly-positions.md § Dust-state UI semantics, work/items/task.0388 § Static review Blocker #2
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
    if (
      c.decision.reason === "market_not_resolved" ||
      c.decision.reason === "read_failed"
    ) {
      return null;
    }
    const lifecycleState: RedeemLifecycleState =
      c.decision.reason === "losing_outcome" ? "loser" : "redeemed";
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
