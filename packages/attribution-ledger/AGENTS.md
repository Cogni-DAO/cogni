# attribution-ledger · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Last reviewed:** 2026-02-27
- **Status:** draft

## Purpose

Pure domain logic for the attribution ledger — shared between the Next.js app (`src/`) and the Temporal `scheduler-worker` service. Contains model types, statement item computation (BIGINT, largest-remainder), hashing (allocation sets, weight configs, artifacts), versioned allocation algorithm framework, pool estimation, artifact envelope validation, enricher inputs hashing, validated store wrapper, port interface (`AttributionStore`), and domain error classes.

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
  - `AttributionEpoch`, `IngestionReceipt`, `AttributionAllocation`, `IngestionCursor`, `AttributionPoolComponent`, `AttributionStatement`, `AttributionStatementSignature` — Read-side record types
  - `InsertReceiptParams`, `InsertAllocationParams`, `InsertPoolComponentParams`, `InsertStatementParams`, `InsertSignatureParams` — Write-side param types
  - `UncuratedEvent` — Event + hasExistingCuration flag for delta curation processing
  - `computeEpochWindowV1()` — Pure, deterministic epoch window computation (Monday-aligned UTC). Safe in Temporal workflow code.
  - `EpochWindow`, `EpochWindowParams` — Types for epoch window computation
  - `computeStatementItems()` — BIGINT proportional distribution with largest-remainder rounding
  - `computeAllocationSetHash()` — SHA-256 of canonical sorted allocation data
  - `computeWeightConfigHash()` — SHA-256 of canonical weight config JSON (key-sorted)
  - `computeProposedAllocations()` — Versioned allocation dispatch (V0: `weight-sum-v0`)
  - `validateWeightConfig()` — Rejects floats, NaN, Infinity, unsafe integers
  - `deriveAllocationAlgoRef()` — Maps `credit_estimate_algo` to internal algorithm ref
  - `CuratedEventForAllocation`, `ProposedAllocation` — Allocation input/output types
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
  - `extractWorkItemIds()` — Regex extraction of work-item IDs from event metadata
  - `WORK_ITEM_LINKS_ARTIFACT_REF`, `WORK_ITEM_LINKER_ALGO_REF` — Namespaced constants for work-item-linker enricher
  - `UpsertArtifactParams`, `CuratedEventWithMetadata`, `AttributionEpochArtifact`, `CloseIngestionWithArtifactsParams` — Artifact-related types
- **CLI:** none
- **Env/Config keys:** none

## Ports

- **Uses ports:** none
- **Implements ports:** none
- **Defines ports:** `AttributionStore` (implemented by `DrizzleAttributionAdapter` in `@cogni/db-client`). Includes identity resolution (`resolveIdentities`, `getUncuratedEvents`, `updateCurationUserId`, `insertCurationDoNothing`), allocation computation (`getCuratedEventsForAllocation`, `upsertAllocations`, `deleteStaleAllocations`), artifact lifecycle (`upsertDraftArtifact`, `closeIngestionWithArtifacts`, `getArtifactsForEpoch`, `getArtifact`, `getCuratedEventsWithMetadata`), and atomic finalization (`finalizeEpochAtomic`).

## Responsibilities

- This directory **does**: Define ledger domain types, port interface, compute deterministic statement items, compute allocation set/config/artifact hashes, versioned allocation algorithm dispatch, pool estimation, artifact envelope validation, enricher inputs hashing, validated store wrapper, define domain errors
- This directory **does not**: Perform I/O, access databases, import from `src/` or `services/`

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
