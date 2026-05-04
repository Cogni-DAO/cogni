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
 * Side-effects: IO (DB read, Polygon RPC, optional Data API).
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  type PolyWalletOverviewOutput,
  polyWalletOverviewOperation,
} from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import { readCurrentWalletPositionModel } from "@/features/wallet-analysis/server/current-position-read-model";
import { getTradingWalletPnlHistory } from "@/features/wallet-analysis/server/trading-wallet-overview-service";
import { EVENT_NAMES, logEvent } from "@/shared/observability";
import {
  DASHBOARD_LEDGER_POSITION_LIMIT,
  DASHBOARD_LEDGER_POSITION_STATUSES,
  summarizeLedgerPositions,
} from "../_lib/ledger-positions";

export const dynamic = "force-dynamic";

function emptyPayload(
  interval: PolyWalletOverviewOutput["interval"],
  capturedAt: string,
  overrides: Partial<PolyWalletOverviewOutput>
): PolyWalletOverviewOutput {
  return polyWalletOverviewOperation.output.parse({
    configured: true,
    connected: false,
    freshness: overrides.freshness ?? "live",
    address: null,
    interval,
    capturedAt,
    pol_gas: null,
    usdc_available: null,
    usdc_locked: null,
    usdc_positions_mtm: null,
    usdc_total: null,
    open_orders: null,
    positions_synced_at: null,
    positions_sync_age_ms: null,
    positions_stale: false,
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
    const startedAtMs = performance.now();
    if (!sessionUser) throw new Error("sessionUser required");
    const url = new URL(request.url);
    const { interval = "1W", freshness } =
      polyWalletOverviewOperation.input.parse({
        interval: url.searchParams.get("interval") ?? undefined,
        freshness: url.searchParams.get("freshness") ?? undefined,
      });
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
        logOverviewComplete(ctx, startedAtMs, {
          status: "wallet_adapter_unconfigured",
          interval,
          freshness,
          connected: false,
          warnings: 1,
          openOrders: null,
          positionsMtm: null,
          lockedUsdc: null,
          pnlPoints: 0,
        });
        return NextResponse.json(
          emptyPayload(interval, capturedAt, {
            configured: false,
            freshness,
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
      logOverviewComplete(ctx, startedAtMs, {
        status: "no_trading_wallet",
        interval,
        freshness,
        connected: false,
        warnings: 1,
        openOrders: null,
        positionsMtm: null,
        lockedUsdc: null,
        pnlPoints: 0,
      });
      return NextResponse.json(
        emptyPayload(interval, capturedAt, {
          freshness,
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

    const capturedAtDate = new Date(capturedAt);
    let positionSummary = summarizeLedgerPositions([], capturedAtDate);
    let currentPositionSummary: {
      positionsMtm: number;
      syncedAt: string | null;
      syncAgeMs: number | null;
      stale: boolean;
    } | null = null;
    try {
      const rows = await container.orderLedger.listTenantPositions({
        billing_account_id: account.id,
        statuses: [...DASHBOARD_LEDGER_POSITION_STATUSES],
        limit: DASHBOARD_LEDGER_POSITION_LIMIT,
      });
      positionSummary = summarizeLedgerPositions(rows, capturedAtDate);
    } catch (err) {
      warnings.push({
        code: "positions_read_model_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const currentPositions = await readCurrentWalletPositionModel({
        db: container.serviceDb,
        walletAddress: balances.address,
        capturedAt: capturedAtDate,
      });
      if (
        !currentPositions.warnings.some(
          (warning) => warning.code === "current_positions_wallet_missing"
        )
      ) {
        currentPositionSummary = currentPositions.summary;
      }
      warnings.push(...currentPositions.warnings);
    } catch (err) {
      warnings.push({
        code: "current_positions_read_model_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    const positionsMtm =
      currentPositionSummary !== null
        ? roundToCents(currentPositionSummary.positionsMtm)
        : null;

    // `balances.usdcE` and `balances.pusd` are the wallet's two on-chain cash
    // balances (USDC.e bridged + Polymarket V2 pUSD). Both are spendable from
    // the dashboard's perspective: pUSD funds CLOB BUYs directly; USDC.e is
    // wrapped to pUSD by the auto-wrap loop when consent is on.
    // Open orders are software-level reservations, so DB-derived locked USDC is
    // already part of the on-chain cash balance.
    const cashOnChain =
      balances.usdcE !== null && balances.pusd !== null
        ? balances.usdcE + balances.pusd
        : null;
    const usdcAvailable =
      cashOnChain !== null
        ? roundToCents(Math.max(0, cashOnChain - positionSummary.lockedUsdc))
        : cashOnChain;
    const total =
      cashOnChain !== null && positionsMtm !== null
        ? roundToCents(cashOnChain + positionsMtm)
        : null;
    let pnlHistory: PolyWalletOverviewOutput["pnlHistory"] = [];
    if (freshness === "live") {
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
    }

    logOverviewComplete(ctx, startedAtMs, {
      status: warnings.some(
        (warning) => warning.code === "positions_read_model_unavailable"
      )
        ? "positions_read_model_unavailable"
        : warnings.some(
              (warning) =>
                warning.code === "current_positions_read_model_unavailable"
            )
          ? "current_positions_read_model_unavailable"
          : warnings.some(
                (warning) => warning.code === "current_positions_stale"
              )
            ? "current_positions_stale"
            : warnings.some(
                  (warning) => warning.code === "pnl_history_unavailable"
                )
              ? "pnl_history_unavailable"
              : warnings.some((warning) => warning.code === "balances_partial")
                ? "balances_partial"
                : "ok",
      interval,
      freshness,
      connected: true,
      warnings: warnings.length,
      openOrders: positionSummary.openOrders,
      positionsMtm,
      lockedUsdc: positionSummary.lockedUsdc,
      pnlPoints: pnlHistory.length,
    });

    return NextResponse.json(
      polyWalletOverviewOperation.output.parse({
        configured: true,
        connected: true,
        freshness,
        address: balances.address,
        interval,
        capturedAt,
        pol_gas: balances.pol,
        usdc_available: usdcAvailable,
        usdc_locked: positionSummary.lockedUsdc,
        usdc_positions_mtm: positionsMtm,
        usdc_total: total,
        open_orders: positionSummary.openOrders,
        positions_synced_at:
          currentPositionSummary?.syncedAt ?? positionSummary.syncedAt,
        positions_sync_age_ms:
          currentPositionSummary?.syncAgeMs ?? positionSummary.syncAgeMs,
        positions_stale: currentPositionSummary?.stale ?? positionSummary.stale,
        pnlHistory,
        warnings,
      })
    );
  }
);

function logOverviewComplete(
  ctx: {
    log: Parameters<typeof logEvent>[0];
    reqId: string;
    routeId: string;
  },
  startedAtMs: number,
  fields: {
    status: string;
    interval: PolyWalletOverviewOutput["interval"];
    freshness: PolyWalletOverviewOutput["freshness"];
    connected: boolean;
    warnings: number;
    openOrders: number | null;
    positionsMtm: number | null;
    lockedUsdc: number | null;
    pnlPoints: number;
  }
): void {
  logEvent(ctx.log, EVENT_NAMES.POLY_WALLET_OVERVIEW_COMPLETE, {
    reqId: ctx.reqId,
    routeId: ctx.routeId,
    status: fields.status,
    durationMs: Math.round(performance.now() - startedAtMs),
    outcome: "success",
    interval: fields.interval,
    freshness: fields.freshness,
    connected: fields.connected,
    warnings: fields.warnings,
    open_orders: fields.openOrders,
    positions_mtm: fields.positionsMtm,
    locked_usdc: fields.lockedUsdc,
    pnl_points: fields.pnlPoints,
  });
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}
