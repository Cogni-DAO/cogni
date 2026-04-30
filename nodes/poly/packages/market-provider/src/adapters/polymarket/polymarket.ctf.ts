// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/adapters/polymarket/ctf`
 * Purpose: Polygon Conditional Tokens read+write surface used by the poly node — `redeemPositions` ABI fragment + `ConditionResolution` / `PayoutRedemption` event ABIs consumed by the event-driven redeem pipeline (task.0388).
 * Scope: Exports pinned mainnet addresses, ABI fragments, and a condition-id normalizer for viem callers. Does not submit transactions, hold signers, or implement grant checks.
 * Invariants:
 *   - POLYGON_MAINNET_ONLY — addresses match `approve-polymarket-allowances.ts` / Polymarket docs for chain id 137.
 * Side-effects: none (pure constants + parseAbi)
 * Links: Polymarket agent-skills ctf-operations.md; scripts/experiments/approve-polymarket-allowances.ts
 * @public
 */

import { parseAbi } from "viem";

/** Polymarket CTF / ConditionalTokens on Polygon (same as approve-polymarket script). */
export const POLYGON_CONDITIONAL_TOKENS =
  "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as const;

/** Bridged USDC.e — Polymarket collateral on Polygon (pre-V2). */
export const POLYGON_USDC_E =
  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

/** pUSD — Polymarket V2 protocol-internal stablecoin (post-2026-04-28
 * cutover). Source of truth: `@polymarket/clob-client-v2`'s
 * `getContractConfig(137).collateral`; hardcoded here to keep the redeem
 * pipeline free of the SDK dep. See `docs/spec/poly-collateral-currency.md`. */
export const POLYGON_PUSD =
  "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as const;

export const PARENT_COLLECTION_ID_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export const polymarketCtfRedeemAbi = parseAbi([
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
]);

/** View functions used to derive a position's collateralToken vintage from
 * its on-chain positionId. `getCollectionId` does BN254 ECC math on chain
 * (we can't replicate it cheaply off-chain); `getPositionId` is a plain
 * `keccak256(abi.encodePacked(collateralToken, collectionId))` but takes
 * the chain-derived collectionId as input. Used by bug.0428's vintage
 * inference at redeem-job-create time. */
export const polymarketCtfPositionIdAbi = parseAbi([
  "function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) view returns (bytes32)",
  "function getPositionId(address collateralToken, bytes32 collectionId) view returns (uint256)",
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
