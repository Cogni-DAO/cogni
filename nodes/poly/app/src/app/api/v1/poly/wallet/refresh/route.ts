// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/refresh`
 * Purpose: HTTP POST — force a bounded refresh of the caller's Polymarket
 *   wallet data. Reconciles the DB current-position model from Polymarket's
 *   Data API, updates legacy ledger rows used for order lifecycle overlays,
 *   then clears process caches and warms the non-CLOB execution slice.
 * Scope: Session-auth, tenant-scoped. This is an explicit mutation, not a
 *   page-load dependency; bounded CLOB/Data-API reads are allowed here to
 *   refresh the durable ledger read model.
 * Side-effects: IO (DB account lookup/write, CLOB getOrder, Data API positions).
 * Links: bug.5001
 * @public
 */

import { toUserId } from "@cogni/ids";
import { noopMetrics, type OrderStatus } from "@cogni/poly-market-provider";
import { PolymarketDataApiClient } from "@cogni/poly-market-provider/adapters/polymarket";
import {
  type PolyWalletRefreshOutput,
  polyWalletRefreshOperation,
} from "@cogni/poly-node-contracts";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { createPolyTradeExecutorFactory } from "@/bootstrap/capabilities/poly-trade-executor";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import {
  classifyPositionActionability,
  type LedgerRow,
  type LedgerStatus,
  type PositionActionability,
} from "@/features/trading";
import { refreshCurrentPositionsForWallet } from "@/features/wallet-analysis/server/trader-observation-service";
import {
  getExecutionSlice,
  invalidateWalletAnalysisCaches,
} from "@/features/wallet-analysis/server/wallet-analysis-service";
import { serverEnv } from "@/shared/env/server-env";
import { EVENT_NAMES, logEvent } from "@/shared/observability";
import {
  DASHBOARD_LEDGER_POSITION_LIMIT,
  hasPositionExposure,
} from "../_lib/ledger-positions";

export const dynamic = "force-dynamic";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const REFRESH_LEDGER_STATUSES = [
  "pending",
  "open",
  "filled",
  "partial",
  "canceled",
  "error",
] satisfies LedgerStatus[];
const REFRESH_CONCURRENCY = 8;

function mapReceiptStatus(s: OrderStatus): LedgerStatus {
  switch (s) {
    case "filled":
      return "filled";
    case "partial":
      return "partial";
    case "canceled":
      return "canceled";
    case "open":
      return "open";
    default:
      return "open";
  }
}

