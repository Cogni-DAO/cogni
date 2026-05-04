// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: tests/unit/features/redeem/redeem-subscriber-sibling-lifecycle
 * Purpose: Regression coverage for task.5006 sibling lifecycle mirroring. The
 *   redeem job queue dedups by condition, but the dashboard lifecycle read
 *   model is asset-scoped, so terminal skip siblings must still mirror even
 *   when their job enqueue collides with the winner row.
 * Scope: Unit test with mocked position resolution and ports only.
 * Links: src/features/redeem/redeem-subscriber.ts, docs/spec/poly-order-position-lifecycle.md
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
  };
}

describe("RedeemSubscriber sibling lifecycle mirroring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mirrors terminal skip siblings even when condition-scoped enqueue already exists", async () => {
    mockResolveRedeemCandidatesForCondition.mockResolvedValue([
      loserCandidate(),
      winnerCandidate(),
    ]);
    const enqueue = vi
      .fn()
      .mockResolvedValueOnce({ alreadyExisted: false, jobId: "job-winner" })
      .mockResolvedValueOnce({ alreadyExisted: true, jobId: "job-winner" });
    const markPositionLifecycleByAsset = vi.fn(async () => 1);
    const subscriber = new RedeemSubscriber({
      redeemJobs: { enqueue } as never,
      orderLedger: { markPositionLifecycleByAsset },
      billingAccountId: "billing-account-1",
      publicClient: {} as never,
      dataApiClient: {} as never,
      funderAddress: FUNDER,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await subscriber.enqueueForCondition(CONDITION_ID);

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(markPositionLifecycleByAsset).toHaveBeenCalledTimes(2);
    expect(markPositionLifecycleByAsset).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        token_id: "111",
        lifecycle: "winner",
      })
    );
    expect(markPositionLifecycleByAsset).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        token_id: "222",
        lifecycle: "loser",
      })
    );
  });

  it("mirrors a winner lifecycle even when enqueue revived an existing job row", async () => {
    mockResolveRedeemCandidatesForCondition.mockResolvedValue([
      winnerCandidate(),
    ]);
    const enqueue = vi
      .fn()
      .mockResolvedValue({ alreadyExisted: true, jobId: "job-winner" });
    const markPositionLifecycleByAsset = vi.fn(async () => 1);
    const subscriber = new RedeemSubscriber({
      redeemJobs: { enqueue } as never,
      orderLedger: { markPositionLifecycleByAsset },
      billingAccountId: "billing-account-1",
      publicClient: {} as never,
      dataApiClient: {} as never,
      funderAddress: FUNDER,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await subscriber.enqueueForCondition(CONDITION_ID);

    expect(markPositionLifecycleByAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        token_id: "111",
        lifecycle: "winner",
      })
    );
  });
});
