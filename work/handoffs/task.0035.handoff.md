---
id: task.0035.handoff
type: handoff
work_item_id: task.0035
status: active
created: 2026-02-13
updated: 2026-02-13
branch: feat/task-0035-thread-sidebar
last_commit: b9b52e48
---

# Handoff: Thread History Sidebar — UI Layer Finish Pass

## Context

- Users lose conversations on refresh — persistence layer exists but no UI for thread list or switching
- Data layer (Steps 1–5) is **committed** on branch: port, contract, facade, API routes, React Query hooks
- UI layer (Steps 6–9) is **written but uncommitted** in worktree: ChatRuntimeProvider, layout, page, chat route
- `pnpm check` has 2 remaining failures (lint + unit test) described below
- Plan: [`~/.claude/plans/crispy-dancing-conway.md`](../../.claude/plans/crispy-dancing-conway.md)

## Current State

- **Committed (3 commits):** `6fa1b16` port/adapter, `190af6d` contract, `b9b52e4` facade/routes/hooks
- **Uncommitted (5 files):** ChatRuntimeProvider, layout, page, chat route, components/index barrel
- **Passing:** typecheck, format, arch:check, check:docs, test:packages, test:services
- **Failing (2):**
  - `lint`: page.tsx imports `Sheet` from `@/components/vendor/shadcn/sheet` — barrel export was added to `components/index.ts` but page import path not yet updated
  - `test:unit`: 3 ChatPage tests fail — mocks in `chat-page-no-hardcoded-models.spec.tsx` and `chat-page-zero-credits.spec.tsx` don't include `Button` (newly imported by page from `@/components`)

## Decisions Made

- `useChatRuntime` **does** support `messages` via `ChatInit` — no hook switch needed (source-verified in `useChatRuntime.js:26-28`)
- Props are **required, not optional**: `initialMessages: UIMessage[]` (default `[]`), `initialStateKey: string | null` (default `null`) — avoids `exactOptionalPropertyTypes` issues
- `key={activeThreadKey ?? "new"}` remount handles abort automatically — no manual AbortController
- Sidebar rendered inline in page.tsx using existing shadcn Sheet + Button — no new component files
- `?t=` URL deep-linking deferred to P1
- Chat route passes `{ model, graphName }` metadata on `expectedLen === 0` (first persist)

## Next Actions

- [ ] Fix page.tsx import: change `@/components/vendor/shadcn/sheet` → `@/components` (barrel already exports Sheet)
- [ ] Fix unit test mocks: add `Button` to the `@/components` mock in `chat-page-no-hardcoded-models.spec.tsx` and `chat-page-zero-credits.spec.tsx`
- [ ] Run `pnpm check` — verify all green
- [ ] Commit UI layer changes (3 planned commits per plan: provider, layout+page, chat route)
- [ ] Manual test: send → sidebar shows → refresh → persists → switch → history loads → continue → new → delete
- [ ] Consider adding contract tests for thread list/load/delete endpoints

## Risks / Gotchas

- **`messages: []` vs omitted:** Passing `messages: []` to `useChatRuntime` is semantically equivalent to omitting it (empty chat) — verified from AI SDK source. But if future versions change behavior, this assumption could break.
- **`stateKey!` non-null assertion:** `useLoadThread` in `useThreads.ts:63` uses `stateKey!` — Biome warns. Safe due to `enabled: !!stateKey` guard but consider refactoring.
- **`as UIMessage[]` cast:** Thread messages come from API as `unknown[]` (per contract). Cast in page.tsx assumes DB round-trip preserves shape. No runtime validation.
- **Partial index:** `ai_threads_owner_updated_idx` has no `WHERE deleted_at IS NULL` filter. Adequate for P0 but a partial index would be more efficient for listThreads.
- **Pre-existing lint warning:** `_log` unused in `preflight-credit-check.decorator.ts` — not related to this PR.

## Pointers

| File / Resource                                                                                                        | Why it matters                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`ChatRuntimeProvider.client.tsx`](../../src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx)                | Added `initialMessages`, `initialStateKey`, `onFinish` — seeds `useChatRuntime` |
| [`chat/page.tsx`](<../../src/app/(app)/chat/page.tsx>)                                                                 | Thread switching state, sidebar (Sheet + inline list), loading gate             |
| [`chat/layout.tsx`](<../../src/app/(app)/chat/layout.tsx>)                                                             | Changed `flex flex-col` → `flex` for sidebar row layout                         |
| [`chat/route.ts`](../../src/app/api/v1/ai/chat/route.ts)                                                               | Metadata `{ model, graphName }` on first persist                                |
| [`components/index.ts`](../../src/components/index.ts)                                                                 | Added Sheet re-exports (page import path still needs updating)                  |
| [`useChatRuntime.js` (node_modules)](../../node_modules/@assistant-ui/react-ai-sdk/dist/ui/use-chat/useChatRuntime.js) | Source-of-truth: passes `messages` through to `useChat` via `...chatOptions`    |
| [`useThreads.ts`](../../src/features/ai/chat/hooks/useThreads.ts)                                                      | React Query hooks — useThreads, useLoadThread, useDeleteThread                  |
| [`ai.threads.v1.contract.ts`](../../src/contracts/ai.threads.v1.contract.ts)                                           | Zod schemas for wire format                                                     |
| [`crispy-dancing-conway.md`](../../.claude/plans/crispy-dancing-conway.md)                                             | Implementation plan (Steps 6-9 section is current)                              |
