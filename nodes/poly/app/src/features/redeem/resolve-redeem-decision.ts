// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `features/redeem/resolve-redeem-decision`
 * Purpose: Shared helper that takes a `(funder, conditionId)` pair and runs
 *   the existing redeem-position resolution flow (Data-API position lookup +
 *   multicall of CTF reads + Capability A `decideRedeem`). Used by the
 *   subscriber (on `ConditionResolution`), the catch-up replay, and the
 *   manual-redeem route. Extracts the logic previously inlined in
 *   `poly-trade-executor.ts:redeemResolvedPosition` so deletion of the sweep
 *   path doesn't lose the position-lookup logic.
 * Scope: Composes existing chain reads + Capability A. Does not write to DB,
 *   does not submit txs.
 * Invariants:
 *   - PURE_OF_PERSISTENCE — does not import port/adapter; returns a value the
 *     caller decides what to do with.
 *   - DECIDE_REDEEM_IS_AUTHORITY — never re-implements policy; always defers
 *     to `@cogni/poly-market-provider/policy:decideRedeem`.
 * Side-effects: IO (Data-API HTTP, Polygon RPC).
 * Links: docs/design/poly-positions.md, work/items/task.0388
 * @public
 */

import {
  normalizePolygonConditionId,
  POLYGON_CONDITIONAL_TOKENS,
  POLYGON_USDC_E,
  type PolymarketDataApiClient,
  type PolymarketUserPosition,
} from "@cogni/poly-market-provider/adapters/polymarket";
import {
  decideRedeem,
  type RedeemDecision,
} from "@cogni/poly-market-provider/policy";
import { type PublicClient, parseAbi } from "viem";

import { inferCollateralTokenForPosition } from "./infer-collateral-token";

const ctfReadAbi = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function payoutNumerators(bytes32 conditionId, uint256 outcomeIndex) view returns (uint256)",
  "function payoutDenominator(bytes32 conditionId) view returns (uint256)",
  "function getOutcomeSlotCount(bytes32 conditionId) view returns (uint256)",
]);

/** Result for a single (funder, conditionId, outcomeIndex) tuple. */
export interface ResolvedRedeemCandidate {
  conditionId: `0x${string}`;
  outcomeIndex: number;
  positionId: bigint;
  negativeRisk: boolean;
  decision: RedeemDecision;
  /** Collateral that minted this position; forwarded to `redeemPositions`. bug.0428. */
  collateralToken: `0x${string}`;
  /**
   * Chain-read payout numerator for this outcome. `null` when the read failed.
   * Carried so callers can populate `poly_market_outcomes` without re-reading
   * the chain. `> 0` ⇒ winner; `=== 0n` ⇒ loser.
   */
  payoutNumerator: bigint | null;
  /** Chain-read payout denominator (same condition for all outcomes). */
  payoutDenominator: bigint | null;
}

/**
 * Stable ordering for `enqueue` of per-condition candidates: `redeem`
 * decisions first, then anything else. The redeem-job table's unique key is
 * `(funder, condition_id)` with `ON CONFLICT DO NOTHING`, so a sibling
 * `skip:losing_outcome` candidate that races in first will lock the
 * condition into `lifecycle=loser` and the winner's enqueue silently
 * no-ops as `alreadyExisted`. Sorting redeems first makes the redeem row
 * always claim the slot, regardless of `listUserPositions` iteration
 * order (bug.0431).
 */
export function sortRedeemCandidatesForEnqueue(
  candidates: ReadonlyArray<ResolvedRedeemCandidate>
): ResolvedRedeemCandidate[] {
  return [...candidates].sort((a, b) => {
    const ra = a.decision.kind === "redeem" ? 0 : 1;
    const rb = b.decision.kind === "redeem" ? 0 : 1;
    return ra - rb;
  });
}

/**
 * Look up funder's positions matching `conditionId`, run chain reads, and
 * compute a `decideRedeem` decision per matching position. Returns one
 * candidate per held outcome side (binary markets typically yield 1).
 *
 * Returns empty array if funder has no Data-API positions matching this
 * condition.
 */
export async function resolveRedeemCandidatesForCondition(deps: {
  funderAddress: `0x${string}`;
  conditionId: `0x${string}` | string;
  publicClient: PublicClient;
  dataApiClient: PolymarketDataApiClient;
  positions?: readonly PolymarketUserPosition[];
}): Promise<ResolvedRedeemCandidate[]> {
  const conditionId = normalizePolygonConditionId(
    typeof deps.conditionId === "string" ? deps.conditionId : deps.conditionId
  );

  const allPositions =
    deps.positions ??
    (await deps.dataApiClient.listUserPositions(deps.funderAddress, {
      market: conditionId,
    }));
  const matches = allPositions.filter((p) => {
    try {
      return normalizePolygonConditionId(p.conditionId) === conditionId;
    } catch {
      return false;
    }
  });
  if (matches.length === 0) return [];

  const out: ResolvedRedeemCandidate[] = [];
  for (const match of matches) {
    if (match.outcomeIndex == null || !match.asset) continue;
    let positionId: bigint;
    try {
      positionId = BigInt(match.asset);
    } catch {
      continue;
    }

    const reads = await deps.publicClient.multicall({
      contracts: [
        {
          address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
          abi: ctfReadAbi,
          functionName: "balanceOf" as const,
          args: [deps.funderAddress, positionId] as const,
        },
        {
          address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
          abi: ctfReadAbi,
          functionName: "payoutNumerators" as const,
          args: [conditionId, BigInt(match.outcomeIndex)] as const,
        },
        {
          address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
          abi: ctfReadAbi,
          functionName: "payoutDenominator" as const,
          args: [conditionId] as const,
        },
        {
          address: POLYGON_CONDITIONAL_TOKENS as `0x${string}`,
          abi: ctfReadAbi,
          functionName: "getOutcomeSlotCount" as const,
          args: [conditionId] as const,
        },
      ],
      allowFailure: true,
    });

    const decision = decideRedeem({
      balance:
        reads[0]?.status === "success" ? (reads[0].result as bigint) : null,
      payoutNumerator:
        reads[1]?.status === "success" ? (reads[1].result as bigint) : null,
      payoutDenominator:
        reads[2]?.status === "success" ? (reads[2].result as bigint) : null,
      outcomeIndex: match.outcomeIndex,
      outcomeSlotCount:
        reads[3]?.status === "success"
          ? Number(reads[3].result as bigint)
          : null,
      negativeRisk: match.negativeRisk ?? false,
    });

    // bug.0428: probe only for vanilla CTF redeems; NegRiskAdapter ignores collateralToken.
    const negativeRisk = match.negativeRisk ?? false;
    const collateralToken =
      decision.kind === "redeem" && !negativeRisk
        ? await inferCollateralTokenForPosition({
            publicClient: deps.publicClient,
            conditionId,
            outcomeIndex: match.outcomeIndex,
            expectedPositionId: positionId,
          })
        : POLYGON_USDC_E;

    out.push({
      conditionId,
      outcomeIndex: match.outcomeIndex,
      positionId,
      negativeRisk,
      decision,
      collateralToken,
      payoutNumerator:
        reads[1]?.status === "success" ? (reads[1].result as bigint) : null,
      payoutDenominator:
        reads[2]?.status === "success" ? (reads[2].result as bigint) : null,
    });
  }
  return out;
}
