// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/redeem-pipeline`
 * Purpose: Construct + start the event-driven CTF redeem pipeline at boot.
 *   For each active `poly_wallet_connections` row, instantiate one
 *   `RedeemSubscriber` (3 viem `watchContractEvent` subscriptions) +
 *   one `RedeemWorker` (drains pending jobs scoped to that funder + reaps
 *   stale submitted rows at N=5 finality) + one boot catch-up replay over
 *   `last_processed_block` and a periodic interval that re-runs the catch-up
 *   every `REDEEM_CATCHUP_INTERVAL_MS`. Layer-3 position diff
 *   (`runRedeemDiffTick`) runs on its own staggered timer to detect
 *   conditions Layer 2 missed (bug.5028). Replaces the deleted
 *   `runRedeemSweep` polling loop in `poly-trade-executor.ts`.
 * Scope: Multi-tenant (task.0412). One pipeline instance per active
 *   `poly_wallet_connections` row. Workers claim jobs with a funder filter
 *   so cross-tenant claims are impossible. 0 active rows → no-op.
 * Invariants:
 *   - PIPELINE_PER_TENANT — exactly one `(subscriber, worker)` pair per
 *     active `poly_wallet_connections` row at boot. Wallet revoke + re-
 *     provision still requires a pod restart for that tenant's pipeline
 *     to pick up the new signing context (acceptable for v1; dynamic
 *     registry is a future opt).
 *   - WORKER_CLAIM_IS_FUNDER_SCOPED — `RedeemJobsPort.claimNextPending(funder)`
 *     is the only contention-safe surface; cross-tenant claims would sign
 *     a job for funder A with funder B's wallet, which the contract would
 *     revert on but waste gas + emit noisy errors.
 *   - CATCHUP_IS_THE_RECOVERY_PATH — the live viem subscriber against
 *     load-balanced HTTP RPC providers (Alchemy) silently drops events when
 *     filter state doesn't sticky-route across backend nodes. The periodic
 *     `runRedeemCatchup` interval is the durable recovery path; the live
 *     subscriber is best-effort latency reduction. Don't remove the timer
 *     without a proven WS / sticky-filter replacement (bug.5015).
 *   - DIFF_IS_GAP_DETECTOR — Layer-3 position diff is a rare safety net
 *     for what Layers 1+2 miss (pre-`initialFromBlock` resolutions, lagged
 *     Data-API flips, filter-drift drops outside catchup horizon). Steady-
 *     state cost is one Data-API read + one DB query — diff is empty when
 *     chain-log catchup is healthy. Replaces the boot-coupled full sweep
 *     `backfillLifecycleStates` that scaled O(positions × multicall) and
 *     would OOM at 5k+ positions per funder (bug.5028).
 * Side-effects: IO (DB query at boot, Polygon RPC long-poll while running).
 * Links: docs/design/poly-positions.md, work/items/task.0388,
 *   work/items/task.0412, work/items/task.0318
 * @public
 */

import { polyWalletConnections } from "@cogni/poly-db-schema";
import { PolymarketDataApiClient } from "@cogni/poly-market-provider/adapters/polymarket";
import type {
  PolyTraderSigningContext,
  PolyTraderWalletPort,
} from "@cogni/poly-wallet";
import { isNull } from "drizzle-orm";
import type { Logger } from "pino";
import {
  type Account,
  createPublicClient,
  createWalletClient,
  http,
  type WalletClient,
} from "viem";
import { polygon } from "viem/chains";

import type { Database } from "@/adapters/server/db/client";
import {
  DrizzleMarketOutcomesAdapter,
  DrizzleRedeemJobsAdapter,
} from "@/adapters/server/redeem";
import {
  RedeemSubscriber,
  RedeemWorker,
  runRedeemCatchup,
  runRedeemDiffTick,
} from "@/features/redeem";
import type { LedgerLifecycleMirrorPort } from "@/features/redeem/mirror-ledger-lifecycle";
import type { RedeemJobsPort } from "@/ports";
import { EVENT_NAMES } from "@/shared/observability/events";

const REDEEM_POLL_INTERVAL_MS = 10 * 60 * 1000;
const REDEEM_WORKER_DRAIN_INTERVAL_MS = 5_000;
// Periodic catch-up interval: re-runs `runRedeemCatchup` every N ms to pick up
// new ConditionResolution / PayoutRedemption logs the live `watchContractEvent`
// subscriber missed. viem's HTTP filter polling against load-balanced RPC
// providers (Alchemy) silently drops events when filter state doesn't sticky-
// route — observed in prod as 0 live-path policy_decisions across 9h on
// 112b4b18 once pod restarts stopped masking it (bug.5015). Cursor advance is
// idempotent, so re-runs are safe and cheap (~300 blocks / 10 min on Polygon).
const REDEEM_CATCHUP_INTERVAL_MS = 10 * 60 * 1000;
// Periodic Layer-3 position-diff interval. Re-runs `runRedeemDiffTick` so
// any conditions Layer 2 missed (pre-`initialFromBlock` resolutions, lagged
// Data-API flips, filter-drift drops outside catchup horizon) are caught.
// Cadence is intentionally looser than catchup: Layer 2 owns the ≤10-min
// recovery SLO; Layer 3 is a rare gap-detector. Steady-state cost is one
// Data-API read + one DB query — diff is empty when chain-log catchup is
// healthy. (bug.5028)
const REDEEM_DIFF_INTERVAL_MS = 60 * 60 * 1000;
// First-tick delay cap. Each tenant pipeline waits `random() * MAX` ms
// before its first diff tick to break the boot-thundering-herd across N
// tenants without making fresh-tenant classify wait an hour. Subsequent
// ticks fire on `setInterval(REDEEM_DIFF_INTERVAL_MS)` and inherit the
// per-tenant phase offset naturally. (bug.5028)
const REDEEM_DIFF_FIRST_TICK_MAX_DELAY_MS = 60 * 1000;

