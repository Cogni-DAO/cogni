// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/ledger/public`
 * Purpose: Re-exports from @cogni/attribution-ledger so app code uses @/core/ledger unchanged.
 * Scope: Re-exports only. Does not define any logic.
 * Invariants: Only exports stable public interfaces and functions.
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md, packages/ledger-core/
 * @public
 */

// Store port re-exports
export type {
  AttributionAllocation,
  AttributionEpoch,
  AttributionPoolComponent,
  AttributionSelection,
  AttributionStatement,
  AttributionStatementSignature,
  AttributionStore,
  EpochStatus,
  FinalizedAllocation,
  IngestionCursor,
  IngestionReceipt,
  InsertAllocationParams,
  InsertPoolComponentParams,
  InsertReceiptParams,
  InsertSignatureParams,
  InsertStatementParams,
  StatementLineItem,
  UpsertSelectionParams,
} from "@cogni/attribution-ledger";
export {
  AllocationNotFoundError,
  computeAllocationSetHash,
  computeStatementItems,
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
} from "@cogni/attribution-ledger";
