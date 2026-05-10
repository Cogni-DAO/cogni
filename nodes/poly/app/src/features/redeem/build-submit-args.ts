// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `features/redeem/build-submit-args`
 * Purpose: Pure-ish boundary helper that translates a `RedeemJob` into the
 *   args vector for the right `redeemPositions` overload (CTF 4-arg vs
 *   NegRiskAdapter 2-arg). Neg-risk re-reads the funder's current ERC-1155
 *   balance from the persisted `positionId` so the dispatch reflects
 *   on-chain state at submit time, not the (potentially stale) decision-time
 *   snapshot.
 * Scope: Single function, parameterised over `readBalance` so tests don't
 *   need a viem `PublicClient`.
 * Invariants:
 *   - REDEEM_REQUIRES_BURN_OBSERVATION (precondition) — caller treats `null`
 *     as malformed and abandons the job before any tx is submitted.
 *   - POSITION_ID_IS_PERSISTED — neg-risk reads `balanceOf(funder, positionId)`,
 *     never derives a sentinel from `conditionId`.
 * Side-effects: none directly; `readBalance` is async and may do I/O.
 * Links: docs/spec/poly-copy-trade-execution.md § Worker, work/items/task.0388
 * @public
 */

import { deriveNegRiskAmounts, type RedeemJob } from "@/core";

export type SubmitArgs =
  | { kind: "ctf"; indexSets: bigint[] }
  | { kind: "neg-risk"; amounts: readonly [bigint, bigint] };

export type ReadBalance = (
  funderAddress: `0x${string}`,
  positionId: bigint
) => Promise<bigint>;

export async function buildSubmitArgs(
  job: RedeemJob,
  ctx: { funderAddress: `0x${string}`; readBalance: ReadBalance }
): Promise<SubmitArgs | null> {
  if (job.flavor === "binary" || job.flavor === "multi-outcome") {
    return { kind: "ctf", indexSets: job.indexSet.map((s) => BigInt(s)) };
  }

  if (job.outcomeIndex !== 0 && job.outcomeIndex !== 1) return null;
  let positionId: bigint;
  try {
    positionId = BigInt(job.positionId);
  } catch {
    return null;
  }
  if (positionId === 0n) return null;

  const balance = await ctx.readBalance(ctx.funderAddress, positionId);
  if (balance === 0n) return null;

  return {
    kind: "neg-risk",
    amounts: deriveNegRiskAmounts(job.outcomeIndex, balance),
  };
}
