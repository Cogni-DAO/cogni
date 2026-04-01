---
id: task.0252
type: task
title: "Strip AI runtime deps from Next.js image"
status: needs_implement
priority: 1
rank: 23
estimate: 1
summary: Remove Codex SDK, internal API route, and AI adapter code from apps/operator now that execution runs in scheduler-worker
outcome: "Next.js image drops ~283 MB; apps/operator is a thin web layer (auth, SSE, threads, UI)"
spec_refs:
  - spec.unified-graph-launch
assignees: []
credit:
project: proj.unified-graph-launch
branch: feat/worker-local-execution
pr:
reviewer:
revision: 0
blocked_by:
  - task.0251
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels:
  - ai-graphs
  - docker
external_refs:
---

# Strip AI runtime deps from Next.js image

## Context

Parent: task.0181. Step 3 of 3. After task.0248 wires execution in the scheduler-worker, the internal API route in Next.js is dead code. Remove it and all AI runtime deps.

## Requirements

- Remove `/api/internal/graphs/[graphId]/runs` route
- Remove `graph-executor.factory.ts` (or reduce to stub if needed for dev mode)
- Remove Codex SDK from Dockerfile (`pnpm add -g @openai/codex` + `COPY node_modules/@openai/`)
- Remove unused AI packages from `apps/operator/package.json` (LangGraph, ai-tools, etc.)
- Update `docs/spec/unified-graph-launch.md`: retire `EXECUTION_VIA_SERVICE_API` invariant, update `STREAM_PUBLISH_IN_EXECUTION_LAYER` to reference worker
- Verify image size: target < 650 MB virtual (down from 900 MB)

## Files

**Delete: `apps/operator/src/app/api/internal/graphs/[graphId]/runs/route.ts`**
**Delete: `apps/operator/src/bootstrap/graph-executor.factory.ts`**
**Delete: AI adapter files** no longer imported by any remaining code

**Modify: `apps/operator/Dockerfile`**

- Remove Codex SDK install + copy layers
- Remove any AI-specific native deps

**Modify: `apps/operator/package.json`**

- Remove: `@cogni/graph-execution-host`, `@cogni/ai-tools`, `@cogni/langgraph-graphs` (if no other consumer)
- Remove: `@openai/codex`, `@openai/codex-sdk`

**Modify: `docs/spec/unified-graph-launch.md`**

- Retire `EXECUTION_VIA_SERVICE_API` (replaced by in-process execution in worker)
- Update `STREAM_PUBLISH_IN_EXECUTION_LAYER` to say "worker activity" not "internal API route"

## Validation

```bash
# Image size check
docker build -t cogni-template-local:latest -f apps/operator/Dockerfile . && docker images cogni-template-local:latest
# Target: virtual < 650 MB (down from 900 MB)

# Full check
pnpm check

# Stack tests still pass (execution via worker, not this route)
pnpm dev:stack:test
pnpm dotenv -e .env.test -- vitest run --config vitest.stack.config.mts
```
