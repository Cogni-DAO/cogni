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
import { noopMetrics } from "@cogni/poly-market-provider";
import {
  PolyWalletOverviewIntervalSchema,
  type PolyWalletOverviewOutput,
  polyWalletOverviewOperation,
} from "@cogni/poly-node-contracts";
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
import { getTradingWalletPnlHistory } from "@/features/wallet-analysis/server/trading-wallet-overview-service";
import { getBalanceSlice } from "@/features/wallet-analysis/server/wallet-analysis-service";
import { serverEnv } from "@/shared/env/server-env";

export const dynamic = "force-dynamic";

function emptyPayload(
  interval: PolyWalletOverviewOutput["interval"],
  capturedAt: string,
  overrides: Partial<PolyWalletOverviewOutput>
): PolyWalletOverviewOutput {
  return polyWalletOverviewOperation.output.parse({
    configured: true,
    connected: false,
    address: null,
    interval,
    capturedAt,
    pol_gas: null,
    usdc_available: null,
    usdc_locked: null,
    usdc_positions_mtm: null,
    usdc_total: null,
    open_orders: null,
    pnlHistory: [],
    warnings: [],
    ...overrides,
  });
}

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.overview",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");
    const url = new URL(request.url);
    const interval = PolyWalletOverviewIntervalSchema.parse(
      url.searchParams.get("interval") ?? "1W"
    );
    const capturedAt = new Date().toISOString();

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
          emptyPayload(interval, capturedAt, {
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
        emptyPayload(interval, capturedAt, {
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

    // `balances.usdcE` is the wallet's single on-chain USDC.e balance.
    // Polymarket's CLOB does not escrow BUY-side USDC on-chain — open orders
    // are software-level reservations against the wallet's allowance, so
    // `lockedUsdc` is already part of `balances.usdcE`. The dashboard wants
    // three non-overlapping buckets that sum to total portfolio value:
    //   available = truly free USDC (on-chain total − locked)
    //   locked    = USDC reserved by open BUY orders
    //   positions = mark-to-market value of CTF share holdings
    // Previously `usdc_available` aliased to `balances.usdcE` (total on-chain)
    // and `usdc_total` summed all three, double-counting locked.
    const usdcAvailable =
      balances.usdcE !== null && lockedUsdc !== null
        ? roundToCents(Math.max(0, balances.usdcE - lockedUsdc))
        : balances.usdcE;
    const total =
      balances.usdcE !== null && positionsMtm !== null
        ? roundToCents(balances.usdcE + positionsMtm)
        : null;
    let pnlHistory: PolyWalletOverviewOutput["pnlHistory"] = [];
    try {
      pnlHistory = await getTradingWalletPnlHistory({
        address: balances.address,
        interval,
        capturedAt,
      });
    } catch (err) {
      warnings.push({
        code: "pnl_history_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    ctx.log.info(
      {
        billing_account_id: account.id,
        funder_address: balances.address,
        interval,
        usdc_available: usdcAvailable,
        usdc_locked: lockedUsdc,
        usdc_positions_mtm: positionsMtm,
        usdc_total: total,
        pol_gas: balances.pol,
        open_orders: openOrders,
        pnl_points: pnlHistory.length,
        warning_count: warnings.length,
      },
      "poly.wallet.overview"
    );

    return NextResponse.json(
      polyWalletOverviewOperation.output.parse({
        configured: true,
        connected: true,
        address: balances.address,
        interval,
        capturedAt,
        pol_gas: balances.pol,
        usdc_available: usdcAvailable,
        usdc_locked: lockedUsdc,
        usdc_positions_mtm: positionsMtm,
        usdc_total: total,
        open_orders: openOrders,
        pnlHistory,
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
