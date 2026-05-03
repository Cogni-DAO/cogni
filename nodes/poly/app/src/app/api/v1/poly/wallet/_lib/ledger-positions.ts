// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/_lib/ledger-positions`
 * Purpose: Map `poly_copy_trade_fills` rows into dashboard position summaries.
 * Scope: Route-local read-model helpers. No CLOB/Data-API calls; the order
 *   reconciler is responsible for keeping `synced_at` fresh.
 * Invariants:
 *   - CLOB_NOT_ON_PAGE_LOAD: dashboard live positions come from DB only.
 *   - SYNC_METADATA_AVAILABLE: every row exposes sync freshness fields.
 * Side-effects: none
 * Links: bug.5001, task.5006, work/items/task.0328.poly-sync-truth-ledger-cache.md
 * @internal
 */

import {
  WALLET_EXECUTION_TERMINAL_LIFECYCLE_STATES,
  type WalletExecutionLifecycleState,
  type WalletExecutionPosition,
  type WalletExecutionPositionStatus,
} from "@cogni/poly-node-contracts";
import {
  isLedgerRestingOrder,
  type LedgerRow,
  ledgerCurrentValue,
  ledgerExecutedUsdc,
  ledgerHasPositionExposure,
  ledgerRemainingUsdc,
  readLedgerNullableString,
  readLedgerNumber,
  readLedgerPositionLifecycle,
  readLedgerString,
  shouldCountLedgerTrade,
} from "@/features/trading";

const POSITION_STALE_MS = 5 * 60_000;
const TRADE_COUNT_WINDOW_DAYS = 14;
export const DASHBOARD_LEDGER_POSITION_STATUSES = [
  "pending",
  "open",
  "filled",
  "partial",
  "canceled",
  "error",
] as const;
export const DASHBOARD_LEDGER_POSITION_LIMIT = 2_000;

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
    openOrders: rows.filter(isLedgerRestingOrder).length,
    lockedUsdc: roundToCents(
      rows.reduce((sum, row) => {
        if (!isLedgerRestingOrder(row)) return sum;
        if (readLedgerString(row, "side") !== "BUY") return sum;
        return sum + ledgerRemainingUsdc(row);
      }, 0)
    ),
    positionsMtm: roundToCents(
      rows.reduce((sum, row) => sum + ledgerCurrentValue(row), 0)
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
  const price = readLedgerNumber(row, "limit_price");
  const lifecycleState = readLedgerPositionLifecycle(
    row
  ) as WalletExecutionLifecycleState | null;
  const status = deriveExecutionStatus(row, lifecycleState);
  const closedAt = readLedgerNullableString(row, "closed_at");
  const executedValue = ledgerExecutedUsdc(row);
  const currentValue = status === "closed" ? 0 : ledgerCurrentValue(row);
  const costBasis = readLedgerCostBasis(row, executedValue);
  const pnlUsd =
    status === "closed" ? 0 : roundToCents(currentValue - costBasis);
  const pnlPct =
    status === "closed" || costBasis <= 0
      ? 0
      : roundToCents((pnlUsd / costBasis) * 100);
  const size =
    price > 0 ? Number((executedValue / price).toFixed(4)) : executedValue;
  const syncAgeMs =
    row.synced_at !== null
      ? Math.max(0, capturedAt.getTime() - row.synced_at.getTime())
      : null;
  const terminalTs = status === "closed" ? (closedAt ?? captured) : null;
  const heldUntilMs =
    terminalTs !== null ? new Date(terminalTs).getTime() : capturedAt.getTime();
  const terminalEvent =
    status === "redeemable"
      ? [{ ts: captured, kind: "redeemable" as const, price, shares: size }]
      : terminalTs !== null
        ? [{ ts: terminalTs, kind: "close" as const, price, shares: size }]
        : [];

  return {
    positionId: row.order_id ?? row.client_order_id,
    conditionId: getLedgerRowConditionId(row),
    asset: readLedgerString(row, "token_id") || row.client_order_id,
    marketTitle:
      readLedgerString(row, "title") ||
      readLedgerString(row, "market_id") ||
      "Polymarket",
    eventTitle: readLedgerNullableString(row, "event_title"),
    marketSlug:
      readLedgerNullableString(row, "market_slug") ??
      readLedgerNullableString(row, "slug"),
    eventSlug: readLedgerNullableString(row, "event_slug"),
    marketUrl: readMarketUrl(row),
    outcome: readLedgerString(row, "outcome") || "UNKNOWN",
    status,
    lifecycleState,
    openedAt: observed,
    closedAt: terminalTs,
    resolvesAt:
      readLedgerIso(row, "resolves_at") ?? readLedgerIso(row, "end_date"),
    gameStartTime: readLedgerNullableString(row, "game_start_time"),
    heldMinutes: Math.max(
      0,
      Math.floor((heldUntilMs - row.observed_at.getTime()) / 60_000)
    ),
    entryPrice: price,
    currentPrice: price,
    size,
    currentValue,
    pnlUsd,
    pnlPct,
    syncedAt: row.synced_at?.toISOString() ?? null,
    syncAgeMs,
    syncStale:
      row.synced_at === null ||
      capturedAt.getTime() - row.synced_at.getTime() > POSITION_STALE_MS,
    timeline: [],
    events: [
      { ts: observed, kind: "entry", price, shares: size },
      ...terminalEvent,
    ],
  };
}

