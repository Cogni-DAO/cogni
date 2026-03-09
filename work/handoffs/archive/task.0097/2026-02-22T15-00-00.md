---
id: task.0097.handoff
type: handoff
work_item_id: task.0097
status: active
created: 2026-02-21
updated: 2026-02-22
branch: worktree-ingestion-core-github-adapter
last_commit: "65804255"
---

# Handoff: GitHub App Auth + Unified Octokit Client (task.0097)

## Context

- The epoch payout pipeline collects GitHub activity (PRs, reviews, issues) via `GitHubSourceAdapter`
- Previously used a PAT with raw `@octokit/graphql` and bespoke rate-limit handling
- This session replaced PAT auth with GitHub App auth (`@octokit/auth-app`) and standardized on `@octokit/core` with retry + throttling plugins
- The adapter now requires a `VcsTokenProvider` — no PAT fallback, no dual-mode
- Env vars are defined in scheduler-worker `config.ts` but **not yet wired** to compose/deploy infrastructure

## Current State

- **Done:** `VcsTokenProvider` port interface in `@cogni/ingestion-core`
- **Done:** `GitHubAppTokenProvider` implementation using `@octokit/auth-app` with dynamic installation ID resolution
- **Done:** `createGitHubClient()` factory with `@octokit/plugin-retry` + `@octokit/plugin-throttling`
- **Done:** `GitHubSourceAdapter` refactored — accepts `tokenProvider` only, auto-refreshes tokens near expiry (5-min buffer)
- **Done:** `config.ts` has `REVIEW_APP_ID`, `REVIEW_APP_PRIVATE_KEY_BASE64`, `REVIEW_INSTALLATION_ID` env vars
- **Done:** 35 unit tests passing (21 adapter + 5 auth + 9 activities)
- **Done:** External test updated to use `GitHubAppTokenProvider`
- **Done:** `pnpm check` passes (only pre-existing `identity-model.md` doc failure)
- **Not done:** Env wiring — compose files, deploy scripts, CI workflows do not pass the new vars
- **Not done:** GitHub App not yet created — need to register in GitHub org settings
- **Not done:** Discord adapter, adapter registry/factory

## Decisions Made

- **App-only auth, no PAT fallback** — user explicitly rejected dual-mode as tech debt
- Removed `GitHubRateLimitError` class — plugins handle retries automatically
- Adapter version bumped `0.2.0` → `0.3.0` for the auth change (breaking config shape)
- `@octokit/graphql` removed, replaced by `@octokit/core` (which includes `.graphql()`)
- Token refresh uses 5-minute buffer before `expiresAt` (installation tokens last ~60min)
- Installation ID resolved dynamically from `repoRef` if not provided in config

## Next Actions

- [ ] Create Review GitHub App in Cogni-DAO org (permissions: `contents:read`, `pull_requests:read`, `issues:read`), install on `Cogni-DAO/test-repo`
- [ ] Wire env vars to scheduler-worker in `docker-compose.dev.yml` and `docker-compose.yml`
- [ ] Wire secrets through `deploy-production.yml`, `staging-preview.yml`, and `deploy.sh`
- [ ] Establish clean env-update workflow that covers both app and worker services
- [ ] Run `pnpm test:external` with real App credentials to validate end-to-end
- [ ] Update work item plan checklist to reflect completed auth items
- [ ] Implement Discord adapter
- [ ] Wire adapters into `CollectEpochWorkflow` (task.0095)

## Risks / Gotchas

- **Env vars not wired:** The scheduler-worker will fail to start in Docker until compose files pass `REVIEW_APP_ID` and `REVIEW_APP_PRIVATE_KEY_BASE64`
- **`config.ts` makes App vars required:** If the worker starts without them, Zod validation will throw at boot. Consider making them optional if the worker has non-ingestion responsibilities
- **External tests will skip** until `REVIEW_APP_ID` + `REVIEW_APP_PRIVATE_KEY_BASE64` are set (previously used `GITHUB_TOKEN`)
- **Review pagination cap:** `reviews(first: 100)` per PR — PRs with 100+ reviews silently drop extras

## Pointers

| File / Resource                                                      | Why it matters                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------- |
| `services/scheduler-worker/src/adapters/ingestion/github.ts`         | Adapter — now uses `VcsTokenProvider`, no direct token  |
| `services/scheduler-worker/src/adapters/ingestion/github-auth.ts`    | `GitHubAppTokenProvider` — App JWT + installation token |
| `services/scheduler-worker/src/adapters/ingestion/octokit-client.ts` | Unified Octokit factory with retry/throttling           |
| `packages/ingestion-core/src/vcs-token-provider.ts`                  | Port interface — lives in pure domain package           |
| `services/scheduler-worker/src/config.ts`                            | Env schema — new `REVIEW_APP_*` vars                    |
| `services/scheduler-worker/tests/github-auth.test.ts`                | Auth unit tests (5 tests)                               |
| `services/scheduler-worker/tests/github-adapter.test.ts`             | Adapter tests (21 tests, mocks `octokit-client`)        |
| `tests/external/ingestion/github-adapter.external.test.ts`           | Real API tests — now uses `GitHubAppTokenProvider`      |
| Commit `65804255`                                                    | The auth refactor commit                                |
| `work/items/task.0097.ledger-source-adapters.md`                     | Canonical work item                                     |
