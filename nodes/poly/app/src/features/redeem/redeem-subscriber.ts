// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `features/redeem/redeem-subscriber`
 * Purpose: Three viem `watchContractEvent` subscriptions that drive the
 *   event-driven redeem pipeline (task.0388):
 *     - CTF `ConditionResolution` → enumerate funder positions for that
 *       condition, run Capability A, enqueue redeem jobs.
 *     - CTF `PayoutRedemption` → match `redeemer == funder` + existing job
 *       row, flip to `confirmed` (subscriber owns this transition).
 *     - NegRiskAdapter `PayoutRedemption` → same, distinct topic hash.
 *   Reorg-aware: viem emits removed-log events; subscriber rolls back
 *   `confirmed → submitted` for affected job rows so the reaper re-evaluates.
 * Scope: One instance per pod. Persists `last_processed_block` per
 *   subscription after every batch.
 * Invariants:
 *   - REDEEM_COMPLETION_IS_EVENT_OBSERVED — subscriber is the only path that
 *     emits `payout_redemption_observed` (worker only emits `submitted`).
 *   - SWEEP_IS_NOT_AN_ARCHITECTURE — no Data-API enumerate-and-fire.
 * Side-effects: IO (Polygon RPC long-poll, DB writes).
 * Links: docs/design/poly-positions.md § Three-subscription topology, task.0388
 * @public
 */

import {
  POLYGON_CONDITIONAL_TOKENS,
  POLYGON_NEG_RISK_ADAPTER,
  type PolymarketDataApiClient,
  polymarketCtfEventsAbi,
  polymarketNegRiskAdapterAbi,
} from "@cogni/poly-market-provider/adapters/polymarket";
import { decodeEventLog, type Log, type PublicClient } from "viem";

import { transition } from "@/core";
import type { MarketOutcomesPort, RedeemJobsPort } from "@/ports";

import { decisionToEnqueueInput } from "./decision-to-enqueue-input";
import {
  type LedgerLifecycleMirrorPort,
  mirrorRedeemLifecycleToLedger,
} from "./mirror-ledger-lifecycle";
import {
  type ResolvedRedeemCandidate,
  resolveRedeemCandidatesForCondition,
  sortRedeemCandidatesForEnqueue,
} from "./resolve-redeem-decision";

interface LoggerLike {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface RedeemSubscriberDeps {
  redeemJobs: RedeemJobsPort;
  /**
   * Chain-resolution authority writer. Populated from the same chain reads the
   * subscriber already does to evaluate `decideRedeem`; never written from
   * Data-API. Read-joined by the dashboard current-position read model so the
   * UI never reads `raw.redeemable` for classification. (bug.5008)
   */
  marketOutcomes: MarketOutcomesPort;
  orderLedger: LedgerLifecycleMirrorPort;
  billingAccountId: string;
  publicClient: PublicClient;
  dataApiClient: PolymarketDataApiClient;
  funderAddress: `0x${string}`;
  logger: LoggerLike;
}

type Unwatch = () => void;

/**
 * Long-lived subscriber. Call `start()` once at boot; `stop()` on shutdown.
 *
 * Each `watchContractEvent` returns an `unwatch` fn we tear down in `stop()`.
 */
export class RedeemSubscriber {
  private unwatches: Unwatch[] = [];

  constructor(private readonly deps: RedeemSubscriberDeps) {}

  start(): void {
    if (this.unwatches.length > 0) return;

    this.unwatches.push(
      this.deps.publicClient.watchContractEvent({
        address: POLYGON_CONDITIONAL_TOKENS,
        abi: polymarketCtfEventsAbi,
        eventName: "ConditionResolution",
        onLogs: (logs) => this.handleConditionResolution(logs),
      }) as Unwatch
    );
    this.unwatches.push(
      this.deps.publicClient.watchContractEvent({
        address: POLYGON_CONDITIONAL_TOKENS,
        abi: polymarketCtfEventsAbi,
        eventName: "PayoutRedemption",
        onLogs: (logs) => this.handlePayoutRedemption(logs, "ctf_payout"),
      }) as Unwatch
    );
    this.unwatches.push(
      this.deps.publicClient.watchContractEvent({
        address: POLYGON_NEG_RISK_ADAPTER,
        abi: polymarketNegRiskAdapterAbi,
        eventName: "PayoutRedemption",
        onLogs: (logs) => this.handlePayoutRedemption(logs, "negrisk_payout"),
      }) as Unwatch
    );
    this.deps.logger.info(
      { event: "poly.ctf.subscriber.started", funder: this.deps.funderAddress },
      "redeem-subscriber: 3 subscriptions active"
    );
  }

  stop(): void {
    for (const unwatch of this.unwatches) {
      try {
        unwatch();
      } catch {
        // ignore — torn down anyway
      }
    }
    this.unwatches = [];
  }

