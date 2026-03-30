---
id: task.0124
type: task
title: "Scaffold @cogni/attribution-pipeline (framework) + @cogni/attribution-pipeline-plugins (built-ins)"
status: done
priority: 1
rank: 1
estimate: 3
summary: "Create two new packages: @cogni/attribution-pipeline (stable framework — contracts, registries, dispatch, ordering/dep validation) and @cogni/attribution-pipeline-plugins (built-in enricher/allocator implementations + profiles). Extract echo, claimant-shares, and weight-sum from current inline code into plugin descriptors + adapters. Does NOT refactor the executor (scheduler-worker) — that is a follow-up task."
outcome: "Two packages exist, build, and pass tests. Framework exports EnricherAdapter, EnricherDescriptor, AllocatorDescriptor, PipelineProfile, resolveProfile(), dispatchAllocator(), and ordering validation. Plugins package exports echo, claimant-shares, and weight-sum plugin implementations plus the cogni-v0.0 profile. Existing scheduler-worker code is unchanged — executor refactor is a separate task."
spec_refs: plugin-attribution-pipeline-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: task/0124-attribution-pipeline-packages
pr: https://github.com/Cogni-DAO/node-template/pull/506
reviewer:
revision: 0
blocked_by: [task.0113]
deploy_verified: false
created: 2026-03-02
updated: 2026-03-24
labels: [governance, attribution, plugins, architecture]
external_refs:
---

# Scaffold @cogni/attribution-pipeline + @cogni/attribution-pipeline-plugins

## Requirements

- **Two separate packages** with correct dependency direction: `attribution-pipeline-plugins → attribution-pipeline → attribution-ledger`. Neither pipeline package may be imported by `attribution-ledger` (PLUGIN_NO_LEDGER_CORE_LEAK).
- **Framework package (`packages/attribution-pipeline/`)** contains only types, pure functions, and validation logic — zero I/O, zero side effects, zero env reads (FRAMEWORK_NO_IO).
  - `EnricherDescriptor` interface with `evaluationRef`, `algoRef`, `schemaRef`
  - `EnricherAdapter` port interface with `evaluateDraft(ctx)` and `buildLocked(ctx)`
  - `EnricherContext` type (epochId, nodeId, attributionStore, logger, profileConfig)
  - `AllocatorDescriptor` interface with `algoRef`, `requiredEvaluationRefs[]`, `compute(ctx)`
  - `AllocationContext` type (events, weightConfig, evaluations map, profileConfig)
  - `PipelineProfile` type with `enricherRefs: EnricherRef[]` (including `dependsOn[]`), `allocatorRef`, `epochKind`, `configSchema`
  - `ProfileRegistry`, `EnricherAdapterRegistry`, `AllocatorRegistry` as `ReadonlyMap` types
  - `resolveProfile()` — lookup or throw
  - `dispatchAllocator()` — validate required evaluations, call `compute()`
  - `validateEnricherOrder()` — topological sort, cycle detection, missing ref detection (ENRICHER_ORDER_EXPLICIT)
  - `validateEvaluationWrite()` — assert evaluationRef, algoRef, inputsHash, schemaRef, payloadHash all present (EVALUATION_WRITE_VALIDATED)
- **Plugins package (`packages/attribution-pipeline-plugins/`)** contains built-in implementations.
  - `plugins/echo/descriptor.ts` — `ECHO_EVALUATION_REF`, `ECHO_ALGO_REF`, `ECHO_SCHEMA_REF`, `buildEchoPayload()` (extracted from `enrichment.ts`)
  - `plugins/echo/adapter.ts` — `EnricherAdapter` impl that reads receipts from store, calls `buildEchoPayload()`, computes hashes
  - `plugins/claimant-shares/descriptor.ts` — re-exports `CLAIMANT_SHARES_EVALUATION_REF`, `CLAIMANT_SHARES_ALGO_REF` from ledger, defines `CLAIMANT_SHARES_SCHEMA_REF`
  - `plugins/claimant-shares/adapter.ts` — `EnricherAdapter` impl that reads attribution receipts, calls `buildDefaultReceiptClaimantSharesPayload()`, computes hashes
  - `plugins/weight-sum/descriptor.ts` — `AllocatorDescriptor` wrapping existing `computeProposedAllocations("weight-sum-v0", ...)` from attribution-ledger
  - `profiles/cogni-v0.0.ts` — profile selecting echo + claimant-shares enrichers and weight-sum-v0 allocator (PROFILE_IS_DATA)
  - `registry.ts` — `createDefaultRegistries()` returning `{profiles, enrichers, allocators}` maps
- **All profiles are plain readonly data** — no classes, no methods, no I/O (PROFILE_IS_DATA).
- **Profiles are semver'd and never mutated** (PROFILE_IMMUTABLE_PUBLISH_NEW).
- **Packages build** via `pnpm packages:build` with no errors.
- **`pnpm check` passes** — types, lint, format all clean.
- **Unit tests** cover: `resolveProfile()`, `dispatchAllocator()`, `validateEnricherOrder()` (cycle detection, missing refs, valid DAG), `validateEvaluationWrite()`, echo adapter (mocked store), weight-sum descriptor delegation.

