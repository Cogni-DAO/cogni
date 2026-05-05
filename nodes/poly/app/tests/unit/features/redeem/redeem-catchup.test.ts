// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: tests/unit/features/redeem/redeem-catchup
 * Purpose: Unit-test bounded redeem event replay used at startup.
 * Scope: Pure orchestration test with mocked ports and clients.
 * Invariants:
 *   - CATCHUP_REPLAY_IS_CHUNKED: catch-up never asks the RPC provider for
 *     more than the configured block span.
 *   - CATCHUP_REUSES_POSITION_SNAPSHOT: each condition-resolution chunk
 *     fetches funder positions once and reuses that snapshot for all enqueues.
 *   - PAYOUT_REPLAY_FILTERS_ON_CHAIN: payout replay asks the RPC provider for
 *     only the active funder's indexed redemption logs.
 * Links: nodes/poly/app/src/features/redeem/redeem-catchup.ts
 */

import type { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import { runRedeemCatchup } from "@/features/redeem";
import type { RedeemSubscriber } from "@/features/redeem/redeem-subscriber";
import type { RedeemJobsPort } from "@/ports";

const FUNDER = "0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134" as const;
const CONDITION_ID =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const POSITIONS = [{ conditionId: CONDITION_ID }];

describe("runRedeemCatchup", () => {
  it("chunks event replay and reuses one positions snapshot per resolution chunk", async () => {
    const getLogs = vi.fn(
      async (params: { event?: { name?: string }; fromBlock: bigint }) => {
        if (params.event?.name !== "ConditionResolution") return [];
        return [
          {
            removed: false,
            topics: ["0x00", CONDITION_ID],
            blockNumber: params.fromBlock,
          },
        ];
      }
    );
    const listUserPositions = vi.fn(async () => POSITIONS);
    const enqueueForCondition = vi.fn(async () => undefined);
    const setLastProcessedBlock = vi.fn(async () => undefined);

    await runRedeemCatchup({
      redeemJobs: {
        getLastProcessedBlock: vi.fn(async () => 0n),
        setLastProcessedBlock,
      } as unknown as RedeemJobsPort,
      orderLedger: {} as never,
      billingAccountId: "billing-account",
      publicClient: {
        getBlockNumber: vi.fn(async () => 5_001n),
        getLogs,
      } as unknown as PublicClient,
      dataApiClient: { listUserPositions } as never,
      funderAddress: FUNDER,
      subscriber: { enqueueForCondition } as unknown as RedeemSubscriber,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      initialFromBlock: 0n,
    });

    const conditionRanges = getLogs.mock.calls
      .filter(([params]) => params.event?.name === "ConditionResolution")
      .map(([params]) => [params.fromBlock, params.toBlock]);
    expect(conditionRanges).toHaveLength(11);
    expect(conditionRanges[0]).toEqual([1n, 500n]);
    expect(conditionRanges.at(-1)).toEqual([5_001n, 5_001n]);
    expect(listUserPositions).toHaveBeenCalledTimes(11);
    expect(enqueueForCondition).toHaveBeenCalledTimes(11);
    for (const call of enqueueForCondition.mock.calls) {
      expect(call).toEqual([CONDITION_ID, POSITIONS]);
    }
    expect(setLastProcessedBlock).toHaveBeenCalledWith("ctf_resolution", 500n);
    expect(setLastProcessedBlock).toHaveBeenCalledWith(
      "ctf_resolution",
      5_001n
    );

    const payoutCalls = getLogs.mock.calls.filter(
      ([params]) => params.event?.name === "PayoutRedemption"
    );
    expect(payoutCalls).toHaveLength(22);
    for (const [params] of payoutCalls) {
      expect(params.args).toEqual({ redeemer: FUNDER });
    }
  });
});
