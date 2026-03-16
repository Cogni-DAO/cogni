---
id: task.0113.handoff
type: handoff
work_item_id: task.0113
status: active
created: 2026-02-27
updated: 2026-02-27
branch: feat/scoring-plugin
last_commit: 94619b25
---

# Handoff: Epoch Artifact Pipeline + Work-Item Scoring

## Context

- The transparent credit payouts system (`proj.transparent-credit-payouts`) currently scores contributors using flat event-type weights (PR=1000, review=500, issue=300 milli-units). This rewards surface area, not work outcomes.
- **task.0113** introduces a generic `epoch_artifacts` table and the first enricher (work-item-linker) that ties GitHub activity to planned work items (`.md` files in `work/items/`). Enrichers run continuously (draft artifacts for UI) and pin immutably at closeIngestion (locked artifacts for payouts).
- **task.0114** (blocked by 0113) replaces `weight-sum-v0` with `work-item-budget-v0` — each work item gets a credit budget = `estimate * priority_multiplier`, contributors split that budget by their linked event weights. Unlinked events fall back to flat weights.
- Together these establish the second plugin surface in the ledger: **Source Adapters** (what happened) → **Epoch Enrichers** (what does it mean) → **Allocation Algorithms** (who gets what).
- Design was iterated through multiple review rounds. All architectural decisions are documented in the task files and the plan file.

## Current State

- Both task files written and committed (`94619b25` on `feat/scoring-plugin`)
- P1 roadmap in `proj.transparent-credit-payouts.md` updated with task.0113 and task.0114
- **No implementation code written yet** — task files are the spec. Ready for implementation.
- The existing V0 pipeline (allocation, epoch close, finalize) is fully built and working — see P0 deliverables in the project file
- Nothing has shipped to users, so no backward compatibility is needed

## Decisions Made

- **One generic table** (`epoch_artifacts`) instead of work-item-specific tables — see task.0113 §1b
- **Draft/locked lifecycle**: `UNIQUE(epoch_id, artifact_type, status)` allows one draft + one locked row per type. Drafts power UI; locked artifacts drive payouts — see task.0113 §1b row model
- **ARTIFACT_FINAL_ATOMIC**: Locked artifact writes + `artifacts_hash` + epoch state transition in one DB transaction — see task.0113 §Store Port Changes
- **Namespaced artifact types**: `cogni.work_item_links.v0` convention — avoids cross-team collisions
- **`repoCommitSha` in payload only, NOT in `inputs_hash`**: `frontmatterHash` per work item already detects content changes. Including commit SHA would create false staleness signals — see task.0113 §Hashing Invariants
- **Missing `.md` files produce zero-budget items** (never throw) — enrichment is best-effort, allocation handles zero-budget naturally — see task.0113 §1d
- **Unit semantics**: `proposedUnits` are milli-units throughout, additive across linked and unlinked paths — see task.0114 §Unit semantics
- Full design plan: `/Users/derek/.claude/plans/golden-shimmying-spindle.md`

## Next Actions

- [ ] Implement task.0113 — start with the `/implement task.0113` skill
- [ ] After task.0113 merges, implement task.0114
- [ ] Unrelated blocker: `docs/archive/moonbags.md` is an unstaged draft file moved from `docs/spec/` to pass validators — decide whether to commit or delete it

## Risks / Gotchas

- The `check:docs` pre-commit hook validates ALL `.md` in `docs/spec/`, `docs/research/`, `docs/guides/`. Untracked drafts without frontmatter will block commits.
- Commitlint prohibits the word "final" in commit bodies (flagged as a "red flag" word). Use "locked" or "pinned" instead.
- The enricher activity needs filesystem access to the repo checkout to read work item `.md` files and run `git rev-parse HEAD`. The scheduler-worker must have the repo mounted.
- `canonicalJsonStringify()` must sort keys at every depth and serialize BigInt as string — this is a correctness-critical function. Test exhaustively.
- The `closeIngestionWithArtifacts` transaction replaces the existing `closeIngestion()` call — coordinate with existing workflow code in `collect-epoch.workflow.ts`.

## Pointers

| File / Resource                                                     | Why it matters                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| `work/items/task.0113.epoch-artifact-pipeline.md`                   | Full spec for artifact pipeline + enricher             |
| `work/items/task.0114.work-item-budget-allocation.md`               | Full spec for budget allocation algorithm              |
| `work/projects/proj.transparent-credit-payouts.md`                  | Project roadmap with P0 done list + P1 tasks           |
| `packages/ledger-core/src/allocation.ts`                            | Current allocation algorithm to replace                |
| `packages/ledger-core/src/store.ts`                                 | Store port — add artifact methods here                 |
| `packages/db-schema/src/ledger.ts`                                  | DB schema — add `epoch_artifacts` table here           |
| `services/scheduler-worker/src/adapters/ingestion/github.ts`        | GitHub adapter — extend GraphQL for body/branch/labels |
| `services/scheduler-worker/src/activities/ledger.ts`                | Activities — add `enrichEpoch` here                    |
| `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` | Workflow — wire enrichment step + correct ordering     |
| `.claude/plans/golden-shimmying-spindle.md`                         | Full design plan with all review iterations            |
