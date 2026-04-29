// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/adapters/polymarket/neg-risk-adapter`
 * Purpose: Polygon NegRiskAdapter contract surface for the event-driven redeem pipeline — exports the pinned mainnet address, the 2-arg `redeemPositions(bytes32,uint256[])` ABI fragment, and the `PayoutRedemption(redeemer, conditionId, amounts, payout)` event ABI consumed by the subscriber + catch-up replay (task.0388).
 * Scope: Address + ABI fragments only. Does not submit transactions, hold signers, or implement the dispatch decision (which lives in the worker).
 * Invariants:
 *   - POLYGON_MAINNET_ONLY — address `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`
 *     (verified Polygonscan, Solidity 0.8.19, "Adapter for the CTF enabling
 *     the linking of a set binary markets where only one can resolve true").
 *   - DISTINCT_FROM_CTF — `redeemPositions(conditionId, amounts[2])` is a
 *     2-arg signature, vs CTF's 4-arg
 *     `redeemPositions(collateral, parentCollectionId, conditionId, indexSets[])`.
 *     Different keccak256 selector → routed by `decision.flavor` at the worker.
 *   - PAYOUT_EVENT_DISTINCT — NegRiskAdapter `PayoutRedemption` has no
 *     `parentCollectionId` and uses `amounts` rather than `indexSets` →
 *     different topic hash than CTF `PayoutRedemption`. Subscriber must
 *     subscribe both independently.
 * Side-effects: none (pure constants + parseAbi)
 * Links: docs/design/poly-positions.md § Three-subscription topology,
 *   work/items/task.0388.poly-redeem-job-queue-capability-b.md
 *   <https://polygonscan.com/address/0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296#code>
 * @public
 */

import { parseAbi } from "viem";

/** Polymarket NegRiskAdapter on Polygon mainnet. */
export const POLYGON_NEG_RISK_ADAPTER =
  "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as const;

/**
 * Minimal ABI for the redeem write path + payout-observation event read path.
 *
 * `redeemPositions(bytes32 conditionId, uint256[] amounts)` — `amounts.length === 2`,
 * indexed by outcome side (YES=0, NO=1). The non-held side passes `0n`. See
 * `core/redeem/derive-negrisk-amounts.ts` for the derivation helper.
 *
 * `PayoutRedemption(address indexed redeemer, bytes32 indexed conditionId,
 * uint256[] amounts, uint256 payout)` — emitted on successful redeem;
 * subscriber matches `redeemer == funder` to flip job rows to `confirmed`.
 */
export const polymarketNegRiskAdapterAbi = parseAbi([
  "function redeemPositions(bytes32 conditionId, uint256[] amounts) external",
  "event PayoutRedemption(address indexed redeemer, bytes32 indexed conditionId, uint256[] amounts, uint256 payout)",
]);