function readTokenId(row: LedgerRow): string | null {
  const value = row.attributes?.token_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.refresh",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, _request, sessionUser) => {
    const startedAtMs = performance.now();
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
        logWalletRefreshComplete(ctx, startedAtMs, {
          status: "wallet_adapter_unconfigured",
          ledgerRowsRead: 0,
          ledgerRowsUpdated: 0,
          currentPositionsRows: 0,
          currentPositionsComplete: false,
          warningCount: payload.warnings.length,
          dataApiCurrent: 0,
          onchainZero: 0,
          onchainDust: 0,
          onchainActionable: 0,
          upstreamError: 0,
        });
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
      logWalletRefreshComplete(ctx, startedAtMs, {
        status: "no_trading_wallet",
        ledgerRowsRead: 0,
        ledgerRowsUpdated: 0,
        currentPositionsRows: 0,
        currentPositionsComplete: false,
        warningCount: payload.warnings.length,
        dataApiCurrent: 0,
        onchainZero: 0,
        onchainDust: 0,
        onchainActionable: 0,
        upstreamError: 0,
      });
      return NextResponse.json(
        polyWalletRefreshOperation.output.parse(payload)
      );
    }

    invalidateWalletAnalysisCaches(address);

    const warnings: PolyWalletRefreshOutput["warnings"] = [];
    let executionCapturedAt: string | null = null;
    let ledgerRowsRead = 0;
    let ledgerRowsUpdated = 0;
    let currentPositionsRows = 0;
    let currentPositionsComplete = false;
    let dataApiCurrentCount = 0;
    let onchainZeroCount = 0;
    let onchainDustCount = 0;
    let onchainActionableCount = 0;
    let upstreamErrorCount = 0;

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
      const rows = await container.orderLedger.listTenantPositions({
        billing_account_id: account.id,
        statuses: REFRESH_LEDGER_STATUSES,
        limit: DASHBOARD_LEDGER_POSITION_LIMIT,
      });
      ledgerRowsRead = rows.length;

      const syncedIds = new Set<string>();
      const orderRefreshFailures: string[] = [];
      const actionabilityByAsset = new Map<
        string,
        Promise<PositionActionability>
      >();
      const classifyAssetWithPositions = (
        tokenId: string,
        dataApiPositions: readonly {
          asset: string;
          size: number;
          currentValue: number;
        }[]
      ) => {
        const existing = actionabilityByAsset.get(tokenId);
        if (existing !== undefined) return existing;
        const next = classifyPositionActionability({
          tokenId,
          dataApiPositions,
          readOnchainShares: executor.getPositionShareBalance,
          readMarketConstraints: executor.getMarketConstraints,
        });
        actionabilityByAsset.set(tokenId, next);
        return next;
      };
      const currentPositionsPromise = refreshCurrentPositionsForWallet({
        db: container.serviceDb as unknown as NodePgDatabase<
          Record<string, unknown>
        >,
        client: new PolymarketDataApiClient(),
        walletAddress: address,
        classifyMissingPosition: async ({ tokenId }) => {
          const actionability = await classifyAssetWithPositions(tokenId, []);
          if (actionability.kind === "onchain_zero") {
            return { kind: "deactivate", reason: "zero_balance" };
          }
          if (actionability.kind === "onchain_dust") {
            return { kind: "deactivate", reason: "dust" };
          }
          if (actionability.kind === "upstream_error") {
            return { kind: "preserve", reason: "authority_unavailable" };
          }
          return { kind: "preserve", reason: "actionable" };
        },
      }).then(
        (result) => ({ ok: true as const, result }),
        (err: unknown) => ({ ok: false as const, err })
      );
      const orderRows = rows.filter(isRefreshableOrderRow);
      const orderUpdateCounts = await mapConcurrent(
        orderRows,
        REFRESH_CONCURRENCY,
        async (row) => {
          try {
            if (row.order_id === null) return 0;
            const result = await executor.getOrder(row.order_id);
            syncedIds.add(row.client_order_id);
            if (!("found" in result)) return 0;
            await container.orderLedger.updateStatus({
              client_order_id: row.client_order_id,
              status: mapReceiptStatus(result.found.status),
              filled_size_usdc: result.found.filled_size_usdc,
              order_id: result.found.order_id,
            });
            return 1;
          } catch (err) {
            orderRefreshFailures.push(
              err instanceof Error ? err.message : String(err)
            );
            return 0;
          }
        }
      );
      ledgerRowsUpdated += orderUpdateCounts.reduce<number>(
        (sum, count) => sum + count,
        0
      );
      if (orderRefreshFailures.length > 0) {
        warnings.push({
          code: "order_refresh_partial",
          message: `${orderRefreshFailures.length} order lookups failed; first error: ${orderRefreshFailures[0]}`,
        });
      }

      const currentPositionsResult = await currentPositionsPromise;
      if (!currentPositionsResult.ok) {
        warnings.push({
          code: "positions_reconciliation_unavailable",
          message:
            currentPositionsResult.err instanceof Error
              ? currentPositionsResult.err.message
              : String(currentPositionsResult.err),
        });
      } else {
        currentPositionsRows = currentPositionsResult.result.positionRows;
        currentPositionsComplete = currentPositionsResult.result.complete;
        if (
          (currentPositionsResult.result.stalePositionRowsPreserved ?? 0) > 0
        ) {
          warnings.push({
            code: "positions_reconciliation_preserved_missing",
            message: `${currentPositionsResult.result.stalePositionRowsPreserved} previously active DB position rows were omitted by Data API and preserved because chain authority did not prove they were closed.`,
          });
        }
        if (!currentPositionsResult.result.complete) {
          warnings.push({
            code: "positions_reconciliation_partial",
            message:
              "Current positions were fetched up to the configured page cap; missing DB rows were not deactivated.",
          });
        }
        const positionActionabilityFailures: string[] = [];
        const lifecycleClassifiedAssets = new Set<string>();
        const classifyAsset = (tokenId: string) => {
          return classifyAssetWithPositions(
            tokenId,
            currentPositionsResult.result.positions
          );
        };
        const exposureRows = rows.filter(hasPositionExposure);
        const exposureUpdateCounts = await mapConcurrent(
          exposureRows,
          REFRESH_CONCURRENCY,
          async (row) => {
            const tokenId = readTokenId(row);
            if (tokenId === null) return 0;
            syncedIds.add(row.client_order_id);
            const actionability = await classifyAsset(tokenId);
            if (actionability.kind === "data_api_current") {
              dataApiCurrentCount += 1;
              await container.orderLedger.updateStatus({
                client_order_id: row.client_order_id,
                status: row.status,
                filled_size_usdc: roundToCents(actionability.currentValueUsdc),
              });
              return 1;
            }
            if (actionability.kind === "onchain_zero") {
              onchainZeroCount += 1;
              if (lifecycleClassifiedAssets.has(tokenId)) return 0;
              lifecycleClassifiedAssets.add(tokenId);
              return container.orderLedger.markPositionLifecycleByAsset({
                billing_account_id: account.id,
                token_id: tokenId,
                lifecycle: "closed",
                updated_at: new Date(),
              });
            }
            if (actionability.kind === "onchain_dust") {
              onchainDustCount += 1;
              if (lifecycleClassifiedAssets.has(tokenId)) return 0;
              lifecycleClassifiedAssets.add(tokenId);
              return container.orderLedger.markPositionLifecycleByAsset({
                billing_account_id: account.id,
                token_id: tokenId,
                lifecycle: "dust",
                updated_at: new Date(),
              });
            }
            if (actionability.kind === "upstream_error") {
              upstreamErrorCount += 1;
              positionActionabilityFailures.push(actionability.message);
              return 0;
            }
            onchainActionableCount += 1;
            return 0;
          }
        );
        ledgerRowsUpdated += exposureUpdateCounts.reduce<number>(
          (sum, count) => sum + count,
          0
        );
        if (positionActionabilityFailures.length > 0) {
          warnings.push({
            code: "positions_actionability_partial",
            message: `${positionActionabilityFailures.length} position classifications failed; first error: ${positionActionabilityFailures[0]}`,
          });
        }
      }

      await container.orderLedger.markSynced([...syncedIds]);
    } catch (err) {
      warnings.push({
        code: "ledger_refresh_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const execution = await getExecutionSlice(container.serviceDb, address, {
        includePriceHistory: false,
        includeTrades: false,
      });
      executionCapturedAt = execution.capturedAt;
      warnings.push(...execution.warnings);
    } catch (err) {
      warnings.push({
        code: "execution_refresh_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    logWalletRefreshComplete(ctx, startedAtMs, {
      status: "ok",
      ledgerRowsRead,
      ledgerRowsUpdated,
      currentPositionsRows,
      currentPositionsComplete,
      warningCount: warnings.length,
      dataApiCurrent: dataApiCurrentCount,
      onchainZero: onchainZeroCount,
      onchainDust: onchainDustCount,
      onchainActionable: onchainActionableCount,
      upstreamError: upstreamErrorCount,
    });

    const payload: PolyWalletRefreshOutput = {
      address: address.toLowerCase() as PolyWalletRefreshOutput["address"],
      refreshedAt: new Date().toISOString(),
      executionCapturedAt,
      warnings,
    };
    return NextResponse.json(polyWalletRefreshOperation.output.parse(payload));
  }
);

