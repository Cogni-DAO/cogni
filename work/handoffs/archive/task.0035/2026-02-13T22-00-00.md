---
id: task.0035.handoff
type: handoff
work_item_id: task.0035
status: active
created: 2026-02-13
updated: 2026-02-13
branch: feat/task-0035-thread-sidebar
last_commit: 9e7d7406
---

# Handoff: Thread History Sidebar

## Context

- Users lose their conversation on page refresh — no thread list, no way to resume a previous chat
- The persistence layer is fully built: `ai_threads` table with RLS, `ThreadPersistencePort` (loadThread, saveThread, softDelete, listThreads), `DrizzleThreadPersistenceAdapter`
- This task adds the thread list API routes, a left sidebar for thread navigation, and history loading on thread switch
- Design is ChatGPT-style: left sidebar (Sheet on mobile, fixed panel on desktop), auto-derived titles from first user message
- Approved plan with P0 exit criteria: [`~/.claude/plans/crispy-dancing-conway.md`](../../.claude/plans/crispy-dancing-conway.md)

## Current State

- **Done (Steps 1–5, data layer):** Port extended (`title` on ThreadSummary, `metadata` param on saveThread), contract defined, facade wired, API routes created, React Query hooks built, public.ts exports updated
- **Done:** `pnpm check` passes (typecheck, arch, docs, tests, format, lint all green)
- **Not committed:** All changes are unstaged in the worktree at `/Users/derek/dev/cogni-template-task-0035`
- **Not started (Steps 6–10, UI layer):** ThreadSidebar component, chat layout modification, chat page thread switching + abort, ChatRuntimeProvider initialMessages support, metadata population in chat route
- **Key open question (Step 9):** Whether `useChatRuntime` from `@assistant-ui/react-ai-sdk` accepts `initialMessages`. If not, must switch to `useChat` from `ai/react` + `useAssistantRuntime`. **No static prepend fallback** — must be single-timeline.

## Decisions Made

- Left sidebar, not right — [plan Step 6](../../.claude/plans/crispy-dancing-conway.md)
- P0 auto-derived title via `jsonb_path_query_first` (not LLM-generated) — handles user-first, assistant-first, tool parts, empty messages safely
- Simple React list component for P0, not assistant-ui `ThreadListPrimitive` (avoids rewriting runtime)
- `key={activeThreadKey}` on `ChatRuntimeProvider` forces remount on thread switch — clean lifecycle
- Abort in-flight streams on thread switch via `AbortController`
- `Cache-Control: no-store` on thread endpoints
- Metadata (model, graphName) populated on first persist only (INSERT path)
- Soft delete without confirmation dialog (reversible, P0)
- OpenClaw-inspired patterns: derived titles, session metadata, preview text

## Next Actions

- [ ] **Step 6:** Build `ThreadSidebar.tsx` kit component — Sheet (mobile) / fixed panel (lg:), ScrollArea, relative timestamps, delete button, new chat button
- [ ] **Step 7:** Update `chat/layout.tsx` — flex row to accommodate sidebar
- [ ] **Step 8:** Update `chat/page.tsx` — `activeThreadKey` state, URL `?t=` deep-link, AbortController on switch, sidebar rendering, invalidate threads on finish
- [ ] **Step 9:** Update `ChatRuntimeProvider.client.tsx` — `initialStateKey` + `initialMessages` props, verify `useChatRuntime` supports it or switch to `useChat` + `useAssistantRuntime`
- [ ] **Step 10:** Update `chat/route.ts` — pass `{ model, graphName }` as metadata on Phase 1 persist when `expectedLen === 0`
- [ ] Run `pnpm check` after each step
- [ ] Write contract tests for thread list/load/delete endpoints
- [ ] Manual test: create → sidebar shows → refresh → persists → switch → history loads → continue → new → delete

## Risks / Gotchas

