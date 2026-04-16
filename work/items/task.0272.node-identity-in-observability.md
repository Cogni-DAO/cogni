---
id: task.0272
type: task
title: "Wire nodeId from repo-spec into logger base bindings and metrics default labels"
status: needs_merge
priority: 0
rank: 1
estimate: 1
summary: "Implement NODE_IDENTITY_IN_OBSERVABILITY — resolve nodeId via getNodeId() at bootstrap, pass to makeLogger() base bindings and metricsRegistry default labels across all 4 apps."
outcome: "Every log line and every Prometheus metric series carries nodeId (UUID from repo-spec). Zero call-site changes. Pino base bindings and prom-client default labels handle propagation."
spec_refs:
  - docs/spec/observability.md
assignees: derekg1729
credit:
project: proj.operator-plane
branch: worktree-cd-pipeline-analysis
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02
labels: [observability, multi-node, identity]
external_refs:
---

# Wire nodeId from repo-spec into logger and metrics

## Requirements

- Every log line carries `nodeId` (UUID) via Pino base bindings — inherited by all child loggers
- Every Prometheus metric series carries `node_id` label via `setDefaultLabels()`
- Source of truth is `.cogni/repo-spec.yaml` via `getNodeId()` (REPO_SPEC_IS_SOURCE)
- No hand-authored env vars for node identity
- No call-site changes — base bindings propagate automatically
- Falls back to `"unknown"` in unit tests where repo-spec is absent

## Allowed Changes

- `apps/operator/src/bootstrap/container.ts` — resolve nodeId before makeLogger
- `nodes/*/app/src/bootstrap/container.ts` — same pattern (3 nodes)
- `apps/operator/src/shared/observability/server/metrics.ts` — add readNodeIdForMetrics + node_id label
- `nodes/*/app/src/shared/observability/server/metrics.ts` — same pattern (3 nodes)

## Plan

- [x] Resolve `getNodeId()` before `makeLogger()` in all 4 container.ts files
- [x] Pass `nodeId` as binding to `makeLogger({ service, nodeId })`
- [x] Reuse resolved `nodeId` variable in Container return (no duplicate call)
- [x] Add `readNodeIdForMetrics()` to all 4 metrics.ts files (reads repo-spec at module scope via `@cogni/repo-spec` pure functions)
- [x] Add `node_id` to `metricsRegistry.setDefaultLabels()`
- [x] `pnpm check:fast` passes

## Validation

**Command:**

```bash
pnpm check:fast
```

**Expected:** All typechecks, lint, and tests pass.

## Review Checklist

- [x] **Work Item:** `task.0272` linked in PR body
- [x] **Spec:** NODE_IDENTITY_IN_OBSERVABILITY invariant upheld
- [x] **Tests:** existing tests pass (no call-site changes needed)
- [ ] **Reviewer:** assigned and approved

## Attribution

- Design review and spec updates in same session (8e698495c)