  /** Handler for CTF `ConditionResolution` — enumerate + Capability A + enqueue. */
  private async handleConditionResolution(
    logs: ReadonlyArray<Log<bigint, number, false>>
  ): Promise<void> {
    let highestBlock: bigint | null = null;
    for (const log of logs) {
      if (log.removed) continue; // reorg of a resolution event itself is a non-event for enqueue
      const conditionId = log.topics[1] as `0x${string}` | undefined;
      if (!conditionId) continue;
      try {
        await this.enqueueForCondition(conditionId);
      } catch (err) {
        this.deps.logger.error(
          {
            event: "poly.ctf.subscriber.condition_resolution_error",
            condition_id: conditionId,
            err: String(err),
          },
          "redeem-subscriber: enqueue failed"
        );
      }
      if (highestBlock === null || log.blockNumber > highestBlock) {
        highestBlock = log.blockNumber;
      }
    }
    if (highestBlock !== null) {
      await this.deps.redeemJobs.setLastProcessedBlock(
        "ctf_resolution",
        highestBlock
      );
    }
  }

  /** Public entrypoint reused by catch-up replay. */
  async enqueueForCondition(conditionId: `0x${string}`): Promise<void> {
    this.deps.logger.info(
      {
        event: "poly.ctf.subscriber.condition_resolution_observed",
        condition_id: conditionId,
        funder: this.deps.funderAddress,
      },
      "redeem-subscriber: condition resolved"
    );
    const candidates = sortRedeemCandidatesForEnqueue(
      await resolveRedeemCandidatesForCondition({
        funderAddress: this.deps.funderAddress,
        conditionId,
        publicClient: this.deps.publicClient,
        dataApiClient: this.deps.dataApiClient,
      })
    );
    for (const c of candidates) {
      this.deps.logger.info(
        {
          event: "poly.ctf.redeem.policy_decision",
          condition_id: c.conditionId,
          funder: this.deps.funderAddress,
          outcome_index: c.outcomeIndex,
          negative_risk: c.negativeRisk,
          policy_decision:
            c.decision.kind === "redeem"
              ? { kind: "redeem", flavor: c.decision.flavor }
              : { kind: c.decision.kind, reason: c.decision.reason },
        },
        "redeem-subscriber: policy decision"
      );
      await this.persistMarketOutcome(c);
      const enqueueInput = decisionToEnqueueInput(this.deps.funderAddress, c);
      if (enqueueInput === null) continue;
      const result = await this.deps.redeemJobs.enqueue(enqueueInput);
      if (
        !result.alreadyExisted ||
        enqueueInput.status === "skipped" ||
        enqueueInput.lifecycleState === "winner"
      ) {
        await mirrorRedeemLifecycleToLedger(
          {
            orderLedger: this.deps.orderLedger,
            billingAccountId: this.deps.billingAccountId,
            logger: this.deps.logger,
          },
          {
            conditionId: c.conditionId,
            positionId: enqueueInput.positionId,
            lifecycle: enqueueInput.lifecycleState,
            source:
              result.alreadyExisted && enqueueInput.status === "skipped"
                ? "redeem_subscriber_terminal_skip"
                : "redeem_subscriber_enqueue",
          }
        );
      }
      this.deps.logger.info(
        {
          event: "poly.ctf.redeem.job_enqueued",
          job_id: result.jobId,
          condition_id: c.conditionId,
          status: enqueueInput.status ?? "pending",
          lifecycle_state: enqueueInput.lifecycleState,
          flavor: enqueueInput.flavor,
          already_existed: result.alreadyExisted,
          collateral_token: c.collateralToken,
        },
        "redeem-subscriber: job enqueued"
      );
    }
  }

  /**
   * UPSERT `poly_market_outcomes` for a single (`conditionId`, `tokenId`)
   * derived from chain `payoutNumerator`. The dashboard read model joins this
   * table to classify rows as `winner | loser` without consulting Polymarket
   * Data-API `raw.redeemable`. (bug.5008)
   */
  private async persistMarketOutcome(
    c: ResolvedRedeemCandidate
  ): Promise<void> {
    const numerator = c.payoutNumerator;
    const denominator = c.payoutDenominator;
    // denominator === null OR === 0n means the chain doesn't yet report a
    // resolved payout for this condition (multicall partial failure or a
    // genuinely-unresolved market replayed by catchup). Persist 'unknown'
    // rather than writing a misleading 'loser' from a 0/0 numerator.
    const outcome =
      numerator === null || denominator === null || denominator === 0n
        ? "unknown"
        : numerator > 0n
          ? "winner"
          : "loser";
    const payout =
      numerator !== null && denominator !== null && denominator > 0n
        ? (Number(numerator) / Number(denominator)).toString()
        : null;
    try {
      await this.deps.marketOutcomes.upsert({
        conditionId: c.conditionId,
        tokenId: c.positionId.toString(),
        outcome,
        payout,
        resolvedAt: new Date(),
        raw: {
          outcome_index: c.outcomeIndex,
          negative_risk: c.negativeRisk,
          payout_numerator: numerator !== null ? numerator.toString() : null,
          payout_denominator:
            denominator !== null ? denominator.toString() : null,
        },
      });
    } catch (err) {
      this.deps.logger.warn(
        {
          event: "poly.ctf.market_outcomes_upsert_failed",
          condition_id: c.conditionId,
          token_id: c.positionId.toString(),
          err: String(err),
        },
        "redeem-subscriber: market outcomes upsert failed (non-fatal)"
      );
    }
  }

