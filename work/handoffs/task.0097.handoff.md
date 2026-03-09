---
id: task.0097.handoff
type: handoff
work_item_id: task.0097
status: active
created: 2026-02-21
updated: 2026-02-22
branch: worktree-ingestion-core-github-adapter
last_commit: "d0d92133"
---

# Handoff: GitHub Ingestion — Build Temporal Workflows

## Context

- The epoch payout pipeline collects GitHub activity (PRs, reviews, issues) to reward contributors
- A `GitHubSourceAdapter` exists that queries GitHub's GraphQL API via `@octokit/core` with retry/throttling
- Auth uses GitHub App tokens (`GitHubAppTokenProvider` implementing `VcsTokenProvider` port), not PATs
- The scheduler-worker service now has clean architecture: `ports/`, `bootstrap/` (env + container), dep-cruiser rules
- **Next step:** Build Temporal workflows that invoke the adapter to collect activity on a schedule

## Current State

- **Done:** `GitHubSourceAdapter` — collects merged PRs, reviews, closed issues from repo-scoped GraphQL queries
- **Done:** `GitHubAppTokenProvider` — JWT + installation token auth, auto-refreshes near expiry
- **Done:** `VcsTokenProvider` port in `@cogni/ingestion-core`, `SourceAdapter` port for the adapter contract
- **Done:** Clean architecture in scheduler-worker: `ports/index.ts` re-exports `ExecutionGrantWorkerPort` + `ScheduleRunRepository`; `bootstrap/container.ts` wires adapters; activities use port types only
- **Done:** Dep-cruiser rules enforce activities/workflows cannot import adapters, db-client, or bootstrap
- **Done:** `GITHUB_REVIEW_APP_*` env vars are optional (worker boots without them), wired through compose files
- **Done:** 26 unit tests pass (adapter + auth), external tests pass with real GitHub App credentials
- **Not done:** Temporal workflow to orchestrate ingestion (collect → store → update cursor)
- **Not done:** Adapter registry (dispatching to GitHub vs future Discord adapter)
- **Not done:** GitHub App not yet created in Cogni-DAO org (using personal test app)
- **Not done:** Deploy pipeline wiring for `GITHUB_REVIEW_*` secrets

## Decisions Made

- **App-only auth** — no PAT fallback, `VcsTokenProvider` port abstracts future auth methods
- **Repo-scoped GraphQL** — queries `repository.pullRequests`, not `search()` (which is best-effort indexed)
- **Early-stop pagination** — stops paging when `updatedAt < since`, avoids scanning entire history
- **Optional env vars** — `GITHUB_REVIEW_APP_*` optional in Zod so worker boots for non-ingestion workflows
- **Clean architecture** — activities/workflows import ports only; concrete adapters wired in `bootstrap/container.ts`
- **Single pino importer** — only `observability/logger.ts` imports pino; all others get `Logger` type from there
- **Cleanup noted:** `VcsTokenProvider` should be renamed to `VcsTokenProviderPort` for naming consistency

## Next Actions

- [ ] Design ingestion Temporal workflow (collect → deduplicate → store to ledger → advance cursor)
- [ ] Add `SourceAdapter` + `VcsTokenProvider` to `bootstrap/container.ts` (wire `GitHubAppTokenProvider` + `GitHubSourceAdapter`)
- [ ] Add ingestion-related ports to `ports/index.ts` if workflows consume them (e.g., `ActivityLedgerStore`)
- [ ] Create ingestion activities (collect, store, cursor management) using port interfaces
- [ ] Create adapter registry or factory for dispatching by source name
- [ ] Wire secrets through deploy pipeline (`deploy-production.yml`, `staging-preview.yml`, `deploy.sh`)
- [ ] Create GitHub App in Cogni-DAO org (permissions: `contents:read`, `pull_requests:read`, `issues:read`)

## Risks / Gotchas

- **Deploy wiring pending** — CI/deploy scripts don't pass `GITHUB_REVIEW_*` secrets yet; compose files are wired
- **Review pagination cap** — `reviews(first: 100)` per PR; 100+ reviews silently dropped
- **Bot/Mannequin actors skipped** — actors without `databaseId` are excluded (no stable user ID)
- **Dep-cruiser enforced** — new activities MUST import from `../ports/index.js`, never from adapters or `@cogni/db-client`

## Pointers

| File / Resource                                                     | Why it matters                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `services/scheduler-worker/AGENTS.md`                               | Architecture diagram, hard rules, env var docs              |
| `services/scheduler-worker/src/ports/index.ts`                      | Port barrel — add new ports here                            |
| `services/scheduler-worker/src/bootstrap/container.ts`              | Composition root — wire new adapters here                   |
| `services/scheduler-worker/src/bootstrap/env.ts`                    | Zod env schema with `GITHUB_REVIEW_*` vars                  |
| `services/scheduler-worker/src/adapters/ingestion/github.ts`        | `GitHubSourceAdapter` — 3 streams, early-stop pagination    |
| `services/scheduler-worker/src/adapters/ingestion/github-auth.ts`   | `GitHubAppTokenProvider` — JWT + installation tokens        |
| `packages/ingestion-core/src/port.ts`                               | `SourceAdapter` interface (collect, streams, handleWebhook) |
| `packages/ingestion-core/src/vcs-token-provider.ts`                 | `VcsTokenProvider` port interface                           |
| `services/scheduler-worker/src/workflows/scheduled-run.workflow.ts` | Existing workflow — pattern reference for new workflows     |
| `.dependency-cruiser.cjs`                                           | Boundary rules (search "no-service-activities")             |
| `tests/external/ingestion/github-adapter.external.test.ts`          | External tests against real GitHub API                      |
| Commit `4d6a5715`                                                   | Clean architecture refactor                                 |
| Commit `d0d92133`                                                   | Env var optional + rename + compose wiring                  |
