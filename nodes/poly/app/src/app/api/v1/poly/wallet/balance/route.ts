// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/balance`
 * Purpose: HTTP GET — legacy single-operator balance endpoint. Post-Stage-4
 *          purge (task.0318 Phase B): the env-pinned POLY_PROTO_WALLET_ADDRESS
 *          wallet is gone and there is no replacement behind this route — the
 *          per-tenant Money-page rework owns user balances and will land on
 *          a new, per-user route. We keep this endpoint serving the legacy
 *          contract shape (all zeros, unconfigured address, `stale=true`) so
 *          the OperatorWalletCard on the dashboard renders its "unconfigured"
 *          state without throwing, and existing clients/typed callers don't
 *          break on a hard 404.
 * Scope: Auth-gated tombstone. No upstream IO. Constant response body.
 * Invariants:
 *   - OPERATOR_ROUTE_DORMANT: no per-user dispatch lives here yet. A future
 *     PR replaces this route (or its callers) with the per-tenant Money-page
 *     surface that goes through `PolyTradeExecutor`.
 *   - CONTRACT_STABLE: response shape matches `polyWalletBalanceOperation.output`
 *     — callers downstream of the contract type-check without changes.
 * Side-effects: none.
 * Links: packages/node-contracts/src/poly.wallet.balance.v1.contract.ts
 * @public
 */

import { polyWalletBalanceOperation } from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.balance",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, _request, _sessionUser) => {
    return NextResponse.json(
      polyWalletBalanceOperation.output.parse({
        operator_address: "0x0000000000000000000000000000000000000000" as const,
        usdc_available: 0,
        usdc_locked: 0,
        usdc_positions_mtm: 0,
        usdc_total: 0,
        pol_gas: 0,
        profile_url: "https://polymarket.com/profile/unconfigured",
        stale: true,
        error_reason: "operator_wallet_removed_use_money_page",
      })
    );
  }
);
