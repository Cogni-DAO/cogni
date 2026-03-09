---
id: proj.transparent-credit-payouts
type: handoff
work_item_id: proj.transparent-credit-payouts
status: active
created: 2026-02-21
updated: 2026-03-01
branch: feat/claimant-share-ownership
last_commit: "07441340"
---

# Handoff: Attribution Pipeline Plugin Architecture

## Context

- CogniDAO needs transparent credit payouts replacing SourceCred's opaque algorithmic scoring
- The system is an **activity-to-statement pipeline**: source adapters collect contribution activity, enrichers produce typed evaluations, allocators distribute credits, an admin finalizes
- The core pipeline (ingest → select → enrich → evaluate → allocate → finalize) is **working on staging** with two enrichers (echo, claimant-shares) and one allocator (weight-sum-v0)
- A new **plugin architecture spec** was just written to support rapid iteration on new enrichers/allocators and future customer extensibility (customers bring their own pipeline config via `.cogni/attribution/`)
- A separate branch has in-progress work on a **work-item-budget-v0** allocation algorithm and LLM scoring research

## Current State

- **Plugin pipeline spec (just committed)**: [`docs/spec/plugin-attribution-pipeline.md`](../../docs/spec/plugin-attribution-pipeline.md) — draft, 12 invariants, profile-based dispatch, `EnricherAdapter` port interface, `AllocatorDescriptor`, user config via `.cogni/attribution/`. Design-reviewed and iterated in this session.
- **`feat/claimant-share-ownership` branch (current)**: Claimant-shares rename pass is done (`claims.ts` → `claimant-shares.ts`, `subjectType` enum → open `subjectKind: string`, store method renamed to `getSelectedReceiptsForAttribution()`). Work-item-linker moved from `packages/attribution-ledger/src/enrichers/` to `services/scheduler-worker/src/enrichers/` (boundary fix). New claimant ownership API routes + facade + tests. **Not yet merged to staging.**
- **Worktree at `.claude/worktrees/attribution-scoring`** (branch `claude/attribution-scoring-design-w1bzy`): Contains task.0114 work-item-budget-v0 allocation algorithm implementation + research doc on attribution scoring design. Rebased onto staging. **Has a known bug: priority multipliers are inverted** (`P0=0, P3=4000` — should be opposite). This work is pre-plugin-architecture and needs refactoring to fit the new plugin model.
- **Attribution ledger spec**: [`docs/spec/attribution-ledger.md`](../../docs/spec/attribution-ledger.md) — active, ~30 invariants, covers the full epoch lifecycle

## Decisions Made

- **Plugin package owns everything** — `packages/plugin-attribution-pipeline/` owns all contracts (port interfaces), built-in implementations (adapters), profiles, and dispatch logic. The executor (scheduler-worker) is generic — zero plugin-specific code. See `PLUGIN_PACKAGE_OWNS_ALL` and `EXECUTOR_IS_GENERIC` invariants.
- **Profiles resolve live, lock at review** — `profile_id` is stored on epoch at creation for provenance, but re-resolved at each pipeline stage. Enricher set and allocator are live during `open`, locked at `closeIngestion`. Consistent treatment — no special pinning rules. See `PROFILE_RESOLVED_NOT_HARDCODED`.
- **User-provided config** — Profiles declare a `configSchema` (Zod). Executor loads `.cogni/attribution/<profileId>.yaml`, validates, passes to plugins via `profileConfig` on `EnricherContext` and `AllocationContext`. See `CONFIG_VALIDATED_AT_CREATION`.
- **`epoch_kind` is plain TEXT** — no DB CHECK constraint. Application-validated so new kinds don't require migrations.
- **Async allocator signature** — `compute()` returns `Promise<ProposedAllocation[]>` to support future LLM-scored allocation.
- **`EnricherAdapter` is a port in the package** — not in scheduler-worker. This is the stable interface customers implement against.

## Next Actions

- [ ] Create `packages/plugin-attribution-pipeline/` package (scaffold from spec's package structure)
- [ ] Implement `EnricherAdapter` port interface, `AllocatorDescriptor`, `PipelineProfile`, `resolveProfile()`, `dispatchAllocator()`
- [ ] Extract echo enricher into plugin: descriptor + adapter from current `enrichment.ts`
- [ ] Extract claimant-shares enricher into plugin: descriptor + adapter
- [ ] Create `cogni-v0.0` profile definition
- [ ] Refactor `scheduler-worker/src/activities/enrichment.ts` to generic dispatch loop
- [ ] Refactor `scheduler-worker/src/activities/ledger.ts` to call `dispatchAllocator()`
- [ ] Add `profile_id` and `epoch_kind` columns to epochs table (migration)
- [ ] Merge `feat/claimant-share-ownership` to staging (run `pnpm check` first)
- [ ] Fix priority multiplier bug in worktree branch, then refactor task.0114 as a plugin

## Risks / Gotchas

- **Two active branches**: `feat/claimant-share-ownership` (main workspace) has the claimant-shares rename. `.claude/worktrees/attribution-scoring` has task.0114 budget algorithm. The budget work predates the plugin spec and needs refactoring to fit the new model.
- **work-item-linker boundary violation**: Currently in `services/scheduler-worker/src/enrichers/` — needs to move into the plugin package as `plugins/work-item-links/`.
- **`packages/attribution-ledger` must stay pure**: The boundary violation that caused this whole redesign was plugin-specific code leaking into `attribution-ledger`. The `PLUGIN_NO_LEDGER_CORE_LEAK` invariant prevents this — dependency direction is `plugin-pipeline → attribution-ledger`, never reverse.
- **Customer plugin loading is deferred**: The spec supports user config files, but customer-authored _code_ plugins (bring-your-own enricher implementation) require a trust/sandbox model that isn't designed yet.
- **`pnpm packages:build` required**: After modifying any package source, build before running tests.

## Pointers

| File / Resource                                          | Why it matters                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `docs/spec/plugin-attribution-pipeline.md`               | **Start here** — the plugin architecture spec with all invariants and interfaces |
| `docs/spec/attribution-ledger.md`                        | Core domain spec — epoch lifecycle, store port, evaluation invariants            |
| `packages/attribution-ledger/src/store.ts`               | `AttributionStore` port interface consumed by enricher adapters                  |
| `packages/attribution-ledger/src/allocation.ts`          | Existing `computeProposedAllocations()` — to be wrapped by allocator descriptors |
| `packages/attribution-ledger/src/claimant-shares.ts`     | Claimant-share domain types — referenced by claimant-shares plugin descriptor    |
| `services/scheduler-worker/src/activities/enrichment.ts` | Current enrichment logic — to be refactored into generic dispatch loop           |
| `.cogni/repo-spec.yaml`                                  | `credit_estimate_algo: cogni-v0.0` — profile selection entry point               |
| `.claude/worktrees/attribution-scoring/`                 | Worktree with task.0114 budget algo + scoring research (needs plugin refactor)   |
| `docs/research/attribution-scoring-design.md`            | LLM evaluation design, quarterly review model (in worktree)                      |
| `work/projects/proj.transparent-credit-payouts.md`       | Project roadmap                                                                  |
