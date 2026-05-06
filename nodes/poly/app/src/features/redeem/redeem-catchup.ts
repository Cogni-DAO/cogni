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
import pLimit from "p-limit";
import type { Abi, PublicClient } from "viem";
import { decodeEventLog, getAbiItem } from "viem";

import type { RedeemJobsPort } from "@/ports";
import { EVENT_NAMES } from "@/shared/observability/events";

import {
  type LedgerLifecycleMirrorPort,
  mirrorRedeemLifecycleToLedger,
} from "./mirror-ledger-lifecycle";
import type { RedeemSubscriber } from "./redeem-subscriber";

interface LoggerLike {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface RedeemCatchupDeps {
  redeemJobs: RedeemJobsPort;
  orderLedger: LedgerLifecycleMirrorPort;
  billingAccountId: string;
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

const MAX_CATCHUP_BLOCK_SPAN = 500n;
// Cap concurrent enqueueForCondition fan-out at boot. Each enqueue does a
// CTF multicall + collateral inference; an unbounded loop over 50+ conditions
// blew the V8 heap on poly prod (bug.5012). Matches CLOB rate-limit ceiling.
const ENQUEUE_CONCURRENCY = 4;

interface ConditionReplayStats {
  chunks: number;
  logs: number;
  conditionIds: number;
  positionFetches: number;
  enqueueAttempts: number;
  enqueueErrors: number;
}

interface PayoutReplayStats {
  chunks: number;
  logs: number;
  matchedRedemptions: number;
}

/**
 * Replay all three subscriptions over `[cursor, head]`, advancing each cursor
 * after a successful pass. Idempotent: enqueue UPSERTs on the unique key,
 * markConfirmed is idempotent on already-confirmed rows.
 */
export async function runRedeemCatchup(deps: RedeemCatchupDeps): Promise<void> {
  const startedAt = Date.now();
  const head = await deps.publicClient.getBlockNumber();

  // CTF ConditionResolution → enqueue
  const conditionStats = await replayConditionResolutions(deps, head);
  // CTF + NegRiskAdapter PayoutRedemption → mark confirmed.
  // Each replay receives the event's full ABI so log decoding goes through
  // viem (no raw-topic indexing — the parameter shape differs between the
  // two contracts: CTF has 3 indexed args incl. parentCollectionId, neg-risk
  // has 2 incl. conditionId).
  const ctfPayoutStats = await replayPayoutRedemptions(
    deps,
    head,
    "ctf_payout",
    POLYGON_CONDITIONAL_TOKENS,
    ctfPayoutEvent,
    polymarketCtfEventsAbi
  );
  const negriskPayoutStats = await replayPayoutRedemptions(
    deps,
    head,
    "negrisk_payout",
    POLYGON_NEG_RISK_ADAPTER,
    negriskPayoutEvent,
    polymarketNegRiskAdapterAbi
  );
  const mem = process.memoryUsage();
  deps.logger.info(
    {
      event: EVENT_NAMES.POLY_REDEEM_CATCHUP_COMPLETE,
      durationMs: Date.now() - startedAt,
      head_block: head.toString(),
      ctf_resolution_chunks: conditionStats.chunks,
      ctf_resolution_logs: conditionStats.logs,
      ctf_resolution_condition_ids: conditionStats.conditionIds,
      ctf_resolution_position_fetches: conditionStats.positionFetches,
      ctf_resolution_enqueue_attempts: conditionStats.enqueueAttempts,
      ctf_resolution_enqueue_errors: conditionStats.enqueueErrors,
      ctf_payout_chunks: ctfPayoutStats.chunks,
      ctf_payout_logs: ctfPayoutStats.logs,
      ctf_payout_matches: ctfPayoutStats.matchedRedemptions,
      negrisk_payout_chunks: negriskPayoutStats.chunks,
      negrisk_payout_logs: negriskPayoutStats.logs,
      negrisk_payout_matches: negriskPayoutStats.matchedRedemptions,
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      rss_mb: Math.round(mem.rss / 1024 / 1024),
    },
    "redeem-catchup: replay complete"
  );
}

async function replayConditionResolutions(
  deps: RedeemCatchupDeps,
  head: bigint
): Promise<ConditionReplayStats> {
  const stats: ConditionReplayStats = {
    chunks: 0,
    logs: 0,
    conditionIds: 0,
    positionFetches: 0,
    enqueueAttempts: 0,
    enqueueErrors: 0,
  };
  const fromBlock =
    (await deps.redeemJobs.getLastProcessedBlock("ctf_resolution")) ??
    deps.initialFromBlock;
  if (fromBlock >= head) return stats;
  for (
    let chunkFrom = fromBlock + 1n;
    chunkFrom <= head;
    chunkFrom += MAX_CATCHUP_BLOCK_SPAN
  ) {
    const chunkTo =
      chunkFrom + MAX_CATCHUP_BLOCK_SPAN - 1n > head
        ? head
        : chunkFrom + MAX_CATCHUP_BLOCK_SPAN - 1n;
    const logs = await deps.publicClient.getLogs({
      address: POLYGON_CONDITIONAL_TOKENS,
      event: ctfResolutionEvent,
      fromBlock: chunkFrom,
      toBlock: chunkTo,
    });
    stats.chunks += 1;
    stats.logs += logs.length;
    deps.logger.info(
      {
        event: "poly.ctf.subscriber.catchup_started",
        cursor_id: "ctf_resolution",
        from: (chunkFrom - 1n).toString(),
        to: chunkTo.toString(),
        count: logs.length,
      },
      "redeem-catchup: replaying condition resolutions"
    );
    const conditionIds = new Set<`0x${string}`>();
    for (const log of logs) {
      if (log.removed) continue;
      const conditionId = log.topics[1] as `0x${string}` | undefined;
      if (conditionId) conditionIds.add(conditionId);
    }
    const positions =
      conditionIds.size > 0
        ? await deps.dataApiClient.listAllUserPositions(deps.funderAddress)
        : [];
    if (conditionIds.size > 0) stats.positionFetches += 1;
    stats.conditionIds += conditionIds.size;
    const limit = pLimit(ENQUEUE_CONCURRENCY);
    await Promise.all(
      Array.from(conditionIds, (conditionId) =>
        limit(async () => {
          try {
            stats.enqueueAttempts += 1;
            await deps.subscriber.enqueueForCondition(conditionId, positions);
          } catch (err) {
            stats.enqueueErrors += 1;
            deps.logger.error(
              {
                event: "poly.ctf.subscriber.catchup_error",
                condition_id: conditionId,
                err: String(err),
              },
              "redeem-catchup: enqueue failed"
            );
          }
        })
      )
    );
    await deps.redeemJobs.setLastProcessedBlock("ctf_resolution", chunkTo);
  }
  return stats;
}

async function replayPayoutRedemptions(
  deps: RedeemCatchupDeps,
  head: bigint,
  cursorId: "ctf_payout" | "negrisk_payout",
  contractAddress: `0x${string}`,
  // biome-ignore lint/suspicious/noExplicitAny: viem AbiEvent type is intentionally generic
  event: any,
  decodeAbi: Abi
): Promise<PayoutReplayStats> {
  const stats: PayoutReplayStats = {
    chunks: 0,
    logs: 0,
    matchedRedemptions: 0,
  };
  const fromBlock =
    (await deps.redeemJobs.getLastProcessedBlock(cursorId)) ??
    deps.initialFromBlock;
  if (fromBlock >= head) return stats;
  for (
    let chunkFrom = fromBlock + 1n;
    chunkFrom <= head;
    chunkFrom += MAX_CATCHUP_BLOCK_SPAN
  ) {
    const chunkTo =
      chunkFrom + MAX_CATCHUP_BLOCK_SPAN - 1n > head
        ? head
        : chunkFrom + MAX_CATCHUP_BLOCK_SPAN - 1n;
    const logs = await deps.publicClient.getLogs({
      address: contractAddress,
      event,
      args: { redeemer: deps.funderAddress },
      fromBlock: chunkFrom,
      toBlock: chunkTo,
    });
    stats.chunks += 1;
    stats.logs += logs.length;
    deps.logger.info(
      {
        event: "poly.ctf.subscriber.catchup_started",
        cursor_id: cursorId,
        from: (chunkFrom - 1n).toString(),
        to: chunkTo.toString(),
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
      stats.matchedRedemptions += 1;

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
      await mirrorRedeemLifecycleToLedger(
        {
          orderLedger: deps.orderLedger,
          billingAccountId: deps.billingAccountId,
          logger: deps.logger,
        },
        {
          conditionId,
          positionId: job.positionId,
          lifecycle: "redeemed",
          source: "redeem_catchup_payout",
        }
      );
    }
    await deps.redeemJobs.setLastProcessedBlock(cursorId, chunkTo);
  }
  return stats;
}
