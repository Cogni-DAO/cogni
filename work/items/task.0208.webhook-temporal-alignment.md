---
id: task.0208
type: task
title: "PR review webhook → Temporal parent workflow with durable GitHub writes"
status: done
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
branch: task-0191-webhook-temporal-alignment
pr: https://github.com/Cogni-DAO/node-template/pull/618
reviewer:
revision: 2
blocked_by: []
deploy_verified: false
created: 2026-03-24
updated: 2026-03-25
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

- `createCheckRunActivity` — GitHub API: create check run in "in_progress" state immediately after workflow starts. Returns `checkRunId`. Provides instant UX feedback on the PR while the graph executes.
- `fetchPrContextActivity` — GitHub API: fetch diff, PR metadata, repo-spec + rule files **from target repo via API** (not local filesystem — worker has no checkout of the target repo). Returns `EvidenceBundle` + gates config + parsed rules. Truncate large diffs to stay within Temporal's per-event payload limits (~2MB).
- `postReviewResultActivity` — GitHub API: update check run + post PR comment. Idempotent via `${repo}/${pr}/${headSha}` business key — retries do not double-post. Staleness guard (head SHA check) stays in this activity. On graph failure, updates check run to "neutral" with error message.
- **Credentials:** Activities use the existing `GitHubAppTokenProvider` already created in `container.ts:188-195` from worker env vars (`GH_REVIEW_APP_ID`, `GH_REVIEW_APP_PRIVATE_KEY_BASE64`). Workflow input passes `installationId` (public) to scope the Octokit to the right installation. **Never pass private keys as workflow input** — they persist in Temporal event history. Single-tenant — one GitHub App, no multi-tenant complexity.

### Graph changes

- `pr-review` graph returns structured artifact: `{verdict, conclusion, gateResults, summary, fileComments}`
- No GitHub side effects inside the graph — pure decision
- **Gate orchestration, criteria evaluation, and summary formatting stay in the graph** — activities are I/O-only wrappers. No package extraction needed (WORKER_IS_DUMB).
- Graph execution via `executeChild(GraphRunWorkflow)` — creates `graph_runs` record, visible on dashboard as `system_webhook`

### Webhook handler changes

- `dispatchPrReview` → `workflowClient.start("PrReviewWorkflow", ...)` — true fire-and-forget
- Remove `createGraphExecutor`, `createScopedGraphExecutor`, `handlePrReview` orchestration from Next.js
- Webhook route starts workflow and exits immediately

### Observability

- PR review runs appear in `graph_runs` as `runKind: "system_webhook"`
- Visible on dashboard Cogni Live tab
- Temporal UI shows parent PrReviewWorkflow with child GraphRunWorkflow

### Known gap: WORKFLOW_TOP_LEVEL_VISIBILITY

Per temporal-patterns spec invariant #9, the parent Workflow should be the primary UI object. However, `PrReviewWorkflow` has no app-side DB record — only its child `GraphRunWorkflow` creates a `graph_runs` entry. The parent is visible in Temporal UI only, not the product dashboard.

**Accepted for task.0191 scope:** The child graph run as `system_webhook` is sufficient for P2 visibility. Evolving the dashboard to show parent workflow runs with child drill-down is a separate product initiative (requires `workflow_runs` table or `parent_workflow_id` on `graph_runs`).

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
webhook route → workflowClient.start("PrReviewWorkflow", { installationId, owner, repo, prNumber, headSha }) → exit

PrReviewWorkflow (Temporal):
  1. Activity: createCheckRun    (GitHub write — "in_progress" immediately, returns checkRunId)
  2. Activity: fetchPrContext    (GitHub API reads: diff, metadata, repo-spec, rules — retryable)
     → creds resolved from worker env via installationId, not workflow input
     → truncate large diffs to stay within Temporal payload limits
  3. Child: GraphRunWorkflow("langgraph:pr-review")
     → graph owns all domain logic: gate orchestration, criteria eval, formatting
     → graph returns structured artifact: {conclusion, gateResults, summary}
     → graph_runs record created (dashboard visibility as system_webhook)
  4. Activity: postReviewResult  (GitHub writes — idempotent via business key)
     → updateCheckRun(checkRunId, conclusion, summary)
     → postPrComment (staleness guard: check headSha still matches)
     → on graph failure: updateCheckRun to "neutral" with error
