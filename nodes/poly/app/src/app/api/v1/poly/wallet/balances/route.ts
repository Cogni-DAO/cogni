// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/balances`
 * Purpose: HTTP GET — on-chain balance snapshot (USDC.e + POL on Polygon) for
 *   the calling user's Polymarket trading wallet. Powers the Money page's
 *   trading-wallet panel.
 * Scope: Read-only. Does not provision wallets, set allowances, or move funds.
 *   Distinct from the legacy operator-only `/balance` (singular) route.
 * Invariants:
 *   - TENANT_SCOPED: tenant derived from the authenticated session's billing account.
 *   - READ_ONLY: delegates to `PolyTraderWalletPort.getBalances`, which performs
 *     no signing and no Privy backend call — just a DB lookup + Polygon RPC.
 *   - PARTIAL_FAILURE_NEVER_THROWS: upstream RPC failures surface as `errors[]`
 *     with the corresponding field `null`; the response stays 200.
 * Side-effects: IO (DB read, Polygon RPC).
 * Links: docs/spec/poly-trader-wallet-port.md,
 *        packages/node-contracts/src/poly.wallet.balances.v1.contract.ts
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  type PolyWalletBalancesOutput,
  polyWalletBalancesOperation,
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
    routeId: "poly.wallet.balances",
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
        const payload: PolyWalletBalancesOutput = {
          configured: false,
          connected: false,
          address: null,
          usdc_e: null,
          pol: null,
          errors: [],
        };
        return NextResponse.json(
          polyWalletBalancesOperation.output.parse(payload)
        );
      }
      throw err;
    }

    const balances = await adapter.getBalances(account.id);

    if (!balances) {
      const payload: PolyWalletBalancesOutput = {
        configured: true,
        connected: false,
        address: null,
        usdc_e: null,
        pol: null,
        errors: [],
      };
      return NextResponse.json(
        polyWalletBalancesOperation.output.parse(payload)
      );
    }

    ctx.log.info(
      {
        billing_account_id: account.id,
        funder_address: balances.address,
        usdc_e: balances.usdcE,
        pol: balances.pol,
        error_count: balances.errors.length,
      },
      "poly.wallet.balances"
    );

    const payload: PolyWalletBalancesOutput = {
      configured: true,
      connected: true,
      address: balances.address,
      usdc_e: balances.usdcE,
      pol: balances.pol,
      errors: [...balances.errors],
    };
    return NextResponse.json(polyWalletBalancesOperation.output.parse(payload));
  }
);