export function hasPositionExposure(row: LedgerRow): boolean {
  return ledgerHasPositionExposure(row);
}

function readLedgerCostBasis(row: LedgerRow, executedValue: number): number {
  const intendedNotional = readLedgerNumber(row, "size_usdc");
  if (row.status === "partial" && intendedNotional > executedValue) {
    return executedValue;
  }
  if (intendedNotional > 0) return intendedNotional;
  return executedValue;
}

export function summarizeDailyTradeCounts(
  rows: readonly LedgerRow[],
  capturedAt: Date
): Array<{ day: string; n: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!shouldCountLedgerTrade(row)) continue;
    const day = row.observed_at.toISOString().slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return buildUtcDayWindow(capturedAt, TRADE_COUNT_WINDOW_DAYS).map((day) => ({
    day,
    n: counts.get(day) ?? 0,
  }));
}

function buildUtcDayWindow(capturedAt: Date, windowDays: number): string[] {
  const days: string[] = [];
  const cursor = new Date(
    Date.UTC(
      capturedAt.getUTCFullYear(),
      capturedAt.getUTCMonth(),
      capturedAt.getUTCDate()
    )
  );
  cursor.setUTCDate(cursor.getUTCDate() - (windowDays - 1));
  for (let i = 0; i < windowDays; i++) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function getLedgerRowConditionId(row: LedgerRow): string {
  const explicit = readLedgerNullableString(row, "condition_id");
  if (explicit !== null) return explicit;

  const marketId = readLedgerNullableString(row, "market_id");
  if (marketId === null) return row.fill_id;

  const prefix = "prediction-market:polymarket:";
  return marketId.startsWith(prefix) ? marketId.slice(prefix.length) : marketId;
}

function deriveExecutionStatus(
  _row: LedgerRow,
  lifecycleState: WalletExecutionLifecycleState | null
): WalletExecutionPositionStatus {
  if (
    lifecycleState !== null &&
    WALLET_EXECUTION_TERMINAL_LIFECYCLE_STATES.has(lifecycleState)
  ) {
    return "closed";
  }
  if (lifecycleState === "winner") return "redeemable";
  return "open";
}

function readMarketUrl(row: LedgerRow): string | null {
  const explicit = readLedgerNullableString(row, "market_url");
  if (explicit !== null) return explicit;
  const eventSlug = readLedgerNullableString(row, "event_slug");
  const marketSlug =
    readLedgerNullableString(row, "market_slug") ??
    readLedgerNullableString(row, "slug");
  if (eventSlug === null || marketSlug === null) return null;
  return `https://polymarket.com/event/${eventSlug}/${marketSlug}`;
}

function readLedgerIso(row: LedgerRow, key: string): string | null {
  const raw = readLedgerNullableString(row, key);
  if (raw === null) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}
