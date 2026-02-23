# ledger-core · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Last reviewed:** 2026-02-22
- **Status:** draft

## Purpose

Pure domain logic for the epoch ledger — shared between the Next.js app (`src/`) and the Temporal `scheduler-worker` service. Contains model types, payout computation (BIGINT, largest-remainder), allocation set hashing (SHA-256), port interface (`ActivityLedgerStore`), and domain error classes.

## Pointers

- [Epoch Ledger Spec](../../docs/spec/epoch-ledger.md)
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

**External deps:** none (pure TypeScript, Web Crypto only).

## Public Surface

- **Exports:**
  - `EPOCH_STATUSES` — Enum array
  - `EpochStatus`, `FinalizedAllocation`, `PayoutLineItem` — Domain types
  - `ActivityLedgerStore` — Port interface for ledger persistence
  - `LedgerEpoch`, `LedgerActivityEvent`, `LedgerCuration`, `LedgerAllocation`, `LedgerSourceCursor`, `LedgerPoolComponent`, `LedgerPayoutStatement`, `LedgerStatementSignature` — Read-side record types
  - `InsertActivityEventParams`, `UpsertCurationParams`, `InsertCurationAutoParams`, `InsertAllocationParams`, `InsertPoolComponentParams`, `InsertPayoutStatementParams`, `InsertSignatureParams` — Write-side param types
  - `UncuratedEvent` — Event + hasExistingCuration flag for delta curation processing
  - `computeEpochWindowV1()` — Pure, deterministic epoch window computation (Monday-aligned UTC). Safe in Temporal workflow code.
  - `EpochWindow`, `EpochWindowParams` — Types for epoch window computation
  - `computePayouts()` — BIGINT proportional distribution with largest-remainder rounding
  - `computeAllocationSetHash()` — SHA-256 of canonical sorted allocation data
  - `EpochNotOpenError`, `EpochAlreadyFinalizedError`, `PoolComponentMissingError` — Domain errors with type guards
  - `buildCanonicalMessage()`, `computeApproverSetHash()` — EIP-191 signing helpers (pure, zero runtime deps)
- **CLI:** none
- **Env/Config keys:** none

## Ports

- **Uses ports:** none
- **Implements ports:** none
- **Defines ports:** `ActivityLedgerStore` (implemented by `DrizzleLedgerAdapter` in `@cogni/db-client`). Includes identity resolution (`resolveIdentities`, `getUncuratedEvents`, `updateCurationUserId`, `insertCurationDoNothing`) for curation auto-population.

## Responsibilities

- This directory **does**: Define ledger domain types, port interface, compute deterministic payouts, compute allocation set hashes, define domain errors
- This directory **does not**: Perform I/O, access databases, import from `src/` or `services/`

## Usage

```bash
pnpm --filter @cogni/ledger-core typecheck
pnpm --filter @cogni/ledger-core build
```

## Standards

- Pure functions and types only — no I/O, no framework deps
- ALL_MATH_BIGINT: No floating point in credit/unit calculations
- PAYOUT_DETERMINISTIC: Same inputs → byte-for-byte identical output

## Dependencies

- **Internal:** none (standalone package)
- **External:** none

## Change Protocol

- Update this file when public exports change
- Coordinate with epoch-ledger.md spec invariants

## Notes

- `src/core/ledger/public.ts` re-exports from this package so app code uses `@/core/ledger` unchanged
- Per PACKAGES_NO_SRC_IMPORTS: This package cannot import from `src/**`
- Package isolation enables `scheduler-worker` to import domain logic without Next.js deps
