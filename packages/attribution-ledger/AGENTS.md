# attribution-ledger · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Last reviewed:** 2026-03-02
- **Status:** draft

## Purpose

Pure domain logic for the attribution ledger — shared between the Next.js app (`src/`) and the Temporal `scheduler-worker` service. Contains model types, attribution statement line computation (BIGINT, largest-remainder), hashing (allocation sets, weight configs, artifacts), versioned allocation algorithm framework, pool estimation, artifact envelope validation, enricher inputs hashing, validated store wrapper, port interface (`AttributionStore`), and domain error classes.

## Pointers

- [Attribution Ledger Spec](../../docs/spec/attribution-ledger.md)
- [Packages Architecture](../../docs/spec/packages-architecture.md)

## Boundaries

```json
{
  "layer": "packages",
  "may_import": ["packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services"
  ]
}
```

**External deps:** none (pure TypeScript, Node `crypto` for SHA-256).

## Public Surface

- **Exports:**
  - `EPOCH_STATUSES` — Enum array
  - `EpochStatus`, `FinalizedAllocation`, `StatementLineItem` — Domain types
  - `AttributionStore` — Port interface for ledger persistence
  - `AttributionEpoch`, `IngestionReceipt`, `EpochUserProjection`, `FinalClaimantAllocationRecord`, `IngestionCursor`, `AttributionPoolComponent`, `AttributionStatement`, `AttributionStatementSignature`, `AttributionEvaluation`, `ReviewSubjectOverrideRecord` — Read-side record types
  - `InsertReceiptParams`, `InsertUserProjectionParams`, `InsertFinalClaimantAllocationParams`, `InsertPoolComponentParams`, `InsertStatementParams`, `InsertSignatureParams`, `UpsertReviewSubjectOverrideParams`, `UpsertEvaluationParams`, `CloseIngestionWithEvaluationsParams` — Write-side param types
  - `computeEpochWindowV1()` — Pure, deterministic epoch window computation (Monday-aligned UTC). Safe in Temporal workflow code.
  - `EpochWindow`, `EpochWindowParams` — Types for epoch window computation
  - `computeStatementItems()`, `computeAttributionStatementLines()` — BIGINT proportional distribution with largest-remainder rounding for user-only and claimant-aware statements
  - `computeAllocationSetHash()`, `computeFinalClaimantAllocationSetHash()` — SHA-256 of canonical sorted allocation data for user-only and claimant-aware finalization
  - `computeWeightConfigHash()` — SHA-256 of canonical weight config JSON (key-sorted)
  - `computeProposedAllocations()` — Versioned allocation dispatch (V0: `weight-sum-v0`)
  - `validateWeightConfig()` — Rejects floats, NaN, Infinity, unsafe integers
  - `deriveAllocationAlgoRef()` — Maps `credit_estimate_algo` to internal algorithm ref
  - `SelectedReceiptForAllocation`, `ProposedAllocation` — Allocation input/output types
  - `AllocationAlgoRef` — Type alias for algorithm version string
  - `estimatePoolComponentsV0()` — Pool component estimation from config (V0: base_issuance only)
  - `PoolComponentEstimate`, `PoolComponentId`, `POOL_COMPONENT_ALLOWLIST` — Pool types and validation
  - `validatePoolComponentId()` — V0 allowlist validation
  - `EpochNotOpenError`, `EpochAlreadyFinalizedError`, `PoolComponentMissingError` — Domain errors with type guards
  - `buildCanonicalMessage()`, `computeApproverSetHash()` — EIP-191 signing helpers (pure, zero runtime deps)
  - `computeArtifactsHash()` — SHA-256 of sorted locked artifact tuples
  - `validateArtifactRef()`, `validateArtifactEnvelope()` — Artifact metadata/hash validation (pure)
  - `computeEnricherInputsHash()` — Deterministic inputs hash for enrichers (base shape + extensions)
  - `createValidatedAttributionStore()` — Wraps `AttributionStore` with envelope validation on artifact writes
  - `buildDefaultReceiptClaimantSharesPayload()`, `parseClaimantSharesPayload()`, `expandClaimantUnits()`, `computeFinalClaimantAllocations()`, `computeAttributionStatementLines()`, `applySubjectOverrides()`, `buildReviewOverrideSnapshots()` — Canonical claimant-share helpers for multi-actor attribution and claimant-aware credit views
  - `CLAIMANT_SHARES_EVALUATION_REF`, `CLAIMANT_SHARES_ALGO_REF`, `CLAIMANT_SHARE_DENOMINATOR_PPM` — Claimant-share evaluation constants
  - `AttributionClaimant`, `ClaimantShare`, `ClaimantSharesSubject`, `ClaimantSharesPayload`, `ExpandedClaimantUnit`, `FinalClaimantAllocation`, `AttributionStatementLine`, `SelectedReceiptForAttribution`, `ReviewOverrideSnapshot`, `SubjectOverride` — Claimant-share domain types
  - `SelectedReceiptWithMetadata` — Receipt-with-metadata type for evaluation inputs
- **CLI:** none
- **Env/Config keys:** none

## Ports

- **Uses ports:** none
- **Implements ports:** none
- **Defines ports:** `AttributionStore` (implemented by `DrizzleAttributionAdapter` in `@cogni/db-client`). Includes identity resolution (`resolveIdentities`, `getUnselectedReceipts`, `updateSelectionUserId`, `insertSelectionDoNothing`), projection computation (`getSelectedReceiptsForAllocation`, `insertUserProjections`, `deleteStaleUserProjections`), canonical attribution reads (`getSelectedReceiptsForAttribution`, `getUserDisplayNames`, `getEvaluation`, `getReviewSubjectOverridesForEpoch`, `getFinalClaimantAllocationsForEpoch`), evaluation lifecycle (`upsertDraftEvaluation`, `closeIngestionWithEvaluations`, `getEvaluationsForEpoch`, `getSelectedReceiptsWithMetadata`), and atomic finalization (`finalizeEpochAtomic`).

## Responsibilities

- This directory **does**: Define ledger domain types, port interface, compute deterministic attribution statement lines, compute allocation set/config/artifact hashes, versioned allocation algorithm dispatch, pool estimation, artifact envelope validation, enricher inputs hashing, validated store wrapper, define domain errors
- This directory **does not**: Perform I/O, access databases, import from `src/` or `services/`, or ship concrete enricher plugin implementations

## Usage

```bash
pnpm --filter @cogni/attribution-ledger typecheck
pnpm --filter @cogni/attribution-ledger build
```

## Standards

- Pure functions and types only — no I/O, no framework deps
- ALL_MATH_BIGINT: No floating point in credit/unit calculations
- STATEMENT_DETERMINISTIC: Same inputs → byte-for-byte identical output

## Dependencies

- **Internal:** none (standalone package)
- **External:** none

## Change Protocol

- Update this file when public exports change
- Coordinate with attribution-ledger.md spec invariants

## Notes

- `src/core/attribution/public.ts` re-exports from this package so app code uses `@/core/attribution` unchanged
- Per PACKAGES_NO_SRC_IMPORTS: This package cannot import from `src/**`
- Package isolation enables `scheduler-worker` to import domain logic without Next.js deps