  /** Handler for both CTF + NegRiskAdapter `PayoutRedemption`. */
  private async handlePayoutRedemption(
    logs: ReadonlyArray<Log<bigint, number, false>>,
    cursorId: "ctf_payout" | "negrisk_payout"
  ): Promise<void> {
    // CTF and NegRiskAdapter both emit `PayoutRedemption` but with different
    // parameter shapes: CTF has 3 indexed args (redeemer, collateralToken,
    // parentCollectionId) — `conditionId` lives in `data`, NOT in `topics`.
    // NegRiskAdapter has 2 indexed args (redeemer, conditionId). Raw topic
    // indexing here was the bug that silently dropped every CTF redemption.
    // Defer decoding to viem's ABI-aware decoder so the parameter layout is
    // never re-derived locally.
    const abi =
      cursorId === "negrisk_payout"
        ? polymarketNegRiskAdapterAbi
        : polymarketCtfEventsAbi;
    let highestBlock: bigint | null = null;
    for (const log of logs) {
      let redeemer: `0x${string}`;
      let conditionId: `0x${string}`;
      try {
        const decoded = decodeEventLog({
          abi,
          eventName: "PayoutRedemption",
          data: log.data,
          topics: log.topics,
        });
        const args = decoded.args as {
          redeemer: `0x${string}`;
          conditionId: `0x${string}`;
        };
        redeemer = args.redeemer;
        conditionId = args.conditionId;
      } catch {
        continue;
      }
      if (redeemer.toLowerCase() !== this.deps.funderAddress.toLowerCase())
        continue;
      const job = await this.deps.redeemJobs.findByKey(
        this.deps.funderAddress,
        conditionId
      );
      if (job === null) {
        // Funder redeemed something we never enqueued — possible if catchup
        // hasn't run yet. Silently ignore; catchup will reconcile.
        continue;
      }

      if (log.removed) {
        // Reorg: roll back confirmed → submitted so the reaper re-evaluates.
        const result = transition(job, {
          kind: "payout_redemption_reorged",
          removedTxHash: log.transactionHash as `0x${string}`,
        });
        if (result.ok && result.transition.nextStatus === "submitted") {
          await this.deps.redeemJobs.revertConfirmedToSubmitted({
            jobId: job.id,
            removedTxHash: log.transactionHash as `0x${string}`,
          });
          await mirrorRedeemLifecycleToLedger(
            {
              orderLedger: this.deps.orderLedger,
              billingAccountId: this.deps.billingAccountId,
              logger: this.deps.logger,
            },
            {
              conditionId,
              positionId: job.positionId,
              lifecycle: "redeem_pending",
              source: "redeem_subscriber_reorg",
              terminalCorrection: "redeem_reorg",
            }
          );
          this.deps.logger.warn(
            {
              event: "poly.ctf.redeem.payout_reorged",
              job_id: job.id,
              condition_id: conditionId,
              removed_tx: log.transactionHash,
            },
            "redeem-subscriber: PayoutRedemption log removed by reorg"
          );
        }
        continue;
      }

      const txHash = log.transactionHash as `0x${string}`;
      const result = transition(job, {
        kind: "payout_redemption_observed",
        txHash,
      });
      if (!result.ok || result.transition.nextStatus !== "confirmed") continue;

      await this.deps.redeemJobs.markConfirmed({ jobId: job.id, txHash });
      // Subscriber owns the lifecycle_state advance for confirmed.
      await this.deps.redeemJobs.setLifecycleState({
        jobId: job.id,
        lifecycleState: "redeemed",
      });
      await mirrorRedeemLifecycleToLedger(
        {
          orderLedger: this.deps.orderLedger,
          billingAccountId: this.deps.billingAccountId,
          logger: this.deps.logger,
        },
        {
          conditionId,
          positionId: job.positionId,
          lifecycle: "redeemed",
          source: "redeem_subscriber_payout",
        }
      );
      this.deps.logger.info(
        {
          event: "poly.ctf.subscriber.payout_redemption_observed",
          job_id: job.id,
          condition_id: conditionId,
          funder: this.deps.funderAddress,
          tx_hash: txHash,
          source: cursorId,
        },
        "redeem-subscriber: payout observed"
      );
      this.deps.logger.info(
        {
          event: "poly.ctf.redeem.job_confirmed",
          job_id: job.id,
          condition_id: conditionId,
          tx_hash: txHash,
        },
        "redeem-subscriber: job confirmed"
      );

      if (highestBlock === null || log.blockNumber > highestBlock) {
        highestBlock = log.blockNumber;
      }
    }
    if (highestBlock !== null) {
      await this.deps.redeemJobs.setLastProcessedBlock(cursorId, highestBlock);
    }
  }
}
