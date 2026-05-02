// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/trading/ledger-lifecycle`
 * Purpose: Pure lifecycle predicates over `poly_copy_trade_fills` rows. These
 *   helpers keep route/UI/order-ledger consumers from inventing different
 *   meanings for `status` plus JSON attributes while task.5006 promotes the
 *   durable lifecycle model into typed DB state.
 * Scope: Pure functions only. No DB, app, bootstrap, CLOB, or copy-trade imports.
 * Invariants:
 *   - POSITION_LIFECYCLE_IS_AUTHORITY: `position_lifecycle`, not JSON
 *     timestamp metadata, decides whether an asset row is terminal.
 *   - ORDER_STATUS_IS_NOT_POSITION_STATE: `status` is CLOB/order state; helper
 *     predicates compose it with typed lifecycle when answering
 *     position/resting questions.
 * Side-effects: none
 * Links: task.5006, bug.5001
 * @public
 */

import type {
  LedgerPositionLifecycle,
  LedgerRow,
  LedgerStatus,
} from "./order-ledger.types";

export const RESTING_LEDGER_STATUSES = [
  "pending",
  "open",
  "partial",
] as const satisfies readonly LedgerStatus[];

export const POSITION_LEDGER_STATUSES = [
  "open",
  "filled",
  "partial",
] as const satisfies readonly LedgerStatus[];

export const TERMINAL_LEDGER_POSITION_LIFECYCLES = [
  "closed",
  "redeemed",
  "loser",
  "dust",
  "abandoned",
] as const satisfies readonly LedgerPositionLifecycle[];

const restingStatuses = new Set<LedgerStatus>(RESTING_LEDGER_STATUSES);
const positionStatuses = new Set<LedgerStatus>(POSITION_LEDGER_STATUSES);
const terminalPositionLifecycles = new Set<LedgerPositionLifecycle>(
  TERMINAL_LEDGER_POSITION_LIFECYCLES
);
const activeOrderPositionLifecycles = new Set<LedgerPositionLifecycle>([
  "unresolved",
  "open",
  "closing",
]);

export function readLedgerString(row: LedgerRow, key: string): string {
  const value = row.attributes?.[key];
  return typeof value === "string" ? value : "";
}

export function readLedgerNullableString(
  row: LedgerRow,
  key: string
): string | null {
  const value = readLedgerString(row, key);
  return value.length > 0 ? value : null;
}

export function readLedgerNumber(row: LedgerRow, key: string): number {
  const value = row.attributes?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function isLedgerPositionClosed(row: LedgerRow): boolean {
  return (
    row.position_lifecycle !== null &&
    terminalPositionLifecycles.has(row.position_lifecycle)
  );
}

export function readLedgerPositionLifecycle(
  row: LedgerRow
): LedgerPositionLifecycle | null {
  return row.position_lifecycle;
}

export function isLedgerRestingOrder(row: LedgerRow): boolean {
  const lifecycle = readLedgerPositionLifecycle(row);
  const orderLifecycleActive =
    lifecycle === null || activeOrderPositionLifecycles.has(lifecycle);
  return orderLifecycleActive && restingStatuses.has(row.status);
}

export function isLedgerPositionStatus(row: LedgerRow): boolean {
  return positionStatuses.has(row.status);
}

export function ledgerExecutedUsdc(row: LedgerRow): number {
  const filled = readLedgerNumber(row, "filled_size_usdc");
  if (filled > 0) return filled;
  if (row.status === "filled" || row.status === "partial") {
    return readLedgerNumber(row, "size_usdc");
  }
  return 0;
}

export function ledgerCurrentValue(row: LedgerRow): number {
  if (isLedgerPositionClosed(row)) return 0;
  return ledgerExecutedUsdc(row);
}

export function ledgerRemainingUsdc(row: LedgerRow): number {
  return Math.max(
    0,
    readLedgerNumber(row, "size_usdc") -
      readLedgerNumber(row, "filled_size_usdc")
  );
}

export function ledgerHasPositionExposure(row: LedgerRow): boolean {
  return ledgerCurrentValue(row) > 0;
}

export function shouldCountLedgerTrade(row: LedgerRow): boolean {
  if (row.status === "pending" || row.status === "open") {
    return ledgerExecutedUsdc(row) > 0;
  }
  return ledgerExecutedUsdc(row) > 0;
}

export function shouldCountLedgerMarketIntent(row: LedgerRow): boolean {
  const lifecycle = readLedgerPositionLifecycle(row);
  if (lifecycle !== null && !activeOrderPositionLifecycles.has(lifecycle)) {
    return false;
  }
  if (
    row.status === "pending" ||
    row.status === "open" ||
    row.status === "filled" ||
    row.status === "partial"
  ) {
    return true;
  }
  return (
    row.status === "error" &&
    readLedgerString(row, "placement") === "market_fok"
  );
}
