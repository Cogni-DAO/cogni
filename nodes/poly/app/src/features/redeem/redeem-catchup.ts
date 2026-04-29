// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `features/redeem/redeem-catchup`
 * Purpose: Startup + daily-cron event-replay for the event-driven redeem
 *   pipeline (task.0388). Reads `poly_subscription_cursors.last_processed_block`
 *   per subscription, calls `getLogs` over `[lastBlock, head]`, and replays
 *   through the same handlers the live subscriber uses. The only legitimate
 *   sweep in the system, bounded by chain history (not by Data-API hint or
 *   wall-clock).
 * Scope: One-shot async fn. Caller (bootstrap) decides cadence.
 * Invariants:
 *   - SWEEP_IS_NOT_AN_ARCHITECTURE — only legitimate sweep is event-replay
 *     bounded by `last_processed_block`. No Data-API enumerate-and-fire.
 * Side-effects: IO (Polygon RPC `getLogs`, DB writes).
 * Links: docs/design/poly-positions.md, work/items/task.0388
 * @public
 */

import {
  POLYGON_CONDITIONAL_TOKENS,
  POLYGON_NEG_RISK_ADAPTER,
  type PolymarketDataApiClient,
  polymarketCtfEventsAbi,
  polymarketNegRiskAdapterAbi,
} from "@cogni/poly-market-provider/adapters/polymarket";
import type { Abi, PublicClient } from "viem";
import { decodeEventLog, getAbiItem } from "viem";

import type { RedeemJobsPort } from "@/ports";

import type { RedeemSubscriber } from "./redeem-subscriber";

interface LoggerLike {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface RedeemCatchupDeps {
  redeemJobs: RedeemJobsPort;
  publicClient: PublicClient;
  dataApiClient: PolymarketDataApiClient;
  funderAddress: `0x${string}`;
  /** Reuse the live subscriber's enqueue handler so logic stays in one place. */
  subscriber: RedeemSubscriber;
  logger: LoggerLike;
  /**
   * Floor for replay: if no cursor row exists yet, start from this block.
   * Typically set to a recent block at first deploy to bound the initial
   * scan; subsequent runs use the persisted cursor.
   */
  initialFromBlock: bigint;
}

const ctfResolutionEvent = getAbiItem({
  abi: polymarketCtfEventsAbi,
  name: "ConditionResolution",
});
const ctfPayoutEvent = getAbiItem({
  abi: polymarketCtfEventsAbi,
  name: "PayoutRedemption",
});
const negriskPayoutEvent = getAbiItem({
  abi: polymarketNegRiskAdapterAbi,
  name: "PayoutRedemption",
});

/**
 * Replay all three subscriptions over `[cursor, head]`, advancing each cursor
 * after a successful pass. Idempotent: enqueue UPSERTs on the unique key,
 * markConfirmed is idempotent on already-confirmed rows.
 */
export async function runRedeemCatchup(deps: RedeemCatchupDeps): Promise<void> {
  const head = await deps.publicClient.getBlockNumber();

  // CTF ConditionResolution → enqueue
  await replayConditionResolutions(deps, head);
  // CTF + NegRiskAdapter PayoutRedemption → mark confirmed.
  // Each replay receives the event's full ABI so log decoding goes through
  // viem (no raw-topic indexing — the parameter shape differs between the
  // two contracts: CTF has 3 indexed args incl. parentCollectionId, neg-risk
  // has 2 incl. conditionId).
  await replayPayoutRedemptions(
    deps,
    head,
    "ctf_payout",
    POLYGON_CONDITIONAL_TOKENS,
    ctfPayoutEvent,
    polymarketCtfEventsAbi
  );
  await replayPayoutRedemptions(
    deps,
    head,
    "negrisk_payout",
    POLYGON_NEG_RISK_ADAPTER,
    negriskPayoutEvent,
    polymarketNegRiskAdapterAbi
  );
}

async function replayConditionResolutions(
  deps: RedeemCatchupDeps,
  head: bigint
): Promise<void> {
  const fromBlock =
    (await deps.redeemJobs.getLastProcessedBlock("ctf_resolution")) ??
    deps.initialFromBlock;
  if (fromBlock >= head) return;
  const logs = await deps.publicClient.getLogs({
    address: POLYGON_CONDITIONAL_TOKENS,
    event: ctfResolutionEvent,
    fromBlock: fromBlock + 1n,
    toBlock: head,
  });
  deps.logger.info(
    {
      event: "poly.ctf.subscriber.catchup_started",
      cursor_id: "ctf_resolution",
      from: fromBlock.toString(),
      to: head.toString(),
      count: logs.length,
    },
    "redeem-catchup: replaying condition resolutions"
  );
  for (const log of logs) {
    if (log.removed) continue;
    const conditionId = log.topics[1] as `0x${string}` | undefined;
    if (!conditionId) continue;
    try {
      await deps.subscriber.enqueueForCondition(conditionId);
    } catch (err) {
      deps.logger.error(
        {
          event: "poly.ctf.subscriber.catchup_error",
          condition_id: conditionId,
          err: String(err),
        },
        "redeem-catchup: enqueue failed"
      );
    }
  }
  await deps.redeemJobs.setLastProcessedBlock("ctf_resolution", head);
}

async function replayPayoutRedemptions(
  deps: RedeemCatchupDeps,
  head: bigint,
  cursorId: "ctf_payout" | "negrisk_payout",
  contractAddress: `0x${string}`,
  // biome-ignore lint/suspicious/noExplicitAny: viem AbiEvent type is intentionally generic
  event: any,
  decodeAbi: Abi
): Promise<void> {
  const fromBlock =
    (await deps.redeemJobs.getLastProcessedBlock(cursorId)) ??
    deps.initialFromBlock;
  if (fromBlock >= head) return;
  const logs = await deps.publicClient.getLogs({
    address: contractAddress,
    event,
    fromBlock: fromBlock + 1n,
    toBlock: head,
  });
  deps.logger.info(
    {
      event: "poly.ctf.subscriber.catchup_started",
      cursor_id: cursorId,
      from: fromBlock.toString(),
      to: head.toString(),
      count: logs.length,
    },
    "redeem-catchup: replaying payout redemptions"
  );
  for (const log of logs) {
    if (log.removed) continue;
    let redeemer: `0x${string}`;
    let conditionId: `0x${string}`;
    try {
      const decoded = decodeEventLog({
        abi: decodeAbi,
        eventName: "PayoutRedemption",
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as unknown as {
        redeemer: `0x${string}`;
        conditionId: `0x${string}`;
      };
      redeemer = args.redeemer;
      conditionId = args.conditionId;
    } catch {
      continue;
    }
    if (redeemer.toLowerCase() !== deps.funderAddress.toLowerCase()) continue;

    const job = await deps.redeemJobs.findByKey(
      deps.funderAddress,
      conditionId
    );
    if (job === null) continue;
    if (job.status === "confirmed") continue;
    await deps.redeemJobs.markConfirmed({
      jobId: job.id,
      txHash: log.transactionHash as `0x${string}`,
    });
    await deps.redeemJobs.setLifecycleState({
      jobId: job.id,
      lifecycleState: "redeemed",
    });
  }
  await deps.redeemJobs.setLastProcessedBlock(cursorId, head);
}
