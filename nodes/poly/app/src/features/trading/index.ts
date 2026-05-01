// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/trading`
 * Purpose: Barrel for the generic Polymarket placement + order-ledger layer.
 * Scope: Re-exports only. Does not add logic.
 * Invariants: TRADING_IS_GENERIC — see AGENTS.md.
 * Side-effects: none
 * Links: ./AGENTS.md
 * @public
 */

export {
  CLOB_EXECUTOR_METRICS,
  type ClobExecutor,
  type ClobExecutorDeps,
  COPY_TRADE_EXECUTOR_METRICS,
  type CopyTradeExecutor,
  type CopyTradeExecutorDeps,
  createClobExecutor,
} from "./clob-executor";
export { createOrderLedger, type OrderLedgerDeps } from "./order-ledger";
export {
  AlreadyRestingError,
  type InsertPendingInput,
  type LedgerCancelReason,
  type LedgerRow,
  type LedgerStatus,
  type ListOpenOrPendingOptions,
  type ListRecentOptions,
  type OpenOrderRow,
  type OrderLedger,
  type RecordDecisionInput,
  type StateSnapshot,
  type SyncHealthSummary,
  type UpdateStatusInput,
} from "./order-ledger.types";