export interface RedeemPipelineHandles {
  redeemJobs: RedeemJobsPort;
  funderAddress: `0x${string}`;
  billingAccountId: string;
  stop: () => void;
}

export interface StartRedeemPipelineDeps {
  serviceDb: Database;
  orderLedger: LedgerLifecycleMirrorPort;
  walletPort: PolyTraderWalletPort;
  polygonRpcUrl: string;
  log: Logger;
  /** Hard-pinned N=5 (~12.5s) post-Heimdall-v2; see task.0388 § FINALITY_IS_FIXED_N. */
  finalityBlocks?: bigint;
  /** Worker pending-job drain cadence. Reaper cadence stays tied to RPC polling. */
  tickIntervalMs?: number;
  /**
   * Catch-up floor for first deploy (ignored once a cursor row exists).
   * Defaults to current chain head — i.e. catch-up only sees resolutions that
   * happen after this pod boots, no historical backfill. Multi-day backfill
   * is a separate operator action (one-shot script), not a boot concern.
   */
  initialFromBlock?: bigint;
}

/**
 * Boot every active tenant's redeem pipeline. Returns a map keyed by
 * `billingAccountId`. Empty map = no active wallets at boot.
 */
export async function startRedeemPipelines(
  deps: StartRedeemPipelineDeps
): Promise<Map<string, RedeemPipelineHandles>> {
  const log = deps.log.child({ subcomponent: "redeem-pipeline" });

  const activeConnections = await deps.serviceDb
    .select({ billingAccountId: polyWalletConnections.billingAccountId })
    .from(polyWalletConnections)
    .where(isNull(polyWalletConnections.revokedAt));

  if (activeConnections.length === 0) {
    log.info(
      { event: "poly.ctf.redeem.pipeline_skipped", reason: "no_active_wallet" },
      "redeem pipeline: no active poly_wallet_connections rows; nothing to start"
    );
    return new Map();
  }

  const pipelines = new Map<string, RedeemPipelineHandles>();
  for (const { billingAccountId } of activeConnections) {
    if (!billingAccountId) continue;
    const handles = await startOneTenantPipeline(billingAccountId, deps, log);
    if (handles !== null) pipelines.set(billingAccountId, handles);
  }

  log.info(
    {
      event: "poly.ctf.redeem.pipelines_boot_complete",
      tenant_count: pipelines.size,
      active_connections: activeConnections.length,
    },
    "redeem pipeline: boot complete"
  );

  return pipelines;
}

