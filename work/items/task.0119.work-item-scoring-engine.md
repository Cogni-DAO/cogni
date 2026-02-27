---
id: task.0119
type: task
title: "Work-item based scoring engine — link events to planned work, score on outcomes not volume"
status: needs_design
priority: 1
rank: 1
estimate: 3
summary: "Replace event-count scoring with work-item-budget scoring. Parse PR bodies for work-item references (task.XXXX, bug.XXXX). Snapshot work-item metadata (priority, estimate) at epoch close. New `work-item-budget-v0` algorithm allocates per-work-item budgets to contributors. Unlinked events fall back to weight-sum-v0 at reduced rate."
outcome: "Scoring rewards completed planned work (estimate × priority) rather than raw event volume. Activity events linked to work items via parsed references. Work-item metadata snapshotted per epoch for reproducibility. weight-sum-v0 unchanged for backward compatibility."
spec_refs: epoch-ledger-spec
assignees:
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-27
updated: 2026-02-27
labels: [governance, ledger, allocation, scoring, p1]
external_refs:
---

# Work-Item Based Scoring Engine

## Problem

`weight-sum-v0` scores on **event volume**: each `pr_merged` = 1000, each `review_submitted` = 500, each `issue_closed` = 300. This is gameable and arbitrary:

1. **Rewards surface area, not outcomes.** 10 trivial PRs score 10× a complex critical bugfix.
2. **No link to planned work.** A PR closing a P0 security task scores the same as a P3 typo fix.
3. **Incentivizes event-spray.** Split work into many small PRs to maximize event count.
4. **No budget cap per deliverable.** Scoring is unbounded per-event, not bounded per-outcome.

The review is right: shift "value" from raw events to completed work items.

## Design Principles

1. **Ingestion stays 99% stable.** `SourceAdapter`, `ActivityEvent`, `collect()` flow — untouched. Only metadata enrichment (add PR body field) to enable downstream linking.
2. **Scoring engines iterate independently.** New `work-item-budget-v0` sits alongside `weight-sum-v0` via existing `allocationAlgoRef` dispatch. Old epochs unaffected.
3. **Ledger stays immutable and cumulative.** Work-item metadata snapshotted at epoch close, hashed, pinned — same pattern as weight config. Old epochs never re-scored.
4. **Painstakingly simple.** Work-item IDs are strings. Linking is regex. Metadata comes from existing `.md` frontmatter. Budget is `estimate × priority_multiplier`. No AI, no ML, no classifiers.
5. **Pluggable.** Scoring is a pure function interface. cogni-git-review, AI advisory scores, KPI multipliers all layer on top without changing the framework.

## Architecture

### Layer Separation

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: INGESTION (99% frozen)                                 │
│                                                                 │
│ SourceAdapter.collect() → ActivityEvent[]                       │
│ GitHub adapter: pr_merged, review_submitted, issue_closed       │
│ Change: add PR body to metadata (one GraphQL field)             │
└─────────────────────┬───────────────────────────────────────────┘
                      │ events (append-only)
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2: ENRICHMENT (new — post-ingestion, pre-scoring)         │
│                                                                 │
│ linkEventsToWorkItems()  — parse PR body/title for task.XXXX    │
│ snapshotWorkItemMeta()   — fetch .md, parse frontmatter, store  │
│                                                                 │
│ Tables: work_item_links, work_item_snapshots                    │
└─────────────────────┬───────────────────────────────────────────┘
                      │ enriched events + metadata
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3: SCORING (pluggable — pure functions)                   │
│                                                                 │
│ weight-sum-v0        — unchanged, backward compatible           │
│ work-item-budget-v0  — NEW: budget per work item, distribute    │
│                                                                 │
│ Dispatch: computeProposedAllocations(algoRef, ...)              │
└─────────────────────┬───────────────────────────────────────────┘
                      │ ProposedAllocation[]
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 4: LEDGER (immutable — unchanged)                         │
│                                                                 │
│ epoch_allocations → payout_statements → signatures              │
│ Admin override preserved. Deterministic. Reproducible.          │
└─────────────────────────────────────────────────────────────────┘
```

### Schema Additions

Two new tables. No changes to existing tables.

```sql
-- Links activity events to work items (many-to-many).
-- An event can reference multiple work items (PR closes task.0102 + bug.0092).
-- A work item can be referenced by multiple events (PR + reviews + issue).
CREATE TABLE work_item_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id     UUID NOT NULL,
  scope_id    UUID NOT NULL,
  event_id    TEXT NOT NULL,           -- FK to activity_events.id
  work_item_id TEXT NOT NULL,          -- "task.0102", "bug.0092"
  link_source TEXT NOT NULL,           -- "pr_body_parse", "pr_title_parse", "manual"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(node_id, scope_id, event_id, work_item_id)
);

