---
id: task.0097.handoff
type: handoff
work_item_id: task.0097
status: active
created: 2026-02-21
updated: 2026-02-22
branch: worktree-ingestion-core-github-adapter
last_commit: "e374616f"
---

# Handoff: GitHub Source Adapter — Auth + Env Wiring (task.0097)

## Context

- Epoch payout pipeline collects GitHub activity (PRs, reviews, issues) via `GitHubSourceAdapter`
- Auth was refactored from PAT to GitHub App only (`@octokit/auth-app`), with a `VcsTokenProvider` port abstraction
- Client switched from `@octokit/graphql` to `@octokit/core` with retry + throttling plugins (no more bespoke rate-limit code)
- **CI is broken** — scheduler-worker fails to boot in Docker because env vars (`GITHUB_REVIEW_APP_*`) are required but not passed through compose files or CI workflows

## Current State

- **Done:** `VcsTokenProvider` port in `@cogni/ingestion-core`, `GitHubAppTokenProvider` implementation, `createGitHubClient()` factory
- **Done:** `GitHubSourceAdapter` accepts `tokenProvider` only, auto-refreshes tokens near expiry
- **Done:** Env schema in `bootstrap/env.ts` defines `GITHUB_REVIEW_APP_ID`, `GITHUB_REVIEW_APP_PRIVATE_KEY_BASE64`, `GITHUB_REVIEW_INSTALLATION_ID`
- **Done:** 26 unit tests passing (adapter + auth)
- **Done:** Env var rename `REVIEW_*` → `GITHUB_REVIEW_*` — applied in `bootstrap/env.ts`, external test file, compose files, and `.env.*.example` files
- **Done:** Scheduler-worker clean architecture refactor (ports/, bootstrap/env + container, dep-cruiser rules)
- **Done:** `GITHUB_REVIEW_APP_*` vars are optional in Zod schema — worker boots without them; ingestion fails at runtime only
- **Done:** Compose files (`docker-compose.dev.yml`, `docker-compose.yml`) pass through `GITHUB_REVIEW_*` vars with empty defaults
- **Not done:** Deploy scripts/CI workflows — `deploy-production.yml`, `staging-preview.yml`, `deploy.sh` need secrets wired
- **Not done:** GitHub App not yet created in Cogni-DAO org
- **Not done:** Discord adapter, adapter registry

## Decisions Made

- **App-only auth** — user rejected PAT fallback as tech debt
- Removed `GitHubRateLimitError` — plugins handle retries
- Adapter version `0.2.0` → `0.3.0` (breaking: `token` field removed from config)
- `@octokit/graphql` removed from `package.json`, replaced by `@octokit/core`
- Env vars renamed to `GITHUB_REVIEW_*` prefix (partially applied)
- **Env vars are required in Zod schema** — worker crashes at boot without them. Must either: (a) wire them everywhere, or (b) make them optional with a guard at ingestion call sites

## Next Actions

- [x] Finish env var rename: `REVIEW_*` → `GITHUB_REVIEW_*` in external test, env schema, compose files
- [x] **Fix CI:** Made `GITHUB_REVIEW_APP_*` optional in Zod — worker boots without them
- [x] Add placeholders to `.env.local.example`, `.env.test.example`
- [x] Wire env vars in `docker-compose.dev.yml` and `docker-compose.yml`
- [ ] Wire secrets through `deploy-production.yml`, `staging-preview.yml`, `deploy.sh`
- [ ] Create GitHub App in Cogni-DAO org (permissions: `contents:read`, `pull_requests:read`, `issues:read`), install on `Cogni-DAO/test-repo`
- [ ] Run `pnpm test:external` with real App credentials
- [ ] Commit the in-progress bootstrap/container refactor

## Risks / Gotchas

- **CI fixed** — `GITHUB_REVIEW_APP_*` vars are optional; worker boots without them
- **Deploy wiring pending** — deploy scripts and CI workflows don't pass `GITHUB_REVIEW_*` secrets yet
- **Review pagination cap:** `reviews(first: 100)` per PR — 100+ reviews silently dropped

## Pointers

| File / Resource                                                      | Why it matters                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| `services/scheduler-worker/src/bootstrap/env.ts`                     | Env schema — `GITHUB_REVIEW_APP_*` vars defined here |
| `services/scheduler-worker/src/adapters/ingestion/github.ts`         | Adapter — requires `tokenProvider`, no direct token  |
| `services/scheduler-worker/src/adapters/ingestion/github-auth.ts`    | `GitHubAppTokenProvider` — JWT + installation token  |
| `services/scheduler-worker/src/adapters/ingestion/octokit-client.ts` | Octokit factory with retry/throttling plugins        |
| `packages/ingestion-core/src/vcs-token-provider.ts`                  | Port interface in pure domain package                |
| `tests/external/ingestion/github-adapter.external.test.ts`           | Needs env var rename to `GITHUB_REVIEW_*`            |
| `platform/infra/services/runtime/docker-compose.dev.yml`             | Scheduler-worker env block — needs new vars          |
| `platform/infra/services/runtime/docker-compose.yml`                 | Production compose — needs new vars                  |
| Commit `65804255`                                                    | Auth refactor commit                                 |
| `work/items/task.0097.ledger-source-adapters.md`                     | Canonical work item                                  |
