// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: tests/unit/features/redeem/redeem-worker-cadence
 * Purpose: Regression coverage for RedeemWorker drain/reaper cadence and
 *   receipt-timeout recovery after a submitted redeem tx is mined.
 * Scope: Unit test with mocked ports only. No chain, DB, or timers running.
 * Links: src/features/redeem/redeem-worker.ts
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RedeemJob } from "@/core";
import { RedeemWorker } from "@/features/redeem/redeem-worker";
import type { RedeemJobsPort } from "@/ports";

const FUNDER = "0xaaaa000000000000000000000000000000000001" as const;
const CONDITION =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const COLLATERAL = "0xbbbb000000000000000000000000000000000001" as const;
const TX_HASH =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

function makeRedeemJob(overrides: Partial<RedeemJob> = {}): RedeemJob {
  const now = new Date("2026-05-02T00:00:00.000Z");
  return {
    id: "redeem-job-1",
    funderAddress: FUNDER,
    conditionId: CONDITION,
    positionId: "1",
    outcomeIndex: 0,
    status: "claimed",
    flavor: "binary",
    indexSet: ["1"],
    collateralToken: COLLATERAL,
    expectedShares: "1000000",
    expectedPayoutUsdc: "1000000",
    txHashes: [],
    attemptCount: 0,
    lastError: null,
    errorClass: null,
    lifecycleState: "winner",
    receiptBurnObserved: null,
    submittedAtBlock: null,
    enqueuedAt: now,
    submittedAt: null,
    confirmedAt: null,
    abandonedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

function makeWorker(
  overrides: {
    redeemJobs?: Partial<RedeemJobsPort>;
    publicClient?: Record<string, unknown>;
    walletClient?: Record<string, unknown>;
  } = {}
) {
  const redeemJobs = {
    claimNextPending: vi.fn(async () => null),
    claimReaperCandidates: vi.fn(async () => []),
    markSubmitted: vi.fn(async () => undefined),
    ...overrides.redeemJobs,
  };
  const orderLedger = {
    markPositionLifecycleByAsset: vi.fn(async () => 0),
  };
  const publicClient = {
    getBlockNumber: vi.fn(async () => 100n),
    getTransactionReceipt: vi.fn(),
    readContract: vi.fn(async () => 1n),
    waitForTransactionReceipt: vi.fn(),
    ...overrides.publicClient,
  };
  const walletClient = {
    writeContract: vi.fn(async () => TX_HASH),
    ...overrides.walletClient,
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const worker = new RedeemWorker({
    redeemJobs: redeemJobs as unknown as RedeemJobsPort,
    orderLedger,
    billingAccountId: "billing-account-1",
    publicClient: publicClient as never,
    walletClient: walletClient as never,
    funderAddress: FUNDER,
    account: { address: FUNDER } as never,
    logger,
    finalityBlocks: 5n,
    tickIntervalMs: 5_000,
    reaperIntervalMs: 10 * 60_000,
    reaperBurstMs: 60_000,
  });
  return { worker, redeemJobs, publicClient, walletClient, logger };
}

describe("RedeemWorker cadence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drains pending work every tick but throttles idle reaper block reads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T00:00:00.000Z"));

    const { worker, redeemJobs, publicClient } = makeWorker();

    await worker.tick();
    expect(redeemJobs.claimNextPending).toHaveBeenCalledTimes(1);
    expect(publicClient.getBlockNumber).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    await worker.tick();
    expect(redeemJobs.claimNextPending).toHaveBeenCalledTimes(2);
    expect(publicClient.getBlockNumber).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10 * 60_000);
    await worker.tick();
    expect(redeemJobs.claimNextPending).toHaveBeenCalledTimes(3);
    expect(publicClient.getBlockNumber).toHaveBeenCalledTimes(2);
  });

  it("allows a short fast reaper burst after a local submit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T00:00:00.000Z"));

    const { worker, publicClient } = makeWorker();
    await worker.tick();
    expect(publicClient.getBlockNumber).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    await worker.tick();
    expect(publicClient.getBlockNumber).toHaveBeenCalledTimes(1);

    (worker as unknown as { startReaperBurst: () => void }).startReaperBurst();
    await worker.tick();
    expect(publicClient.getBlockNumber).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(5_000);
    await worker.tick();
    expect(publicClient.getBlockNumber).toHaveBeenCalledTimes(3);
  });

  it("persists submitted tx with receipt block when receipt wait times out but direct lookup succeeds", async () => {
    const receipt = { blockNumber: 123n, logs: [] };
    const claimNextPending = vi
      .fn()
      .mockResolvedValueOnce(makeRedeemJob())
      .mockResolvedValue(null);
    const waitForTransactionReceipt = vi
      .fn()
      .mockRejectedValueOnce(new Error("Timed out while waiting for tx"));
    const getTransactionReceipt = vi.fn().mockResolvedValueOnce(receipt);

    const { worker, redeemJobs, logger } = makeWorker({
      redeemJobs: { claimNextPending },
      publicClient: { waitForTransactionReceipt, getTransactionReceipt },
    });

    await worker.tick();

    expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash: TX_HASH });
    expect(getTransactionReceipt).toHaveBeenCalledWith({ hash: TX_HASH });
    expect(redeemJobs.markSubmitted).toHaveBeenCalledWith({
      jobId: "redeem-job-1",
      txHash: TX_HASH,
      submittedAtBlock: 123n,
      receiptBurnObserved: false,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "poly.ctf.redeem.receipt_wait_timeout_recovered",
        tx_hash: TX_HASH,
      }),
      "redeem-worker: recovered receipt after wait timeout"
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: "poly.ctf.redeem.worker_drain_error",
      }),
      expect.anything()
    );
  });

  it("preserves submitted tx hash when receipt is unavailable after wait timeout", async () => {
    const claimNextPending = vi
      .fn()
      .mockResolvedValueOnce(makeRedeemJob())
      .mockResolvedValue(null);
    const waitForTransactionReceipt = vi
      .fn()
      .mockRejectedValueOnce(new Error("Timed out while waiting for tx"));
    const getTransactionReceipt = vi
      .fn()
      .mockRejectedValueOnce(new Error("receipt not found"));

    const { worker, redeemJobs, logger } = makeWorker({
      redeemJobs: { claimNextPending },
      publicClient: { waitForTransactionReceipt, getTransactionReceipt },
    });

    await worker.tick();

    expect(redeemJobs.markSubmitted).toHaveBeenCalledWith({
      jobId: "redeem-job-1",
      txHash: TX_HASH,
      submittedAtBlock: null,
      receiptBurnObserved: false,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "poly.ctf.redeem.receipt_wait_timeout_pending",
        tx_hash: TX_HASH,
      }),
      "redeem-worker: receipt unavailable after wait timeout; preserving submitted tx hash"
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: "poly.ctf.redeem.worker_drain_error",
      }),
      expect.anything()
    );
  });
});
