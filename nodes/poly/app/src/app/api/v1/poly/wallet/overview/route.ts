// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/overview`
 * Purpose: HTTP GET — current dashboard summary for the calling user's
 *   Polymarket trading wallet: cash, live locked open-order notional,
 *   position MTM, total, and gas.
 * Scope: Read-only, session-authenticated, tenant-scoped. Does not provision
 *   wallets, place trades, or infer any historical balance curve.
 * Invariants:
 *   - TENANT_SCOPED: the caller's billing account is resolved from session.
 *   - CURRENT_ONLY: all values describe the current wallet state only.
 *   - PARTIAL_FAILURE_NEVER_THROWS: upstream failures degrade to nullable
 *     fields plus warnings while the route stays 200.
 * Side-effects: IO (DB read, Polygon RPC, Data API, CLOB open-orders read).
 * @public
 */

import { toUserId } from "@cogni/ids";
import { noopMetrics } from "@cogni/market-provider";
import {
  type PolyWalletOverviewOutput,
  polyWalletOverviewOperation,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import {
  createPolyTradeExecutorFactory,
  type OpenOrderSummary,
} from "@/bootstrap/capabilities/poly-trade-executor";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import { getBalanceSlice } from "@/features/wallet-analysis/server/wallet-analysis-service";
import { serverEnv } from "@/shared/env/server-env";

export const dynamic = "force-dynamic";

function emptyPayload(
  overrides: Partial<PolyWalletOverviewOutput>
): PolyWalletOverviewOutput {
  return polyWalletOverviewOperation.output.parse({
    configured: true,
    connected: false,
    address: null,
    pol_gas: null,
    usdc_available: null,
    usdc_locked: null,
    usdc_positions_mtm: null,
    usdc_total: null,
    open_orders: null,
    warnings: [],
    ...overrides,
  });
}

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.overview",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, _request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

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
          emptyPayload({
            configured: false,
            warnings: [
              {
                code: "wallet_adapter_unconfigured",
                message:
                  "Trading-wallet adapter is not configured on this pod yet.",
              },
            ],
          })
        );
      }
      throw err;
    }

    const balances = await adapter.getBalances(account.id);
    if (!balances) {
      return NextResponse.json(
        emptyPayload({
          warnings: [
            {
              code: "no_trading_wallet",
              message:
                "No Polymarket trading wallet is provisioned for this account yet.",
            },
          ],
        })
      );
    }

    const warnings: PolyWalletOverviewOutput["warnings"] = [
      ...balances.errors.map((message) => ({
        code: "balances_partial",
        message,
      })),
    ];

    let positionsMtm: number | null = null;
    const balanceSlice = await getBalanceSlice(balances.address);
    if (balanceSlice.kind === "ok") {
      positionsMtm = balanceSlice.value.positions;
    } else {
      warnings.push({
        code: balanceSlice.warning.code,
        message: balanceSlice.warning.message,
      });
    }

    let lockedUsdc: number | null = null;
    let openOrders: number | null = null;
    try {
      const env = serverEnv();
      const executorFactory = createPolyTradeExecutorFactory({
        walletPort: adapter,
        logger: ctx.log,
        metrics: noopMetrics,
        host: env.POLY_CLOB_HOST,
        polygonRpcUrl: env.POLYGON_RPC_URL,
      });
      const executor = await executorFactory.getPolyTradeExecutorFor(
        account.id
      );
      const orders = await executor.listOpenOrders();
      openOrders = orders.length;
      lockedUsdc = sumLockedUsdc(orders);
    } catch (err) {
      warnings.push({
        code: "open_orders_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const total =
      balances.usdcE !== null && positionsMtm !== null && lockedUsdc !== null
        ? roundToCents(balances.usdcE + positionsMtm + lockedUsdc)
        : null;

    ctx.log.info(
      {
        billing_account_id: account.id,
        funder_address: balances.address,
        usdc_available: balances.usdcE,
        usdc_locked: lockedUsdc,
        usdc_positions_mtm: positionsMtm,
        usdc_total: total,
        pol_gas: balances.pol,
        open_orders: openOrders,
        warning_count: warnings.length,
      },
      "poly.wallet.overview"
    );

    return NextResponse.json(
      polyWalletOverviewOperation.output.parse({
        configured: true,
        connected: true,
        address: balances.address,
        pol_gas: balances.pol,
        usdc_available: balances.usdcE,
        usdc_locked: lockedUsdc,
        usdc_positions_mtm: positionsMtm,
        usdc_total: total,
        open_orders: openOrders,
        warnings,
      })
    );
  }
);

function sumLockedUsdc(orders: OpenOrderSummary[]): number {
  return roundToCents(
    orders.reduce((sum, order) => {
      if (order.side !== "BUY" || order.remainingUsdc === null) return sum;
      return sum + order.remainingUsdc;
    }, 0)
  );
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}
