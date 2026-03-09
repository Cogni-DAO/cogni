---
id: task.0095.handoff
type: handoff
work_item_id: task.0095
status: active
created: 2026-02-22
updated: 2026-02-22
branch: worktree-ingestion-core-github-adapter
last_commit: 88a5a842
---

# Handoff: Ledger Temporal Workflows (Collect + Finalize)

## Context

- Building the orchestration layer for the transparent credit payouts pipeline (proj.transparent-credit-payouts)
- Two Temporal workflows needed: `CollectEpochWorkflow` (daily data collection) and `FinalizeEpochWorkflow` (admin-triggered payout computation)
- All domain logic, DB schema, store port/adapter, and GitHub source adapter already exist — this task wires them together via Temporal
- Collection runs daily (not just at epoch close) so admins see progress throughout the week
- Epoch configuration (length, sources) will be declared in `.cogni/repo-spec.yaml`

## Current State

- **Done**: Full design written in task.0095 (status: `needs_implement`)
- **Done**: DB schema (8 tables), migrations, triggers (task.0093, task.0094)
- **Done**: `ActivityLedgerStore` port + `DrizzleLedgerAdapter` + DI wiring
- **Done**: `@cogni/ledger-core` — `computePayouts()`, `computeAllocationSetHash()`, model types, errors
- **Done**: `@cogni/ingestion-core` — `SourceAdapter` port, `ActivityEvent` types, helpers
- **Done**: `GitHubSourceAdapter` (PRs, reviews, issues via GraphQL)
- **Not started**: The 7 activity functions, 2 workflows, ledger worker, repo-spec config
- **Not started**: `computeProposedAllocations()` pure function in ledger-core
- **Not started**: `resolveIdentities()` method on store port + adapter

## Decisions Made

- Separate task queue (`ledger-tasks`) from scheduler queue — see Design § Architecture in [task.0095](../items/task.0095.ledger-temporal-workflows.md)
- Separate `createLedgerActivities(deps)` factory (not merged with scheduler activities)
- Single `finalizeEpoch` activity wraps the atomic close+insert transaction
- `collectFromSource` calls adapter in-process (not via HTTP) — adapters are stateless
- Daily collection via Temporal Schedule (`0 6 * * *`); schedule registration deferred to task.0096
- Repo-spec declares `activity_ledger.epoch_length_days` + `activity_sources` — see Design § Repo-Spec
- `blocked_by` reduced to just task.0094 (done); task.0097 GitHub adapter is done on this branch

## Next Actions

- [ ] Add `activity_ledger` section to `.cogni/repo-spec.yaml` (epoch_length_days: 7, activity_sources.github)
- [ ] Add `computeProposedAllocations()` to `packages/ledger-core/src/rules.ts` + unit tests
- [ ] Add `resolveIdentities()` to `ActivityLedgerStore` port + implement in `DrizzleLedgerAdapter`
- [ ] Create `services/scheduler-worker/src/activities/ledger.ts` — 7 activity functions
- [ ] Create `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts`
- [ ] Create `services/scheduler-worker/src/workflows/finalize-epoch.workflow.ts`
- [ ] Create `services/scheduler-worker/src/ledger-worker.ts` + wire into `main.ts`
- [ ] Add `NODE_ID` to scheduler-worker config schema
- [ ] Validate: `pnpm check && pnpm --filter scheduler-worker build && pnpm test -- tests/unit/core/ledger/`

## Risks / Gotchas

- Pre-commit hook fails on `tests/external/AGENTS.md` (pre-existing, unrelated) — may need `--no-verify` for commits
- `user_bindings` table exists in schema but task.0089 (identity bindings CRUD) is not started — `resolveIdentities` will return empty maps until bindings are populated
- The existing `worker.ts` and `activities/index.ts` belong to the scheduler — do NOT modify them; create parallel `ledger-worker.ts` and `activities/ledger.ts`
- `node_id` value is `4ff8eac1-4eba-4ed0-931b-b1fe4f64713d` from repo-spec — needs a `NODE_ID` env var

## Pointers

| File / Resource                                                                              | Why it matters                                                      |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [task.0095 (full design)](../items/task.0095.ledger-temporal-workflows.md)                   | Activity table, workflow pseudocode, invariants, file list          |
| [epoch-ledger spec](../../docs/spec/epoch-ledger.md)                                         | 16 invariants, schema, API contracts, lifecycle                     |
| [packages/ledger-core/src/](../../packages/ledger-core/src/)                                 | `store.ts` (port), `rules.ts` (computePayouts), `model.ts` (types)  |
| [packages/ingestion-core/src/](../../packages/ingestion-core/src/)                           | `port.ts` (SourceAdapter), `model.ts` (ActivityEvent), `helpers.ts` |
| [DrizzleLedgerAdapter](../../packages/db-client/src/adapters/drizzle-ledger.adapter.ts)      | Store implementation — all DB methods                               |
| [GitHubSourceAdapter](../../services/scheduler-worker/src/adapters/ingestion/github.ts)      | Working adapter to wire into collect workflow                       |
| [Existing activities pattern](../../services/scheduler-worker/src/activities/index.ts)       | `createActivities(deps)` — follow this exact DI pattern             |
| [Existing workflow](../../services/scheduler-worker/src/workflows/scheduled-run.workflow.ts) | `proxyActivities` pattern to follow                                 |
| [worker.ts](../../services/scheduler-worker/src/worker.ts)                                   | DO NOT MODIFY — create parallel `ledger-worker.ts`                  |
| [.cogni/repo-spec.yaml](../../.cogni/repo-spec.yaml)                                         | `node_id` lives here; add `activity_ledger` section                 |
