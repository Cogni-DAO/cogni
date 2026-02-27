// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-ledger`
 * Purpose: Pure domain logic for the epoch ledger — shared between app and scheduler-worker.
 * Scope: Re-exports model types, payout computation, hashing, store port, and errors. Does not contain I/O or infrastructure code.
 * Invariants: No imports from src/ or services/. Pure domain logic only.
 * Side-effects: none
 * Links: docs/spec/attribution-ledger.md
 * @public
 */

// Allocation algorithm framework (pure, deterministic)
export {
  computeProposedAllocations,
  deriveAllocationAlgoRef,
  type ProposedAllocation,
  type SelectedReceiptForAllocation,
  validateWeightConfig,
} from "./allocation";

// Evaluation envelope validation
export {
  validateEvaluationEnvelope,
  validateEvaluationRef,
} from "./artifact-envelope";

// Enricher inputs hash
export { computeEnricherInputsHash } from "./enricher-inputs";

// Enrichers (pure functions)
export {
  extractWorkItemIds,
  WORK_ITEM_LINKER_ALGO_REF,
  WORK_ITEM_LINKS_ARTIFACT_REF,
  type WorkItemLink,
  type WorkItemLinksPayload,
  type WorkItemSnapshot,
} from "./enrichers/work-item-linker";

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
  canonicalJsonStringify,
  computeAllocationSetHash,
  computeArtifactsHash,
  computeWeightConfigHash,
  sha256OfCanonicalJson,
} from "./hashing";

// Model types and enums
export type {
  AllocationAlgoRef,
  EpochStatus,
  FinalizedAllocation,
  StatementLineItem,
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
export { computeStatementItems } from "./rules";

// Signing
export {
  buildCanonicalMessage,
  type CanonicalMessageParams,
  computeApproverSetHash,
} from "./signing";

// Store port interface + types
export type {
  AttributionAllocation,
  AttributionEpoch,
  AttributionEvaluation,
  AttributionPoolComponent,
  AttributionSelection,
  AttributionStatement,
  AttributionStatementSignature,
  AttributionStore,
  CloseIngestionWithEvaluationsParams,
  IngestionCursor,
  IngestionReceipt,
  InsertAllocationParams,
  InsertPoolComponentParams,
  InsertReceiptParams,
  InsertSelectionAutoParams,
  InsertSignatureParams,
  InsertStatementParams,
  SelectedReceiptWithMetadata,
  UnselectedReceipt,
  UpsertEvaluationParams,
  UpsertSelectionParams,
} from "./store";

// Validated store wrapper
export { createValidatedAttributionStore } from "./validated-store";
