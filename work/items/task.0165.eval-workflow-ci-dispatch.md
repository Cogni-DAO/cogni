---
id: task.0165
type: task
title: "Create eval.yaml workflow with repository_dispatch and schedule"
status: needs_design
priority: 1
rank: 12
estimate: 2
summary: "Separate GitHub Actions workflow for AI evals. Tier 1 triggered by repository_dispatch from CI on AI path changes. Tier 2 on nightly schedule. Posts GitHub commit status."
outcome: "eval.yaml workflow exists. CI fires dispatch on AI code changes (non-blocking). Eval workflow runs experiments and posts commit status linking to Langfuse."
spec_refs: ai-evals-spec
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0164
deploy_verified: false
created: 2026-03-13
updated: 2026-03-13
labels: [ai, evals, ci, langfuse]
external_refs:
  - docs/research/ai-eval-pipeline-architecture.md
---

# Create eval.yaml workflow with repository_dispatch and schedule

## Requirements

- `.github/workflows/eval.yaml` with three triggers:
  - `repository_dispatch` (type: `ai-code-changed`) — Tier 1, per-PR
  - `schedule` (nightly cron) — Tier 2
  - `workflow_dispatch` — manual with tier selection input
- CI path filter step in `ci.yaml` that fires `repository_dispatch` when AI paths change:
  - `packages/langgraph-graphs/**`
  - `packages/ai-core/**`, `packages/ai-tools/**`
  - `apps/web/src/features/ai/**`, `apps/web/src/adapters/server/ai/**`, `apps/web/src/shared/ai/**`
  - `evals/**`
- Eval workflow posts GitHub commit status (`pending` → `success`/`failure`) via `gh api`
- Commit status links to Langfuse experiment run URL
- Job timeout: 5min (Tier 1), 15min (Tier 2)
- Cost budget guard in workflow (fail-safe if spend exceeds threshold)

## Key decisions

- CI has ZERO network dependency on eval infrastructure — dispatch is fire-and-forget
- Eval results are non-blocking initially (informational commit status, not required check)
- Can promote to required check after pipeline is proven stable

## Allowed Changes

- `.github/workflows/eval.yaml` (new)
- `.github/workflows/ci.yaml` (add dispatch step)

## Validation

```bash
# Manual trigger
gh workflow run eval.yaml -f tier=1

# Verify dispatch from CI
# Push AI code change, check that eval workflow triggers
```
