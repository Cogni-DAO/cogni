// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/ledger/public`
 * Purpose: Re-exports from @cogni/ledger-core so app code uses @/core/ledger unchanged.
 * Scope: Re-exports only. Does not define any logic.
 * Invariants: Only exports stable public interfaces and functions.
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md, packages/ledger-core/
 * @public
 */

// Store port re-exports
export type {
  EpochLedgerStore,
  EpochStatus,
  FinalizedAllocation,
  InsertAllocationParams,
  InsertEpochStatementParams,
  InsertIngestionReceiptParams,
  InsertPoolComponentParams,
  InsertStatementSignatureParams,
  LedgerAllocation,
  LedgerEpoch,
  LedgerEpochStatement,
  LedgerIngestionCursor,
  LedgerIngestionReceipt,
  LedgerPoolComponent,
  LedgerSelection,
  LedgerStatementSignature,
  PayoutLineItem,
  UpsertSelectionParams,
} from "@cogni/ledger-core";
export {
  AllocationNotFoundError,
  computeAllocationSetHash,
  computePayouts,
  EPOCH_STATUSES,
  EpochAlreadyFinalizedError,
  EpochNotFoundError,
  EpochNotOpenError,
  isAllocationNotFoundError,
  isEpochAlreadyFinalizedError,
  isEpochNotFoundError,
  isEpochNotOpenError,
  isPoolComponentMissingError,
  PoolComponentMissingError,
} from "@cogni/ledger-core";