function logWalletRefreshComplete(
  ctx: {
    log: Parameters<typeof logEvent>[0];
    reqId: string;
    routeId: string;
  },
  startedAtMs: number,
  fields: {
    status: string;
    ledgerRowsRead: number;
    ledgerRowsUpdated: number;
    currentPositionsRows: number;
    currentPositionsComplete: boolean;
    warningCount: number;
    dataApiCurrent: number;
    onchainZero: number;
    onchainDust: number;
    onchainActionable: number;
    upstreamError: number;
  }
): void {
  logEvent(ctx.log, EVENT_NAMES.POLY_WALLET_REFRESH_COMPLETE, {
    reqId: ctx.reqId,
    routeId: ctx.routeId,
    status: fields.status,
    durationMs: Math.round(performance.now() - startedAtMs),
    outcome: "success",
    ledger_rows_read: fields.ledgerRowsRead,
    ledger_rows_updated: fields.ledgerRowsUpdated,
    current_positions_rows: fields.currentPositionsRows,
    current_positions_complete: fields.currentPositionsComplete,
    warning_count: fields.warningCount,
    actionability_data_api_current: fields.dataApiCurrent,
    actionability_onchain_zero: fields.onchainZero,
    actionability_onchain_dust: fields.onchainDust,
    actionability_onchain_actionable: fields.onchainActionable,
    actionability_upstream_error: fields.upstreamError,
  });
}

function isRefreshableOrderRow(row: LedgerRow): boolean {
  return (
    row.order_id !== null &&
    (row.status === "pending" ||
      row.status === "open" ||
      row.status === "partial")
  );
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index] as T);
      }
    }
  );
  await Promise.all(workers);
  return results;
}
