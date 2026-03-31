---
id: task.0235
type: task
title: "Chat activity status line — consume StatusEvent in thread UI"
status: needs_merge
priority: 1
rank: 1
estimate: 2
summary: "Add a 1-line activity indicator in chat and dashboard that renders whatever the backend sends. Evolve StatusEvent to carry human-readable text (max 80 chars). Frontend is a dumb renderer — backend controls the message."
outcome: "Users see real-time status text during AI processing. Chat shows it above composer, dashboard RunCards show it as statusLabel. Backend sends the text, frontend just renders it."
spec_refs:
assignees: []
credit:
project: proj.premium-frontend-ux
branch: feat/chat-activity-status-line
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-31
labels: [ui, chat, ai-graphs, dashboard]
external_refs:
---

# Chat Activity Status Line

## Design

### Outcome

Real-time 1-line status text appears in chat (above composer) and on dashboard RunCards during AI processing. The **backend** decides what to display. The **frontend** is a dumb text renderer with a pulse animation.

### Approach

**Philosophy**: The UI renders whatever string the backend sends. No frontend enum mapping, no phase→icon hardcoding. Today the backend sends "Thinking...", tomorrow it sends AI-generated summaries like "Searching 12 files for auth patterns...". The frontend doesn't care — it's just a string and a dot.

**Backend change** (packages/ai-core):

- Add `text` field to `StatusEvent` (max 80 chars, optional for backward compat)
- `text` is the human-readable display string
- `phase` stays as animation hint (pulse style), not display text
- Update contract schema to include `text`

**Frontend** (2 components):

- `StatusLine.tsx` — renders `{ text, phase? }`. Pulse dot + text. Framer Motion enter/exit. That's it.
- Wire into `thread.tsx` (chat) and `RunCard` (dashboard) — both consume the same data shape

**Constraint**: `text` max 80 characters. Enforced at the type level, truncated at render.

**Reuses**:

- Existing `StatusEvent` → Redis → SSE pipeline (zero new infra)
- `@assistant-ui/react` `useThread` selector (chat)
- Existing SSE reconnection endpoint (dashboard RunCards)
- `framer-motion` (already installed)

**Rejected**:

- Hardcoded phase→icon map in frontend (couples UI to backend enum, blocks evolution)
- Separate hook per consumer (DRY violation — same data shape)

### Design Review Feedback (incorporated)

1. Use `useThread` with selector, not deprecated `useThreadRuntime`
2. Selector extracts only `isRunning` + last message data parts (perf)
3. StatusEvent already flows through Redis → SSE for RunCards

### Invariants

- [ ] STATUS_IS_EPHEMERAL: Status line is transient — never persisted
- [ ] STATUS_BEST_EFFORT: Missing text gracefully shows nothing (not an error)
- [ ] BACKEND_OWNS_TEXT: Frontend never generates display text from phase enum
- [ ] TEXT_MAX_80: Status text max 80 characters, truncated at render
- [ ] CONTRACTS_ARE_TRUTH: StatusEvent schema in ai-core is the single source

### Files

**Modify** (backend — packages):

- `packages/ai-core/src/events/ai-events.ts` — add `text?: string` to StatusEvent
- `apps/web/src/contracts/ai.completions.v1.contract.ts` — add `text` to CogniStatusSchema

**Modify** (emitters):

- `apps/web/src/adapters/server/sandbox/openclaw-gateway-client.ts` — populate `text` field
- `apps/web/src/app/api/v1/ai/chat/route.ts` — forward `text` in data-status chunk

**Create** (frontend):

- `apps/web/src/components/kit/chat/StatusLine.tsx` — dumb text renderer with pulse + animation

**Modify** (frontend wiring):

- `apps/web/src/components/vendor/assistant-ui/thread.tsx` — add StatusLine in running state

## Validation

```bash
pnpm check:fast
```