async function startOneTenantPipeline(
  billingAccountId: string,
  deps: StartRedeemPipelineDeps,
  parentLog: Logger
): Promise<RedeemPipelineHandles | null> {
  const log = parentLog.child({ billing_account_id: billingAccountId });

  let signing: PolyTraderSigningContext | null;
  try {
    signing = await deps.walletPort.resolve(billingAccountId);
  } catch (err) {
    log.warn(
      {
        event: "poly.ctf.redeem.pipeline_skipped",
        reason: "wallet_resolve_failed",
        err: err instanceof Error ? err.message : String(err),
      },
      "redeem pipeline: walletPort.resolve threw; skipping this tenant"
    );
    return null;
  }
  if (!signing) {
    log.info(
      {
        event: "poly.ctf.redeem.pipeline_skipped",
        reason: "no_signing_context",
      },
      "redeem pipeline: walletPort.resolve returned null; skipping this tenant"
    );
    return null;
  }

  const funderAddress = signing.funderAddress;
  const account = signing.account as unknown as Account;

  const publicClient = createPublicClient({
    chain: polygon,
    pollingInterval: REDEEM_POLL_INTERVAL_MS,
    transport: http(deps.polygonRpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(deps.polygonRpcUrl),
  }) as WalletClient;

  const redeemJobs: RedeemJobsPort = new DrizzleRedeemJobsAdapter(
    deps.serviceDb
  );
  const marketOutcomes = new DrizzleMarketOutcomesAdapter(deps.serviceDb);
  const dataApiClient = new PolymarketDataApiClient();

  const subscriber = new RedeemSubscriber({
    redeemJobs,
    marketOutcomes,
    orderLedger: deps.orderLedger,
    billingAccountId,
    publicClient,
    dataApiClient,
    funderAddress,
    logger: log,
  });
  const worker = new RedeemWorker({
    redeemJobs,
    orderLedger: deps.orderLedger,
    billingAccountId,
    publicClient,
    walletClient,
    funderAddress,
    account,
    logger: log,
    finalityBlocks: deps.finalityBlocks ?? 5n,
    tickIntervalMs: deps.tickIntervalMs ?? REDEEM_WORKER_DRAIN_INTERVAL_MS,
    reaperIntervalMs: REDEEM_POLL_INTERVAL_MS,
  });

  const initialFromBlock =
    deps.initialFromBlock ?? (await publicClient.getBlockNumber());
  const catchupStartedAt = Date.now();
  try {
    await runRedeemCatchup({
      redeemJobs,
      orderLedger: deps.orderLedger,
      billingAccountId,
      publicClient,
      dataApiClient,
      funderAddress,
      subscriber,
      logger: log,
      initialFromBlock,
    });
  } catch (err) {
    const mem = process.memoryUsage();
    log.warn(
      {
        event: EVENT_NAMES.POLY_REDEEM_CATCHUP_FAILED,
        durationMs: Date.now() - catchupStartedAt,
        reason_code: "redeem_catchup_threw",
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        err: err instanceof Error ? err.message : String(err),
      },
      "redeem pipeline: catch-up replay threw; subscriber + worker will still start"
    );
  }

  subscriber.start();
  worker.start();

  let diffInFlight = false;
  const runDiffTick = (): void => {
    if (diffInFlight) {
      log.warn(
        {
          event: EVENT_NAMES.POLY_REDEEM_DIFF_TICK_SKIPPED,
          reason: "in_flight",
        },
        "redeem pipeline: skipping diff tick; previous run still in flight"
      );
      return;
    }
    diffInFlight = true;
    runRedeemDiffTick({
      redeemJobs,
      dataApiClient,
      subscriber,
      funderAddress,
      log,
    })
      .catch((err) => {
        const mem = process.memoryUsage();
        log.warn(
          {
            event: EVENT_NAMES.POLY_REDEEM_DIFF_TICK_FAILED,
            err: err instanceof Error ? err.message : String(err),
            heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
            rss_mb: Math.round(mem.rss / 1024 / 1024),
          },
          "redeem pipeline: diff tick threw; will retry next tick"
        );
      })
      .finally(() => {
        diffInFlight = false;
      });
  };

  // First-tick stagger: random delay up to REDEEM_DIFF_FIRST_TICK_MAX_DELAY_MS.
  // Spreads the initial diff tick across tenants so they don't all hit
  // Polymarket Data-API simultaneously at boot. (bug.5028)
  const firstDiffDelayMs = Math.floor(
    Math.random() * REDEEM_DIFF_FIRST_TICK_MAX_DELAY_MS
  );
  const firstDiffTimeout = setTimeout(runDiffTick, firstDiffDelayMs);
  firstDiffTimeout.unref?.();
  const diffTimer = setInterval(runDiffTick, REDEEM_DIFF_INTERVAL_MS);
  diffTimer.unref?.();

  let catchupInFlight = false;
  const catchupTimer = setInterval(() => {
    if (catchupInFlight) {
      log.warn(
        {
          event: EVENT_NAMES.POLY_REDEEM_CATCHUP_TICK_SKIPPED,
          reason: "in_flight",
        },
        "redeem pipeline: skipping periodic catchup tick; previous run still in flight"
      );
      return;
    }
    catchupInFlight = true;
    const tickStartedAt = Date.now();
    runRedeemCatchup({
      redeemJobs,
      orderLedger: deps.orderLedger,
      billingAccountId,
      publicClient,
      dataApiClient,
      funderAddress,
      subscriber,
      logger: log,
      initialFromBlock,
    })
      .catch((err) => {
        const mem = process.memoryUsage();
        log.warn(
          {
            event: EVENT_NAMES.POLY_REDEEM_CATCHUP_FAILED,
            durationMs: Date.now() - tickStartedAt,
            reason_code: "redeem_catchup_periodic_threw",
            heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
            rss_mb: Math.round(mem.rss / 1024 / 1024),
            err: err instanceof Error ? err.message : String(err),
          },
          "redeem pipeline: periodic catch-up replay threw; will retry next tick"
        );
      })
      .finally(() => {
        catchupInFlight = false;
      });
  }, REDEEM_CATCHUP_INTERVAL_MS);
  catchupTimer.unref?.();

  log.info(
    {
      event: "poly.ctf.redeem.pipeline_started",
      funder: funderAddress,
      billing_account_id: billingAccountId,
    },
    "redeem pipeline: started"
  );

  return {
    redeemJobs,
    funderAddress,
    billingAccountId,
    stop: () => {
      clearTimeout(firstDiffTimeout);
      clearInterval(diffTimer);
      clearInterval(catchupTimer);
      subscriber.stop();
      worker.stop();
    },
  };
}