-- Snapshot of work-item metadata at epoch close.
-- Source of truth is the .md file; this is the pinned copy for reproducibility.
-- Snapshotted when epoch transitions open → review (alongside weight_config_hash).
CREATE TABLE work_item_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id        UUID NOT NULL,
  epoch_id       BIGINT NOT NULL REFERENCES epochs(id),
  work_item_id   TEXT NOT NULL,        -- "task.0102"
  priority       SMALLINT NOT NULL,    -- 0-3 from frontmatter
  estimate       SMALLINT NOT NULL,    -- 0-5 from frontmatter
  status         TEXT NOT NULL,        -- "done", "needs_implement", etc.
  labels         JSONB,                -- from frontmatter
  source_path    TEXT NOT NULL,        -- "work/items/task.0102.allocation-computation-epoch-close.md"
  snapshot_hash  TEXT NOT NULL,        -- SHA-256 of canonical metadata
  snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(node_id, epoch_id, work_item_id)
);
```

**Invariants:**
- `WORK_ITEM_LINKS_IDEMPOTENT`: ON CONFLICT DO NOTHING (safe to re-parse).
- `SNAPSHOT_PINNED_AT_REVIEW`: Snapshots taken once at `closeIngestion`, never updated.
- `SNAPSHOT_HASH_REPRODUCIBLE`: SHA-256 of canonical JSON of `{ work_item_id, priority, estimate, status, labels }`.

### Work-Item Linking

**Activity: `linkEventsToWorkItems()`** — runs after `curateAndResolve`, before `computeAllocations`.

```
For each unlinked activity_event in epoch window:
  1. Extract text to search:
     - metadata.title (PR title)
     - metadata.body  (PR body — new field from adapter)
  2. Regex parse: /\b(task|bug|spike|story|subtask)\.(\d{4})\b/gi
  3. For each match:
     INSERT INTO work_item_links (node_id, scope_id, event_id, work_item_id, link_source)
     VALUES (..., 'task.0102', 'pr_body_parse')
     ON CONFLICT DO NOTHING
```

**What changes in the GitHub adapter (minimal):**
- Add `body` field to the merged-PRs GraphQL query
- Store in `metadata.body` on the `ActivityEvent`
- Does NOT change event ID, payloadHash, or any other field
- Reviews and issues: no body needed (they link via the parent PR)

**Linking reviews to work items:**
- Reviews are already linked to a PR via `metadata.prNumber`
- The linking activity finds the parent PR's work-item links and copies them to the review event
- This means: reviewing a PR that closes `task.0102` earns credit toward `task.0102`

### Work-Item Metadata Snapshot

**Activity: `snapshotWorkItemMeta()`** — runs during `autoCloseIngestion` (open → review transition).

```
1. Collect all distinct work_item_ids from work_item_links for this epoch
2. For each work_item_id:
   a. Resolve file path: scan work/items/{type}.{num}.*.md
   b. Fetch file contents via GitHub API (contents endpoint)
   c. Parse YAML frontmatter: extract priority, estimate, status, labels
   d. Compute snapshot_hash = SHA-256(canonicalJson({ work_item_id, priority, estimate, status, labels }))
   e. INSERT INTO work_item_snapshots ... ON CONFLICT DO NOTHING
3. If a work_item_id has no .md file: log warning, skip (orphan reference)
```

**Why GitHub API and not filesystem?**
- Scheduler-worker runs in a container without repo filesystem access
- GitHub API gives us the file at a specific commit (pinnable)
- Same auth path as the existing adapter (VcsTokenProvider)

### Scoring Algorithm: `work-item-budget-v0`

**Pure function. No I/O. Deterministic. All BigInt.**

```
Input:
  - events: CuratedEventForAllocation[]       (existing type, with work_item links joined)
  - weightConfig: Record<string, number>       (existing, for within-item distribution)
  - workItemMeta: WorkItemSnapshot[]           (new, from snapshot table)
  - budgetConfig: WorkItemBudgetConfig         (new, from epoch config)

WorkItemBudgetConfig:
  base_unit_milli: number                      // Base budget unit in milli-credits (default: 1000)
  priority_multipliers: Record<number, number> // { 0: 500, 1: 1000, 2: 1500, 3: 2000 }
  unlinked_fraction_milli: number              // Weight for unlinked events (default: 250 = 0.25×)

