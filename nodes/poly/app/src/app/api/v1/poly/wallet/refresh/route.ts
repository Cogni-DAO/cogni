// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/refresh`
 * Purpose: HTTP POST — force a bounded refresh of the caller's Polymarket
 *   wallet data. Clears process caches and warms the non-CLOB execution slice.
 * Scope: Session-auth, tenant-scoped. Does not call private CLOB on the
 *   request path; order-state reconciliation remains background-owned.
 * Side-effects: IO (DB account lookup, Data API cache warm).
 * Links: bug.5001
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  type PolyWalletRefreshOutput,
  polyWalletRefreshOperation,
} from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import {
  getExecutionSlice,
  invalidateWalletAnalysisCaches,
} from "@/features/wallet-analysis/server/wallet-analysis-service";

export const dynamic = "force-dynamic";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.refresh",
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
        const payload: PolyWalletRefreshOutput = {
          address: ZERO_ADDRESS,
          refreshedAt: new Date().toISOString(),
          executionCapturedAt: null,
          warnings: [
            {
              code: "wallet_adapter_unconfigured",
              message:
                "Trading-wallet adapter is not configured on this pod yet.",
            },
          ],
        };
        return NextResponse.json(
          polyWalletRefreshOperation.output.parse(payload)
        );
      }
      throw err;
    }

    const address = await adapter.getAddress(account.id);
    if (!address) {
      const payload: PolyWalletRefreshOutput = {
        address: ZERO_ADDRESS,
        refreshedAt: new Date().toISOString(),
        executionCapturedAt: null,
        warnings: [
          {
            code: "no_trading_wallet",
            message:
              "No Polymarket trading wallet is provisioned for this account.",
          },
        ],
      };
      return NextResponse.json(
        polyWalletRefreshOperation.output.parse(payload)
      );
    }

    invalidateWalletAnalysisCaches(address);

    const warnings: PolyWalletRefreshOutput["warnings"] = [];
    let executionCapturedAt: string | null = null;
    try {
      const execution = await getExecutionSlice(address, {
        includePriceHistory: false,
      });
      executionCapturedAt = execution.capturedAt;
      warnings.push(...execution.warnings);
    } catch (err) {
      warnings.push({
        code: "execution_refresh_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    ctx.log.info(
      {
        billing_account_id: account.id,
        funder_address: address,
        execution_captured_at: executionCapturedAt,
        warning_count: warnings.length,
      },
      "poly.wallet.refresh"
    );

    const payload: PolyWalletRefreshOutput = {
      address: address.toLowerCase() as PolyWalletRefreshOutput["address"],
      refreshedAt: new Date().toISOString(),
      executionCapturedAt,
      warnings,
    };
    return NextResponse.json(polyWalletRefreshOperation.output.parse(payload));
  }
);
