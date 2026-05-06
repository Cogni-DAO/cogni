// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `features/redeem/redeem-worker`
 * Purpose: In-process worker for the event-driven CTF redeem pipeline (task.0388).
 *   Two responsibilities, two cadences:
 *     1. Drain `pending` rows: dispatch CTF or NegRiskAdapter per `decision.flavor`,
 *        decode the receipt for funder-burn presence (persisted as observational
 *        only), transition to `submitted`.
 *     2. Reap stale `submitted` rows past N=5 finality on a slower idle
 *        interval, with a short fast-confirmation burst after this worker
 *        submits a tx. Batch-fetches
 *        `PayoutRedemption(redeemer=funder)` logs per flavor (CTF vs
 *        NegRiskAdapter) and falls back to `balanceOf` per condition that
 *        didn't match. Dispatches `reaper_chain_evidence` to
 *        `core/redeem/transitions`. RPC failure on `getLogs` defers all
 *        candidates of that flavor to the next tick.
 *   Replaces the old `runRedeemSweep` polling loop in `poly-trade-executor.ts`.
 * Scope: One instance per pod. Uses `FOR UPDATE SKIP LOCKED` for concurrency.
 *   No periodic Data-API enumerate-and-fire; all enqueues come from the
 *   subscriber + catch-up replay.
 * Invariants:
 *   - REAPER_QUERIES_CHAIN_TRUTH — at N=5 finality the reaper consults
 *     `getLogs` for `PayoutRedemption(redeemer=funder)` and `balanceOf` for
 *     the funder's position, then dispatches `reaper_chain_evidence`.
 *     Receipt-burn flag is observational only; never decides confirm/bleed
 *     (bug.0403).
 *   - REDEEM_REQUIRES_BURN_OBSERVATION — bleed is detected when no payout
 *     log was emitted AND `balanceOf > 0` for the funder. Balance-zero with
 *     no payout is treated as off-pipeline settlement and confirmed
 *     defensively at warn-level for audit visibility.
 *   - REDEEM_HAS_CIRCUIT_BREAKER — `attempt_count >= 3` transient failures
 *     escalate via `transitions` to `abandoned/transient_exhausted`.
 *   - FINALITY_IS_FIXED_N — reaper uses `REDEEM_FINALITY_BLOCKS` from env.
 * Side-effects: IO (Polygon RPC writes + reads, DB).
 * Links: docs/design/poly-positions.md § Worker, work/items/task.0388,
 *   work/items/bug.0403
 * @public
 */

import {
  POLYGON_CONDITIONAL_TOKENS,
  POLYGON_NEG_RISK_ADAPTER,
  polymarketCtfEventsAbi,
  polymarketCtfRedeemAbi,
  polymarketNegRiskAdapterAbi,
} from "@cogni/poly-market-provider/adapters/polymarket";
import {
  type AbiEvent,
  type Account,
  decodeEventLog,
  getAbiItem,
  keccak256,
  type PublicClient,
  parseAbi,
  type TransactionReceipt,
  toBytes,
  type WalletClient,
} from "viem";
import { polygon } from "viem/chains";

import {
  REDEEM_MAX_TRANSIENT_ATTEMPTS,
  type RedeemFlavor,
  type RedeemJob,
  type RedeemLifecycleState,
  transition,
} from "@/core";
import type { RedeemJobsPort } from "@/ports";

import { buildSubmitArgs } from "./build-submit-args";
import {
  type LedgerLifecycleMirrorPort,
  mirrorRedeemLifecycleToLedger,
} from "./mirror-ledger-lifecycle";

const ctfBalanceAbi = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
]);

/** Per-call polling cadence for `waitForTransactionReceipt`. Polygon block
 * time is ~2s, so 4s is the lowest cadence that is still cheap and matches
 * viem's pre-`f961f2e81` HTTP-transport default. The shared `publicClient`'s
 * client-level `pollingInterval` is 10 min (throttled for the live
 * subscriber's `watchContractEvent`) — without this override every redeem
 * costs 180s (viem's hardcoded `waitForTransactionReceipt` timeout) before
 * the catch-block manually fetches the receipt. (bug.5030) */