Algorithm:
  1. Partition events into linked (have work_item_links) and unlinked
  2. For each work item:
     a. budget = estimate × priority_multiplier[priority] × base_unit
     b. Collect all linked events for this work item
     c. Compute per-contributor weights within the work item
        using event-type weights from weightConfig (same as weight-sum-v0)
     d. Distribute budget proportionally among contributors by their within-item weight
  3. For unlinked events:
     a. Apply weight-sum-v0 logic
     b. Multiply result by unlinked_fraction (0.25× default)
     c. This penalizes unlinked work without zeroing it
  4. Sum per-contributor totals across all work items + unlinked pool
  5. Return sorted by userId (deterministic)
```

**Why this works:**
- **Caps event spam**: 10 trivial PRs against one low-priority task still get that task's budget, not 10× the reward
- **Rewards priority**: P1 tasks with estimate=3 yield 3× more budget than P3 tasks with estimate=1
- **Preserves within-item granularity**: Merging the PR gets more than reviewing it (event-type weights still apply within a work item)
- **Graceful degradation**: Unlinked events still earn credit (at 25%), so the system works even with partial adoption
- **Deterministic**: Same inputs → byte-identical output. All BigInt. Sorted output.

**Example:**

```
Work item: task.0102 (priority=1, estimate=3)
  priority_multiplier[1] = 1000
  budget = 3 × 1000 × 1000 = 3,000,000 milli-credits

  Events:
    Alice: pr_merged (weight 1000) + review_submitted (weight 500) = 1500
    Bob:   review_submitted (weight 500)                          = 500
    Total within-item weight = 2000

  Distribution:
    Alice: 3,000,000 × 1500/2000 = 2,250,000
    Bob:   3,000,000 × 500/2000  = 750,000

Unlinked events (no work item reference):
    Carol: pr_merged (weight 1000), unlinked
    Carol gets: 1000 × 250/1000 = 250 (unlinked_fraction = 0.25)
```

### Configuration in repo-spec.yaml

Extend `activity_ledger` with scoring engine config:

```yaml
activity_ledger:
  epoch_length_days: 7
  approvers: [...]
  pool_config:
    base_issuance_credits: "10000"
  activity_sources:
    github:
      credit_estimate_algo: cogni-v0.1       # NEW: triggers work-item-budget-v0
      source_refs: ["cogni-dao/cogni-template"]
      streams: ["pull_requests", "reviews", "issues"]
  # NEW: work-item budget scoring config
  scoring:
    work_item_budget:
      base_unit_milli: 1000
      priority_multipliers:
        0: 500    # P0 = 0.5× base
        1: 1000   # P1 = 1.0× base (default)
        2: 1500   # P2 = 1.5× base
        3: 2000   # P3 = 2.0× base
      unlinked_fraction_milli: 250  # unlinked events get 0.25× weight
```

`credit_estimate_algo: cogni-v0.1` → `deriveAllocationAlgoRef("cogni-v0.1")` → `"work-item-budget-v0"`.

Existing deployments with `cogni-v0.0` continue using `weight-sum-v0` unchanged.

### Workflow Integration

Changes to `CollectEpochWorkflow` (minimal):

```
existing: ensureEpoch → collect → insertEvents → curateAndResolve → computeAllocations → ensurePool → autoClose

new:      ensureEpoch → collect → insertEvents → curateAndResolve
          → linkEventsToWorkItems (NEW)                              ← parse + store links
          → computeAllocations (extended: passes work-item context)  ← uses budget algo if configured
          → ensurePool → autoClose
          → snapshotWorkItemMeta (NEW, runs inside autoClose)        ← pin metadata at review
