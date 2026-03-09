---
id: task.0035
type: task
title: Thread history sidebar — list, switch, load conversations
status: done
priority: 1
estimate: 3
summary: Add thread list API + sidebar UI to the chat page so users can see past conversations, switch between them, and start new threads.
outcome: Users see a thread list sidebar in /chat, can switch threads (loading history from DB), and start new conversations. Thread list fetched via GET /api/v1/ai/threads.
spec_refs: thread-persistence
assignees: derekg1729
credit:
project: proj.thread-persistence
branch: feat/task-0035-thread-sidebar
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-14
labels: [ai-graphs, ui]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Thread history sidebar — list, switch, load conversations

## Requirements

- `GET /api/v1/ai/threads` returns `ThreadSummary[]` for the authenticated user (paginated, recency-ordered)
- `GET /api/v1/ai/threads/[stateKey]` returns `UIMessage[]` for a specific thread (loads full history)
- Chat page shows a collapsible thread list sidebar (left side, Sheet or panel)
- Each thread row displays: preview text (first user message snippet), updated timestamp, message count
- Clicking a thread loads its messages into the assistant-ui runtime and sets the active `stateKey`
- "New thread" button clears the current conversation and resets `stateKey` (server generates new one on first send)
- Thread soft-delete action (swipe or button) calls existing `softDelete` on the port
- All thread access is RLS-scoped (TENANT_SCOPED invariant upheld)
- Contract-first: Zod schemas in `src/contracts/ai.threads.v1.contract.ts`

## Allowed Changes

- `src/contracts/ai.threads.v1.contract.ts` — **new**: thread list + thread load contracts
- `src/app/api/v1/ai/threads/route.ts` — **new**: GET handler (list threads)
- `src/app/api/v1/ai/threads/[stateKey]/route.ts` — **new**: GET handler (load thread), DELETE handler (soft-delete)
- `src/app/_facades/ai/threads.server.ts` — **new**: facade wiring auth → port
- `src/app/(app)/chat/layout.tsx` — modify: add sidebar slot
- `src/app/(app)/chat/page.tsx` — modify: thread switching state, sidebar toggle
- `src/app/(app)/chat/_api/` — **new**: client fetch wrappers (fetchThreads, fetchThread, deleteThread)
- `src/components/kit/chat/ThreadList.tsx` — **new**: presentational thread list component
- `src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx` — modify: thread switching (stateKey + message loading)
- `tests/contract/ai/threads.contract.test.ts` — **new**: contract tests for thread endpoints
- `tests/unit/features/ai/` — unit tests for new components

## Plan

- [ ] Define `ai.threads.v1.contract.ts` — list input (limit, cursor), list output (ThreadSummary[]), load output (UIMessage[])
- [ ] Create `threads.server.ts` facade — resolve session user, call `threadPersistenceForUser(userId).listThreads()` / `.loadThread()`
- [ ] Create `GET /api/v1/ai/threads` route — parse query params, call facade, return contract output
- [ ] Create `GET /api/v1/ai/threads/[stateKey]` route — load thread messages for authenticated user
- [ ] Create `DELETE /api/v1/ai/threads/[stateKey]` route — soft-delete thread
- [ ] Create client-side fetch wrappers in `chat/_api/`
- [ ] Build `ThreadList.tsx` kit component — list items with preview, timestamp, message count, delete action
- [ ] Integrate sidebar into chat layout — Sheet (mobile) or side panel (desktop), toggle button
- [ ] Wire `ChatRuntimeProvider` for thread switching — on thread select: set stateKey, load messages into runtime
- [ ] Add "New thread" action — clear stateKey, reset runtime messages
- [ ] Contract tests: list returns owned threads only, load returns messages, soft-delete removes from list
- [ ] Verify RLS: thread list and load respect tenant isolation (existing stack tests cover adapter layer)

## Validation

**Command:**

```bash
pnpm test tests/contract/ai/threads.contract.test.ts
pnpm test tests/unit/features/ai/
pnpm check
```

**Expected:** All tests pass. Thread list endpoint returns only authenticated user's threads. Thread switching loads correct history.

## Review Checklist

- [ ] **Work Item:** `task.0035` linked in PR body
- [ ] **Spec:** TENANT_SCOPED, STATE_KEY_LIFECYCLE, SERVER_OWNS_MESSAGES invariants upheld
- [ ] **Tests:** Contract tests for all three endpoints, unit tests for ThreadList component
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0035.handoff.md)

## Attribution

-
