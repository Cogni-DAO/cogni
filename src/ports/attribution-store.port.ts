// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/ledger-store`
 * Purpose: Re-exports AttributionStore port and related types from @cogni/attribution-ledger.
 * Scope: Type re-exports only. Does not contain implementations.
 * Invariants: Named exports only, no runtime coupling.
 * Side-effects: none
 * Links: packages/ledger-core/src/store.ts, docs/spec/epoch-ledger.md
 * @public
 */

export type {
  AttributionAllocation,
  AttributionEpoch,
  AttributionPoolComponent,
  AttributionSelection,
  AttributionStatement,
  AttributionStatementSignature,
  AttributionStore,
  IngestionCursor,
  IngestionReceipt,
  InsertAllocationParams,
  InsertPoolComponentParams,
  InsertReceiptParams,
  InsertSignatureParams,
  InsertStatementParams,
  UpsertSelectionParams,
} from "@cogni/attribution-ledger";
