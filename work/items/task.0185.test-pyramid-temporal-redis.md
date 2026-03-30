---
id: task.0185
type: task
title: "Migrate spy-based observability tests to correct test pyramid layer"
status: needs_triage
priority: 1
rank: 6
estimate: 2
summary: Langfuse, metrics, and billing-idempotency stack tests used in-process spies that no longer reach the decorator stack after Temporal+Redis migration. Replace with internal-route-level tests and black-box smoke tests.
outcome: Observability test coverage restored at the right seam — internal route for decorator behavior, black-box for end-to-end parity
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by:
  - task.0177
created: 2026-03-18
updated: 2026-03-18
labels:
  - testing
  - ai-graphs
---

# Migrate Spy-Based Observability Tests

## Context

After task.0177, the chat/completions facade starts a Temporal workflow and subscribes to Redis — it no longer calls `GraphExecutorPort.runGraph()` inline. Stack tests that injected `SpyLangfusePort` or checked in-process metrics via `vi.mock("@/bootstrap/container")` can't intercept decorator calls because the decorator stack runs in the internal API route (triggered by Temporal activity), not in the facade.

The product code is correct — the full decorator stack (Langfuse, billing, preflight, observability) still runs in the internal API route. The test pyramid is pointed at the wrong layer.

## Requirements

- **Internal route tests**: Test `POST /api/internal/graphs/{graphId}/runs` directly (no Temporal hop) to verify Langfuse traces, metrics recording, and billing decorator behavior. These are component-level tests.
- **Black-box smoke tests** (1-2): Real HTTP calls to the dev server chat endpoint, wait for workflow completion, scrape `/api/metrics` for counter increments and/or query Langfuse API for traces. True stack tests.
- Remove quarantined `.skip` from migrated tests once replacement coverage lands.

## Quarantined Tests

- `tests/stack/ai/langfuse-observability.stack.test.ts` — 8 tests, `describe.skip`
- `tests/stack/meta/metrics-instrumentation.stack.test.ts` — LLM metrics describe, `describe.skip`
- `tests/stack/ai/billing-idempotency.stack.test.ts` — timeout, needs internal-route-level test

## Plan

- [ ] **Checkpoint 1**: Write internal-route-level tests for Langfuse + metrics + billing decorator
- [ ] **Checkpoint 2**: Write 1-2 black-box smoke tests (real Temporal + Redis)
- [ ] **Checkpoint 3**: Remove `.skip` from old tests or delete them

## Validation

```bash
pnpm check
pnpm test:stack:dev
```
