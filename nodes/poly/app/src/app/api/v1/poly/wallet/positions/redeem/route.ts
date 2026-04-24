// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/positions/redeem`
 * Purpose: HTTP POST — on-chain `redeemPositions` for a resolved market so USDC.e is returned to the tenant wallet (post-resolution exit; not a CLOB order).
 * Scope: Validates with `polyWalletRedeemPositionOperation`, resolves session billing account, calls `PolyTradeExecutor.redeemResolvedPosition`. Does not place CLOB orders.
 * Invariants:
 *   - TENANT_SCOPED — condition id selects the caller's Data API redeemable row; no cross-wallet redeem.
 *   - REDEEM_GATE — executor refuses when Data API does not mark the position redeemable for that wallet.
 * Side-effects: Polygon RPC writes (signed redeem tx), HTTPS to Data API for position preflight.
 * Links: packages/market-provider/src/adapters/polymarket/polymarket.ctf.redeem.ts,
 *        nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts
 * @public
 */

import { toUserId } from "@cogni/ids";
import { noopMetrics } from "@cogni/market-provider";
import { polyWalletRedeemPositionOperation } from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import {
  createPolyTradeExecutorFactory,
  PolyTradeExecutorError,
} from "@/bootstrap/capabilities/poly-trade-executor";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import { invalidateWalletAnalysisCaches } from "@/features/wallet-analysis/server/wallet-analysis-service";
import { serverEnv } from "@/shared/env/server-env";

export const dynamic = "force-dynamic";

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

    const container = getContainer();
    const account = await container
      .accountsForUser(toUserId(sessionUser.id))
      .getOrCreateBillingAccountForUser({ userId: sessionUser.id });

    let adapter: ReturnType<typeof getPolyTraderWalletAdapter>;
    try {
      adapter = getPolyTraderWalletAdapter(ctx.log);
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
    const executorFactory = createPolyTradeExecutorFactory({
      walletPort: adapter,
      logger: ctx.log,
      metrics: noopMetrics,
      host: env.POLY_CLOB_HOST,
      polygonRpcUrl: env.POLYGON_RPC_URL,
    });

    try {
      const executor = await executorFactory.getPolyTradeExecutorFor(
        account.id
      );
      const result = await executor.redeemResolvedPosition({
        condition_id: parsed.data.condition_id,
      });

      const payload = polyWalletRedeemPositionOperation.output.parse({
        tx_hash: result.tx_hash,
      });

      try {
        const address = await adapter.getAddress(account.id);
        if (address) invalidateWalletAnalysisCaches(address);
      } catch (err) {
        ctx.log.warn(
          {
            billing_account_id: account.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "poly.wallet.positions.redeem.cache_invalidate_failed"
        );
      }

      ctx.log.info(
        {
          billing_account_id: account.id,
          condition_id: parsed.data.condition_id,
          tx_hash: result.tx_hash,
        },
        "poly.wallet.positions.redeem.ok"
      );

      return NextResponse.json(payload);
    } catch (err) {
      if (err instanceof PolyTradeExecutorError) {
        if (err.code === "not_authorized") {
          return NextResponse.json(
            { error: err.code, reason: err.reason ?? null },
            { status: 403 }
          );
        }
        if (err.code === "not_redeemable") {
          return NextResponse.json({ error: err.code }, { status: 409 });
        }
        if (err.code === "redeem_failed") {
          return NextResponse.json(
            { error: err.code, message: err.message },
            { status: 502 }
          );
        }
      }
      ctx.log.error(
        {
          billing_account_id: account.id,
          err: err instanceof Error ? err.message : String(err),
        },
        "poly.wallet.positions.redeem.error"
      );
      return NextResponse.json(
        {
          error: "redeem_failed",
          message: err instanceof Error ? err.message : String(err),
        },
        { status: 502 }
      );
    }
  }
);
