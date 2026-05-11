// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/orders`
 * Purpose: HTTP GET — list of open/resting CLOB orders for the calling
 *   user's Polymarket trading wallet. Third leaf of the wallet read-side
 *   alongside /overview (snapshot totals) and /execution (positions +
 *   trade cadence); this route owns the per-order detail those two
 *   intentionally exclude.
 * Scope: Read-only, session-authenticated, tenant-scoped.
 * Invariants:
 *   - TENANT_SCOPED: caller's billing account resolved from session.
 *   - PARTIAL_FAILURE_NEVER_THROWS: upstream CLOB errors degrade to empty
 *     orders list + warning entry; route stays 200 like /overview does.
 *   - CONTRACT_STABLE: response shape matches `polyWalletOrdersOperation.output`.
 * Side-effects: IO (DB read, CLOB read).
 * Links: bug.5000, packages/node-contracts/src/poly.wallet.orders.v1.contract.ts
 * @public
 */

import { toUserId } from "@cogni/ids";
import { noopMetrics } from "@cogni/poly-market-provider";
import {
  type PolyWalletOrdersOutput,
  PolyWalletOrdersOutputSchema,
} from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { createPolyTradeExecutorFactory } from "@/bootstrap/capabilities/poly-trade-executor";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import { serverEnv } from "@/shared/env/server-env";

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.orders",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, _request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");
    const capturedAt = new Date().toISOString();
    const warnings: PolyWalletOrdersOutput["warnings"] = [];

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
          PolyWalletOrdersOutputSchema.parse({
            configured: false,
            connected: false,
            address: null,
            capturedAt,
            orders: [],
            warnings: [],
          })
        );
      }
      throw err;
    }

    const address = await adapter.getAddress(account.id);
    if (!address) {
      return NextResponse.json(
        PolyWalletOrdersOutputSchema.parse({
          configured: true,
          connected: false,
          address: null,
          capturedAt,
          orders: [],
          warnings: [],
        })
      );
    }

    let orders: PolyWalletOrdersOutput["orders"] = [];
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
      orders = await executor.listOpenOrders();
    } catch (err) {
      warnings.push({
        code: "open_orders_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    return NextResponse.json(
      PolyWalletOrdersOutputSchema.parse({
        configured: true,
        connected: true,
        address,
        capturedAt,
        orders,
        warnings,
      })
    );
  }
);
