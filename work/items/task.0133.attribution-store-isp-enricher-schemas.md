---
id: task.0133
type: task
title: "Split AttributionStore via ISP + add Zod output schemas to enricher/allocator contracts"
status: done
priority: 1
rank: 10
estimate: 3
summary: "Apply Interface Segregation Principle to the AttributionStore port, narrow enricher context to scoped read/write views, and add descriptor-owned Zod output schemas to enricher and allocator contracts so runtime plugin I/O is validated."
outcome: "AttributionStore composes narrow sub-interfaces. EnricherContext depends on EvaluationStore & SelectionReader. Enricher and allocator descriptors declare Zod output schemas. Evaluation writes and allocator dispatch parse runtime outputs against descriptor schemas. The worker allocation path resolves profiles and dispatches allocators through registries."
spec_refs:
  [plugin-attribution-pipeline-spec, attribution-pipeline-overview-spec]
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: fix/workflow-zod
pr: https://github.com/Cogni-DAO/node-template/pull/513
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-03
updated: 2026-03-03
labels: [governance, attribution, architecture, refactor]
external_refs:
---

# Split AttributionStore via ISP + Add Zod Output Schemas to Enricher/Allocator Contracts

## Context

The `AttributionStore` port (`packages/attribution-ledger/src/store.ts`, 617 lines, 46 methods) is a god interface. Every enricher, allocator, activity, and API route depends on the entire surface area even though each consumer uses only 3-5 methods. This makes:

1. **Iteration slow** — adding a new enricher requires understanding the full store, not just the slice it needs
2. **Testing heavy** — mocking requires stubbing 46 methods for a test that touches 3
3. **AI enrichers impossible to scope** — a LangGraph-backed enricher graph should receive a narrow typed context, not the full store

Separately, enricher/allocator `payloadJson` is `Record<string, unknown>` — a black box. When multiple enrichers feed an allocator, there's no way to validate that enricher A's output matches what allocator B expects. Zod schemas on step I/O close this gap and also enable future AI enrichers to know exactly what shape they must produce (LangGraph `Annotation.Root()` + Zod schemas for structured LLM output).

## Requirements

### Part 1: Interface Segregation (backward-compatible)

- [x] Define narrow sub-interfaces in `store.ts`, grouped by domain:

  | Interface              | Methods                                                                                                                                                                                                                                                       | Consumers                                 |
  | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
  | `EpochReader`          | `getEpoch`, `getOpenEpoch`, `getEpochByWindow`, `listEpochs`                                                                                                                                                                                                  | Workflows, API routes                     |
  | `EpochWriter`          | `createEpoch`, `closeIngestion`, `closeIngestionWithEvaluations`, `finalizeEpoch`, `finalizeEpochAtomic`                                                                                                                                                      | Ledger activities only                    |
  | `ReceiptStore`         | `insertIngestionReceipts`, `getReceiptsForWindow`                                                                                                                                                                                                             | Ingestion activity                        |
  | `SelectionStore`       | `upsertSelection`, `insertSelectionDoNothing`, `getSelectionForEpoch`, `getUnresolvedSelection`, `getSelectedReceiptsForAllocation`, `getSelectedReceiptsWithMetadata`, `getSelectedReceiptsForAttribution`, `updateSelectionUserId`, `getUnselectedReceipts` | Enrichers, allocation, selection activity |
  | `EvaluationStore`      | `upsertDraftEvaluation`, `getEvaluationsForEpoch`, `getEvaluation`                                                                                                                                                                                            | Enrichers                                 |
  | `ProjectionStore`      | `insertUserProjections`, `upsertUserProjections`, `deleteStaleUserProjections`, `getUserProjectionsForEpoch`                                                                                                                                                  | Allocation activity                       |
  | `ClaimantStore`        | `upsertDraftClaimants`, `lockClaimantsForEpoch`, `loadLockedClaimants`                                                                                                                                                                                        | Claimant resolution, finalization         |
  | `CursorStore`          | `upsertCursor`, `getCursor`                                                                                                                                                                                                                                   | Ingestion activity                        |
  | `PoolStore`            | `insertPoolComponent`, `getPoolComponentsForEpoch`                                                                                                                                                                                                            | Pool activity, finalization               |
  | `StatementStore`       | `insertEpochStatement`, `getStatementForEpoch`, `insertStatementSignature`, `getSignaturesForStatement`                                                                                                                                                       | Finalization, API routes                  |
  | `OverrideStore`        | `upsertReviewSubjectOverride`, `batchUpsertReviewSubjectOverrides`, `deleteReviewSubjectOverride`, `getReviewSubjectOverridesForEpoch`                                                                                                                        | Review API, finalization                  |
  | `FinalAllocationStore` | `replaceFinalClaimantAllocations`, `getFinalClaimantAllocationsForEpoch`                                                                                                                                                                                      | Finalization                              |
  | `IdentityResolver`     | `resolveIdentities`, `getUserDisplayNames`                                                                                                                                                                                                                    | Selection materialization                 |

- [x] `AttributionStore` becomes `AttributionStore extends EpochReader, EpochWriter, ReceiptStore, SelectionStore, EvaluationStore, ProjectionStore, ClaimantStore, CursorStore, PoolStore, StatementStore, OverrideStore, FinalAllocationStore, IdentityResolver` — **zero breaking changes**, existing code continues to work
- [x] `DrizzleAttributionAdapter` implementation is unchanged — it already implements `AttributionStore` which now extends the sub-interfaces
- [x] Export all sub-interfaces from `@cogni/attribution-ledger`

### Part 2: Narrow EnricherContext and AllocationContext

