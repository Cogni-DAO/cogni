---
id: task.0191-handoff
type: handoff
work_item_id: task.0191
status: active
created: 2026-03-25
updated: 2026-03-25
branch: task-0191-webhook-temporal-alignment
last_commit: 6bce4988
---

# Handoff: PR Review Webhook → Temporal (Post-Merge)

## Context

PR #618 moves PR review from inline Next.js execution to Temporal. The pipeline works end-to-end: webhook → PrReviewWorkflow → GraphRunWorkflow child → check run + PR comment on GitHub. Dashboard shows runs under "Cogni Live." External tests pass. CI stack tests pass.

This handoff covers what's left after merge.

## Current State

- **PR #618** — rebased on staging, CI running. 15 commits.
- **Pipeline proven** — external E2E test creates real PRs on `derekg1729/test-repo`, LLM evaluates gates, check run + comment posted. Dashboard shows all 5 runs.
- **RLS migration** — `0024_graph_runs_rls_requested_by.sql` widens `graph_runs` RLS to check `requested_by` OR `schedule_id`. Required because webhook runs have no schedule.
- **stateKey fix** — internal API no longer conflates `stateKey` with `runId` for headless runs. Thread persistence skipped when no conversation context.

## Follow-Up Work (Post-Merge)

### Bugs to fix

| Bug      | Summary                                                                        | Effort |
| -------- | ------------------------------------------------------------------------------ | ------ |
| bug.0193 | Worker houses workflow definitions — extract to `packages/temporal-workflows/` | 3      |
| bug.0195 | TigerBeetle dev OOM crashloop (unrelated, blocks stack tests intermittently)   | 2      |

### Dashboard improvements

- **Run card detail**: clicking a Cogni Live run should drill into the graph run stream (Redis SSE). The `runId` is available — wire it to `/api/v1/ai/runs/{runId}/stream`.
- **"My Runs" tab**: currently shows nothing for most users (no `user_immediate` runs yet). Will populate when chat uses the unified path.
- **Old scheduled runs**: 700+ runs have `requested_by = "cogni_system"` (string slug, not UUID). They show under Cogni Live because they match via `schedule_id` RLS path. New runs use `COGNI_SYSTEM_PRINCIPAL_USER_ID` UUID. Consider a data backfill: `UPDATE graph_runs SET requested_by = '00000000-0000-4000-a000-000000000001' WHERE requested_by = 'cogni_system'`.

### Architecture debt

- **bug.0193**: `services/scheduler-worker/` is 66% business code. Workflows belong in `packages/temporal-workflows/`. Activities stay in the worker (need concrete deps). Domain logic (`domain/review.ts`) moves to the workflow package.
- **`responseFormat` schemaId registry**: `RESPONSE_FORMAT_SCHEMAS` in the internal API route is a hardcoded map. Works for now (one schema). If more graphs need structured output, formalize the registry.
- **task.0122 (operator node registration)**: remote repo-spec fetching is naive — lenient YAML parse fallback when target repo lacks `node_id`/`scope_id`. Proper fix is the operator registration lifecycle.

## Decisions Made

- **GraphRunWorkflow returns typed terminal artifact** — `{ok, runId, structuredOutput?}`. Redis/SSE remain observability transport, not parent-child control data.
- **Domain logic extracted** — `evaluateCriteria()`, `formatCheckRunSummary()`, `formatPrComment()` in `domain/review.ts`. Activities do only GitHub I/O.
- **Idempotency** — parent workflowId = `pr-review:{owner}/{repo}/{prNumber}/{headSha}`. Child workflowId = `graph-run:system:pr-review:{same key}`. Stable business keys, no `attempt` in external write keys.
- **RLS via `requested_by`** — migration 0024 adds `requested_by = current_user` as alternative to `schedule_id` chain. Both paths coexist.
- **System identity** — `COGNI_SYSTEM_PRINCIPAL_USER_ID` (UUID `...0001`) for all `requested_by` and `actorUserId` fields. `SYSTEM_ACTOR` (`...0000`) for RLS context only. `"cogni_system"` slug purged from all code paths.

## Pointers

| File                                                                                   | Why                                                      |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `services/scheduler-worker/src/workflows/pr-review.workflow.ts`                        | Parent workflow — 4 steps                                |
| `services/scheduler-worker/src/activities/review.ts`                                   | GitHub I/O activities                                    |
| `services/scheduler-worker/src/domain/review.ts`                                       | Pure domain logic (criteria eval, formatting)            |
| `apps/operator/src/app/_facades/review/dispatch.server.ts`                             | Webhook → Temporal dispatch                              |
| `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts`                    | responseFormat forwarding + stateKey fix                 |
| `apps/operator/src/app/api/v1/ai/runs/route.ts`                                        | Runs API with `scope=system` for Cogni Live              |
| `apps/operator/src/app/(app)/dashboard/_api/fetchRuns.ts`                              | Client fetch with scope param                            |
| `apps/operator/src/adapters/server/db/migrations/0024_graph_runs_rls_requested_by.sql` | RLS migration                                            |
| `docs/spec/temporal-patterns.md`                                                       | Normative webhook pattern, terminology, invariants       |
| `apps/operator/tests/external/review/pr-review-e2e.external.test.ts`                   | E2E test — creates real PR, verifies check run + comment |