const RECEIPT_POLL_INTERVAL_MS = 4_000;

// keccak256(TransferSingle(address,address,address,uint256,uint256))
const TRANSFER_SINGLE_TOPIC = keccak256(
  toBytes("TransferSingle(address,address,address,uint256,uint256)")
);
// keccak256(PayoutRedemption(address,bytes32,uint256[],uint256)) — NegRiskAdapter
const NEG_RISK_PAYOUT_TOPIC = keccak256(
  toBytes("PayoutRedemption(address,bytes32,uint256[],uint256)")
);

const ctfPayoutEvent = getAbiItem({
  abi: polymarketCtfEventsAbi,
  name: "PayoutRedemption",
}) as AbiEvent;
const negriskPayoutEvent = getAbiItem({
  abi: polymarketNegRiskAdapterAbi,
  name: "PayoutRedemption",
}) as AbiEvent;

const isNegRiskFlavor = (f: RedeemFlavor): boolean =>
  f === "neg-risk-parent" || f === "neg-risk-adapter";

interface LoggerLike {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export interface RedeemWorkerDeps {
  redeemJobs: RedeemJobsPort;
  orderLedger: LedgerLifecycleMirrorPort;
  billingAccountId: string;
  publicClient: PublicClient;
  walletClient: WalletClient;
  /** EOA holding the redeemable positions. */
  funderAddress: `0x${string}`;
  /** Account object the wallet client signs with (must be non-null). */
  account: Account;
  logger: LoggerLike;
  /** N=5 hard-pinned for v0.2 (FINALITY_IS_FIXED_N). */
  finalityBlocks: bigint;
  /** Pending-job drain cadence in ms. */
  tickIntervalMs: number;
  /** Stale-submitted reaper cadence in ms. Defaults to `tickIntervalMs`. */
  reaperIntervalMs?: number;
  /** Fast reaper window after a successful submit. Defaults to 60s. */
  reaperBurstMs?: number;
}

/**
 * Decode a receipt's logs and assert at least one `funder-burn` is present.
 *
 * - CTF flavors: look for `TransferSingle(operator, from=funder, to=*, id, value>0)`.
 * - Neg-risk flavors: look for NegRiskAdapter `PayoutRedemption(redeemer=funder, ...)`.
 *
 * Returns `true` iff the expected burn signal is present.
 */
function decodeReceiptForBurn(
  receipt: TransactionReceipt,
  flavor: RedeemFlavor,
  funderAddress: `0x${string}`
): boolean {
  const funderTopic = funderAddressTopic(funderAddress);

  if (flavor === "neg-risk-parent" || flavor === "neg-risk-adapter") {
    return receipt.logs.some(
      (log) =>
        log.address.toLowerCase() === POLYGON_NEG_RISK_ADAPTER.toLowerCase() &&
        log.topics[0] === NEG_RISK_PAYOUT_TOPIC &&
        log.topics[1] === funderTopic
    );
  }
  // CTF binary / multi-outcome: TransferSingle from=funder with value>0.
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== POLYGON_CONDITIONAL_TOKENS.toLowerCase())
      return false;
    if (log.topics[0] !== TRANSFER_SINGLE_TOPIC) return false;
    // topics[2] is `from` (indexed). Match against funder.
    if (log.topics[2] !== funderTopic) return false;
    try {
      const decoded = decodeEventLog({
        abi: parseAbi([
          "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
        ]),
        data: log.data,
        topics: log.topics,
      });
      return (decoded.args.value as bigint) > 0n;
    } catch {
      return false;
    }
  });
}

function funderAddressTopic(addr: `0x${string}`): `0x${string}` {
  // address-as-topic = 0x000…000<20-byte addr>, lowercase.
  return `0x000000000000000000000000${addr.slice(2).toLowerCase()}` as `0x${string}`;
}

