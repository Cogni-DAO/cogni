---
id: task.0018
type: task
title: "Dynamic agent catalog in UI + OpenClaw model sync"
status: needs_design
priority: 1
estimate: 1
summary: Replace hardcoded AVAILABLE_GRAPHS with useAgents() hook fetching from existing API, and sync LiteLLM model catalog into openclaw-gateway.json.
outcome: Agent picker driven by API catalog; OpenClaw gateway knows about all LiteLLM models.
spec_refs:
  - openclaw-sandbox-controls-spec
  - openclaw-sandbox-spec
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-10
updated: 2026-02-10
labels: [openclaw, ui, catalog]
external_refs:
  - docs/research/openclaw-ui-alignment.md
assignees: derekg1729
credit:
revision: 0
blocked_by:
deploy_verified: false
rank: 13
---

# Dynamic agent catalog in UI + OpenClaw model sync

## Requirements

- `ChatComposerExtras.tsx` no longer contains a hardcoded `AVAILABLE_GRAPHS` array
- Agent list fetched from `GET /api/v1/ai/agents` via `useAgents()` hook
- `GraphPicker` shows loading state while fetching
- `openclaw-gateway.json` models array contains all models from `litellm.config.yaml` (currently 2, should be 16)
- Invariant CATALOG_FROM_API (inv 21) satisfied

## Allowed Changes

- `src/features/ai/hooks/useAgents.ts` (new)
- `src/features/ai/components/ChatComposerExtras.tsx`
- `src/features/ai/components/GraphPicker.tsx` (loading state)
- `src/app/(app)/chat/page.tsx` (default agent from API)
- `services/sandbox-openclaw/openclaw-gateway.json` (models array)
- `scripts/sync-openclaw-models.mjs` (new, optional — or manual sync is fine)

## Plan

- [ ] Create `useAgents()` hook — `useQuery` wrapping `GET /api/v1/ai/agents`, 5min staleTime
- [ ] Wire into `ChatComposerExtras` replacing `AVAILABLE_GRAPHS`
- [ ] Add loading/empty state to `GraphPicker`
- [ ] Sync all 16 LiteLLM models into `openclaw-gateway.json` models array
- [ ] `pnpm check`

## Validation

```bash
pnpm check
```

**Manual:** Chat page agent picker shows API-driven list; OpenClaw gateway config has all models.

## Review Checklist

- [ ] **Work Item:** `task.0018` linked in PR body
- [ ] **Spec:** CATALOG_FROM_API (inv 21) — no hardcoded agent arrays in UI
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
