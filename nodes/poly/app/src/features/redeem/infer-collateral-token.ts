// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `features/redeem/infer-collateral-token`
 * Purpose: At redeem-job-create time, derive which ERC-20 collateralToken minted a vanilla CTF position from its on-chain `positionId`. Vanilla CTF `redeemPositions(collateralToken, parentCollectionId, conditionId, indexSets)` requires the exact collateralToken used at split time; mismatch silently zero-burns and yields no payout (bug.0428).
 * Scope: Two CTF view-call probes per inference. No DB, no writes. Independent of `decideRedeem` so the policy stays pure.
 * Invariants:
 *   - PROBE_FROM_KNOWN_POSITION_ID — caller passes the on-chain `positionId` (Data-API `asset`); we test which candidate `(collateralToken, collectionId)` keccak hashes to it.
 *   - DETERMINISTIC_FALLBACK — when neither candidate matches, return USDC.e (V1-legacy default). Worker still emits `bleed_detected` if the redeem zero-burns; the inferred-from audit field surfaces the guess.
 *   - PARENT_COLLECTION_ZERO — only inspects the standard parent-collection path used by binary, multi-outcome, and neg-risk-parent flavors.
 * Side-effects: IO (Polygon RPC view calls).
 * Links: docs/spec/poly-collateral-currency.md, work/items/bug.0428.poly-redeem-worker-hardcodes-usdce.md
 * @public
 */

import {
  PARENT_COLLECTION_ID_ZERO,
  POLYGON_CONDITIONAL_TOKENS,
  POLYGON_PUSD,
  POLYGON_USDC_E,
  polymarketCtfPositionIdAbi,
} from "@cogni/poly-market-provider/adapters/polymarket";
import type { PublicClient } from "viem";

/** Why a particular collateralToken was selected. Surfaced in the audit log. */
export type CollateralTokenInferredFrom =
  /** chain probe matched the funder's positionId to this candidate */
  | "chain_probe_pusd"
  | "chain_probe_usdce"
  /** neither candidate matched — used USDC.e as the legacy-safe default */
  | "default_no_match"
  /** chain reads failed; used USDC.e as the legacy-safe default */
  | "default_read_failed";

export interface InferredCollateralToken {
  collateralToken: `0x${string}`;
  inferredFrom: CollateralTokenInferredFrom;
}

const CANDIDATE_TOKENS: ReadonlyArray<{
  address: `0x${string}`;
  source: "chain_probe_pusd" | "chain_probe_usdce";
}> = [
  // pUSD first — V2 cutover (2026-04-28) means new positions are pUSD-backed;
  // USDC.e remains the V1-legacy fallback.
  { address: POLYGON_PUSD, source: "chain_probe_pusd" },
  { address: POLYGON_USDC_E, source: "chain_probe_usdce" },
];

/**
 * Probe CTF for `(collateralToken, collectionId) → positionId` and pick the
 * candidate that hashes to the funder's known on-chain positionId.
 *
 * Sequence (only one path executes per call):
 *   1. `getCollectionId(zero, conditionId, 1n << outcomeIndex)` — chain
 *      derives the collection id (BN254 ECC math; not replicable off-chain
 *      cheaply).
 *   2. multicall `getPositionId(token, collectionId)` for both candidates.
 *   3. compare each result to `expectedPositionId` and return the match.
 *
 * Falls through to USDC.e on any read failure or non-match. Worker's
 * `bleed_detected` audit channel still flags zero-burn redeems, so a wrong
 * inference is observable — silent corruption is impossible by design.
 */
export async function inferCollateralTokenForPosition(deps: {
  publicClient: PublicClient;
  conditionId: `0x${string}`;
  outcomeIndex: number;
  expectedPositionId: bigint;
}): Promise<InferredCollateralToken> {
  const indexSet = 1n << BigInt(deps.outcomeIndex);

  let collectionId: `0x${string}`;
  try {
    collectionId = (await deps.publicClient.readContract({
      address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
      abi: polymarketCtfPositionIdAbi,
      functionName: "getCollectionId",
      args: [PARENT_COLLECTION_ID_ZERO, deps.conditionId, indexSet],
    })) as `0x${string}`;
  } catch {
    return {
      collateralToken: POLYGON_USDC_E,
      inferredFrom: "default_read_failed",
    };
  }

  const positionIdReads = await deps.publicClient.multicall({
    contracts: CANDIDATE_TOKENS.map((c) => ({
      address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
      abi: polymarketCtfPositionIdAbi,
      functionName: "getPositionId" as const,
      args: [c.address, collectionId] as const,
    })),
    allowFailure: true,
  });

  for (let i = 0; i < CANDIDATE_TOKENS.length; i++) {
    const read = positionIdReads[i];
    const candidate = CANDIDATE_TOKENS[i];
    if (!read || !candidate || read.status !== "success") continue;
    if ((read.result as bigint) === deps.expectedPositionId) {
      return {
        collateralToken: candidate.address,
        inferredFrom: candidate.source,
      };
    }
  }

  return {
    collateralToken: POLYGON_USDC_E,
    inferredFrom: "default_no_match",
  };
}
