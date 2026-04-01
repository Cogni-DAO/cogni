---
id: task.0251
type: task
title: "Wire in-process graph execution in scheduler-worker"
status: needs_implement
priority: 1
rank: 22
estimate: 3
summary: Change executeGraphActivity from HTTP call to in-process execution via @cogni/graph-execution-host; add idempotency, Redis publish, and thread persistence to activity
outcome: "Scheduler-worker executes graphs directly; no HTTP hop to Next.js; Redis stream events published from worker"
spec_refs:
  - spec.unified-graph-launch
  - services-architecture-spec
assignees: []
credit:
project: proj.unified-graph-launch
branch: feat/worker-local-execution
pr:
reviewer:
revision: 0
blocked_by:
  - task.0250
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels:
  - ai-graphs
  - scheduler
external_refs:
---

# Wire in-process graph execution in scheduler-worker

## Context

Parent: task.0181. Step 2 of 3. After task.0247 extracts `@cogni/graph-execution-host`, the scheduler-worker can import it.

This task changes `executeGraphActivity` from an HTTP call to `apps/operator` internal API to an in-process graph execution call. The activity absorbs the responsibilities that were in the internal API route: idempotency enforcement, billing context resolution, Redis stream publishing, and thread persistence.

## Requirements

- `executeGraphActivity` calls `executor.runGraph()` in-process (no HTTP)
- Activity publishes all `AiEvent`s to Redis stream (per `STREAM_PUBLISH_IN_EXECUTION_LAYER`)
- Idempotency via `execution_requests` table (same dedup logic as internal API route)
- Thread persistence for `stateKey`-bearing runs (save assistant messages)
- Billing decorators fire (preflight credit check, usage commit, observability)
- Scheduler-worker Dockerfile includes AI runtime deps (Codex SDK, LangGraph, etc.)
- `SERVICE_ISOLATION` maintained — only `@cogni/*` imports, no `src/` imports

## Files

**Modify: `services/scheduler-worker/src/bootstrap/container.ts`**

- Add graph executor factory from `@cogni/graph-execution-host`
- Add Redis client for `RunStreamPort`
- Add DB adapters: `DrizzleExecutionRequestAdapter`, `DrizzleThreadPersistenceAdapter`
- Add model provider resolver, connection broker

**Modify: `services/scheduler-worker/src/activities/index.ts`**

- `executeGraphActivity`: replace `fetch()` with in-process executor call
- Add idempotency check/create/finalize around execution
- Add Redis stream publish loop (drain async iterable → publish)
- Add thread persistence post-execution

**Modify: `services/scheduler-worker/package.json`**

- Add: `@cogni/graph-execution-host`, `@cogni/ai-tools`, `@cogni/langgraph-graphs`, `@cogni/ai-core`

**Modify: `services/scheduler-worker/Dockerfile`**

- Add Codex SDK install (from apps/operator Dockerfile pattern)
- Add any native deps needed by providers (dockerode for sandbox, etc.)

**Test: `services/scheduler-worker/src/activities/__tests__/execute-graph.test.ts`**

- Unit test: in-process execution with mocked executor
- Unit test: idempotency dedup (duplicate request → skip)
- Unit test: Redis stream publish (events appear in stream)

## Validation

```bash
pnpm check
pnpm dev:stack:test
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts tests/stack/sandbox-llm-roundtrip-billing.stack.test.ts
```

**Expected:** Stack tests pass with execution flowing through worker, not Next.js internal API.
