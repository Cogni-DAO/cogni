---
id: task.0141
type: task
title: "Category pool allocation — split epoch budget across source categories before per-source scoring"
status: needs_design
priority: 1
rank: 20
estimate: 3
summary: "Implement category pool splitting: repo-spec declares category shares, epoch budget splits across categories before per-source allocation runs, per-claimant credits sum across categories. Produces one signed statement per epoch (not per category)."
outcome: "Adding a new source adapter no longer dilutes existing contributors. Governance controls macro allocation (category shares) separately from micro allocation (within-category weights). Statement lines show one creditAmount per claimant summed across categories, with per-category breakdown in the statement payload for auditability."
spec_refs: tokenomics-spec, attribution-pipeline-overview-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by: [spike.0140, task.0130]
deploy_verified: false
created: 2026-03-07
updated: 2026-03-07
labels: [governance, tokenomics, attribution, multi-source]
external_refs:
---

# Category Pool Allocation

> Depends on: [spike.0140](spike.0140.multi-source-category-pool-design.md) (design), [task.0130](task.0130.tokenomics-crawl-budget-bank.md) (budget policy)
> Project: [proj.transparent-credit-payouts](../projects/proj.transparent-credit-payouts.md) (Walk P1)

## Problem

All receipts from all sources share one flat pool. Cross-source weight ratios are ungovernable — "how many Discord messages equal one merged PR?" has no good answer. Adding a new source adapter silently dilutes existing contributors' shares.

## Design

### Outcome

Epoch budget splits by governance-controlled category shares before per-source allocation runs. Within-category weights remain a domain-expert concern. Cross-category allocation is an explicit governance decision.

### Approach

**Solution**: category pool shares in repo-spec + category-aware allocation step

**Reuses**: Existing `computeReceiptWeights`, `explodeToClaimants`, `computeAttributionStatementLines`. Category split is a new step _between_ budget computation and per-receipt weighting.

**Implementation notes** (pending spike.0140 findings):

1. **repo-spec schema**: Add `category_pools` to `budget_policy` with source → category mapping and share percentages
2. **Category split step**: After `computeEpochBudget` produces `epoch_pool`, split into per-category sub-pools using category shares (BigInt, largest-remainder rounding for exact sum)
3. **Per-category allocation**: Filter receipts by category (via source), run existing `computeReceiptWeights` + `explodeToClaimants` per category with category sub-pool as `poolTotalCredits`
4. **Claimant summation**: Sum `creditAmount` across categories per claimant. A contributor active in multiple categories gets credit from each.
5. **Statement**: One statement per epoch. Statement lines show final summed `creditAmount`. Statement payload includes per-category breakdown for auditability.
6. **Empty category handling**: If a category has zero receipts, its share is unspent (not redistributed). Consistent with task.0130's no-carry-over V0 semantics. Revisit when carry-over ships.

### Invariants

- [ ] CATEGORY_SHARES_SUM_TO_POOL: `SUM(category_sub_pools) === epoch_pool` (exact, BigInt rounding)
- [ ] CATEGORY_SPLIT_DETERMINISTIC: same shares + same epoch_pool → identical sub-pools
- [ ] ONE_STATEMENT_PER_EPOCH: categories are an allocation concern, not a statement concern
- [ ] BACKWARD_COMPAT: epochs with no `category_pools` config use the entire pool as a single implicit category (existing behavior)
- [ ] ALL_MATH_BIGINT: category splits use BigInt with largest-remainder (no floats)

### Files

**New** (pending spike.0140):

- `packages/attribution-ledger/src/category-split.ts` — pure function: `splitPoolByCategory(epochPool, categoryShares) → Map<categoryId, bigint>`
- `packages/attribution-ledger/tests/category-split.test.ts` — unit tests for split math, rounding, empty categories, single-category fallback

**Modify** (pending spike.0140):

- `packages/repo-spec/src/schema.ts` — add `categoryPoolsSchema` to `budgetPolicySchema`
- `packages/repo-spec/src/accessors.ts` — add `getCategoryPools()` accessor
- `packages/attribution-ledger/src/claimant-shares.ts` — `computeAttributionStatementLines` may need category metadata in output
- `services/scheduler-worker/src/activities/ledger.ts` — category-aware allocation orchestration
- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — pass category config through
- `.cogni/repo-spec.yaml` — add `category_pools` when second source ships

### Migration Notes

- Existing single-source epochs are unaffected. No `category_pools` = single implicit category = current behavior.
- Category pools activate when repo-spec gains `category_pools` config. No migration needed for historical epochs.

## Validation

- [ ] `pnpm check` passes
- [ ] Category split unit tests: exact BigInt rounding, 2+ categories, empty category, single-category fallback
- [ ] Statement lines show correct summed creditAmount for multi-category contributors
- [ ] Statement payload includes per-category breakdown
- [ ] Backward compat: epochs without `category_pools` produce identical results to current behavior
- [ ] Adding a new source to an existing category doesn't change other categories' allocations

## Review Checklist

- [ ] **Work Item:** `task.0141` linked in PR body
- [ ] **Spec:** CATEGORY_SHARES_SUM_TO_POOL and BACKWARD_COMPAT upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
