---
id: task.0114
type: task
title: "Work-item budget enrichment + budget allocation algorithm"
status: needs_triage
priority: 1
rank: 2
estimate: 2
summary: "Adds budget computation to the work-item enricher (computeWorkItemBudgetMilli, priorityMultipliers) and introduces work-item-budget-v0 allocation algorithm that distributes fixed per-work-item budgets among contributors. Builds on the generic artifact pipeline from task.0113."
outcome: "Credit allocation is anchored to planned work items with capped budgets. Event-spam on a single work item splits a fixed budget, not an unbounded sum. Priority and estimate from .md frontmatter directly affect payout distribution. Unlinked events fall back to flat weights (known v0 limitation)."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 1
blocked_by: [task.0113]
deploy_verified: false
created: 2026-02-27
updated: 2026-02-27
labels: [governance, ledger, scoring, allocation]
external_refs:
---

# Work-Item Budget Enrichment + Budget Allocation Algorithm

## Problem

After task.0113, the enricher extracts work-item links and snapshots raw frontmatter, but doesn't compute budgets. The allocation algorithm (`weight-sum-v0`) still assigns flat weights per event type. Nothing ties rewards to planned work estimates or priorities.

## Design

### 2a. Enhance Work-Item Enricher with Budget Computation

**File**: `packages/ledger-core/src/enrichers/work-item-linker.ts`

Add budget computation to the existing enricher:

```typescript
computeWorkItemBudgetMilli(
  estimate: number,             // from .md frontmatter (snapshotted by task.0113)
  priority: number,             // from .md frontmatter (snapshotted by task.0113)
  multipliers: Record<number, number>  // pinned in artifact
) -> bigint
// budget = BigInt(estimate) * BigInt(multipliers[priority] ?? 0)
```

**Priority multipliers** (default policy, pinned in artifact):

```json
{ "0": 0, "1": 1000, "2": 2000, "3": 4000 }
```

**Enhanced artifact payload** (`cogni.work_item_links.v0` — extends task.0113 payload):

```json
{
  "repoCommitSha": "a1b2c3d4...",
  "priorityMultipliers": { "0": 0, "1": 1000, "2": 2000, "3": 4000 },
  "workItems": {
    "task.0102": {
      "estimate": 3, "priority": 1, "status": "done",
      "title": "Allocation computation",
      "frontmatterHash": "sha256:abc...",
      "budgetMilli": "3000"
    }
  },
  "eventLinks": { ... },
  "unlinkedEventIds": [...]
}
```

New fields vs task.0113: `priorityMultipliers` (top-level) and `budgetMilli` (per work item). Missing `.md` work items (captured with `error` field by task.0113) get `budgetMilli: "0"` — zero-budget items don't affect allocation.

**inputs_hash update**: Add `priorityMultipliers` to the enricher's inputs_hash (alongside epoch_id, event hashes, frontmatter hashes from task.0113).

### 2b. Updated Allocation Signature

**File**: `packages/ledger-core/src/allocation.ts`

```typescript
export function computeProposedAllocations(
  algoRef: string,
  events: readonly CuratedEventForAllocation[],
  weightConfig: Record<string, number>,
  artifacts?: ReadonlyMap<string, unknown> // artifact_type -> payload
): ProposedAllocation[];
```

Artifacts are an opaque map. Each algorithm picks what it needs. `weight-sum-v0` ignores artifacts entirely (backward compat). `work-item-budget-v0` reads `cogni.work_item_links.v0`.

### 2c. Algorithm: `work-item-budget-v0`

1. Parse `cogni.work_item_links.v0` artifact from `artifacts` map
2. Build lookups: `eventId -> workItemId[]`, `workItemId -> budgetMilli`
3. **Linked events** (budget > 0): for each work item, compute V0 event weights for all linked events, distribute the work item's fixed `budgetMilli` proportionally among users. Largest-remainder rounding within each work item (sum === budget exactly).
4. **Unlinked events**: apply V0 flat weights directly (fallback)
5. Sum per user, sort by userId, return `ProposedAllocation[]`

**Key property**: adding more PRs to the same work item splits a fixed budget. Event-spam is capped per work item.

**All math is BIGINT.** Deterministic: same events + same artifacts -> identical output.

**Unit semantics**: `proposedUnits` are **milli-units** — same unit as `budgetMilli` and `weightOverrideMilli`. Both linked (budget-split) and unlinked (flat-weight) paths produce milli-units, so they're additive. `computeStatementItems()` treats them as proportional weights: `payout = (userUnits / totalUnits) * poolTotalCredits`.

**Known limitation (v0)**: Unlinked events produce uncapped flat-weight sums identical to `weight-sum-v0`. If most events are unlinked, the algorithm degrades to the old behavior. Acceptable for v0 — the `unlinkedEventIds` array in the artifact enables monitoring the unlinked ratio.

### 2d. Updated `computeAllocations` Activity

**File**: `services/scheduler-worker/src/activities/ledger.ts`

- Load artifacts from `epoch_artifacts` (status='draft' for UI projections, status='final' for payouts per PAYOUT_FROM_FINAL_ONLY)
- Build `ReadonlyMap<string, unknown>` from artifact rows
- Pass to `computeProposedAllocations()` alongside events + weightConfig

### 2e. Config

- `deriveAllocationAlgoRef("cogni-v0.1")` -> `"work-item-budget-v0"`
- Update `.cogni/repo-spec.yaml`: `credit_estimate_algo: cogni-v0.1`

## Scope

- [ ] Implement `computeWorkItemBudgetMilli()` pure function in `work-item-linker.ts`
- [ ] Add `priorityMultipliers` default policy + pinning in artifact payload
- [ ] Add `budgetMilli` field to work item snapshots in artifact payload
- [ ] Add `priorityMultipliers` to enricher `inputs_hash`
- [ ] Add `work-item-budget-v0` algorithm to `allocation.ts`
- [ ] Update `computeProposedAllocations` signature to accept `artifacts` map
- [ ] Add `deriveAllocationAlgoRef("cogni-v0.1")` mapping
- [ ] Update `computeAllocations` activity to load and pass artifacts
- [ ] Update `.cogni/repo-spec.yaml` to `cogni-v0.1`
- [ ] Update workflow to pass artifacts through to allocation
- [ ] Unit tests: budget computation, determinism, budget caps, largest-remainder rounding per work item, mixed linked/unlinked, multi-user work item splits, milli-unit consistency
- [ ] Stack test: full pipeline — collect -> enrich -> allocate -> payout with budget-based scoring

## Validation

```bash
pnpm check
pnpm packages:build
pnpm test
```

- [ ] Budget per work item = estimate \* priority_multiplier (from pinned artifact)
- [ ] Sum of all user shares within one work item === work item budget exactly
- [ ] Unlinked events contribute V0 flat weights (fallback path works)
- [ ] Same inputs + same artifacts -> identical output (determinism)
- [ ] Adding more events to a work item splits budget, does not increase total
- [ ] `proposedUnits` are milli-units (same unit as `budgetMilli` and flat weights)
- [ ] Linked + unlinked contributions are additive (same unit)
- [ ] Unlinked event ratio is observable from artifact's `unlinkedEventIds`
- [ ] Missing `.md` work items (error field from task.0113) get budgetMilli: "0", don't distort allocation
- [ ] `weight-sum-v0` still works when no artifacts present (backward compat)

## PR / Links

- Handoff: [handoff](../handoffs/task.0113.handoff.md)
