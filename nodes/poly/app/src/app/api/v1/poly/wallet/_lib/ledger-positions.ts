// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/_lib/ledger-positions`
 * Purpose: Map `poly_copy_trade_fills` rows into dashboard position summaries.
 * Scope: Route-local read-model helpers. No CLOB/Data-API calls; the order
 *   reconciler is responsible for keeping `synced_at` fresh.
 * Invariants:
 *   - CLOB_NOT_ON_PAGE_LOAD: dashboard live positions come from DB only.
 *   - SYNC_METADATA_AVAILABLE: every row exposes sync metadata for diagnostics;
 *     UI decides how much of that state should be foregrounded.
 * Side-effects: none
 * Links: bug.5001, work/items/task.0328.poly-sync-truth-ledger-cache.md
 * @internal
 */

import type { WalletExecutionPosition } from "@cogni/poly-node-contracts";
import type { LedgerRow } from "@/features/trading";

const POSITION_STALE_MS = 5 * 60_000;

export interface LedgerPositionSummary {
  openOrders: number;
  lockedUsdc: number;
  positionsMtm: number;
  syncedAt: string | null;
  syncAgeMs: number | null;
  stale: boolean;
}

export function summarizeLedgerPositions(
  rows: readonly LedgerRow[],
  capturedAt: Date
): LedgerPositionSummary {
  const capturedMs = capturedAt.getTime();
  const syncedTimes = rows
    .map((row) => row.synced_at?.getTime() ?? null)
    .filter((time): time is number => time !== null);
  const latestSyncedMs =
    syncedTimes.length > 0 ? Math.max(...syncedTimes) : null;
  const syncAgeMs =
    latestSyncedMs !== null ? Math.max(0, capturedMs - latestSyncedMs) : null;

  return {
    openOrders: rows.filter((row) => row.status === "open").length,
    lockedUsdc: roundToCents(
      rows.reduce((sum, row) => {
        if (row.status !== "open") return sum;
        if (readStr(row, "side") !== "BUY") return sum;
        return sum + readNum(row, "size_usdc");
      }, 0)
    ),
    positionsMtm: roundToCents(
      rows.reduce((sum, row) => sum + rowCurrentValue(row), 0)
    ),
    syncedAt:
      latestSyncedMs !== null ? new Date(latestSyncedMs).toISOString() : null,
    syncAgeMs,
    stale:
      rows.length > 0 &&
      rows.some((row) => {
        if (row.synced_at === null) return true;
        return capturedMs - row.synced_at.getTime() > POSITION_STALE_MS;
      }),
  };
}

export function toWalletExecutionPosition(
  row: LedgerRow,
  capturedAt: Date
): WalletExecutionPosition {
  const observed = row.observed_at.toISOString();
  const captured = capturedAt.toISOString();
  const price = readNum(row, "limit_price");
  const currentValue = rowCurrentValue(row);
  const size =
    price > 0 ? Number((currentValue / price).toFixed(4)) : currentValue;
  const syncAgeMs =
    row.synced_at !== null
      ? Math.max(0, capturedAt.getTime() - row.synced_at.getTime())
      : null;

  return {
    positionId: row.order_id ?? row.client_order_id,
    conditionId: readStr(row, "market_id") || row.fill_id,
    asset: readStr(row, "token_id") || row.client_order_id,
    marketTitle:
      readStr(row, "title") || readStr(row, "market_id") || "Polymarket",
    marketSlug: null,
    eventSlug: null,
    marketUrl: null,
    outcome: readStr(row, "outcome") || "UNKNOWN",
    status: "open",
    lifecycleState: null,
    openedAt: observed,
    closedAt: null,
    resolvesAt: null,
    heldMinutes: Math.max(
      0,
      Math.floor((capturedAt.getTime() - row.observed_at.getTime()) / 60_000)
    ),
    entryPrice: price,
    currentPrice: price,
    size,
    currentValue,
    pnlUsd: 0,
    pnlPct: 0,
    syncedAt: row.synced_at?.toISOString() ?? null,
    syncAgeMs,
    syncStale:
      row.synced_at === null ||
      capturedAt.getTime() - row.synced_at.getTime() > POSITION_STALE_MS,
    timeline: [
      { ts: observed, price, size },
      { ts: captured, price, size },
    ],
    events: [{ ts: observed, kind: "entry", price, shares: size }],
  };
}

export function summarizeDailyTradeCounts(
  rows: readonly LedgerRow[]
): Array<{ day: string; n: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const day = row.observed_at.toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, n]) => ({ day, n }));
}

function rowCurrentValue(row: LedgerRow): number {
  const filled = readNum(row, "filled_size_usdc");
  if (filled > 0) return filled;
  return readNum(row, "size_usdc");
}

function readStr(row: LedgerRow, key: string): string {
  const value = row.attributes?.[key];
  return typeof value === "string" ? value : "";
}

function readNum(row: LedgerRow, key: string): number {
  const value = row.attributes?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}
