// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/balance`
 * Purpose: HTTP GET — operator EOA balance: USDC.e available + USDC notional locked in open orders + USDC MTM of held positions + POL gas.
 * Scope: Thin wrapper. Delegates the three shared signals (available, locked, positions) to the common wallet-analysis service + operator-extras helper; `pol_gas` remains operator-only and is fetched here. Returns legacy contract shape for back-compat.
 * Invariants: Amounts in USD, not atomic units. Single operator wallet per pod (HARDCODED_USER). `stale=true` when any of the three shared signals surfaced an error.
 * Side-effects: IO (Polygon RPC via operator-extras + Data-API via wallet-analysis service).
 * Notes: Authenticated via session. Balance composition is coalesced 30 s per signal by the shared service.
 * Links: docs/spec/poly-copy-trade-phase1.md, docs/design/wallet-analysis-components.md
 * @public
 */

import { polyWalletBalanceOperation } from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { fetchOperatorExtras } from "@/app/_lib/poly/operator-extras";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getBalanceSlice } from "@/features/wallet-analysis/server/wallet-analysis-service";
import { serverEnv } from "@/shared/env/server-env";

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.balance",
    auth: { mode: "required", getSessionUser },
  },
  // TODO(HARDCODED_USER): single-operator prototype. Multi-tenant wallet
  // balances land in task.0315 P2 when connection-broker-keyed wallets exist.
  async (_ctx, _request, _sessionUser) => {
    const env = serverEnv();
    const operator_address = env.POLY_PROTO_WALLET_ADDRESS as
      | `0x${string}`
      | undefined;

    if (!operator_address) {
      return NextResponse.json(
        polyWalletBalanceOperation.output.parse({
          operator_address:
            "0x0000000000000000000000000000000000000000" as const,
          usdc_available: 0,
          usdc_locked: 0,
          usdc_positions_mtm: 0,
          usdc_total: 0,
          pol_gas: 0,
          profile_url: "https://polymarket.com/profile/unconfigured",
          stale: true,
          error_reason: "POLY_PROTO_WALLET_ADDRESS not set",
        })
      );
    }

    const profile_url = `https://polymarket.com/profile/${operator_address.toLowerCase()}`;
    const errors: string[] = [];

    // Shared balance pass — positions (Data-API) + operator extras (available + locked).
    // Re-uses the same service the new wallet-analysis route + page call, so both UIs
    // always see identical numbers.
    const sliceResult = await getBalanceSlice(
      operator_address,
      fetchOperatorExtras
    );
    let usdc_available = 0;
    let usdc_locked = 0;
    let usdc_positions_mtm = 0;
    if (sliceResult.kind === "ok") {
      usdc_available = sliceResult.value.available ?? 0;
      usdc_locked = sliceResult.value.locked ?? 0;
      usdc_positions_mtm = sliceResult.value.positions;
      if (sliceResult.value.available === undefined)
        errors.push("available_unavailable");
      if (sliceResult.value.locked === undefined)
        errors.push("locked_unavailable");
    } else {
      errors.push(`balance_slice: ${sliceResult.warning.message}`);
    }

    // POL gas is operator-specific and not part of the generic wallet-analysis balance.
    // We still surface it here for legacy callers. One more call into operator-extras
    // coalesces with the one the slice already made (same key, same TTL).
    const extras = await fetchOperatorExtras(operator_address);
    const pol_gas = extras.polGas ?? 0;
    if (extras.polGas === null) errors.push("pol_gas_unavailable");

    const stale = errors.length > 0;

    return NextResponse.json(
      polyWalletBalanceOperation.output.parse({
        operator_address,
        usdc_available,
        usdc_locked,
        usdc_positions_mtm,
        usdc_total: usdc_available + usdc_locked + usdc_positions_mtm,
        pol_gas,
        profile_url,
        stale,
        error_reason: stale ? errors.join("; ") : null,
      })
    );
  }
);
