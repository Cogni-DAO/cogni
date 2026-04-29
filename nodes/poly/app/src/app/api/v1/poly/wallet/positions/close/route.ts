// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/positions/close`
 * Purpose: HTTP POST — tenant-scoped market SELL that fully exits an open outcome position while the market still trades (pre-resolution exit).
 * Scope: Validates body with `polyWalletClosePositionOperation`, resolves session billing account, delegates to `PolyTradeExecutor.exitPosition`. Does not implement new CLOB client code or target wallets.
 * Invariants:
 *   - TENANT_SCOPED — the funder address always comes from the caller's trading connection, never from the request body.
 *   - EXIT_ON_PATH — `exitPosition` sells the caller's full share balance for the token via a market order; grant caps never block user exits.
 * Side-effects: Polymarket CLOB HTTPS, possible on-chain fill when the order matches.
 * Links: nodes/poly/packages/node-contracts/src/poly.wallet.position-actions.v1.contract.ts,
 *        nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts
 * @public
 */

import { randomBytes } from "node:crypto";

import { toUserId } from "@cogni/ids";
import { noopMetrics } from "@cogni/poly-market-provider";
import { polyWalletClosePositionOperation } from "@cogni/poly-node-contracts";
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

function randomClientOrderId(): `0x${string}` {
  return `0x${randomBytes(32).toString("hex")}`;
}

export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.positions.close",
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

    const parsed = polyWalletClosePositionOperation.input.safeParse(body);
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
      const receipt = await executor.exitPosition({
        tokenId: parsed.data.token_id,
        client_order_id: randomClientOrderId(),
      });

      const payload = polyWalletClosePositionOperation.output.parse({
        order_id: receipt.order_id,
        status: receipt.status,
        client_order_id: receipt.client_order_id,
        filled_size_usdc: receipt.filled_size_usdc,
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
          "poly.wallet.positions.close.cache_invalidate_failed"
        );
      }

      ctx.log.info(
        {
          billing_account_id: account.id,
          token_id: parsed.data.token_id,
          order_id: receipt.order_id,
        },
        "poly.wallet.positions.close.ok"
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
        if (err.code === "no_position_to_close") {
          return NextResponse.json({ error: err.code }, { status: 409 });
        }
      }
      ctx.log.error(
        {
          billing_account_id: account.id,
          err: err instanceof Error ? err.message : String(err),
        },
        "poly.wallet.positions.close.error"
      );
      return NextResponse.json(
        {
          error: "close_failed",
          message: err instanceof Error ? err.message : String(err),
        },
        { status: 502 }
      );
    }
  }
);
