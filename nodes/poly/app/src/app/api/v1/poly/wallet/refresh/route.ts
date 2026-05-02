// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/refresh`
 * Purpose: HTTP POST — force a bounded refresh of the caller's Polymarket
 *   wallet data. Updates the DB ledger rows used by dashboard page-loads,
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
import {
  type PolyWalletRefreshOutput,
  polyWalletRefreshOperation,
} from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { createPolyTradeExecutorFactory } from "@/bootstrap/capabilities/poly-trade-executor";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import type { LedgerRow, LedgerStatus } from "@/features/trading";
import {
  getExecutionSlice,
  invalidateWalletAnalysisCaches,
} from "@/features/wallet-analysis/server/wallet-analysis-service";
import { serverEnv } from "@/shared/env/server-env";
import { hasPositionExposure } from "../_lib/ledger-positions";

export const dynamic = "force-dynamic";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const REFRESH_LEDGER_STATUSES = [
  "pending",
  "open",
  "filled",
  "partial",
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
    let ledgerRowsRead = 0;
    let ledgerRowsUpdated = 0;

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
        limit: 500,
      });
      ledgerRowsRead = rows.length;

      const syncedIds = new Set<string>();
      const orderRefreshFailures: string[] = [];
      const positionsPromise = executor.listPositions().then(
        (positions) => ({ ok: true as const, positions }),
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

      const positionsResult = await positionsPromise;
      if (!positionsResult.ok) {
        warnings.push({
          code: "positions_reconciliation_unavailable",
          message:
            positionsResult.err instanceof Error
              ? positionsResult.err.message
              : String(positionsResult.err),
        });
      } else {
        const currentValueByAsset = new Map(
          positionsResult.positions
            .filter((position) => position.size > 0)
            .map((position) => [
              position.asset,
              roundToCents(position.currentValue),
            ])
        );

        const closedAssets = new Set<string>();
        const exposureRows = rows.filter(hasPositionExposure);
        const exposureUpdateCounts = await mapConcurrent(
          exposureRows,
          REFRESH_CONCURRENCY,
          async (row) => {
            const tokenId = readTokenId(row);
            if (tokenId === null) return 0;
            syncedIds.add(row.client_order_id);
            const currentValue = currentValueByAsset.get(tokenId);
            if (currentValue !== undefined && currentValue > 0) {
              await container.orderLedger.updateStatus({
                client_order_id: row.client_order_id,
                status: row.status,
                filled_size_usdc: currentValue,
              });
              return 1;
            }
            if (closedAssets.has(tokenId)) return 0;
            closedAssets.add(tokenId);
            return container.orderLedger.markPositionClosedByAsset({
              billing_account_id: account.id,
              token_id: tokenId,
              reason: "refresh_no_position",
              closed_at: new Date(),
            });
          }
        );
        ledgerRowsUpdated += exposureUpdateCounts.reduce<number>(
          (sum, count) => sum + count,
          0
        );
      }

      await container.orderLedger.markSynced([...syncedIds]);
    } catch (err) {
      warnings.push({
        code: "ledger_refresh_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
    }

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
        ledger_rows_read: ledgerRowsRead,
        ledger_rows_updated: ledgerRowsUpdated,
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
