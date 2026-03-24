---
id: task.0191
type: task
title: "PR review webhook → Temporal parent workflow with durable GitHub writes"
status: needs_design
priority: 1
rank: 2
estimate: 5
summary: Refactor PR review webhook from inline graph execution to Temporal parent workflow pattern — fetch context activity, GraphRunWorkflow child for AI decision, idempotent GitHub write activities
outcome: PR review runs visible on dashboard as system_webhook; GitHub writes are idempotent and crash-recoverable; webhook handler is fire-and-forget; LangGraph/Temporal boundary enforced per spec
spec_refs:
  - spec.unified-graph-launch
  - temporal-patterns-spec
assignees: []
project: proj.unified-graph-launch
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-03-24
updated: 2026-03-24
labels:
  - ai-graphs
  - scheduler
---

# PR Review Webhook → Temporal Parent Workflow

## Context

PR review is the first webhook-triggered graph execution and the template for all future webhook→graph flows. Currently it violates `ONE_RUN_EXECUTION_PATH` — the webhook handler runs the LLM inline in Next.js via `createGraphExecutor` → `executeStream`, bypassing Temporal, Redis, and `graph_runs`. The run is invisible to the dashboard.

Per the LangGraph vs Temporal boundary guide (temporal-patterns spec):

- **LangGraph** owns the AI decision (diff analysis, rule evaluation, structured verdict)
- **Temporal** owns the durable orchestration (trigger, context fetch, graph child, GitHub writes)

This task establishes the canonical pattern for all future webhook→graph flows.

## Requirements

### PrReviewWorkflow (Temporal parent)

- New workflow in `services/scheduler-worker/src/workflows/`
- Orchestrates: fetch context → run graph child → post result
- Idempotency key: `pr-review:${owner}/${repo}/${prNumber}/${headSha}`
- Registered alongside `GraphRunWorkflow` in worker bundle

### Activities

- `fetchPrContext` — GitHub API: fetch diff, PR metadata, repo-spec. Returns `EvidenceBundle` + gates config.
- `postReviewResult` — GitHub API: create/update check run + post PR comment. Idempotent via headSha key — retries do not double-post.
- GitHub App credentials: passed as workflow input (resolved by webhook handler before starting workflow)

### Graph changes

- `pr-review` graph returns structured artifact: `{verdict, conclusion, gateResults, summary, fileComments}`
- No GitHub side effects inside the graph — pure decision
- Graph execution via `executeChild(GraphRunWorkflow)` — creates `graph_runs` record, visible on dashboard as `system_webhook`

### Webhook handler changes

- `dispatchPrReview` → `workflowClient.start("PrReviewWorkflow", ...)` — true fire-and-forget
- Remove `createGraphExecutor`, `createScopedGraphExecutor`, `handlePrReview` orchestration from Next.js
- Webhook route starts workflow and exits immediately

### Observability

- PR review runs appear in `graph_runs` as `runKind: "system_webhook"`
- Visible on dashboard Cogni Live tab
- Temporal UI shows parent PrReviewWorkflow with child GraphRunWorkflow

## Current flow (to be replaced)

```
webhook route → dispatchPrReview (Next.js async)
  → handlePrReview:
    1. createCheckRun          (GitHub write)
    2. gatherEvidence           (GitHub read)
    3. loadGatesConfig          (local read)
    4. runGates → ai-rule.ts   (INLINE LLM — violates ONE_RUN_EXECUTION_PATH)
    5. updateCheckRun           (GitHub write)
    6. postPrComment            (GitHub write)
```

## Target flow

```
webhook route → workflowClient.start("PrReviewWorkflow") → exit

PrReviewWorkflow (Temporal):
  1. Activity: fetchPrContext   (GitHub reads + repo-spec — retryable)
  2. Child: GraphRunWorkflow("langgraph:pr-review")
     → graph returns {conclusion, gateResults, summary}
     → graph_runs record created (dashboard visibility)
  3. Activity: postReviewResult (GitHub writes — idempotent)
     → createCheckRun + updateCheckRun + postPrComment
```

## Allowed Changes

- `services/scheduler-worker/src/workflows/` — new `PrReviewWorkflow`
- `services/scheduler-worker/src/activities/` — new review activities
- `services/scheduler-worker/src/worker.ts` — register new workflow in bundle
- `services/scheduler-worker/src/bootstrap/` — env/container for GitHub creds
- `apps/web/src/app/_facades/review/dispatch.server.ts` — simplify to Temporal start
- `apps/web/src/features/review/` — may simplify or remove handler orchestration
- `packages/langgraph-graphs/` — ensure pr-review graph returns structured artifact
- Tests

## Plan

- [ ] **Checkpoint 1: PrReviewWorkflow skeleton**
  - New workflow with activity stubs (fetchPrContext, postReviewResult)
  - Register in worker bundle
  - Validation: `pnpm check` passes, worker starts

- [ ] **Checkpoint 2: Activities + graph structured output**
  - Implement fetchPrContext activity (GitHub API via Octokit)
  - Implement postReviewResult activity (idempotent GitHub writes)
  - Ensure pr-review graph returns structured decision artifact
  - Validation: `pnpm check` passes

- [ ] **Checkpoint 3: Wire webhook → Temporal**
  - Refactor dispatchPrReview to start PrReviewWorkflow
  - Remove inline execution path
  - Validation: `pnpm check` passes, webhook triggers Temporal workflow

- [ ] **Checkpoint 4: Tests + docs**
  - Contract tests for workflow/activity behavior
  - Update AGENTS.md, specs
  - Validation: `pnpm check` passes, `pnpm check:docs` passes

## Validation

```bash
pnpm check
pnpm check:docs
pnpm test
```

## Review Checklist

- [ ] **Work Item:** task.0191 linked in PR body
- [ ] **Spec:** ONE_RUN_EXECUTION_PATH upheld — no inline graph execution
- [ ] **Spec:** LangGraph/Temporal boundary per temporal-patterns guide
- [ ] **Tests:** workflow, activities, and webhook dispatch tested
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0191.handoff.md)

## Attribution

-
