---
id: proj.agent-workforce.handoff
type: handoff
work_item_id: proj.agent-workforce
status: active
created: 2026-03-30
updated: 2026-03-30
branch: feat/scheduled-sweep-v0
last_commit: 3af89bf0
---

# Handoff: Agent Workforce — Autonomous Operator Agents

## Context

- Goal: autonomous AI agents that run on Temporal schedules, process work items, and take actions (merge PRs, triage tickets, research OSS tools)
- The system already has a working agent pattern: `PrReviewWorkflow` (webhook → graph → structured output → GitHub write-back). This is the template.
- Session produced a spec (`docs/spec/agent-roles.md` on `feat/mission-control-clean`), a graph factory, and a sweep workflow — but **no tools, no tested execution, no useful agent output**
- The real blocker is that agents have no tools to act with — they can reason but can't do anything
- Prompts should be managed via Langfuse (already integrated for observability), not hardcoded TypeScript constants. This was identified late.

## Current State

- **Branch `feat/scheduled-sweep-v0`**: 2 clean commits on staging. Compiles, `pnpm check:fast` passes.
  - Commit 1: `systemPrompt` field added to graph factory pipeline + `createOperatorGraph` factory + CEO/Git Reviewer catalog entries
  - Commit 2: `ScheduledSweepWorkflow` + `RoleSpec` type + sweep activities wired into scheduler-worker
- **Never tested against running stack** — workflow has never executed
- **No tools built** — agents can only call `get_current_time` and `metrics_query`
- **No Langfuse prompt management** — prompts are hardcoded strings in `graphs/operator/prompts.ts`
- **No Temporal schedules created** — nothing fires the sweep workflow
- **Design docs on `feat/mission-control-clean`** (PR #562, 24 commits, messy) — spec is useful, code is superseded by `feat/scheduled-sweep-v0`

## Decisions Made

- Three-axis architecture: capability (graph config) × workflow shape (Temporal) × domain activities (shared by integration) — see `docs/spec/agent-roles.md` on `feat/mission-control-clean`
- `PrReviewWorkflow` is the webhook shape. `ScheduledSweepWorkflow` is the cron shape. New shape only when trigger/lifecycle materially differs.
- `createReactAgent` is deprecated in LangGraph v1 — `createOperatorGraph` uses `prompt` param (non-deprecated), wraps as migration seam
- Work item `claim()`/`release()` exists on `WorkItemCommandPort` but skipped for v0 — Temporal `overlap: SKIP` prevents concurrent runs

## Next Actions

- [ ] Build agent tools: `work_item_query`, `work_item_transition` in `@cogni/ai-tools` — this is the actual blocker
- [ ] Move prompts to Langfuse instead of hardcoded TypeScript strings
- [ ] Create Temporal schedule that fires `ScheduledSweepWorkflow` with CEO config
- [ ] Test end-to-end with `pnpm dev:stack` — verify the sweep picks an item and the graph responds usefully
- [ ] Build GitHub tools: `github_pr_read`, `github_pr_status` for Git Reviewer role
- [ ] Add `discord_post` tool so agents can report what they did
- [ ] Wire KPI measurement — each sweep run should emit structured metrics (Langfuse traces already capture cost)

## Risks / Gotchas

- **PR #562 is stale** — 24 commits, design churn, carries old OpenClaw mc-controller code. Don't merge it. Use `feat/scheduled-sweep-v0` instead.
- **Work items are markdown files** on disk, not DB rows. The sweep activity fetches via the app's REST API (`/api/v1/work/items`). The API must be running.
- **System billing account** (`billingAccountId`, `virtualKeyId`) must be resolved for `GraphRunWorkflowInput` — check how `PrReviewWorkflow` gets these from the webhook input
- **Cost control** — agents running on schedules will burn LLM credits. Use `gpt-4o-mini` for operator roles. Flash models for research.
- **Langfuse prompt versioning** is the right path for prompt management + A/B testing + KPI correlation. Don't build a custom prompt registry.

## Pointers

| File / Resource                                                         | Why it matters                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `packages/langgraph-graphs/src/graphs/operator/graph.ts`                | `createOperatorGraph` factory — the migration seam           |
| `packages/langgraph-graphs/src/catalog.ts`                              | Catalog entries for ceo-operator + git-reviewer              |
| `packages/temporal-workflows/src/workflows/scheduled-sweep.workflow.ts` | The sweep workflow (untested)                                |
| `packages/temporal-workflows/src/workflows/pr-review.workflow.ts`       | The proven pattern to follow                                 |
| `services/scheduler-worker/src/activities/sweep.ts`                     | Sweep activities (fetch items, log result)                   |
| `services/scheduler-worker/src/worker.ts`                               | Where activities are registered                              |
| `packages/work-items/src/ports.ts`                                      | `WorkItemCommandPort.claim()`/`release()` for future locking |
| `packages/ai-tools/src/`                                                | Where new tools need to go                                   |
