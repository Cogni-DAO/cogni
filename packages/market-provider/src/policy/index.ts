// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/policy`
 * Purpose: Subpath barrel for pure decision policies — currently exports the redeem policy; future close/exit policies land alongside.
 * Scope: Re-exports only. Does not implement logic or hold state.
 * Invariants: PURE_POLICY_NO_IO — see individual modules. STABLE_BARREL — renames or removals must update consumers in the same commit.
 * Side-effects: none
 * Links: docs/design/poly-positions.md, work/items/task.0387
 * @public
 */

export {
  decideRedeem,
  REDEEM_PARENT_COLLECTION_ID_ZERO,
  type RedeemDecision,
  type RedeemFlavor,
  type RedeemMalformedReason,
  type RedeemPolicyInput,
  type RedeemSkipReason,
} from "./redeem.js";
