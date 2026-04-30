// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: tests/unit/features/redeem/build-submit-args
 * Purpose: Regression coverage for the worker's CTF-vs-NegRiskAdapter
 *   dispatch boundary. v0 of this module derived a sentinel `positionId = 0n`
 *   for neg-risk, producing zero-amount no-op redeem txs (the v0.1 bleed
 *   shape). These tests pin the contract: neg-risk must read on-chain balance
 *   off the persisted `positionId` and emit non-zero `[yes, no]` amounts.
 * Scope: Pure logic + a stub `readBalance`. No chain, no DB.
 * Links: src/features/redeem/build-submit-args.ts, work/items/task.0388
 */

import { describe, expect, it, vi } from "vitest";

import type { RedeemJob } from "@/core";
import { buildSubmitArgs } from "@/features/redeem/build-submit-args";

const FUNDER = "0xaaaa000000000000000000000000000000000001" as const;
const COND =
  "0x86c171b757d290aebed1d5a22e63da3c06900e6e9f42e84ac27baf89fcf09e4b" as const;
const POSITION_ID = "12345678901234567890";

function makeJob(overrides: Partial<RedeemJob>): RedeemJob {
  return {
    id: "job-1",
    funderAddress: FUNDER,
    conditionId: COND,
    positionId: POSITION_ID,
    outcomeIndex: 0,
    status: "claimed",
    flavor: "binary",
    indexSet: ["1", "2"],
    collateralToken: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    expectedShares: "1000000",
    expectedPayoutUsdc: "1000000",
    txHashes: [],
    attemptCount: 0,
    lastError: null,
    errorClass: null,
    lifecycleState: "winner",
    receiptBurnObserved: null,
    submittedAtBlock: null,
    enqueuedAt: new Date(),
    submittedAt: null,
    confirmedAt: null,
    abandonedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("buildSubmitArgs: CTF flavors", () => {
  it("binary uses indexSet directly, never reads chain", async () => {
    const readBalance = vi.fn();
    const args = await buildSubmitArgs(makeJob({ flavor: "binary" }), {
      funderAddress: FUNDER,
      readBalance,
    });
    expect(args).toEqual({ kind: "ctf", indexSets: [1n, 2n] });
    expect(readBalance).not.toHaveBeenCalled();
  });

  it("multi-outcome passes the index-set through verbatim", async () => {
    const args = await buildSubmitArgs(
      makeJob({ flavor: "multi-outcome", indexSet: ["4"] }),
      { funderAddress: FUNDER, readBalance: vi.fn() }
    );
    expect(args).toEqual({ kind: "ctf", indexSets: [4n] });
  });
});

describe("buildSubmitArgs: neg-risk dispatch (B2 regression)", () => {
  it("YES (outcomeIndex=0) reads balance off persisted positionId, returns [balance, 0]", async () => {
    const readBalance = vi.fn(async () => 7_500_000n);
    const job = makeJob({ flavor: "neg-risk-parent", outcomeIndex: 0 });
    const args = await buildSubmitArgs(job, {
      funderAddress: FUNDER,
      readBalance,
    });
    expect(args).toEqual({ kind: "neg-risk", amounts: [7_500_000n, 0n] });
    expect(readBalance).toHaveBeenCalledWith(FUNDER, BigInt(POSITION_ID));
  });

  it("NO (outcomeIndex=1) returns [0, balance]", async () => {
    const readBalance = vi.fn(async () => 1_000n);
    const args = await buildSubmitArgs(
      makeJob({ flavor: "neg-risk-adapter", outcomeIndex: 1 }),
      { funderAddress: FUNDER, readBalance }
    );
    expect(args).toEqual({ kind: "neg-risk", amounts: [0n, 1_000n] });
  });

  it("never returns the sentinel-positionId v0 bug shape", async () => {
    // The v0.1 bleed: positionId derived as 0n → balanceOf returns 0 →
    // amounts = [0, 0] → no-op tx. Guard: a non-zero persisted positionId
    // must reach `readBalance`.
    const readBalance = vi.fn(async () => 0n);
    const job = makeJob({ flavor: "neg-risk-parent", outcomeIndex: 0 });
    const args = await buildSubmitArgs(job, {
      funderAddress: FUNDER,
      readBalance,
    });
    expect(args).toBeNull();
    expect(readBalance).toHaveBeenCalledWith(FUNDER, BigInt(POSITION_ID));
  });

  it("rejects positionId='0' (would replicate the v0 sentinel bug)", async () => {
    const readBalance = vi.fn();
    const args = await buildSubmitArgs(
      makeJob({ flavor: "neg-risk-parent", positionId: "0" }),
      { funderAddress: FUNDER, readBalance }
    );
    expect(args).toBeNull();
    expect(readBalance).not.toHaveBeenCalled();
  });

  it("rejects out-of-range outcomeIndex on neg-risk", async () => {
    const args = await buildSubmitArgs(
      makeJob({ flavor: "neg-risk-parent", outcomeIndex: 2 }),
      { funderAddress: FUNDER, readBalance: vi.fn() }
    );
    expect(args).toBeNull();
  });

  it("rejects unparseable positionId", async () => {
    const args = await buildSubmitArgs(
      makeJob({ flavor: "neg-risk-parent", positionId: "not-a-number" }),
      { funderAddress: FUNDER, readBalance: vi.fn() }
    );
    expect(args).toBeNull();
  });
});
