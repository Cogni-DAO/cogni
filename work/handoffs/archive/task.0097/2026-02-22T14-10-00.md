---
id: task.0097.handoff
type: handoff
work_item_id: task.0097
status: active
created: 2026-02-21
updated: 2026-02-22
branch: worktree-ingestion-core-github-adapter
last_commit: 986c8076
---

# Handoff: GitHub + Discord Source Adapters (task.0097)

## Context

Epoch-based payout pipeline needs automated activity collection from GitHub (and later Discord). The `SourceAdapter` port + `GitHubSourceAdapter` were built, then validated with a new **external integration test tier** that hits real GitHub API against `Cogni-DAO/test-repo`.

The external tests caught two real bugs — both now fixed in working tree (uncommitted):

1. `@octokit/graphql` reserves `query` as variable name — renamed to `searchQuery`
2. **GitHub Search API (`search()`) is incomplete** — only returned 3/7 merged PRs. Rewrote all 3 GraphQL queries to use authoritative repo-scoped connections (`repository.pullRequests`, `repository.issues`)

## Current State

- **Done:** `@cogni/ingestion-core` package (types, port, helpers) — 13 tests
- **Done:** `GitHubSourceAdapter` rewritten to use repo-scoped GraphQL (not search index) — 24 unit tests passing
- **Done:** External test tier wired (`vitest.external.config.mts`, `pnpm test:external`, `tests/external/AGENTS.md`)
- **Done:** External test file with 6 test cases (streams, PRs, issues, reviews, determinism, ledger round-trip)
- **Done:** Test data in `Cogni-DAO/test-repo`: Issue #51 (closed), PR #52 (merged, reviewed by Cogni-1729)
- **Done:** Lockfile fix for `@cogni/ingestion-core` workspace symlink
- **Uncommitted:** All adapter rewrites + external test infrastructure. Need `pnpm check`, then commit.
- **Not done:** `pnpm test:external` not yet run after the search→repo-scoped rewrite
- **Not done:** Discord adapter, adapter registry/factory

## Decisions Made

- Replaced `search()` GraphQL with `repository.pullRequests(states: MERGED, orderBy: UPDATED_AT DESC)` and `repository.issues(states: CLOSED, orderBy: UPDATED_AT DESC)` — authoritative connections, not best-effort search index
- Client-side time-window filtering (`mergedAt`/`closedAt`/`submittedAt` > since && <= until)
- Early-stop optimization: stop paging when `updatedAt < since`
- Exclusive lower bound on cursor (`eventTime > since`) to avoid duplicates
- Adapter version bumped to `0.2.0` for the query rewrite
- External tests skip gracefully if `GITHUB_TOKEN`/`GH_TOKEN` not set
- External tests reuse testcontainers-postgres globalSetup for ledger round-trip

## Next Actions

- [ ] Run `pnpm test:external` with `GITHUB_TOKEN=$(gh auth token)` — verify all 6 external tests pass after rewrite
- [ ] Run `pnpm check` — verify lint/typecheck/format clean
- [ ] Commit all uncommitted changes (adapter rewrite, external test tier, fixture updates)
- [ ] Implement Discord adapter (`services/scheduler-worker/src/adapters/ingestion/discord.ts`)
- [ ] Add adapter registry/factory for workflow iteration
- [ ] Wire into `CollectEpochWorkflow` (task.0095)

## Risks / Gotchas

- **Review pagination cap:** `reviews(first: 100)` on each PR — PRs with 100+ reviews will silently drop extras
- **Exclusive lower bound:** Uses `mergedAt > since` (not `>=`). If cursor value equals an event's mergedAt exactly, that event is excluded on re-collect. This is intentional to prevent duplicates.
- **Single cursor across streams:** `collect()` returns one `nextCursor` for all streams. Per-stream cursors needed at workflow layer.
- **`GITHUB_REPOS` config:** Stored as raw string in scheduler-worker config — caller must `split(",")` to get array

## Pointers

| File                                                                  | Why it matters                                                    |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `services/scheduler-worker/src/adapters/ingestion/github.ts`          | Adapter — repo-scoped GraphQL, normalization, early-stop          |
| `services/scheduler-worker/tests/github-adapter.test.ts`              | 24 unit tests with mock fixtures                                  |
| `services/scheduler-worker/tests/fixtures/github-graphql.fixtures.ts` | Mock response factories (`wrapPrResponse`, `wrapIssueResponse`)   |
| `tests/external/ingestion/github-adapter.external.test.ts`            | 6 real-API tests against Cogni-DAO/test-repo                      |
| `vitest.external.config.mts`                                          | External test runner config (testcontainers + generous timeouts)  |
| `packages/ingestion-core/src/`                                        | Pure types (`model.ts`), port (`port.ts`), helpers (`helpers.ts`) |
| `work/items/task.0097.ledger-source-adapters.md`                      | Canonical work item                                               |
| `docs/spec/epoch-ledger.md`                                           | Spec: schema, invariants, adapter contract                        |
