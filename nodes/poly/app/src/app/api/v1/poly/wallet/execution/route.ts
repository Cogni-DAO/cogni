// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/execution`
 * Purpose: HTTP GET — per-tenant execution feed (positions + daily trade
 *          counts) for the caller's own Polymarket trading wallet. Powers the dashboard's
 *          `OperatorWalletChartsRow` + `ExecutionActivityCard`.
 * Scope: Session-auth, tenant-scoped. Resolves the caller's billing account,
 *   asks `PolyTraderWalletPort` for its `funder_address`, reads the local
 *   position read model, and optionally overlays live timeline enrichment.
 * Invariants:
 *   - TENANT_SCOPED: the caller's own wallet is the only thing this route
 *     ever reads. The route has no query-parameter escape hatch.
 *   - CONTRACT_STABLE: response shape matches
 *     `polyWalletExecutionOperation.output`. When the tenant has no trading
 *     wallet provisioned yet (or the adapter itself is unconfigured on this
 *     pod), the payload is empty arrays with a warning — the UI empty
 *     state renders without throwing.
 *   - EXECUTION_ONLY: current wallet totals live on
 *     `/api/v1/poly/wallet/overview`; this route stays focused on positions
 *     and trade cadence only.
 * Side-effects: IO (DB read, optional Polymarket Data API + CLOB public reads).
 * Links: nodes/poly/packages/node-contracts/src/poly.wallet.execution.v1.contract.ts,
 *        docs/spec/poly-trader-wallet-port.md,
 *        work/items/task.0354.poly-trading-hardening-followups.md
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  type PolyWalletExecutionOutput,
  PolyWalletExecutionOutputSchema,
  polyWalletExecutionOperation,
} from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import { buildMarketExposureGroups } from "@/features/wallet-analysis/server/market-exposure-service";
import { getExecutionSlice } from "@/features/wallet-analysis/server/wallet-analysis-service";
import { EVENT_NAMES, logEvent } from "@/shared/observability";
import { enrichWalletExecutionPositions } from "../_lib/enrich-positions";
import {
  coalesceWalletExecutionPositions,
  DASHBOARD_LEDGER_POSITION_LIMIT,
  DASHBOARD_LEDGER_POSITION_STATUSES,
  summarizeDailyTradeCounts,
  toWalletExecutionPosition,
} from "../_lib/ledger-positions";

