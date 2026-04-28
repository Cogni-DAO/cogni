// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/positions/redeem`
 * Purpose: HTTP POST — enqueue a redeem job through the event-driven pipeline (task.0388) for a resolved Polymarket condition. The user-facing entry point holds the connection up to 30s waiting for the worker to confirm; falls back to `202 + job_id` past that ceiling so an in-cluster ALB / ingress timeout cannot orphan the request.
 * Scope: Validates input with `polyWalletRedeemPositionOperation`, resolves the calling tenant's billing account → per-tenant redeem pipeline (task.0412 multi-tenant fan-out), enqueues via that pipeline's `RedeemJobsPort`, polls `findByKey` until terminal or timeout. Does not place CLOB orders, does not sign transactions.
 * Invariants:
 *   - TENANT_SCOPED — each tenant gets their own redeem pipeline keyed by `billingAccountId`; the route resolves the calling session's billing account and uses only that tenant's pipeline + funder, never another tenant's.
 *   - REDEEM_DEDUP_IS_PERSISTED — the port UPSERTs on `(funder, condition_id)`; double-clicks return the same `jobId`.
 * Side-effects: One DB write (job enqueue) + repeated polls; no chain writes from the route. Worker handles tx submission.
 * Links: nodes/poly/app/src/bootstrap/redeem-pipeline.ts, nodes/poly/app/src/features/redeem/resolve-redeem-decision.ts
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  normalizePolygonConditionId,
  PolymarketDataApiClient,
} from "@cogni/market-provider/adapters/polymarket";
import { polyWalletRedeemPositionOperation } from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { polygon } from "viem/chains";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import { resolveRedeemCandidatesForCondition } from "@/features/redeem";
import { invalidateWalletAnalysisCaches } from "@/features/wallet-analysis/server/wallet-analysis-service";
import { serverEnv } from "@/shared/env/server-env";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 500;
const POLL_BUDGET_MS = 30_000;

export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.positions.redeem",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = polyWalletRedeemPositionOperation.input.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    let conditionId: `0x${string}`;
    try {
      conditionId = normalizePolygonConditionId(parsed.data.condition_id);
    } catch {
      return NextResponse.json(
        { error: "invalid_condition_id" },
        { status: 400 }
      );
    }

    const container = getContainer();
    const account = await container
      .accountsForUser(toUserId(sessionUser.id))
      .getOrCreateBillingAccountForUser({ userId: sessionUser.id });

    const pipeline = container.redeemPipelineFor(account.id);
    if (!pipeline) {
      // The calling tenant's pipeline isn't running. Either their wallet
      // isn't provisioned yet, was provisioned after this pod's last boot
      // (pipeline registry is built once at startup), or the trader-wallet
      // adapter is unconfigured.
      ctx.log.info(
        { billing_account_id: account.id },
        "poly.wallet.positions.redeem.pipeline_unavailable_for_tenant"
      );
      return NextResponse.json(
        { error: "redeem_pipeline_unavailable" },
        { status: 503 }
      );
    }

    try {
      getPolyTraderWalletAdapter(ctx.log);
    } catch (err) {
      if (err instanceof WalletAdapterUnconfiguredError) {
        return NextResponse.json(
          { error: "wallet_adapter_unconfigured" },
          { status: 503 }
        );
      }
      throw err;
    }

    const env = serverEnv();
    const publicClient = createPublicClient({
      chain: polygon,
      transport: http(env.POLYGON_RPC_URL),
    });
    const dataApiClient = new PolymarketDataApiClient();

    const candidates = await resolveRedeemCandidatesForCondition({
      funderAddress: pipeline.funderAddress,
      conditionId,
      publicClient,
      dataApiClient,
    });
    const candidate = candidates.find((c) => c.decision.kind === "redeem");
    if (!candidate || candidate.decision.kind !== "redeem") {
      const skip = candidates[0];
      const reason =
        skip && skip.decision.kind !== "redeem"
          ? skip.decision.reason
          : "no_redeemable_position";
      return NextResponse.json(
        { error: "not_redeemable", reason },
        { status: 409 }
      );
    }

    const decision = candidate.decision;
    const enqueued = await pipeline.redeemJobs.enqueue({
      funderAddress: pipeline.funderAddress,
      conditionId: candidate.conditionId,
      positionId: candidate.positionId.toString(),
      outcomeIndex: candidate.outcomeIndex,
      flavor: decision.flavor,
      indexSet: decision.indexSet.map((b) => b.toString()),
      expectedShares: decision.expectedShares.toString(),
      expectedPayoutUsdc: decision.expectedPayoutUsdc.toString(),
      lifecycleState: "winner",
    });

    const startedAt = Date.now();
    while (Date.now() - startedAt < POLL_BUDGET_MS) {
      await sleep(POLL_INTERVAL_MS);
      const job = await pipeline.redeemJobs.findByKey(
        pipeline.funderAddress,
        candidate.conditionId
      );
      if (!job) continue;
      if (job.status === "confirmed") {
        const txHash = (job.txHashes[job.txHashes.length - 1] ?? null) as
          | `0x${string}`
          | null;
        if (!txHash) continue;
        try {
          invalidateWalletAnalysisCaches(pipeline.funderAddress);
        } catch {
          /* cache invalidation is best-effort */
        }
        ctx.log.info(
          {
            billing_account_id: account.id,
            condition_id: candidate.conditionId,
            tx_hash: txHash,
            job_id: job.id,
          },
          "poly.wallet.positions.redeem.confirmed"
        );
        const payload = polyWalletRedeemPositionOperation.output.parse({
          tx_hash: txHash,
        });
        return NextResponse.json(payload);
      }
      if (job.status === "abandoned") {
        ctx.log.warn(
          {
            billing_account_id: account.id,
            condition_id: candidate.conditionId,
            job_id: job.id,
            error_class: job.errorClass,
            last_error: job.lastError,
          },
          "poly.wallet.positions.redeem.abandoned"
        );
        return NextResponse.json(
          {
            error: "redeem_failed",
            reason: job.errorClass ?? "unknown",
            message: job.lastError ?? null,
          },
          { status: 502 }
        );
      }
    }

    ctx.log.info(
      {
        billing_account_id: account.id,
        condition_id: candidate.conditionId,
        job_id: enqueued.jobId,
      },
      "poly.wallet.positions.redeem.pending"
    );
    return NextResponse.json(
      { status: "pending", job_id: enqueued.jobId },
      { status: 202 }
    );
  }
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
