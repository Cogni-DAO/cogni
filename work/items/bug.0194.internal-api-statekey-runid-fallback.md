---
id: bug.0194
type: bug
title: "Internal graph API conflates stateKey with runId — headless runs create phantom threads"
status: needs_triage
priority: 3
rank: 50
estimate: 1
summary: "Internal API route falls back stateKey=runId when no stateKey provided. Headless graph runs (PR review, system webhooks) create throwaway thread entries in the DB."
outcome: "stateKey=undefined for headless runs; thread persistence skipped when no conversation context"
spec_refs: [temporal-patterns-spec]
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
labels: [ai-graphs, data-quality]
---

# Internal graph API conflates stateKey with runId

## Symptoms

- `POST /api/internal/graphs/{graphId}/runs` falls back `stateKey = runId` when input has no stateKey (route.ts line 376-378)
- Every headless run (PR review, system webhook) creates a phantom thread entry keyed by a one-off runId
- Thread persistence at line 553 runs because `stateKey` is always truthy after fallback
- DB accumulates meaningless thread records for non-conversational runs

## Root Cause

The route was designed for scheduled graph runs which always have a conversation context. The fallback made sense then. With webhook-triggered headless runs (task.0191), stateKey should be undefined — no thread, no persistence.

## Proposed Fix

- When `input.stateKey` is absent/empty AND `executionGrantId` is null (API-originated): set `stateKey = undefined`
- Thread persistence guard at line 553 (`if (stateKey && actorUserId)`) already handles undefined correctly
- No schema changes needed

## Validation

```bash
pnpm check
```

## Attribution

-