export const dynamic = "force-dynamic";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function emptyPayload(
  freshness: PolyWalletExecutionOutput["freshness"],
  warning: { code: string; message: string }
) {
  return polyWalletExecutionOperation.output.parse({
    address: ZERO_ADDRESS,
    freshness,
    capturedAt: new Date().toISOString(),
    dailyTradeCounts: [],
    live_positions: [],
    market_groups: [],
    closed_positions: [],
    warnings: [warning],
  });
}

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.execution",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser) => {
    const startedAtMs = performance.now();
    if (!sessionUser) throw new Error("sessionUser required");
    const url = new URL(request.url);
    const { freshness } = polyWalletExecutionOperation.input.parse({
      freshness: url.searchParams.get("freshness") ?? undefined,
    });

    const container = getContainer();
    const account = await container
      .accountsForUser(toUserId(sessionUser.id))
      .getOrCreateBillingAccountForUser({ userId: sessionUser.id });

    let adapter: ReturnType<typeof getPolyTraderWalletAdapter>;
    try {
      adapter = getPolyTraderWalletAdapter(ctx.log);
    } catch (err) {
      if (err instanceof WalletAdapterUnconfiguredError) {
        logEvent(ctx.log, EVENT_NAMES.POLY_WALLET_EXECUTION_COMPLETE, {
          reqId: ctx.reqId,
          routeId: ctx.routeId,
          status: "wallet_adapter_unconfigured",
          durationMs: Math.round(performance.now() - startedAtMs),
          outcome: "success",
          freshness,
          live_positions: 0,
          closed_positions: 0,
          daily_trade_days: 0,
          warnings: 1,
        });
        return NextResponse.json(
          emptyPayload(freshness, {
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
      logEvent(ctx.log, EVENT_NAMES.POLY_WALLET_EXECUTION_COMPLETE, {
        reqId: ctx.reqId,
        routeId: ctx.routeId,
        status: "no_trading_wallet",
        durationMs: Math.round(performance.now() - startedAtMs),
        outcome: "success",
        freshness,
        live_positions: 0,
        closed_positions: 0,
        daily_trade_days: 0,
        warnings: 1,
      });
      return NextResponse.json(
        emptyPayload(freshness, {
          code: "no_trading_wallet",
          message:
            "No Polymarket trading wallet is provisioned for this account. Connect one from the Money page.",
        })
      );
    }

    const capturedAt = new Date();
    const warnings: Array<{ code: string; message: string }> = [];
    let dbLivePositions: PolyWalletExecutionOutput["live_positions"] = [];
    let closedPositions: PolyWalletExecutionOutput["closed_positions"] = [];
    let dailyTradeCounts: ReturnType<typeof summarizeDailyTradeCounts> = [];
    try {
      const rows = await container.orderLedger.listTenantPositions({
        billing_account_id: account.id,
        statuses: [...DASHBOARD_LEDGER_POSITION_STATUSES],
        limit: DASHBOARD_LEDGER_POSITION_LIMIT,
      });
      dailyTradeCounts = summarizeDailyTradeCounts(rows, capturedAt);
      const positions = rows.map((row) =>
        toWalletExecutionPosition(row, capturedAt)
      );
      dbLivePositions = coalesceWalletExecutionPositions(
        positions
          .filter((position) => position.status !== "closed")
          .filter((position) => position.currentValue > 0)
      );
      closedPositions = coalesceWalletExecutionPositions(
        positions.filter((position) => position.status === "closed")
      );
    } catch (err) {
      warnings.push({
        code: "positions_read_model_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    let livePositions = dbLivePositions;
    if (
      freshness === "live" &&
      (dbLivePositions.length > 0 || closedPositions.length > 0)
    ) {
      try {
        const currentExecution = await getExecutionSlice(address, {
          includePriceHistory: true,
          assets: [...dbLivePositions, ...closedPositions].map(
            (position) => position.asset
          ),
        });
        livePositions = enrichWalletExecutionPositions(
          dbLivePositions,
          currentExecution.live_positions.filter(hasActionableCurrentPosition),
          capturedAt
        );
        closedPositions = enrichWalletExecutionPositions(
          closedPositions,
          currentExecution.closed_positions,
          capturedAt
        );
        warnings.push(...currentExecution.warnings);
      } catch (err) {
        warnings.push({
          code: "positions_current_unavailable",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const marketGroups = await buildMarketExposureGroups({
      db: container.serviceDb,
      billingAccountId: account.id,
      walletAddress: address,
      livePositions,
    }).catch((err: unknown) => {
      warnings.push({
        code: "market_exposure_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
      return [];
    });

    logEvent(ctx.log, EVENT_NAMES.POLY_WALLET_EXECUTION_COMPLETE, {
      reqId: ctx.reqId,
      routeId: ctx.routeId,
      status: warnings.some(
        (warning) => warning.code === "positions_read_model_unavailable"
      )
        ? "positions_read_model_unavailable"
        : warnings.some(
              (warning) => warning.code === "positions_current_unavailable"
            )
          ? "positions_current_unavailable"
          : "ok",
      durationMs: Math.round(performance.now() - startedAtMs),
      outcome: "success",
      freshness,
      live_positions: livePositions.length,
      market_groups: marketGroups.length,
      closed_positions: closedPositions.length,
      daily_trade_days: dailyTradeCounts.length,
      warnings: warnings.length,
    });

    return NextResponse.json(
      PolyWalletExecutionOutputSchema.parse({
        address: address.toLowerCase(),
        freshness,
        capturedAt: capturedAt.toISOString(),
        dailyTradeCounts,
        live_positions: livePositions,
        market_groups: marketGroups,
        closed_positions: closedPositions,
        warnings,
      })
    );
  }
);

function hasActionableCurrentPosition(
  position: PolyWalletExecutionOutput["live_positions"][number]
): boolean {
  return position.status !== "closed" && position.currentValue > 0;
}
