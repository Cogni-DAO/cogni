// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: tests/unit/features/redeem/redeem-subscriber-market-outcomes
 * Purpose: Lock the bug.5008 invariant — `RedeemSubscriber.enqueueForCondition`
 *   UPSERTs `poly_market_outcomes` for every candidate it processes. This is
 *   the chain-resolution authority the dashboard read model joins on, so if
 *   the subscriber stops persisting outcomes, the read model silently regresses
 *   to "lifecycle-only" mode and dashboard rows stop classifying as
 *   `winner | loser` until the redeem job lifecycle catches up.
 * Scope: Unit test with mocked candidates + ports.
 * Links: docs/design/poly-redeem-chain-authority.md
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { RedeemSubscriber } from "@/features/redeem/redeem-subscriber";
import type { ResolvedRedeemCandidate } from "@/features/redeem/resolve-redeem-decision";

const { mockResolveRedeemCandidatesForCondition } = vi.hoisted(() => ({
  mockResolveRedeemCandidatesForCondition: vi.fn(),
}));

vi.mock("@/features/redeem/resolve-redeem-decision", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/features/redeem/resolve-redeem-decision")
    >();
  return {
    ...actual,
    resolveRedeemCandidatesForCondition:
      mockResolveRedeemCandidatesForCondition,
  };
});

const FUNDER = "0xaaaa000000000000000000000000000000000001" as const;
const CONDITION_ID =
  "0x4eaf52950000000000000000000000000000000000000000000000000000aaaa" as const;
const USDC_E = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

function winnerCandidate(): ResolvedRedeemCandidate {
  return {
    conditionId: CONDITION_ID,
    outcomeIndex: 0,
    positionId: 111n,
    negativeRisk: false,
    collateralToken: USDC_E,
    decision: {
      kind: "redeem",
      flavor: "binary",
      parentCollectionId:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      indexSet: [1n],
      expectedShares: 5_000_000n,
      expectedPayoutUsdc: 5_000_000n,
    },
    payoutNumerator: 1n,
    payoutDenominator: 1n,
  };
}

function loserCandidate(): ResolvedRedeemCandidate {
  return {
    conditionId: CONDITION_ID,
    outcomeIndex: 1,
    positionId: 222n,
    negativeRisk: false,
    collateralToken: USDC_E,
    decision: { kind: "skip", reason: "losing_outcome" },
    payoutNumerator: 0n,
    payoutDenominator: 1n,
  };
}

function readFailedCandidate(): ResolvedRedeemCandidate {
  return {
    conditionId: CONDITION_ID,
    outcomeIndex: 0,
    positionId: 333n,
    negativeRisk: false,
    collateralToken: USDC_E,
    decision: { kind: "skip", reason: "read_failed" },
    payoutNumerator: null,
    payoutDenominator: null,
  };
}

function buildSubscriber(opts: {
  marketOutcomesUpsert: ReturnType<typeof vi.fn>;
  enqueue?: ReturnType<typeof vi.fn>;
}): RedeemSubscriber {
  const enqueue =
    opts.enqueue ??
    vi.fn().mockResolvedValue({ alreadyExisted: false, jobId: "job-1" });
  const markPositionLifecycleByAsset = vi.fn(async () => 1);
  return new RedeemSubscriber({
    redeemJobs: { enqueue } as never,
    marketOutcomes: { upsert: opts.marketOutcomesUpsert },
    orderLedger: { markPositionLifecycleByAsset },
    billingAccountId: "billing-account-1",
    publicClient: {} as never,
    dataApiClient: {} as never,
    funderAddress: FUNDER,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
}

describe("RedeemSubscriber poly_market_outcomes UPSERT (bug.5008)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("UPSERTs winner outcome with payout=1.0 from chain numerators", async () => {
    mockResolveRedeemCandidatesForCondition.mockResolvedValue([
      winnerCandidate(),
    ]);
    const upsert = vi.fn(async () => {});
    const subscriber = buildSubscriber({ marketOutcomesUpsert: upsert });

    await subscriber.enqueueForCondition(CONDITION_ID);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conditionId: CONDITION_ID,
        tokenId: "111",
        outcome: "winner",
        payout: "1",
      })
    );
  });

  it("UPSERTs loser outcome with payout=0 from chain numerators", async () => {
    mockResolveRedeemCandidatesForCondition.mockResolvedValue([
      loserCandidate(),
    ]);
    const upsert = vi.fn(async () => {});
    const subscriber = buildSubscriber({ marketOutcomesUpsert: upsert });

    await subscriber.enqueueForCondition(CONDITION_ID);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conditionId: CONDITION_ID,
        tokenId: "222",
        outcome: "loser",
        payout: "0",
      })
    );
  });

  it("UPSERTs 'unknown' outcome when chain reads failed (numerator=null)", async () => {
    mockResolveRedeemCandidatesForCondition.mockResolvedValue([
      readFailedCandidate(),
    ]);
    const upsert = vi.fn(async () => {});
    const subscriber = buildSubscriber({ marketOutcomesUpsert: upsert });

    await subscriber.enqueueForCondition(CONDITION_ID);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "unknown",
        payout: null,
      })
    );
  });

  it("UPSERTs 'unknown' (not 'loser') when denominator is null/0 — guards against 0/0 misclassification", async () => {
    // numerator=0n with denominator=null|0n means the chain didn't report a
    // resolved payout yet (multicall partial failure or unresolved market in
    // a catchup replay). Without this guard, the outcome would be written as
    // 'loser' from `numerator > 0n ? 'winner' : 'loser'`.
    const cand: ResolvedRedeemCandidate = {
      ...loserCandidate(),
      payoutNumerator: 0n,
      payoutDenominator: null,
    };
    mockResolveRedeemCandidatesForCondition.mockResolvedValue([cand]);
    const upsert = vi.fn(async () => {});
    const subscriber = buildSubscriber({ marketOutcomesUpsert: upsert });

    await subscriber.enqueueForCondition(CONDITION_ID);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "unknown", payout: null })
    );
  });

  it("writes one outcome per candidate in mixed binary market", async () => {
    mockResolveRedeemCandidatesForCondition.mockResolvedValue([
      loserCandidate(),
      winnerCandidate(),
    ]);
    const upsert = vi.fn(async () => {});
    const subscriber = buildSubscriber({ marketOutcomesUpsert: upsert });

    await subscriber.enqueueForCondition(CONDITION_ID);

    // sort sends winner first; both should still be persisted
    expect(upsert).toHaveBeenCalledTimes(2);
    const calls = upsert.mock.calls.map((c) => c[0]);
    expect(calls.map((c: { tokenId: string }) => c.tokenId).sort()).toEqual([
      "111",
      "222",
    ]);
    expect(calls.map((c: { outcome: string }) => c.outcome).sort()).toEqual([
      "loser",
      "winner",
    ]);
  });

  it("does not throw when the UPSERT itself fails — logs and continues", async () => {
    mockResolveRedeemCandidatesForCondition.mockResolvedValue([
      winnerCandidate(),
    ]);
    const upsert = vi.fn(async () => {
      throw new Error("db down");
    });
    const subscriber = buildSubscriber({ marketOutcomesUpsert: upsert });

    await expect(
      subscriber.enqueueForCondition(CONDITION_ID)
    ).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
