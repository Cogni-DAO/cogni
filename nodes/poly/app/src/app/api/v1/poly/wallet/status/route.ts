// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/status`
 * Purpose: HTTP GET — read whether the calling user has an active (non-revoked)
 *   `poly_wallet_connections` row and whether Polymarket approvals are stamped
 *   (`trading_ready`). DB-only via `getConnectionSummary` — no Privy round-trip.
 * Scope: Read-only status surface for the `/profile` and Money pages and API
 *   validation. Does not provision wallets, set allowances, or move funds.
 * Invariants:
 *   - TENANT_SCOPED: tenant derived from the authenticated session's billing account.
 *   - STATUS_REFLECTS_ACTIVE_CONNECTION: `connected=true` when an un-revoked
 *     connection row exists; `trading_ready` from `trading_approvals_ready_at`.
 *     Privy / decrypt validation happens on `resolve` / `authorizeIntent`, not here.
 * Side-effects: IO (DB reads only).
 * Links: docs/spec/poly-trader-wallet-port.md, work/items/task.0318
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  type PolyWalletStatusOutput,
  polyWalletStatusOperation,
} from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.status",
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
        const payload: PolyWalletStatusOutput = {
          configured: false,
          connected: false,
          connection_id: null,
          funder_address: null,
          trading_ready: false,
        };
        return NextResponse.json(
          polyWalletStatusOperation.output.parse(payload)
        );
      }
      throw err;
    }

    // DB-only summary (no Privy round-trip). Keeps the page-render cost low
    // and surfaces `trading_ready` for the Money-page "Enable Trading" CTA.
    const summary = await adapter.getConnectionSummary(account.id);
    const payload: PolyWalletStatusOutput = summary
      ? {
          configured: true,
          connected: true,
          connection_id: summary.connectionId,
          funder_address: summary.funderAddress,
          trading_ready: summary.tradingApprovalsReadyAt !== null,
        }
      : {
          configured: true,
          connected: false,
          connection_id: null,
          funder_address: null,
          trading_ready: false,
        };

    return NextResponse.json(polyWalletStatusOperation.output.parse(payload));
  }
);
