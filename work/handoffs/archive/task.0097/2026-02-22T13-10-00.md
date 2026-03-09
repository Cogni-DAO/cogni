---
id: task.0097.handoff
type: handoff
work_item_id: task.0097
status: active
created: 2026-02-21
updated: 2026-02-22
branch: worktree-ingestion-core-github-adapter
last_commit: 0810ca17
---

# Handoff: GitHub + Discord Source Adapters (task.0097)

## Context

- Part of [proj.transparent-credit-payouts](../projects/proj.transparent-credit-payouts.md) — epoch-based activity-to-payout pipeline
- Implements the `SourceAdapter` port and GitHub adapter for automated weekly activity collection
- `@cogni/ingestion-core` is a new pure package (types + helpers); adapter lives in `services/scheduler-worker/`
- Blocked by task.0094 (ledger DB schema + store) — now merged into this worktree
- Discord adapter is remaining work (same `SourceAdapter` interface)

## Current State

- **Done:** `@cogni/ingestion-core` package — `ActivityEvent`, `StreamDefinition`, `StreamCursor`, `CollectParams`, `CollectResult` types, `SourceAdapter` port, `buildEventId()`, `canonicalJson()`, `hashCanonicalPayload()` helpers
- **Done:** `GitHubSourceAdapter` — 3 streams (merged PRs, submitted reviews, closed issues) via GraphQL, deterministic IDs, SHA-256 hashing, bot filtering, pagination, rate limit handling
- **Done:** 35 tests passing (13 helper + 22 adapter), all packages build, worktree healthy
- **Done:** Port re-exports wired into `src/ports/`, scheduler-worker config updated with `GITHUB_TOKEN`/`GITHUB_REPOS`
- **Done:** task.0094 (ledger port + Drizzle adapter) merged into this worktree
- **Not done:** Discord adapter (`services/scheduler-worker/src/adapters/ingestion/discord.ts`)
- **Not done:** Adapter registry/factory for workflow iteration

## Decisions Made

- Types + port in `@cogni/ingestion-core` package, adapters in `services/scheduler-worker/` (ADAPTERS_NOT_IN_CORE) — per [epoch-ledger spec](../../docs/spec/epoch-ledger.md)
- `platformUserId` = GitHub numeric `databaseId` (stable), not `login` (mutable)
- Bot/Mannequin actors skipped (no `databaseId` on non-User actors)
- Payload hash uses `canonicalJson()` (sorted keys) → SHA-256 via Web Crypto — no external deps
- Logger uses minimal `LoggerLike` interface — no hard pino dependency in adapter
- Review collection searches PRs merged in window, then filters reviews by `submittedAt`

## Next Actions

- [ ] Implement Discord adapter using `discord.js` (same `SourceAdapter` interface)
- [ ] Add adapter registry/factory for `CollectEpochWorkflow` to iterate registered adapters
- [ ] Wire into `CollectEpochWorkflow` Temporal workflow (task.0095) — calls `adapter.collect()`, inserts via `ActivityLedgerStore`
- [ ] Consider per-stream cursors (current: single cursor across all streams in `collect()`)
- [ ] Run `pnpm check` — may need minor lint/format fixes

## Risks / Gotchas

- **Single cursor across streams:** `collect()` returns one `nextCursor` for all streams. If PR stream advances past reviews, reviews could be skipped. Consider per-stream cursor tracking in the workflow layer.
- **Review search scope:** Reviews are found via PRs merged in the window. Reviews on unmerged PRs or PRs merged before the window are missed. May need `updated:` range instead.
- **Worktree was corrupted** by another dev attempting deletion — restored via `git checkout HEAD -- .` and re-applied feature patch. All verified clean.
- **`GITHUB_REPOS` config** is stored as raw string — caller must `split(",")` to get array.

## Pointers

| File / Resource                                              | Why it matters                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `packages/ingestion-core/src/`                               | Pure types (`model.ts`), port (`port.ts`), helpers (`helpers.ts`)        |
| `services/scheduler-worker/src/adapters/ingestion/github.ts` | GitHub adapter — all GraphQL queries, normalization, rate limit handling |
| `services/scheduler-worker/tests/github-adapter.test.ts`     | 22 adapter tests with fixture factories                                  |
| `packages/ingestion-core/tests/helpers.test.ts`              | 13 helper tests (ID determinism, hashing)                                |
| `src/ports/source-adapter.port.ts`                           | Type re-exports for app-layer consumers                                  |
| `work/items/task.0097.ledger-source-adapters.md`             | Canonical work item with requirements + plan                             |
| `docs/spec/epoch-ledger.md`                                  | Spec: schema, invariants, adapter interface contract                     |
