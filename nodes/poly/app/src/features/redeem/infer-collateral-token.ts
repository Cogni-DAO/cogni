// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `features/redeem/infer-collateral-token`
 * Purpose: Pick the right ERC-20 `collateralToken` for `redeemPositions(...)` on a vanilla CTF position by chain-probing both candidates (pUSD, USDC.e) and matching the one whose `(token, collectionId)` hashes to the funder's known on-chain positionId. Mismatch silently zero-burns (bug.0428).
 * Scope: Two CTF view calls. No DB, no writes.
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

// pUSD first — post-V2-cutover positions are pUSD-backed; USDC.e is the
// legacy fallback for V1 mints and the default on read failure.
const CANDIDATES: ReadonlyArray<`0x${string}`> = [POLYGON_PUSD, POLYGON_USDC_E];

/**
 * Returns the collateral that minted the given positionId, or USDC.e on
 * non-match / RPC failure (legacy-safe default). The worker's existing
 * `bleed_detected` invariant flags any wrong inference — silent corruption
 * is impossible by design.
 */
export async function inferCollateralTokenForPosition(deps: {
  publicClient: PublicClient;
  conditionId: `0x${string}`;
  outcomeIndex: number;
  expectedPositionId: bigint;
}): Promise<`0x${string}`> {
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
    return POLYGON_USDC_E;
  }

  const positionIds = await deps.publicClient.multicall({
    contracts: CANDIDATES.map((token) => ({
      address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
      abi: polymarketCtfPositionIdAbi,
      functionName: "getPositionId" as const,
      args: [token, collectionId] as const,
    })),
    allowFailure: true,
  });

  for (let i = 0; i < CANDIDATES.length; i++) {
    const read = positionIds[i];
    const token = CANDIDATES[i];
    if (read?.status !== "success" || !token) continue;
    if ((read.result as bigint) === deps.expectedPositionId) return token;
  }
  return POLYGON_USDC_E;
}
