---
id: task.0191-handoff
type: handoff
work_item_id: task.0191
status: active
created: 2026-03-24
updated: 2026-03-24
branch: ""
last_commit: 6cac8b6f
---

# Handoff: PR Review Webhook → Temporal Parent Workflow

## Context

- The "unified graph launch" project requires ALL graph execution to go through `GraphRunWorkflow` via Temporal — chat and scheduled runs already do, but **webhook-triggered PR review does not**
- PR review currently runs the LLM inline in the Next.js process via `createGraphExecutor` → `executeStream`, bypassing Temporal, Redis, and `graph_runs` — the run is invisible to the dashboard
- task.0178 (just merged) deleted the old `GovernanceScheduledRunWorkflow`, removed deprecated aliases, and documented the **LangGraph vs Temporal boundary** in `docs/spec/temporal-patterns.md` — that boundary guide is the design contract for this task
- The boundary principle: LangGraph owns intelligence/dataflow (thinking, evaluating). Temporal owns durable orchestration (triggers, writes, idempotency, crash recovery)
- This is the first webhook→graph flow and sets the canonical pattern for all future ones (deploy analysis, incident response, etc.)

## Current State

- **Work item:** `work/items/task.0191.webhook-temporal-alignment.md` — status `needs_design`, has full requirements and 4-checkpoint plan
- **No branch created yet** — start from `staging` after task.0178 merges
- **No code written** — design and requirements are complete, implementation not started
- The current inline path works functionally (PR reviews do post to GitHub) but violates `ONE_RUN_EXECUTION_PATH` and is invisible to observability

## Decisions Made

- **Temporal parent + LangGraph child pattern** — documented in [temporal-patterns.md § LangGraph vs Temporal Boundary](../docs/spec/temporal-patterns.md). Webhook fires Temporal workflow; graph returns pure structured artifact; GitHub writes happen in Temporal activities with idempotency
- **`system_webhook` runKind** — already exists in the `GRAPH_RUN_KINDS` enum (`packages/db-schema/src/scheduling.ts`). No schema migration needed
- **Fire-and-forget from webhook handler** — `dispatchPrReview` starts the Temporal workflow and exits. No blocking Next.js on Redis/SSE
- **Idempotency key**: `pr-review:${owner}/${repo}/${prNumber}/${headSha}` — prevents duplicate reviews on webhook retries
- **Graph returns structured artifact, not side effects** — `{verdict, conclusion, gateResults, summary}`. GitHub API calls move to Temporal activities

## Next Actions

- [ ] Create feature branch from `staging` (after task.0178 PR #616 merges)
- [ ] `/design` — validate approach, resolve any open questions about GitHub App credential passing to Temporal worker
- [ ] Checkpoint 1: `PrReviewWorkflow` skeleton + activity stubs in `services/scheduler-worker/src/workflows/`
- [ ] Checkpoint 2: Implement `fetchPrContext` and `postReviewResult` activities; ensure `pr-review` graph returns structured artifact
- [ ] Checkpoint 3: Refactor `dispatchPrReview` to start Temporal workflow instead of inline execution
- [ ] Checkpoint 4: Tests + docs + closeout
- [ ] Verify PR reviews appear on dashboard Cogni Live tab as `system_webhook` runs

## Risks / Gotchas

- **GitHub App credentials** — currently resolved in the Next.js process (`dispatch.server.ts:50-57`). The Temporal worker needs access to `GH_REVIEW_APP_ID` and `GH_REVIEW_APP_PRIVATE_KEY_BASE64` — these are already in the worker's env schema (`services/scheduler-worker/src/bootstrap/env.ts`) as optional vars
- **The review handler does more than LLM** — `handlePrReview` orchestrates: evidence gathering, gate config loading, rule parsing, AI evaluation, check run creation, comment posting. The Temporal workflow replaces this orchestration; individual steps become activities or stay in the graph
- **Existing review adapters** — `apps/web/src/bootstrap/review-adapter.factory.ts` creates GitHub API adapters (Octokit). These need equivalents in the scheduler-worker, or the adapter factory needs to be shared
- **`postPrComment` has a staleness guard** — it checks if the PR head SHA still matches before posting. This logic must survive the move to a Temporal activity
- **Worker bundle path** — `services/scheduler-worker/src/worker.ts:75` currently points `workflowsPath` to only `graph-run.workflow.js`. The new `PrReviewWorkflow` needs its own bundle entry or must be co-located

## Pointers

| File / Resource                                                    | Why it matters                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `docs/spec/temporal-patterns.md` § LangGraph vs Temporal Boundary  | The design contract — read this first                                          |
| `work/items/task.0191.webhook-temporal-alignment.md`               | Full requirements, plan, allowed changes                                       |
| `apps/web/src/app/_facades/review/dispatch.server.ts`              | Current inline dispatch — this gets simplified                                 |
| `apps/web/src/features/review/services/review-handler.ts`          | Current orchestration pipeline — steps become activities                       |
| `apps/web/src/features/review/gates/ai-rule.ts:78-98`              | Where `executor.runGraph()` runs inline — this moves to GraphRunWorkflow child |
| `apps/web/src/app/_facades/ai/completion.server.ts:348-375`        | The Temporal start pattern to follow (chat path)                               |
| `services/scheduler-worker/src/workflows/graph-run.workflow.ts`    | The unified workflow — PrReviewWorkflow calls this as child                    |
| `services/scheduler-worker/src/worker.ts:75`                       | Worker bundle registration — add new workflow here                             |
| `apps/web/src/app/api/internal/webhooks/[source]/route.ts:124-127` | Webhook entry point — where `dispatchPrReview` is called                       |
| `work/projects/proj.unified-graph-launch.md` § P2                  | Project roadmap context                                                        |
