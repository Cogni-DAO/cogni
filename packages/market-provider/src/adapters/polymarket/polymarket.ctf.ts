// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/polymarket/ctf`
 * Purpose: Polygon Conditional Tokens read+write surface used by the poly node — `redeemPositions` calldata for resolved markets plus the ERC1155 `balanceOf` view used by the redeem sweep to confirm the funder still holds redeemable shares before submitting a tx.
 * Scope: Exports pinned mainnet addresses, the minimal ABI, and a condition-id normalizer for viem callers. Does not submit transactions, hold signers, or implement grant checks.
 * Invariants:
 *   - POLYGON_MAINNET_ONLY — addresses match `approve-polymarket-allowances.ts` / Polymarket docs for chain id 137.
 *   - BINARY_INDEX_SETS_WRITE_ONLY — `[1, 2]` applies only to the `redeemPositions` write path (indexSets argument). The `balanceOf` read path takes an arbitrary ERC1155 token id (e.g. `Position.asset` from the Data-API) and is outcome-cardinality agnostic.
 * Side-effects: none (pure constants + parseAbi)
 * Links: Polymarket agent-skills ctf-operations.md; scripts/experiments/approve-polymarket-allowances.ts
 * @public
 */

import { parseAbi } from "viem";

/** Polymarket CTF / ConditionalTokens on Polygon (same as approve-polymarket script). */
export const POLYGON_CONDITIONAL_TOKENS =
  "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const;

/** Bridged USDC.e — Polymarket collateral on Polygon. */
export const POLYGON_USDC_E =
  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

export const PARENT_COLLECTION_ID_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/**
 * Binary markets: index sets 1 (Yes) and 2 (No). Only the resolved winning
 * side pays USDC when redeeming after resolution.
 */
export const BINARY_REDEEM_INDEX_SETS: readonly [bigint, bigint] = [1n, 2n];

export const polymarketCtfRedeemAbi = parseAbi([
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
]);

/**
 * Event ABI for the CTF subscriptions used by the event-driven redeem
 * pipeline (task.0388):
 *
 *  - `ConditionResolution(conditionId, oracle, questionId, outcomeSlotCount, payoutNumerators)`
 *    fires once per resolved condition; subscriber enumerates funder's positions for
 *    that condition and enqueues redeem jobs via Capability A.
 *  - `PayoutRedemption(redeemer, collateralToken, parentCollectionId, conditionId, indexSets, payout)`
 *    fires on every successful CTF `redeemPositions` call; subscriber matches
 *    `redeemer == funder` + existing job row to flip status to `confirmed` at N=5.
 *
 * The shape differs from `NegRiskAdapter.PayoutRedemption` (different topic hash);
 * subscriber must subscribe both independently.
 */
export const polymarketCtfEventsAbi = parseAbi([
  "event ConditionResolution(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint256 outcomeSlotCount, uint256[] payoutNumerators)",
  "event PayoutRedemption(address indexed redeemer, address indexed collateralToken, bytes32 indexed parentCollectionId, bytes32 conditionId, uint256[] indexSets, uint256 payout)",
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
]);

/** Normalize API / DB condition ids to a 32-byte hex string. */
export function normalizePolygonConditionId(raw: string): `0x${string}` {
  const trimmed = raw.trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hex)) {
    throw new Error(
      `normalizePolygonConditionId: expected 32-byte hex condition id, got "${raw.slice(0, 42)}..."`
    );
  }
  return hex as `0x${string}`;
}
