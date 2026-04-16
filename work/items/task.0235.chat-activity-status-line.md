---
id: task.0235
type: task
title: "Chat activity status line — consume StatusEvent in thread UI"
status: needs_design
priority: 1
rank: 1
estimate: 2
summary: "Add a 1-line activity indicator above the chat composer that shows the current agent phase (thinking, tool_use, compacting) from StatusEvent data-status chunks. Replaces the invisible thinking gap."
outcome: "Users see 'Thinking...', 'Using search_web...', 'Compacting context...' in real-time while the AI is working. Fades in/out with Framer Motion. Auto-dismisses on text_delta or done."
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
labels: [ui, chat, ai-graphs]
external_refs:
---

# Chat Activity Status Line

## Requirements

1. Subscribe to `data-status` transient chunks from `@assistant-ui/react` runtime
2. Render a `<StatusLine>` component between last message and composer
3. Show phase-appropriate icon + text:
   - `thinking` → brain icon + "Thinking..."
   - `tool_use` → wrench icon + "Using {label}..." (label = tool name)
   - `compacting` → compress icon + "Compacting context..."
4. Animate enter/exit with Framer Motion (fade + slide)
5. Auto-dismiss when first `text_delta` arrives or stream ends (`done`)

## Allowed Changes

- `apps/operator/src/components/vendor/assistant-ui/thread.tsx` — add StatusLine to AssistantMessage or Thread
- `apps/operator/src/components/kit/chat/StatusLine.tsx` — new component
- `apps/operator/src/features/ai/chat/` — hook to consume status events if needed

## Plan

- [ ] Prototype: verify `@assistant-ui/react` exposes `data-status` chunks via runtime API or message parts
- [ ] Create `StatusLine` component with phase icon map + Framer Motion animations
- [ ] Wire into Thread component (render between messages and composer when running)
- [ ] Test with manual StatusEvent emission in dev

## Validation

```bash
pnpm check:fast
```
