---
id: task.0180
type: task
title: "Emit neutral usage facts from providers — remove billing identity from inner executor"
status: needs_design
priority: 1
rank: 10
estimate: 2
summary: "Providers emit usage_report events without billingAccountId/virtualKeyId. A billing-aware decorator enriches events with billing identity upstream. Removes the need for AsyncLocalStorage billing scope in the static inner executor."
outcome: "Inner providers (InProc, LangGraph, Sandbox) emit neutral usage facts. Billing identity added by a decorator in the per-run wrapper layer. ExecutionScope ALS can be removed or reduced to abortSignal only."
spec_refs:
  - spec.unified-graph-launch
assignees: []
project: proj.unified-graph-launch
blocked_by:
  - task.0179
created: 2026-03-16
updated: 2026-03-16
branch:
labels:
  - ai-graphs
  - architecture
---

# Emit Neutral Usage Facts from Providers

## Context

task.0179 introduced `AsyncLocalStorage<ExecutionScope>` to carry billing context to static inner providers that emit `usage_report` events with `billingAccountId` + `virtualKeyId`. This is a known boundary smell — providers in the pure execution layer shouldn't know about billing identity.

## Requirements

- Providers emit `usage_report` events without `billingAccountId` or `virtualKeyId`
- A per-run billing enrichment decorator (in the wrapper layer) intercepts `usage_report` events and adds billing fields before they reach the observability/billing decorators
- `ExecutionScope` ALS can be reduced to `abortSignal?` only (or removed entirely if abort is also addressed)

## Allowed Changes

- `apps/web/src/adapters/server/ai/inproc-completion-unit.adapter.ts`
- `apps/web/src/adapters/server/ai/langgraph/dev/stream-translator.ts`
- `apps/web/src/adapters/server/sandbox/sandbox-graph.provider.ts`
- `apps/web/src/adapters/server/ai/execution-scope.ts`
- `apps/web/src/bootstrap/graph-executor.factory.ts`
- New: billing enrichment decorator
- Tests

## Validation

```bash
pnpm check
pnpm test
```
