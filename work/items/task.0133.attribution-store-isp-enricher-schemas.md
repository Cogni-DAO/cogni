---
id: task.0133
type: task
title: "Split AttributionStore via ISP + add Zod output schemas to enricher/allocator contracts"
status: needs_implement
priority: 1
rank: 10
estimate: 3
summary: "Apply Interface Segregation Principle to the 46-method AttributionStore god interface — define scoped sub-interfaces (EpochReader, ReceiptStore, SelectionStore, EvaluationStore, etc.) and narrow EnricherContext/AllocationContext to depend only on what they need. Add Zod output schemas to EnricherDescriptor and AllocatorDescriptor so step I/O is runtime-validated and self-documenting. This unblocks future AI enrichers (LangGraph-backed) that need clear typed contracts to produce valid output."
outcome: "AttributionStore composed from narrow sub-interfaces. EnricherContext depends on EvaluationStore & SelectionStore (not the full store). Enricher descriptors declare outputSchema (Zod). Echo enricher and weight-sum allocator export Zod schemas for their payloads. Existing tests pass without behavioral changes."
spec_refs:
  [plugin-attribution-pipeline-spec, attribution-pipeline-overview-spec]
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
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

- [ ] Define narrow sub-interfaces in `store.ts`, grouped by domain:

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

- [ ] `AttributionStore` becomes `AttributionStore extends EpochReader, EpochWriter, ReceiptStore, SelectionStore, EvaluationStore, ProjectionStore, ClaimantStore, CursorStore, PoolStore, StatementStore, OverrideStore, FinalAllocationStore, IdentityResolver` — **zero breaking changes**, existing code continues to work
- [ ] `DrizzleAttributionAdapter` implementation is unchanged — it already implements `AttributionStore` which now extends the sub-interfaces
- [ ] Export all sub-interfaces from `@cogni/attribution-ledger`

### Part 2: Narrow EnricherContext and AllocationContext

- [ ] Change `EnricherContext.attributionStore` from `AttributionStore` to `EvaluationStore & SelectionStore` (the only methods echo enricher actually calls)
- [ ] Change `AllocationContext` to not carry the full store (it already doesn't — it takes data, not a store reference). Verify and document.
- [ ] Update `EnricherAdapter` JSDoc to clarify: enrichers receive a scoped store view, not the full store

### Part 3: Zod output schemas on enricher/allocator descriptors

- [ ] Add `outputSchema: z.ZodType` field to `EnricherDescriptor` in `packages/attribution-pipeline-contracts/src/enricher.ts`
- [ ] Add `outputSchema: z.ZodType` field to `AllocatorDescriptor` in `packages/attribution-pipeline-contracts/src/allocator.ts`
- [ ] Echo enricher (`plugins/echo/descriptor.ts`): define and export `EchoPayloadSchema` (Zod) matching the shape produced by `buildEchoPayload()`
- [ ] Weight-sum allocator (`plugins/weight-sum/descriptor.ts`): define and export `WeightSumOutputSchema` (Zod) matching `ReceiptUnitWeight[]`
- [ ] `validateEvaluationWrite()` in `validation.ts`: add optional schema validation — if the enricher declares an `outputSchema`, parse `payloadJson` against it before write. Log a warning on mismatch (don't throw in V0 — avoid breaking existing pipelines during rollout)
- [ ] `dispatchAllocator()`: after `compute()`, validate output against `outputSchema` if declared (same warn-not-throw policy)

### Part 4: Design note for LangGraph-backed AI enrichers

- [ ] Add a `## AI Enricher Pattern` section to the `plugin-attribution-pipeline` spec documenting how a LangGraph-backed enricher fits the existing architecture:
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

- [ ] Define sub-interfaces in `store.ts`, make `AttributionStore` extend all of them
- [ ] Export sub-interfaces from `@cogni/attribution-ledger` barrel
- [ ] Narrow `EnricherContext.attributionStore` type in contracts package to `EvaluationStore & SelectionStore`
- [ ] Update echo enricher adapter if needed (should be source-compatible since it only uses evaluation + selection methods)
- [ ] Add `outputSchema` to `EnricherDescriptor` and `AllocatorDescriptor` (optional field)
- [ ] Define `EchoPayloadSchema` in echo descriptor, `WeightSumOutputSchema` in weight-sum descriptor
- [ ] Add optional schema validation to `validateEvaluationWrite()` and `dispatchAllocator()`
- [ ] Add `## AI Enricher Pattern` design note to plugin-attribution-pipeline spec
- [ ] Add unit tests for sub-interface type narrowing (compile-time check: enricher context accepts scoped store)
- [ ] Add unit tests for Zod schema validation in evaluation write path
- [ ] Run full test suite, verify zero regressions

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
- [ ] **Spec:** PLUGIN_NO_LEDGER_CORE_LEAK upheld (sub-interfaces defined in ledger, not contracts)
- [ ] **Spec:** EVALUATION_WRITE_VALIDATED still enforced (schema validation is additive)
- [ ] **Spec:** ENRICHER_ORDER_EXPLICIT unchanged (ordering.ts untouched)
- [ ] **Tests:** new unit tests for sub-interface narrowing + Zod schema validation
- [ ] **Backward compat:** `AttributionStore` is a strict superset of all sub-interfaces (no consumer breaks)
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