- **initialMessages in useChatRuntime:** This is the biggest unknown. AI SDK's `useChat` supports `initialMessages`, but `useChatRuntime` (assistant-ui wrapper) may not expose it. If not, you must compose `useChat` + `useAssistantRuntime` — do NOT ship a static-prepend workaround (creates split-brain UI for tool replay, scrolling, message IDs)
- **stateKey enforcement:** When `initialStateKey` is set, `prepareSendMessagesRequest` must always include stateKey. Omitting it would create a duplicate thread.
- **jsonb_path_query_first:** Requires PostgreSQL 12+. The JSONPath `'$[*] ? (@.role == "user").parts[*] ? (@.type == "text").text'` finds the first user text part regardless of message shape. Verify it works against actual `ai_threads` data in dev.
- **Index:** `ai_threads_owner_updated_idx` is NOT a partial index (no `WHERE deleted_at IS NULL` filter). Sufficient for P0 but a partial index would be more efficient.
- **Non-null assertion:** `useLoadThread` uses `stateKey!` inside queryFn — Biome flags it. The `enabled: !!stateKey` guard makes it safe, but you may want to refactor to avoid the lint warning.

## Pointers

| File / Resource                                                                                                                        | Why it matters                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`~/.claude/plans/crispy-dancing-conway.md`](../../.claude/plans/crispy-dancing-conway.md)                                             | Full 10-step implementation plan with P0 exit criteria                                |
| [`docs/spec/thread-persistence.md`](../../docs/spec/thread-persistence.md)                                                             | Canonical spec — invariants, schema, event mapping, port interface                    |
| [`work/items/task.0035.thread-history-ui.md`](../items/task.0035.thread-history-ui.md)                                                 | Work item with requirements and allowed changes                                       |
| [`src/ports/thread-persistence.port.ts`](../../src/ports/thread-persistence.port.ts)                                                   | Port interface — loadThread, saveThread, softDelete, listThreads                      |
| [`src/contracts/ai.threads.v1.contract.ts`](../../src/contracts/ai.threads.v1.contract.ts)                                             | **New** — Zod schemas for list/load/delete (in worktree)                              |
| [`src/app/_facades/ai/threads.server.ts`](../../src/app/_facades/ai/threads.server.ts)                                                 | **New** — Facade wiring container → port (in worktree)                                |
| [`src/app/api/v1/ai/threads/route.ts`](../../src/app/api/v1/ai/threads/route.ts)                                                       | **New** — GET /threads list route (in worktree)                                       |
| [`src/app/api/v1/ai/threads/[stateKey]/route.ts`](../../src/app/api/v1/ai/threads/%5BstateKey%5D/route.ts)                             | **New** — GET load + DELETE soft-delete (in worktree)                                 |
| [`src/features/ai/chat/hooks/useThreads.ts`](../../src/features/ai/chat/hooks/useThreads.ts)                                           | **New** — React Query hooks: useThreads, useLoadThread, useDeleteThread (in worktree) |
| [`src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx`](../../src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx) | Needs modification — initialMessages + stateKey enforcement                           |
| [`src/app/(app)/chat/page.tsx`](<../../src/app/(app)/chat/page.tsx>)                                                                   | Needs modification — thread switching, sidebar, abort                                 |
| [`src/components/vendor/shadcn/sheet.tsx`](../../src/components/vendor/shadcn/sheet.tsx)                                               | Sheet component for mobile sidebar                                                    |
| [`src/components/kit/navigation/MobileNav.tsx`](../../src/components/kit/navigation/MobileNav.tsx)                                     | Reference pattern for Sheet-based sidebar                                             |
| [`docs/spec/ui-implementation.md`](../../docs/spec/ui-implementation.md)                                                               | UI guidelines: KIT_FIRST, TOKENS_ONLY, MOBILE_FIRST                                   |
| Worktree: `/Users/derek/dev/cogni-template-task-0035`                                                                                  | All changes live here — branch `feat/task-0035-thread-sidebar`                        |
