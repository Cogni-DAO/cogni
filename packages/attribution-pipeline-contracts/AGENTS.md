# attribution-pipeline-contracts · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Last reviewed:** 2026-03-02
- **Status:** draft

## Purpose

Stable framework package for the attribution pipeline plugin architecture. Defines contracts (port interfaces), registries, dispatch logic, enricher ordering/dependency validation, and evaluation write validation. Contains **zero I/O, zero side effects, zero env reads** (FRAMEWORK_NO_IO). This package is boring and changes rarely — it is the stable interface customers depend on.

## Pointers

- [Plugin Attribution Pipeline Spec](../../docs/spec/plugin-attribution-pipeline.md)
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

**External deps:** none (pure TypeScript types and functions).

## Public Surface

- **Exports:**
  - `EnricherDescriptor` — Pure data: evaluationRef, algoRef, schemaRef
  - `EnricherAdapter` — Port interface: evaluateDraft(ctx), buildLocked(ctx)
  - `EnricherContext` — Dependency injection context for adapters
  - `EnricherEvaluationResult` — Return type from adapter methods
  - `EnricherLogger` — Minimal logger interface (Pino-compatible)
  - `EnricherAdapterRegistry` — ReadonlyMap<evaluationRef, EnricherAdapter>
  - `AllocatorDescriptor` — algoRef, requiredEvaluationRefs[], compute()
  - `AllocationContext` — events, weightConfig, evaluations map, profileConfig
  - `AllocatorRegistry` — ReadonlyMap<algoRef, AllocatorDescriptor>
  - `dispatchAllocator()` — Validate required evaluations, call compute()
  - `PipelineProfile` — pluginEnricherRefs[], allocatorRef, epochKind
  - `EnricherRef` — evaluationRef + dependsOn[]
  - `ProfileRegistry` — ReadonlyMap<profileId, PipelineProfile>
  - `resolveProfile()` — Lookup profile by credit_estimate_algo or throw
  - `validateEnricherOrder()` — Topological sort, cycle/missing-ref detection
  - `validateEvaluationWrite()` — Assert all required evaluation fields present
- **CLI:** none
- **Env/Config keys:** none

## Ports

- **Uses ports:** none
- **Implements ports:** none
- **Defines ports:** `EnricherAdapter` (implemented by built-in plugins in `@cogni/attribution-pipeline-plugins`)

## Responsibilities

- This directory **does**: Define plugin contracts, registries, dispatch logic, ordering validation, evaluation write validation
- This directory **does not**: Perform I/O, contain plugin implementations, access databases, import from `src/` or `services/`, or import from `@cogni/attribution-pipeline-plugins`

## Usage

```bash
pnpm --filter @cogni/attribution-pipeline-contracts typecheck
pnpm --filter @cogni/attribution-pipeline-contracts build
```

## Standards

- Pure types and functions only — no I/O, no framework deps (FRAMEWORK_NO_IO)
- PROFILE_IS_DATA: profiles are plain readonly objects
- ENRICHER_ORDER_EXPLICIT: dependency DAG validated at registration
- EVALUATION_WRITE_VALIDATED: all required fields checked on every write

## Dependencies

- **Internal:** `@cogni/attribution-ledger` (domain types only: AttributionStore, ProposedAllocation, SelectedReceiptForAllocation)
- **External:** none

## Change Protocol

- Update this file when public exports change
- Coordinate with plugin-attribution-pipeline.md spec invariants
- Changes here are rare — this is the stable contract package

## Notes

- Dependency direction: `attribution-pipeline-plugins → attribution-pipeline-contracts → attribution-ledger`
- Never imports from `@cogni/attribution-pipeline-plugins` (FRAMEWORK_STABLE_PLUGINS_CHURN)