## Allowed Changes

- `packages/attribution-pipeline/` — **NEW** entire package
- `packages/attribution-pipeline-plugins/` — **NEW** entire package
- `package.json` (root) — workspace references
- `tsconfig.json` (root) — composite project references if needed
- `pnpm-workspace.yaml` — if packages glob doesn't already cover `packages/*`

**Do NOT modify:**

- `packages/attribution-ledger/` — no changes (existing code stays, plugins delegate to it)
- `services/scheduler-worker/` — executor refactor is a follow-up task
- `packages/db-client/` — no schema changes in this task

## Plan

### Phase 1: Framework package (`packages/attribution-pipeline/`)

- [ ] Create `packages/attribution-pipeline/` with `package.json` (`@cogni/attribution-pipeline`), `tsconfig.json` (composite, refs `@cogni/attribution-ledger`), `tsup.config.ts`, `AGENTS.md`
- [ ] Implement `src/enricher.ts` — `EnricherDescriptor`, `EnricherAdapter`, `EnricherContext`, `UpsertEvaluationParams` (re-export or compatible type)
- [ ] Implement `src/allocator.ts` — `AllocatorDescriptor`, `AllocationContext`, `AllocatorRegistry`, `dispatchAllocator()`
- [ ] Implement `src/profile.ts` — `PipelineProfile`, `EnricherRef`, `ProfileRegistry`, `resolveProfile()`
- [ ] Implement `src/ordering.ts` — `validateEnricherOrder()` with topological sort, cycle detection, missing ref detection
- [ ] Implement `src/validation.ts` — `validateEvaluationWrite()` asserting all required fields present
- [ ] Create `src/index.ts` barrel exporting all public types and functions
- [ ] Write unit tests: `tests/profile.test.ts`, `tests/ordering.test.ts`, `tests/validation.test.ts`, `tests/allocator.test.ts`
- [ ] Verify: `pnpm packages:build` succeeds, `pnpm check` passes

### Phase 2: Plugins package (`packages/attribution-pipeline-plugins/`)

- [ ] Create `packages/attribution-pipeline-plugins/` with `package.json` (`@cogni/attribution-pipeline-plugins`), `tsconfig.json` (composite, refs `@cogni/attribution-pipeline`), `tsup.config.ts`, `AGENTS.md`
- [ ] Implement `src/plugins/echo/descriptor.ts` — extract `ECHO_EVALUATION_REF`, `ECHO_ALGO_REF`, `buildEchoPayload()` from `enrichment.ts` (copy, not move — enrichment.ts stays unchanged)
- [ ] Implement `src/plugins/echo/adapter.ts` — `EnricherAdapter` impl using `EnricherContext`
- [ ] Implement `src/plugins/claimant-shares/descriptor.ts` — re-export ledger constants, add `CLAIMANT_SHARES_SCHEMA_REF`
- [ ] Implement `src/plugins/claimant-shares/adapter.ts` — `EnricherAdapter` impl using `EnricherContext`
- [ ] Implement `src/plugins/weight-sum/descriptor.ts` — `AllocatorDescriptor` wrapping `computeProposedAllocations()`
- [ ] Implement `src/profiles/cogni-v0.0.ts` — plain readonly profile object
- [ ] Implement `src/registry.ts` — `createDefaultRegistries()`
- [ ] Create `src/index.ts` barrel
- [ ] Write unit tests: `tests/plugins/echo/adapter.test.ts` (mocked store), `tests/plugins/weight-sum/descriptor.test.ts`, `tests/profiles/cogni-v0.0.test.ts`
- [ ] Verify: `pnpm packages:build` succeeds, `pnpm check` passes

## Validation

**Commands:**

```bash
pnpm packages:build
pnpm check
pnpm test packages/attribution-pipeline/
pnpm test packages/attribution-pipeline-plugins/
```

**Expected:**

- Both packages build with no errors
- `pnpm check` (lint + types + format) passes
- All unit tests pass
- `attribution-ledger` has zero imports from either pipeline package (verify with `grep -r "attribution-pipeline" packages/attribution-ledger/`)

## Review Checklist

- [ ] **Work Item:** `task.0124` linked in PR body
- [ ] **Spec:** all invariants from plugin-attribution-pipeline-spec are upheld (FRAMEWORK_NO_IO, PROFILE_IS_DATA, ENRICHER_ORDER_EXPLICIT, EVALUATION_WRITE_VALIDATED, PLUGIN_NO_LEDGER_CORE_LEAK, FRAMEWORK_STABLE_PLUGINS_CHURN)
- [ ] **Tests:** framework dispatch, ordering validation, evaluation write validation, echo adapter, weight-sum delegation all covered
- [ ] **No executor changes:** `services/scheduler-worker/` is untouched
- [ ] **No ledger changes:** `packages/attribution-ledger/` is untouched
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Spec: [plugin-attribution-pipeline](../../docs/spec/plugin-attribution-pipeline.md)
- Parent: [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md)
- Predecessor: task.0113 (epoch artifact pipeline)

## Attribution

-
