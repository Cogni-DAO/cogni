// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/redeem-pipeline`
 * Purpose: Construct + start the event-driven CTF redeem pipeline at boot —
 *   one `RedeemSubscriber` (3 viem `watchContractEvent` subscriptions) +
 *   one `RedeemWorker` (drains pending jobs + reaps stale submitted rows
 *   at N=5 finality) + one catch-up replay against `last_processed_block`.
 *   Replaces the deleted `runRedeemSweep` polling loop in `poly-trade-executor.ts`.
 * Scope: v0.2 binds the pipeline to a single funder (the one active
 *   `poly_wallet_connections` row). Multi-tenant fan-out is task.0318 Phase C.
 *   When >1 active connection is present, the pipeline does not start and a
 *   warning is logged so the migration is forced rather than silently
 *   selecting one tenant's wallet.
 * Invariants:
 *   - SINGLE_FUNDER_V0_2 — exactly one `poly_wallet_connections` row may be
 *     active when the pipeline starts. 0 → no-op (skip); 2+ → no-op (warn).
 *   - PIPELINE_BINDS_AT_BOOT — funder + signer are resolved once at start;
 *     a wallet revoke + re-provision requires a pod restart. Acceptable for
 *     v0.2 (1 user); refactor path is Phase C.
 * Side-effects: IO (DB query at boot, Polygon RPC long-poll while running).
 * Links: docs/design/poly-positions.md, work/items/task.0388
 * @public
 */

import { PolymarketDataApiClient } from "@cogni/market-provider/adapters/polymarket";
import { polyWalletConnections } from "@cogni/poly-db-schema";
import type {
  PolyTraderSigningContext,
  PolyTraderWalletPort,
} from "@cogni/poly-wallet";
import { eq } from "drizzle-orm";
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

export async function startRedeemPipeline(
  deps: StartRedeemPipelineDeps
): Promise<RedeemPipelineHandles | null> {
  const log = deps.log.child({ subcomponent: "redeem-pipeline" });

  const activeConnections = await deps.serviceDb
    .select({ billingAccountId: polyWalletConnections.billingAccountId })
    .from(polyWalletConnections)
    .where(eq(polyWalletConnections.revokedAt, null as unknown as Date));

  if (activeConnections.length === 0) {
    log.info(
      { event: "poly.ctf.redeem.pipeline_skipped", reason: "no_active_wallet" },
      "redeem pipeline: no active poly_wallet_connections row; not starting"
    );
    return null;
  }
  if (activeConnections.length > 1) {
    log.warn(
      {
        event: "poly.ctf.redeem.pipeline_skipped",
        reason: "multi_tenant_unsupported",
        count: activeConnections.length,
      },
      "redeem pipeline: >1 active poly_wallet_connections — v0.2 binds a single funder; refactor required (task.0318 Phase C)"
    );
    return null;
  }

  const billingAccountId = activeConnections[0]?.billingAccountId;
  if (!billingAccountId) return null;

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
      "redeem pipeline: walletPort.resolve threw; not starting"
    );
    return null;
  }
  if (!signing) {
    log.info(
      {
        event: "poly.ctf.redeem.pipeline_skipped",
        reason: "no_signing_context",
      },
      "redeem pipeline: walletPort.resolve returned null; not starting"
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
    stop: () => {
      subscriber.stop();
      worker.stop();
    },
  };
}
