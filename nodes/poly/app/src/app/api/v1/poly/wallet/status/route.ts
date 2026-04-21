// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/status`
 * Purpose: HTTP GET — read whether the calling user already has a resolvable
 *   Polymarket trading wallet connection on this deployment.
 * Scope: Read-only status surface for the `/profile` page and API validation.
 *   Does not provision wallets, set allowances, or move funds.
 * Invariants:
 *   - TENANT_SCOPED: tenant derived from the authenticated session's billing account.
 *   - STATUS_REFLECTS_RUNTIME_RESOLVE: `connected=true` only when the runtime can
 *     resolve the full signing context for this tenant.
 * Side-effects: IO (DB reads, Privy-backed signing-context resolve).
 * Links: docs/spec/poly-trader-wallet-port.md, work/items/task.0318
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  type PolyWalletStatusOutput,
  polyWalletStatusOperation,
} from "@cogni/node-contracts";
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
        };
        return NextResponse.json(
          polyWalletStatusOperation.output.parse(payload)
        );
      }
      throw err;
    }

    const resolved = await adapter.resolve(account.id);
    const payload: PolyWalletStatusOutput = resolved
      ? {
          configured: true,
          connected: true,
          connection_id: resolved.connectionId,
          funder_address: resolved.funderAddress,
        }
      : {
          configured: true,
          connected: false,
          connection_id: null,
          funder_address: null,
        };

    return NextResponse.json(polyWalletStatusOperation.output.parse(payload));
  }
);
