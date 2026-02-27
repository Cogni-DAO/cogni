// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/ledger-store`
 * Purpose: Re-exports EpochLedgerStore port and related types from @cogni/ledger-core.
 * Scope: Type re-exports only. Does not contain implementations.
 * Invariants: Named exports only, no runtime coupling.
 * Side-effects: none
 * Links: packages/ledger-core/src/store.ts, docs/spec/epoch-ledger.md
 * @public
 */

export type {
  EpochLedgerStore,
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
  UpsertSelectionParams,
} from "@cogni/ledger-core";
