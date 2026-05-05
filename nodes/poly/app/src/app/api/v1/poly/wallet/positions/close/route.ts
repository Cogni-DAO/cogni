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
import {
  BELOW_MARKET_MIN_CODE,
  noopMetrics,
} from "@cogni/poly-market-provider";
import { polyWalletClosePositionOperation } from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import {
  classifyClobCredentialRotationError,
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
import { EVENT_NAMES, logEvent } from "@/shared/observability";

export const dynamic = "force-dynamic";

function randomClientOrderId(): `0x${string}` {
  return `0x${randomBytes(32).toString("hex")}`;
}

function isBelowMarketMinError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: unknown }).code === BELOW_MARKET_MIN_CODE
  );
}

export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.positions.close",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser) => {
    const startedAtMs = performance.now();
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
        kind: "order",
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

      logWalletCloseComplete(ctx, startedAtMs, {
        status: "order",
        ordersPlaced: 1,
        ledgerRowsUpdated: 0,
      });

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
          const updated =
            await container.orderLedger.markPositionLifecycleByAsset({
              billing_account_id: account.id,
              token_id: parsed.data.token_id,
              lifecycle: "closed",
              updated_at: new Date(),
            });
          if (updated > 0) {
            try {
              const address = await adapter.getAddress(account.id);
              if (address) invalidateWalletAnalysisCaches(address);
            } catch (cacheErr) {
              ctx.log.warn(
                {
                  billing_account_id: account.id,
                  err:
                    cacheErr instanceof Error
                      ? cacheErr.message
                      : String(cacheErr),
                },
                "poly.wallet.positions.close.cache_invalidate_failed"
              );
            }
            logWalletCloseComplete(ctx, startedAtMs, {
              status: "stale_zero_balance",
              ordersPlaced: 0,
              ledgerRowsUpdated: updated,
            });
            return NextResponse.json(
              polyWalletClosePositionOperation.output.parse({
                kind: "classified",
                status: "closed",
                classification: "stale_zero_balance",
                ledger_rows_updated: updated,
              })
            );
          }
          return NextResponse.json({ error: err.code }, { status: 409 });
        }
      }
      if (isBelowMarketMinError(err)) {
        const updated =
          await container.orderLedger.markPositionLifecycleByAsset({
            billing_account_id: account.id,
            token_id: parsed.data.token_id,
            lifecycle: "dust",
            updated_at: new Date(),
          });
        try {
          const address = await adapter.getAddress(account.id);
          if (address) invalidateWalletAnalysisCaches(address);
        } catch (cacheErr) {
          ctx.log.warn(
            {
              billing_account_id: account.id,
              err:
                cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
            },
            "poly.wallet.positions.close.cache_invalidate_failed"
          );
        }
        logWalletCloseComplete(ctx, startedAtMs, {
          status: "below_market_min",
          ordersPlaced: 0,
          ledgerRowsUpdated: updated,
        });
        return NextResponse.json(
          polyWalletClosePositionOperation.output.parse({
            kind: "classified",
            status: "dust",
            classification: "below_market_min",
            ledger_rows_updated: updated,
          })
        );
      }
      const clobError = classifyClobCredentialRotationError(err);
      if (clobError.httpStatus !== undefined) {
        ctx.log.warn(
          {
            billing_account_id: account.id,
            token_id: parsed.data.token_id,
            reason: clobError.reasonCode,
            http_status: clobError.httpStatus,
            error_class: clobError.errorClass,
          },
          "poly.wallet.positions.close.clob_upstream_error"
        );
        return NextResponse.json(
          {
            error: clobError.reasonCode,
            httpStatus: clobError.httpStatus,
          },
          { status: 502 }
        );
      }
      ctx.log.error(
        {
          billing_account_id: account.id,
          error_class:
            err && typeof err === "object" && err.constructor?.name
              ? err.constructor.name
              : typeof err,
        },
        "poly.wallet.positions.close.error"
      );
      return NextResponse.json(
        {
          error: "close_failed",
        },
        { status: 502 }
      );
    }
  }
);

function logWalletCloseComplete(
  ctx: {
    log: Parameters<typeof logEvent>[0];
    reqId: string;
    routeId: string;
  },
  startedAtMs: number,
  fields: {
    status: "order" | "stale_zero_balance" | "below_market_min";
    ordersPlaced: number;
    ledgerRowsUpdated: number;
  }
): void {
  logEvent(ctx.log, EVENT_NAMES.POLY_WALLET_POSITIONS_CLOSE_COMPLETE, {
    reqId: ctx.reqId,
    routeId: ctx.routeId,
    status: fields.status,
    durationMs: Math.round(performance.now() - startedAtMs),
    outcome: "success",
    orders_placed: fields.ordersPlaced,
    ledger_rows_updated: fields.ledgerRowsUpdated,
  });
}
