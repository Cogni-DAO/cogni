// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ledger-core`
 * Purpose: Pure domain logic for the epoch ledger — shared between app and scheduler-worker.
 * Scope: Re-exports model types, payout computation, hashing, store port, and errors. Does not contain I/O or infrastructure code.
 * Invariants: No imports from src/ or services/. Pure domain logic only.
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

// Allocation algorithm framework (pure, deterministic)
export {
  type CuratedEventForAllocation,
  computeProposedAllocations,
  deriveAllocationAlgoRef,
  type ProposedAllocation,
  validateWeightConfig,
} from "./allocation";

// Epoch window computation (pure, deterministic — safe in Temporal workflow code)
export {
  computeEpochWindowV1,
  type EpochWindow,
  type EpochWindowParams,
} from "./epoch-window";

// Errors
export {
  AllocationNotFoundError,
  EpochAlreadyFinalizedError,
  EpochNotFoundError,
  EpochNotOpenError,
  isAllocationNotFoundError,
  isEpochAlreadyFinalizedError,
  isEpochNotFoundError,
  isEpochNotOpenError,
  isPoolComponentMissingError,
  PoolComponentMissingError,
} from "./errors";

// Hashing
export {
  computeAllocationSetHash,
  computeWeightConfigHash,
} from "./hashing";

// Model types and enums
export type {
  AllocationAlgoRef,
  EpochStatus,
  FinalizedAllocation,
  PayoutLineItem,
} from "./model";
export { EPOCH_STATUSES } from "./model";

// Pool estimation (pure, deterministic)
export {
  estimatePoolComponentsV0,
  POOL_COMPONENT_ALLOWLIST,
  type PoolComponentEstimate,
  type PoolComponentId,
  validatePoolComponentId,
} from "./pool";

// Rules
export { computePayouts } from "./rules";

// Signing
export {
  buildCanonicalMessage,
  type CanonicalMessageParams,
  computeApproverSetHash,
} from "./signing";

// Store port interface + types
export type {
  ActivityLedgerStore,
  InsertActivityEventParams,
  InsertAllocationParams,
  InsertCurationAutoParams,
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
  UncuratedEvent,
  UpsertCurationParams,
} from "./store";
