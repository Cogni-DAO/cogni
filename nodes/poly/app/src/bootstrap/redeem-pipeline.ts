// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/redeem-pipeline`
 * Purpose: Construct + start the event-driven CTF redeem pipeline at boot.
 *   For each active `poly_wallet_connections` row, instantiate one
 *   `RedeemSubscriber` (3 viem `watchContractEvent` subscriptions) +
 *   one `RedeemWorker` (drains pending jobs scoped to that funder + reaps
 *   stale submitted rows at N=5 finality) + one catch-up replay against
 *   `last_processed_block`. Replaces the deleted `runRedeemSweep` polling
 *   loop in `poly-trade-executor.ts`.
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
 * Side-effects: IO (DB query at boot, Polygon RPC long-poll while running).
 * Links: docs/design/poly-positions.md, work/items/task.0388,
 *   work/items/task.0412, work/items/task.0318
 * @public
 */

import { PolymarketDataApiClient } from "@cogni/market-provider/adapters/polymarket";
import { polyWalletConnections } from "@cogni/poly-db-schema";
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
import { DrizzleRedeemJobsAdapter } from "@/adapters/server/redeem";
import {
  RedeemSubscriber,
  RedeemWorker,
  runRedeemCatchup,
} from "@/features/redeem";
import type { RedeemJobsPort } from "@/ports";

export interface RedeemPipelineHandles {
  redeemJobs: RedeemJobsPort;
  funderAddress: `0x${string}`;
  billingAccountId: string;
  stop: () => void;
}

export interface StartRedeemPipelineDeps {
  serviceDb: Database;
  walletPort: PolyTraderWalletPort;
  polygonRpcUrl: string;
  log: Logger;
  /** Hard-pinned N=5 (~12.5s) post-Heimdall-v2; see task.0388 § FINALITY_IS_FIXED_N. */
  finalityBlocks?: bigint;
  /** Worker tick cadence; one job claim + one reaper pass per tick. */
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
  const dataApiClient = new PolymarketDataApiClient();

  const subscriber = new RedeemSubscriber({
    redeemJobs,
    publicClient,
    dataApiClient,
    funderAddress,
    logger: log,
  });
  const worker = new RedeemWorker({
    redeemJobs,
    publicClient,
    walletClient,
    funderAddress,
    account,
    logger: log,
    finalityBlocks: deps.finalityBlocks ?? 5n,
    tickIntervalMs: deps.tickIntervalMs ?? 5_000,
  });

  const initialFromBlock =
    deps.initialFromBlock ?? (await publicClient.getBlockNumber());
  try {
    await runRedeemCatchup({
      redeemJobs,
      publicClient,
      dataApiClient,
      funderAddress,
      subscriber,
      logger: log,
      initialFromBlock,
    });
  } catch (err) {
    log.warn(
      {
        event: "poly.ctf.redeem.catchup_failed",
        err: err instanceof Error ? err.message : String(err),
      },
      "redeem pipeline: catch-up replay threw; subscriber + worker will still start"
    );
  }

  subscriber.start();
  worker.start();

  try {
    await backfillLifecycleStates(
      funderAddress,
      dataApiClient,
      subscriber,
      log
    );
  } catch (err) {
    log.warn(
      {
        event: "poly.ctf.redeem.backfill_failed",
        err: err instanceof Error ? err.message : String(err),
      },
      "redeem pipeline: lifecycle-state backfill threw; continuing"
    );
  }

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
      subscriber.stop();
      worker.stop();
    },
  };
}

async function backfillLifecycleStates(
  funderAddress: `0x${string}`,
  dataApiClient: PolymarketDataApiClient,
  subscriber: RedeemSubscriber,
  log: Logger
): Promise<void> {
  const positions = await dataApiClient.listUserPositions(funderAddress);
  const conditionIds = new Set<`0x${string}`>();
  for (const p of positions) {
    if (!p.conditionId) continue;
    const id = p.conditionId.startsWith("0x")
      ? (p.conditionId as `0x${string}`)
      : (`0x${p.conditionId}` as `0x${string}`);
    conditionIds.add(id);
  }
  log.info(
    {
      event: "poly.ctf.redeem.backfill_started",
      funder: funderAddress,
      condition_count: conditionIds.size,
    },
    "redeem pipeline: classifying current positions"
  );
  for (const conditionId of conditionIds) {
    await subscriber.enqueueForCondition(conditionId);
  }
}
