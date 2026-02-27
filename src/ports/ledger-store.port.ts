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
  InsertEpochPayoutParams,
  InsertIngestionReceiptParams,
  InsertPayoutSignatureParams,
  InsertPoolComponentParams,
  LedgerAllocation,
  LedgerEpoch,
  LedgerEpochPayout,
  LedgerIngestionCursor,
  LedgerIngestionReceipt,
  LedgerPayoutSignature,
  LedgerPoolComponent,
  LedgerSelection,
  UpsertSelectionParams,
} from "@cogni/ledger-core";