/**
 * Long-lived worker. Call `start()` once at boot; `stop()` on shutdown.
 */
export class RedeemWorker {
  private timer: NodeJS.Timeout | null = null;
  private lastReaperAtMs = 0;
  private reaperBurstUntilMs = 0;
  private tickInFlight = false;

  constructor(private readonly deps: RedeemWorkerDeps) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      if (this.tickInFlight) return;
      this.tickInFlight = true;
      this.tick().finally(() => {
        this.tickInFlight = false;
      });
    }, this.deps.tickIntervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Single tick: drain one pending row + maybe reap stale submitted rows. */
  async tick(): Promise<void> {
    let submitted = false;
    try {
      submitted = await this.drainOnePending();
    } catch (err) {
      this.deps.logger.error(
        { event: "poly.ctf.redeem.worker_drain_error", err: String(err) },
        "redeem-worker drain loop error"
      );
    }
    if (submitted) this.startReaperBurst();
    if (this.shouldRunReaper()) {
      try {
        await this.reapStale();
      } catch (err) {
        this.deps.logger.error(
          { event: "poly.ctf.redeem.worker_reap_error", err: String(err) },
          "redeem-worker reaper loop error"
        );
      }
    }
  }

  private startReaperBurst(): void {
    this.reaperBurstUntilMs = Date.now() + (this.deps.reaperBurstMs ?? 60_000);
  }

  private async mirrorLifecycle(
    conditionId: string,
    positionId: string,
    lifecycle: RedeemLifecycleState,
    source: string
  ): Promise<void> {
    await mirrorRedeemLifecycleToLedger(
      {
        orderLedger: this.deps.orderLedger,
        billingAccountId: this.deps.billingAccountId,
        logger: this.deps.logger,
      },
      { conditionId, positionId, lifecycle, source }
    );
  }

  private shouldRunReaper(): boolean {
    const now = Date.now();
    if (now < this.reaperBurstUntilMs) {
      this.lastReaperAtMs = now;
      return true;
    }
    const interval = this.deps.reaperIntervalMs ?? this.deps.tickIntervalMs;
    if (now - this.lastReaperAtMs < interval) return false;
    this.lastReaperAtMs = now;
    return true;
  }

  private async drainOnePending(): Promise<boolean> {
    const job = await this.deps.redeemJobs.claimNextPending(
      this.deps.funderAddress
    );
    if (job === null) return false;

    const args = await buildSubmitArgs(job, {
      funderAddress: this.deps.funderAddress,
      readBalance: (funder, positionId) =>
        this.deps.publicClient.readContract({
          address: POLYGON_CONDITIONAL_TOKENS,
          abi: ctfBalanceAbi,
          functionName: "balanceOf",
          args: [funder, positionId],
        }) as Promise<bigint>,
    });
    if (args === null) {
      // Malformed dispatch — abandon immediately. This is a code defect, not
      // pre-finality terminal.
      await this.deps.redeemJobs.markAbandoned({
        jobId: job.id,
        errorClass: "malformed",
        error: `unable to build submit args for flavor=${job.flavor}`,
      });
      await this.mirrorLifecycle(
        job.conditionId,
        job.positionId,
        "abandoned",
        "worker_malformed"
      );
      this.deps.logger.error(
        {
          event: "poly.ctf.redeem.bleed_detected",
          level: 50,
          job_id: job.id,
          condition_id: job.conditionId,
          funder: job.funderAddress,
          reason: "build_args_failed",
        },
        "redeem-worker: malformed dispatch"
      );
      return false;
    }

    let txHash: `0x${string}`;
    try {
      if (args.kind === "ctf") {
        // bug.0428: collateralToken from the job row (set at enqueue).
        txHash = await this.deps.walletClient.writeContract({
          address: POLYGON_CONDITIONAL_TOKENS,
          abi: polymarketCtfRedeemAbi,
          functionName: "redeemPositions",
          args: [
            job.collateralToken,
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            job.conditionId,
            args.indexSets,
          ],
          chain: polygon,
          account: this.deps.account,
        });
      } else {
        txHash = await this.deps.walletClient.writeContract({
          address: POLYGON_NEG_RISK_ADAPTER,
          abi: polymarketNegRiskAdapterAbi,
          functionName: "redeemPositions",
          args: [job.conditionId, [args.amounts[0], args.amounts[1]]],
          chain: polygon,
          account: this.deps.account,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const result = transition(job, { kind: "transient_failure", error: msg });
      if (result.ok && result.transition.nextStatus === "abandoned") {
        await this.deps.redeemJobs.markAbandoned({
          jobId: job.id,
          errorClass: "transient_exhausted",
          error: msg,
        });
        await this.mirrorLifecycle(
          job.conditionId,
          job.positionId,
          "abandoned",
          "worker_transient_exhausted"
        );
      } else {
        await this.deps.redeemJobs.markTransientFailure({
          jobId: job.id,
          error: msg,
        });
      }
      this.deps.logger.warn(
        {
          event: "poly.ctf.redeem.tx_failed_transient",
          job_id: job.id,
          condition_id: job.conditionId,
          attempt: job.attemptCount + 1,
          max_attempts: REDEEM_MAX_TRANSIENT_ATTEMPTS,
          err: msg,
        },
        "redeem-worker: tx submission failed"
      );
      return false;
    }

    // Wait for receipt + read its block + decode burn presence.
    const receipt = await this.waitForSubmittedReceipt(txHash);
    const burnObserved =
      receipt !== null
        ? decodeReceiptForBurn(receipt, job.flavor, this.deps.funderAddress)
        : false;
    await this.deps.redeemJobs.markSubmitted({
      jobId: job.id,
      txHash,
      submittedAtBlock: receipt?.blockNumber ?? null,
      receiptBurnObserved: burnObserved,
    });
    await this.mirrorLifecycle(
      job.conditionId,
      job.positionId,
      "redeem_pending",
      "worker_submitted"
    );
    this.deps.logger.info(
      {
        event: "poly.ctf.redeem.tx_submitted",
        job_id: job.id,
        condition_id: job.conditionId,
        funder: job.funderAddress,
        tx_hash: txHash,
        collateral_token_used: args.kind === "ctf" ? job.collateralToken : null,
        block: receipt?.blockNumber.toString() ?? null,
        flavor: job.flavor,
        burn_observed: burnObserved,
      },
      "redeem-worker: tx submitted"
    );
    return true;
  }

  private async waitForSubmittedReceipt(
    txHash: `0x${string}`
  ): Promise<TransactionReceipt | null> {
    try {
      return await this.deps.publicClient.waitForTransactionReceipt({
        hash: txHash,
        pollingInterval: RECEIPT_POLL_INTERVAL_MS,
      });
    } catch (waitErr) {
      try {
        const receipt = await this.deps.publicClient.getTransactionReceipt({
          hash: txHash,
        });
        this.deps.logger.warn(
          {
            event: "poly.ctf.redeem.receipt_wait_timeout_recovered",
            tx_hash: txHash,
            err: waitErr instanceof Error ? waitErr.message : String(waitErr),
          },
          "redeem-worker: recovered receipt after wait timeout"
        );
        return receipt;
      } catch (lookupErr) {
        this.deps.logger.warn(
          {
            event: "poly.ctf.redeem.receipt_wait_timeout_pending",
            tx_hash: txHash,
            wait_err:
              waitErr instanceof Error ? waitErr.message : String(waitErr),
            lookup_err:
              lookupErr instanceof Error
                ? lookupErr.message
                : String(lookupErr),
          },
          "redeem-worker: receipt unavailable after wait timeout; preserving submitted tx hash"
        );
        return null;
      }
    }
  }

  private async reapStale(): Promise<void> {
    const headBlock = await this.deps.publicClient.getBlockNumber();
    const candidates = await this.deps.redeemJobs.claimReaperCandidates(
      headBlock,
      this.deps.finalityBlocks
    );
    if (candidates.length === 0) return;

    // Batch one PayoutRedemption getLogs per flavor group across all
    // candidates: filter by funder topic + the contract appropriate to the
    // flavor, fromBlock = min(submittedAtBlock) - 1, toBlock = head.
    // `null` return = RPC failure → defer all candidates of that flavor to
    // next tick. Falling through to balanceOf on a getLogs RPC flake would
    // pollute the `balance_zero_no_payout` audit channel with false-positive
    // off-pipeline-settlement signals.
    const ctfJobs = candidates.filter((j) => !isNegRiskFlavor(j.flavor));
    const negJobs = candidates.filter((j) => isNegRiskFlavor(j.flavor));
    const ctfPayouts = await this.fetchPayoutMap(ctfJobs, headBlock, "ctf");
    const negPayouts = await this.fetchPayoutMap(negJobs, headBlock, "negrisk");

    for (const job of candidates) {
      const payouts = isNegRiskFlavor(job.flavor) ? negPayouts : ctfPayouts;
      if (payouts === null) continue; // RPC-deferred for this flavor
      const payoutTx = payouts.get(job.conditionId.toLowerCase());

      let balance = 0n;
      if (!payoutTx) {
        try {
          balance = (await this.deps.publicClient.readContract({
            address: POLYGON_CONDITIONAL_TOKENS,
            abi: ctfBalanceAbi,
            functionName: "balanceOf",
            args: [this.deps.funderAddress, BigInt(job.positionId)],
          })) as bigint;
        } catch (err) {
          // RPC error reading balance — defer this job to next tick rather
          // than risking a wrong-direction transition.
          this.deps.logger.warn(
            {
              event: "poly.ctf.redeem.reaper_balance_read_failed",
              job_id: job.id,
              condition_id: job.conditionId,
              err: err instanceof Error ? err.message : String(err),
            },
            "redeem-worker: balanceOf read failed; deferring reaper decision"
          );
          continue;
        }
      }

      const result = transition(job, {
        kind: "reaper_chain_evidence",
        payoutObserved: payoutTx !== undefined,
        balance,
      });
      if (!result.ok) continue;

      if (result.transition.nextStatus === "confirmed") {
        const txHashForLog =
          payoutTx ?? (job.txHashes.at(-1) as `0x${string}` | undefined);
        await this.deps.redeemJobs.markConfirmed({
          jobId: job.id,
          txHash: (txHashForLog ?? "0x0") as `0x${string}`,
        });
        await this.deps.redeemJobs.setLifecycleState({
          jobId: job.id,
          lifecycleState: "redeemed",
        });
        await this.mirrorLifecycle(
          job.conditionId,
          job.positionId,
          "redeemed",
          "worker_reaper_confirmed"
        );
        if (payoutTx) {
          this.deps.logger.info(
            {
              event: "poly.ctf.redeem.job_confirmed",
              source: "reaper",
              job_id: job.id,
              condition_id: job.conditionId,
              tx_hash: payoutTx,
              flavor: job.flavor,
            },
            "redeem-worker: job confirmed via reaper chain query"
          );
        } else {
          // Defensive confirm: balance==0, no payout log. Settled
          // off-pipeline. Distinct event so on-call can audit volume.
          this.deps.logger.warn(
            {
              event: "poly.ctf.redeem.balance_zero_no_payout",
              job_id: job.id,
              condition_id: job.conditionId,
              funder: job.funderAddress,
              tx_hashes: job.txHashes,
              flavor: job.flavor,
            },
            "redeem-worker: no payout + balance=0; confirming defensively"
          );
        }
      } else if (
        result.transition.nextStatus === "abandoned" &&
        result.transition.errorClass === "malformed"
      ) {
        await this.deps.redeemJobs.markAbandoned({
          jobId: job.id,
          errorClass: "malformed",
          error:
            result.transition.lastError ??
            "REDEEM_REQUIRES_BURN_OBSERVATION: no payout + balance>0",
        });
        await this.mirrorLifecycle(
          job.conditionId,
          job.positionId,
          "abandoned",
          "worker_reaper_bleed"
        );
        this.deps.logger.error(
          {
            event: "poly.ctf.redeem.bleed_detected",
            level: 50,
            job_id: job.id,
            condition_id: job.conditionId,
            funder: job.funderAddress,
            tx_hashes: job.txHashes,
            flavor: job.flavor,
            balance: balance.toString(),
          },
          "redeem-worker: BLEED DETECTED — no payout + funder still holds position at N=5"
        );
      }
    }
  }

  /**
   * Batch-fetch PayoutRedemption logs from the given contract over the
   * smallest range covering all candidate submissions. Returns a Map keyed by
   * lowercase conditionId → tx hash of the matching log. Restricted to
   * `redeemer == funder` via the indexed-topic filter (no per-log scan).
   *
   * Returns `null` to signal RPC failure — caller defers all candidates of
   * this flavor to the next tick rather than falling through to `balanceOf`,
   * which would mark genuine-redeemed positions as `balance_zero_no_payout`
   * and pollute the off-pipeline-settlement audit signal.
   */
  private async fetchPayoutMap(
    jobs: ReadonlyArray<RedeemJob>,
    headBlock: bigint,
    kind: "ctf" | "negrisk"
  ): Promise<Map<string, `0x${string}`> | null> {
    const map = new Map<string, `0x${string}`>();
    if (jobs.length === 0) return map;
    const minBlock = jobs.reduce<bigint>(
      (acc, j) =>
        j.submittedAtBlock !== null && j.submittedAtBlock < acc
          ? j.submittedAtBlock
          : acc,
      headBlock
    );
    const fromBlock = minBlock > 0n ? minBlock - 1n : 0n;
    const conditionSet = new Set(jobs.map((j) => j.conditionId.toLowerCase()));
    try {
      const logs = await this.deps.publicClient.getLogs({
        address:
          kind === "ctf"
            ? POLYGON_CONDITIONAL_TOKENS
            : POLYGON_NEG_RISK_ADAPTER,
        event: kind === "ctf" ? ctfPayoutEvent : negriskPayoutEvent,
        args: { redeemer: this.deps.funderAddress },
        fromBlock,
        toBlock: headBlock,
      });
      for (const log of logs) {
        if (log.removed) continue;
        try {
          const decoded = decodeEventLog({
            abi:
              kind === "ctf"
                ? polymarketCtfEventsAbi
                : polymarketNegRiskAdapterAbi,
            eventName: "PayoutRedemption",
            data: log.data,
            topics: log.topics,
          });
          const args = decoded.args as unknown as {
            redeemer: `0x${string}`;
            conditionId: `0x${string}`;
          };
          if (
            args.redeemer.toLowerCase() !==
            this.deps.funderAddress.toLowerCase()
          )
            continue;
          const cidLower = args.conditionId.toLowerCase();
          if (!conditionSet.has(cidLower)) continue;
          if (!map.has(cidLower) && log.transactionHash) {
            map.set(cidLower, log.transactionHash as `0x${string}`);
          }
        } catch {
          // Decode failure on a foreign-shape log — skip silently.
        }
      }
    } catch (err) {
      this.deps.logger.warn(
        {
          event: "poly.ctf.redeem.reaper_getlogs_failed",
          kind,
          from: fromBlock.toString(),
          to: headBlock.toString(),
          err: err instanceof Error ? err.message : String(err),
        },
        "redeem-worker: reaper getLogs failed; deferring flavor to next tick"
      );
      return null;
    }
    return map;
  }
}
