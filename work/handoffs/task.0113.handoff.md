---
id: task.0113.handoff
type: handoff
work_item_id: task.0113
status: active
created: 2026-02-27
updated: 2026-02-27
branch: feat/scoring-plugin
last_commit: 71be222b
---

# Handoff: Epoch Artifact Pipeline — Checkpoints 4 & 5

## Context

- **task.0113** builds a generic artifact pipeline for the epoch ledger. Source adapters collect events; enrichers produce typed artifacts; allocation algorithms consume them.
- Checkpoints 1-3 shipped earlier: `epoch_artifacts` table, store port methods, drizzle adapter, canonical JSON hashing, work-item-linker pure functions.
- This session implemented **Checkpoints 4 & 5**: envelope validation, pipeline wiring, echo enricher (`cogni.echo.v0`), and tests.
- The echo enricher is a trivial plumbing proof (event counts by type/user). The real work-item-linker enricher (reading `.md` files, snapshotting frontmatter) is future work.
- **task.0114** (blocked by 0113) replaces the flat `weight-sum-v0` allocation algorithm with `work-item-budget-v0`.

## Current State

- All implementation code is **unstaged/uncommitted** on `feat/scoring-plugin` (21 files changed/new)
- `pnpm check` passes (lint, type, format, docs, arch)
- `pnpm test` passes (151 files, 1216 tests, 0 failures)
- Pre-work rename: `artifactType` → `artifactRef` across all code, schema, and migration
- 3 new modules in `packages/attribution-ledger/src/`: `artifact-envelope.ts`, `enricher-inputs.ts`, `validated-store.ts`
- New enrichment activity module: `services/scheduler-worker/src/activities/enrichment.ts`
- Workflow wired: enrichEpochDraft after curation, buildFinalArtifacts before autoClose
- `autoCloseIngestion` now always uses `closeIngestionWithArtifacts` (artifacts required)
- Container wraps drizzle adapter with `createValidatedAttributionStore` for envelope validation
- 2 new test files: `artifact-envelope.test.ts` (14 tests), `enrichment-activities.test.ts` (7 tests)
- Work item status still says `needs_implement` — needs update to `needs_closeout`
- **Not done**: GitHub adapter enhancement (body/branch/labels in metadata), work-item-linker enricher activity (filesystem reads), component/stack tests

## Decisions Made

- **`artifactType` → `artifactRef`**: Renamed before more code depended on it. `artifactRef` = stable namespaced versioned identifier (e.g. `cogni.echo.v0`)
- **Envelope validation is metadata-only**: `validateArtifactEnvelope` checks ref pattern, hash format, non-null payload. Does NOT standardize payload shape — that's per-plugin.
- **`computeEnricherInputsHash` is extensible**: Base shape (epochId + sorted events) is frozen. Enrichers add via `extensions` param (canonicalJsonStringify sorts keys).
- **ValidatedLedgerStore wraps at bootstrap**: Thin proxy ensures all artifact writes pass validation regardless of which code calls the store.
- **Echo enricher (`cogni.echo.v0`)**: Trivial aggregation (totalEvents, byEventType, byUserId) as pipeline proof. `enrichEpochDraft` writes draft; `buildFinalArtifacts` returns data without writing.
- **`autoCloseIngestion` always requires artifacts**: Removed the old `closeIngestion()` path entirely — artifacts are mandatory for epoch close.

## Next Actions

- [ ] Commit the 21 changed/new files
- [ ] Update `work/items/task.0113.epoch-artifact-pipeline.md` status to `needs_closeout`
- [ ] Run `/closeout task.0113` to finalize — update scope checkboxes, file headers, AGENTS.md
- [ ] Decide on remaining task.0113 scope items (GitHub adapter body/branch/labels, work-item-linker activity with filesystem reads) — these may be deferred to a follow-up task
- [ ] Implement task.0114 (work-item-budget allocation algorithm)
- [ ] Add component tests for artifact CRUD + unique constraints + draft/locked lifecycle
- [ ] Add stack test: collect → enrich → close → verify artifacts pinned

## Risks / Gotchas

- The migration file (`0016_quick_thunderbolts.sql`) was rewritten in-place (column `artifact_type` → `artifact_ref`, index renamed). This is safe because the branch hasn't been deployed, but must not be applied on top of any DB that already ran the old migration.
- `autoCloseIngestion` now requires `artifacts` and `artifactsHash` in its input — any external callers of this activity must be updated.
- The work-item-linker enricher (reading `.md` files from filesystem) is NOT wired yet. The echo enricher is a placeholder proving the pipeline works.
- Commitlint prohibits the word "final" in commit bodies — use "locked" or "pinned" instead.
- `canonicalJsonStringify()` is correctness-critical for all hashing — its tests are in `packages/attribution-ledger/tests/hashing.test.ts`.

## Pointers

| File / Resource                                                     | Why it matters                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/attribution-ledger/src/artifact-envelope.ts`              | NEW — `validateArtifactRef` + `validateArtifactEnvelope`    |
| `packages/attribution-ledger/src/enricher-inputs.ts`                | NEW — `computeEnricherInputsHash` with extensions           |
| `packages/attribution-ledger/src/validated-store.ts`                | NEW — `createValidatedAttributionStore` wrapper             |
| `services/scheduler-worker/src/activities/enrichment.ts`            | NEW — echo enricher activities                              |
| `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` | MODIFIED — enrichment wired at steps 6 and 9                |
| `services/scheduler-worker/src/activities/ledger.ts`                | MODIFIED — `AutoCloseIngestionInput` now requires artifacts |
| `services/scheduler-worker/src/bootstrap/container.ts`              | MODIFIED — wraps store with validated wrapper               |
| `work/items/task.0113.epoch-artifact-pipeline.md`                   | Full spec for artifact pipeline                             |
| `work/items/task.0114.work-item-budget-allocation.md`               | Next task: budget allocation algorithm                      |
