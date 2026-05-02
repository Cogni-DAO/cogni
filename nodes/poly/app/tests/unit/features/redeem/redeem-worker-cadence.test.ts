// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: tests/unit/features/redeem/redeem-worker-cadence
 * Purpose: Regression coverage for the RPC-throttle split in RedeemWorker:
 *   pending-job drains stay responsive, but idle reaper block reads do not run
 *   on every 5s drain tick.
 * Scope: Unit test with mocked ports only. No chain, DB, or timers running.
 * Links: src/features/redeem/redeem-worker.ts
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { RedeemWorker } from "@/features/redeem/redeem-worker";
import type { RedeemJobsPort } from "@/ports";

const FUNDER = "0xaaaa000000000000000000000000000000000001" as const;

function makeWorker() {
  const redeemJobs = {
    claimNextPending: vi.fn(async () => null),
    claimReaperCandidates: vi.fn(async () => []),
  };
  const orderLedger = {
    markPositionLifecycleByAsset: vi.fn(async () => 0),
  };
  const publicClient = {
    getBlockNumber: vi.fn(async () => 100n),
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
    walletClient: {} as never,
    funderAddress: FUNDER,
    account: { address: FUNDER } as never,
    logger,
    finalityBlocks: 5n,
    tickIntervalMs: 5_000,
    reaperIntervalMs: 10 * 60_000,
    reaperBurstMs: 60_000,
  });
  return { worker, redeemJobs, publicClient };
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
});
