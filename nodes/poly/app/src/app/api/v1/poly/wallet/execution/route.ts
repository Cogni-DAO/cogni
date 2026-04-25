// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/execution`
 * Purpose: HTTP GET — per-tenant execution feed (positions + daily trade
 *          counts) for the caller's own Polymarket trading wallet. Powers the dashboard's
 *          `OperatorWalletChartsRow` + `ExecutionActivityCard`.
 * Scope: Session-auth, tenant-scoped. Resolves the caller's billing account,
 *   asks `PolyTraderWalletPort` for its `funder_address`, then delegates to
 *   `getExecutionSlice(funderAddress)` in the shared wallet-analysis service
 *   (Polymarket Data API for trades + positions, public CLOB for price
 *   history). No writes, no operator capability.
 * Invariants:
 *   - TENANT_SCOPED: the caller's own wallet is the only thing this route
 *     ever reads. There is no `?addr=` override.
 *   - CONTRACT_STABLE: response shape matches
 *     `polyWalletExecutionOperation.output`. When the tenant has no trading
 *     wallet provisioned yet (or the adapter itself is unconfigured on this
 *     pod), the payload is empty arrays with a warning — the UI empty
 *     state renders without throwing.
 *   - EXECUTION_ONLY: current wallet totals live on
 *     `/api/v1/poly/wallet/overview`; this route stays focused on positions
 *     and trade cadence only.
 * Side-effects: IO (DB read, Polymarket Data API, public CLOB).
 * Links: packages/node-contracts/src/poly.wallet.execution.v1.contract.ts,
 *        docs/spec/poly-trader-wallet-port.md,
 *        work/items/task.0354.poly-trading-hardening-followups.md
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  PolyWalletExecutionOutputSchema,
  polyWalletExecutionOperation,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import { getExecutionSlice } from "@/features/wallet-analysis/server/wallet-analysis-service";

export const dynamic = "force-dynamic";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function emptyPayload(warning: { code: string; message: string }) {
  return polyWalletExecutionOperation.output.parse({
    address: ZERO_ADDRESS,
    capturedAt: new Date().toISOString(),
    dailyTradeCounts: [],
    live_positions: [],
    closed_positions: [],
    warnings: [warning],
  });
}

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.execution",
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
            code: "wallet_adapter_unconfigured",
            message:
              "Trading-wallet adapter is not configured on this pod yet.",
          })
        );
      }
      throw err;
    }

    const address = await adapter.getAddress(account.id);
    if (!address) {
      return NextResponse.json(
        emptyPayload({
          code: "no_trading_wallet",
          message:
            "No Polymarket trading wallet is provisioned for this account. Connect one from the Money page.",
        })
      );
    }

    ctx.log.info(
      {
        billing_account_id: account.id,
        funder_address: address,
      },
      "poly.wallet.execution"
    );

    return NextResponse.json(
      PolyWalletExecutionOutputSchema.parse(await getExecutionSlice(address))
    );
  }
);