```

### Relationship to cogni-git-review

`cogni-git-review` is **not a blocker** for this task. The work-item linking and budget scoring work entirely from PR metadata + existing `.md` files.

However, cogni-git-review integration is a **natural follow-up** (separate task) for:

1. **Enforcement**: GitHub check that fails PRs without work-item references
2. **AI advisory scoring**: Bounded discrete outputs (complexity 1-5, impact 1-5, quality 1-5) stored as event metadata
3. **Capped multipliers**: AI scores applied as 0.8-1.25× multiplier on work-item budgets, with model ID + prompt hash + output pinned per epoch

This is designed but out of scope for this task.

### Relationship to task.0105

`task.0105` (allocation algorithm expansion) overlaps in the algo dispatch area. This task supersedes the scoring-related parts of task.0105. Weight derivation from repo-spec (task.0105's main goal) is complementary and can land independently.

## Files

### New
- `packages/db-schema/src/ledger-work-items.ts` — Drizzle schema for work_item_links + work_item_snapshots
- `packages/ledger-core/src/work-item-budget.ts` — `workItemBudgetV0()` pure scoring function
- `packages/ledger-core/src/work-item-types.ts` — `WorkItemSnapshot`, `WorkItemBudgetConfig`, `WorkItemLink` types
- Migration file for new tables

### Modified
- `packages/ledger-core/src/allocation.ts` — add `work-item-budget-v0` case to dispatch + extended params
- `packages/ledger-core/src/index.ts` — export new types and functions
- `packages/ledger-core/src/store.ts` — add work-item store methods to port interface
- `services/scheduler-worker/src/activities/ledger.ts` — `linkEventsToWorkItems()`, `snapshotWorkItemMeta()` activities
- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — wire new activities
- `services/scheduler-worker/src/adapters/ingestion/github.ts` — add `body` to PR GraphQL query metadata
- `.cogni/repo-spec.yaml` — add `scoring.work_item_budget` config section
- `src/shared/config/repoSpec.schema.ts` — scoring config Zod schema

### Tests
- `packages/ledger-core/tests/work-item-budget.test.ts` — pure algorithm tests
- `services/scheduler-worker/tests/link-events-to-work-items.test.ts` — parsing + linking tests
- Existing allocation tests unmodified (weight-sum-v0 unchanged)

## Plan

- [ ] Step 1: Schema — add `work_item_links` + `work_item_snapshots` tables (Drizzle + migration)
- [ ] Step 2: Types — `WorkItemSnapshot`, `WorkItemBudgetConfig`, `WorkItemLink` in ledger-core
- [ ] Step 3: Linking — `linkEventsToWorkItems()` activity (regex parse + insert)
- [ ] Step 4: GitHub adapter — add `body` field to PR GraphQL query
- [ ] Step 5: Scoring — `workItemBudgetV0()` pure function + dispatch case
- [ ] Step 6: Snapshot — `snapshotWorkItemMeta()` activity (fetch .md via GitHub API)
- [ ] Step 7: Workflow — wire new activities into CollectEpochWorkflow
- [ ] Step 8: Config — scoring section in repo-spec schema
- [ ] Step 9: Tests — algorithm purity, linking regex, config validation
- [ ] Step 10: pnpm check + pnpm test

## Validation

```bash
pnpm check
pnpm test
```

**Expected:** All existing tests pass. New tests cover:
- `workItemBudgetV0()` determinism, BigInt math, edge cases (no links, all unlinked, single contributor)
- Work-item reference parsing (various formats, edge cases, no false positives)
- Snapshot hash reproducibility
- Backward compatibility: `cogni-v0.0` still routes to `weight-sum-v0`

## Review Checklist

- [ ] **Work Item:** `task.0119` linked in PR body
- [ ] **Spec invariants upheld:**
  - ALLOCATION_ALGO_VERSIONED: `work-item-budget-v0` registered in dispatch
  - ALL_MATH_BIGINT: no floats in budget computation
  - PAYOUT_DETERMINISTIC: same inputs → identical output
  - ACTIVITY_APPEND_ONLY: ingestion untouched except metadata addition
  - CONFIG_LOCKED_AT_REVIEW: snapshot_hash pinned at closeIngestion
- [ ] **Backward compatible:** `cogni-v0.0` / `weight-sum-v0` unchanged
- [ ] **No over-engineering:** No AI, no ML, no classifiers. Regex + BigInt + pure functions.
- [ ] **Tests:** algorithm, linking, snapshot
- [ ] **Reviewer:** assigned and approved

## Invariants (New)

| Invariant | Constraint |
|-----------|-----------|
| WORK_ITEM_LINKS_IDEMPOTENT | Re-parsing produces same links. ON CONFLICT DO NOTHING. |
| SNAPSHOT_PINNED_AT_REVIEW | Work-item metadata snapshotted once at epoch close. Never re-fetched. |
| SNAPSHOT_HASH_REPRODUCIBLE | SHA-256 of canonical JSON. Same metadata → same hash. |
| BUDGET_CAPS_EVENT_SPAM | Per-work-item budget is fixed regardless of event count within it. |
| UNLINKED_GRACEFUL_DEGRADATION | Unlinked events still score (at reduced rate), not zeroed. |
| SCORING_ENGINE_PURE | workItemBudgetV0 is deterministic, no I/O, all BigInt. |

## PR / Links

-

## Attribution

-