- [x] Change `EnricherContext.attributionStore` from `AttributionStore` to `EvaluationStore & SelectionReader`
- [x] Change `AllocationContext` to not carry the full store (it already doesn't — it takes data, not a store reference). Verify and document.
- [x] Update `EnricherAdapter` JSDoc to clarify: enrichers receive a scoped store view, not the full store

### Part 3: Zod output schemas on enricher/allocator descriptors

- [x] Add `outputSchema: z.ZodType` field to `EnricherDescriptor` in `packages/attribution-pipeline-contracts/src/enricher.ts`
- [x] Add `outputSchema: z.ZodType` field to `AllocatorDescriptor` in `packages/attribution-pipeline-contracts/src/allocator.ts`
- [x] Echo enricher (`plugins/echo/descriptor.ts`): define and export `EchoPayloadSchema` (Zod) matching the shape produced by `buildEchoPayload()`
- [x] Weight-sum allocator (`plugins/weight-sum/descriptor.ts`): define and export `WeightSumOutputSchema` (Zod) matching `ReceiptUnitWeight[]`
- [x] `validateEvaluationWrite()` in `validation.ts`: parse `payloadJson` against the descriptor `outputSchema` before write and throw on mismatch
- [x] `dispatchAllocator()`: after `compute()`, validate output against `outputSchema` and throw on mismatch

### Part 4: Design note for LangGraph-backed AI enrichers

- [x] Add a `## AI Enricher Pattern` section to the `plugin-attribution-pipeline` spec documenting how a LangGraph-backed enricher fits the existing architecture:
  - An AI enricher implements `EnricherAdapter` (same interface as pure enrichers)
  - Its `evaluateDraft()` calls `GraphExecutorPort.runGraph()` with a dedicated graph
  - The graph uses `Annotation.Root()` for typed state (receipts + prior evaluations as input)
  - The graph's output node produces data matching the enricher's `outputSchema` (Zod)
  - The enricher adapter extracts the structured output and returns `EnricherEvaluationResult`
  - Billing, streaming, observability come free via existing `GraphExecutorPort` infrastructure
  - The outer Temporal workflow is unchanged — it calls the enricher activity, which happens to run a LangGraph graph internally

## Allowed Changes

- `packages/attribution-ledger/src/store.ts` — sub-interface definitions, `AttributionStore` extends clause
- `packages/attribution-pipeline-contracts/src/enricher.ts` — `outputSchema` field on descriptor
- `packages/attribution-pipeline-contracts/src/allocator.ts` — `outputSchema` field on descriptor
- `packages/attribution-pipeline-contracts/src/validation.ts` — optional schema validation
- `packages/attribution-pipeline-plugins/src/plugins/echo/descriptor.ts` — Zod schema
- `packages/attribution-pipeline-plugins/src/plugins/weight-sum/descriptor.ts` — Zod schema
- `packages/attribution-pipeline-plugins/src/registry.ts` — if registry creation needs updating
- `docs/spec/plugin-attribution-pipeline.md` — AI enricher pattern section
- Test files for above packages

### NOT in scope

- Refactoring `DrizzleAttributionAdapter` into separate classes (it stays as one class implementing the composed interface)
- Refactoring activity files to use narrow interfaces (follow-up — activities can adopt narrower types incrementally)
- Implementing an actual AI enricher (separate task/spike)
- Changing the Temporal workflow structure
- Adding Zod to the store port itself (store types stay as TypeScript interfaces)

## Plan

- [x] Define sub-interfaces in `store.ts`, make `AttributionStore` extend all of them
- [x] Export sub-interfaces from `@cogni/attribution-ledger` barrel
- [x] Narrow `EnricherContext.attributionStore` type in contracts package to `EvaluationStore & SelectionReader`
- [x] Update echo enricher adapter to use the scoped store view
- [x] Add `outputSchema` to `EnricherDescriptor` and `AllocatorDescriptor`
- [x] Define `EchoPayloadSchema` in echo descriptor, `WeightSumOutputSchema` in weight-sum descriptor
- [x] Add schema validation to `validateEvaluationWrite()` and `dispatchAllocator()`
- [x] Add `## AI Enricher Pattern` design note to plugin-attribution-pipeline spec
- [x] Add unit tests for sub-interface type narrowing (compile-time check: enricher context accepts scoped store)
- [x] Add unit tests for Zod schema validation in evaluation write and allocator dispatch paths
- [x] Run full test suite and verify zero regressions

## Validation

**Commands:**

```bash
# Unit tests for contracts + plugins packages
pnpm --filter @cogni/attribution-pipeline-contracts test
pnpm --filter @cogni/attribution-pipeline-plugins test

# Integration tests for the adapter (must still implement full interface)
pnpm --filter @cogni/db-client test

# Ledger activities (enrichment, allocation)
pnpm --filter scheduler-worker test

# Type check — the critical gate for ISP refactor
pnpm typecheck

# Full check
pnpm check
```

**Expected:** All tests pass. `pnpm typecheck` confirms `DrizzleAttributionAdapter implements AttributionStore` still holds. Enricher context compiles with the narrowed type.

## Review Checklist

- [ ] **Work Item:** `task.0133` linked in PR body
- [x] **Spec:** PLUGIN_NO_LEDGER_CORE_LEAK upheld (sub-interfaces defined in ledger, not contracts)
- [x] **Spec:** EVALUATION_WRITE_VALIDATED still enforced (schema validation is additive)
- [x] **Spec:** ENRICHER_ORDER_EXPLICIT unchanged (ordering.ts untouched)
- [x] **Tests:** new unit tests for sub-interface narrowing + Zod schema validation
- [x] **Backward compat:** `AttributionStore` is a strict superset of all sub-interfaces (no consumer breaks)
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
