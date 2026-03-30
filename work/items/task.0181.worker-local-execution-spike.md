---
id: task.0181
type: task
title: "Spike: Worker-local graph execution — evaluate and design"
status: needs_triage
priority: 2
rank: 99
estimate: 2
summary: Evaluate whether scheduler-worker should execute graphs directly (eliminating internal API hop) and design the package extraction if justified
outcome: Decision document with latency/reliability data; if warranted, a concrete design for @cogni/graph-execution-host package and migration plan
spec_refs:
  - spec.unified-graph-launch
  - packages-architecture-spec
assignees: []
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
revision: 0
blocked_by:
  - task.0176
  - task.0177
deploy_verified: false
created: 2026-03-18
updated: 2026-03-18
labels:
  - ai-graphs
  - scheduler
external_refs:
---

# Spike: Worker-local graph execution — evaluate and design

## Context

task.0176 (2026-03-18 design decision) explicitly deferred worker-local execution:

> Execution stays in `apps/web` via the existing internal API route. If worker-local execution becomes necessary later, that's a separate task with its own package (`graph-execution-host` or similar).

Currently, the scheduler-worker calls `POST /api/internal/graphs/{graphId}/runs` via HTTP to execute graphs. The internal API route in `apps/web` owns the full execution stack (providers, decorators, factory, Redis pump). This adds an HTTP hop and couples execution availability to the Next.js process.

This spike evaluates whether that indirection causes measurable problems and, if so, designs the extraction.

## Requirements

- Measure internal API hop latency overhead (p50/p95/p99) from existing Grafana metrics or targeted instrumentation
- Document reliability failure modes: what happens when `apps/web` is deploying/restarting during a scheduled run?
- Identify the full dependency tree that would need to move: providers, decorators, factory, env config, feature-layer functions (`executeStream`, `preflightCreditCheck`)
- Evaluate package boundaries: can `@cogni/graph-execution-host` satisfy `PURE_LIBRARY` (no process lifecycle) or does it need to be a service?
- If justified: design the package shape, migration plan, and which invariants change (particularly `EXECUTION_VIA_SERVICE_API` and `STREAM_PUBLISH_IN_EXECUTION_LAYER`)
- If NOT justified: document why and close as "not warranted"

## Trigger conditions (when to prioritize this spike)

- Observed p95 latency > 200ms on the internal API hop (excluding graph execution time)
- Observed execution failures during `apps/web` deploys
- Need for >1 execution host (horizontal scaling of graph execution independent of web)
- Desire to eliminate the internal API route entirely

## Allowed Changes

- `docs/research/` — spike output document
- `work/items/` — follow-up task(s) if warranted
- No code changes in this spike

## Plan

- [ ] Collect latency data for `executeGraphActivity` HTTP calls (Grafana or targeted measurement)
- [ ] Document the full adapter dependency tree that would need extraction
- [ ] Evaluate `PURE_LIBRARY` vs service boundary for the extracted package
- [ ] Write decision document: proceed or defer, with supporting data
- [ ] If proceed: create follow-up implementation task(s)

## Validation

**Command:**

```bash
pnpm check:docs
```

**Expected:** Docs pass. Decision document exists in `docs/research/`.

## Review Checklist

- [ ] **Work Item:** task.0181 linked in PR body
- [ ] **Spec:** Decision is consistent with packages-architecture-spec and unified-graph-launch invariants
- [ ] **Tests:** N/A (spike — no code changes)
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