```

## Allowed Changes

- `services/scheduler-worker/src/workflows/` — new `PrReviewWorkflow`
- `services/scheduler-worker/src/activities/` — new review activities
- `services/scheduler-worker/src/worker.ts` — register new workflow in bundle
- `services/scheduler-worker/src/bootstrap/` — env/container for GitHub creds
- `apps/operator/src/app/_facades/review/dispatch.server.ts` — simplify to Temporal start
- `apps/operator/src/features/review/` — may simplify or remove handler orchestration
- `packages/langgraph-graphs/` — ensure pr-review graph returns structured artifact
- Tests

## Design Decisions (from design review)

1. **Gate orchestration stays in the graph** — activities are I/O-only. No package extraction (WORKER_IS_DUMB). Domain logic (gate evaluation, criteria comparison, summary formatting) lives in the `pr-review` graph, not in activities.
2. **Split check run into two activities** — `createCheckRunActivity` (step 1) shows "in progress" immediately; `postReviewResultActivity` (step 4) updates check run + posts comment. Avoids UX regression of no feedback during LLM execution.
3. **Use existing `GitHubAppTokenProvider`** — worker bootstrap already creates it from env. Activities pass `installationId` from workflow input to scope auth. Single-tenant, no multi-tenant abstraction.
4. **Diff truncation** — `fetchPrContextActivity` truncates large diffs to stay within Temporal's ~2MB per-event payload limit.

## Plan

- [ ] **Checkpoint 1: PrReviewWorkflow skeleton + bootstrap**
  - New workflow with activity stubs (createCheckRun, fetchPrContext, postReviewResult)
  - Activities use existing GitHubAppTokenProvider from container
  - Register in worker bundle
  - Validation: `pnpm check` passes, worker starts

- [ ] **Checkpoint 2: Activities + graph structured output**
  - Implement createCheckRunActivity (GitHub API — create "in_progress" check run)
  - Implement fetchPrContextActivity (GitHub API — diff, metadata, repo-spec from target repo, rule files; truncate large diffs)
  - Implement postReviewResultActivity (idempotent GitHub writes, staleness guard, business-key idempotency)
  - Activities resolve GitHub App creds from worker env/container via installationId (not workflow input)
  - Ensure pr-review graph returns structured decision artifact (domain logic stays in graph)
  - Validation: `pnpm check` passes

- [ ] **Checkpoint 3: Wire webhook → Temporal**
  - Refactor dispatchPrReview to start PrReviewWorkflow
  - Remove inline execution path (createGraphExecutor, createScopedGraphExecutor, handlePrReview)
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

## Review Feedback (revision 2)

**Blocking — must fix before merge:**

1. **`route.ts:468-475` — `responseFormat` not forwarded to `runGraph()`**. The internal API route does not pass `responseFormat` from the input payload to the graph executor. Without this, `structuredOutput` will always be `undefined`, making parent-child workflow composition non-functional. Fix: add `responseFormat` parsing + forwarding in the `runGraph()` call.

2. **`review.ts:301-326` — JSON Schema vs Zod schema format**. The activity builds `responseFormat` as a raw JSON Schema object, but the existing inline path (`ai-rule.ts:85-90`) passes a Zod schema. Verify the executor accepts both, or use the same Zod schema approach (import `EvaluationOutputSchema` from the feature layer or duplicate in domain module).

**Non-blocking suggestions:**

- Remove dead IIFE at `review.ts:370-377` (DAO config extraction always returns undefined)
- Cache Octokit per installationId in activity factory closure
- Add test for `evaluateGraphResult` bridge function
- Remove env var check in `dispatch.server.ts:44-50` (worker owns cred validation now)

## PR / Links

- Handoff: [handoff](../handoffs/task.0191.handoff.md)

## Attribution

-
