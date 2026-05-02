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
    openOrders: rows.filter(isRestingOrder).length,
    lockedUsdc: roundToCents(
      rows.reduce((sum, row) => {
        if (!isRestingOrder(row)) return sum;
        if (readStr(row, "side") !== "BUY") return sum;
        return sum + rowRemainingUsdc(row);
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
    conditionId: readConditionId(row),
    asset: readStr(row, "token_id") || row.client_order_id,
    marketTitle:
      readStr(row, "title") || readStr(row, "market_id") || "Polymarket",
    eventTitle: readNullableStr(row, "event_title"),
    marketSlug:
      readNullableStr(row, "market_slug") ?? readNullableStr(row, "slug"),
    eventSlug: readNullableStr(row, "event_slug"),
    marketUrl: readMarketUrl(row),
    outcome: readStr(row, "outcome") || "UNKNOWN",
    status: "open",
    lifecycleState: null,
    openedAt: observed,
    closedAt: null,
    resolvesAt:
      readNullableStr(row, "game_start_time") ??
      readNullableStr(row, "resolves_at") ??
      readNullableStr(row, "end_date"),
    gameStartTime: readNullableStr(row, "game_start_time"),
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

export function hasPositionExposure(row: LedgerRow): boolean {
  return rowCurrentValue(row) > 0;
}

export function summarizeDailyTradeCounts(
  rows: readonly LedgerRow[]
): Array<{ day: string; n: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!isExecutedTradeRow(row)) continue;
    const day = row.observed_at.toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, n]) => ({ day, n }));
}

function readConditionId(row: LedgerRow): string {
  const explicit = readNullableStr(row, "condition_id");
  if (explicit !== null) return explicit;

  const marketId = readNullableStr(row, "market_id");
  if (marketId === null) return row.fill_id;

  const prefix = "prediction-market:polymarket:";
  return marketId.startsWith(prefix) ? marketId.slice(prefix.length) : marketId;
}

function rowCurrentValue(row: LedgerRow): number {
  if (readNullableStr(row, "closed_at") !== null) return 0;
  return rowExecutedUsdc(row);
}

function isExecutedTradeRow(row: LedgerRow): boolean {
  if (row.status === "pending" || row.status === "open") {
    return rowExecutedUsdc(row) > 0;
  }
  if (row.status === "canceled" || row.status === "error") {
    return false;
  }
  return rowExecutedUsdc(row) > 0;
}

function rowExecutedUsdc(row: LedgerRow): number {
  const filled = readNum(row, "filled_size_usdc");
  if (filled > 0) return filled;
  if (row.status === "filled" || row.status === "partial") {
    return readNum(row, "size_usdc");
  }
  return 0;
}

function rowRemainingUsdc(row: LedgerRow): number {
  return Math.max(
    0,
    readNum(row, "size_usdc") - readNum(row, "filled_size_usdc")
  );
}

function isRestingOrder(row: LedgerRow): boolean {
  return row.status === "open" || row.status === "partial";
}

function readNullableStr(row: LedgerRow, key: string): string | null {
  const value = readStr(row, key);
  return value.length > 0 ? value : null;
}

function readMarketUrl(row: LedgerRow): string | null {
  const explicit = readNullableStr(row, "market_url");
  if (explicit !== null) return explicit;
  const eventSlug = readNullableStr(row, "event_slug");
  const marketSlug =
    readNullableStr(row, "market_slug") ?? readNullableStr(row, "slug");
  if (eventSlug === null || marketSlug === null) return null;
  return `https://polymarket.com/event/${eventSlug}/${marketSlug}`;
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
