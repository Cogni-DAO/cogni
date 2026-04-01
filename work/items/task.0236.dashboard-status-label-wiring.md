---
id: task.0236
type: task
title: "Dashboard statusLabel wiring — RunCard shows live phase from SSE"
status: needs_design
priority: 1
rank: 2
estimate: 2
summary: "Wire the RunCard statusLabel field to live StatusEvent data from the SSE reconnection endpoint. Running cards show 'Thinking...', 'Using tools...' instead of static 'Running'."
outcome: "Dashboard RunCards with status=running show real-time phase labels from StatusEvent stream. Falls back to 'Running' when no status events available."
spec_refs:
assignees: []
credit:
project: proj.premium-frontend-ux
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-30
labels: [ui, dashboard, ai-graphs]
external_refs:
---

# Dashboard StatusLabel Wiring

## Requirements

1. Create `useRunActivity(runId)` hook that connects to `GET /api/v1/ai/runs/{runId}/stream` via EventSource
2. Hook returns `{ phase, label }` from latest StatusEvent, or null when idle/terminal
3. Dashboard view connects running RunCards to `useRunActivity` hook
4. RunCard renders `statusLabel` from hook output instead of null
5. EventSource reconnects with `Last-Event-ID` header on disconnect

## Allowed Changes

- `apps/operator/src/features/ai/hooks/useRunActivity.ts` — new hook
- `apps/operator/src/app/(app)/dashboard/view.tsx` — wire hook to running cards
- `apps/operator/src/components/kit/data-display/RunCard.tsx` — minor: accept external statusLabel override

## Plan

- [ ] Create `useRunActivity` hook wrapping EventSource + reconnection logic
- [ ] Wire into dashboard view for running cards only (avoid SSE connection spam for completed cards)
- [ ] Test with running graph execution in dev stack

## Validation

```bash
pnpm check:fast
```
