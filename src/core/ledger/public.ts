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
  ActivityLedgerStore,
  EpochStatus,
  FinalizedAllocation,
  InsertActivityEventParams,
  InsertAllocationParams,
  InsertPayoutStatementParams,
  InsertPoolComponentParams,
  InsertSignatureParams,
  LedgerActivityEvent,
  LedgerAllocation,
  LedgerCuration,
  LedgerEpoch,
  LedgerPayoutStatement,
  LedgerPoolComponent,
  LedgerSourceCursor,
  LedgerStatementSignature,
  PayoutLineItem,
  UpsertCurationParams,
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
