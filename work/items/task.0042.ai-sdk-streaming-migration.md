---
id: task.0042
type: task
title: "AI SDK streaming migration — createUIMessageStream + useChatRuntime"
status: done
priority: 1
estimate: 3
summary: "Replace assistant-stream wire protocol with AI SDK Data Stream Protocol. Server: createAssistantStreamResponse → createUIMessageStream. Client: useDataStreamRuntime → useChatRuntime. Contract: messages[] → {stateKey?, message, model, graphName}. Requires assistant-ui 0.11→0.12 upgrade. Fixes bug.0036 and bug.0011 as side effects."
outcome: "Chat streaming uses AI SDK Data Stream Protocol end-to-end. Client sends single user message (not full history). Server bridges AiEvent → AI SDK stream parts via createUIMessageStream. assistant-stream package removable. No changes to internal conversion pipeline (toCoreMessages, GraphRunRequest, ports)."
spec_refs: thread-persistence
assignees:
  - cogni-dev
credit:
project: proj.thread-persistence
branch: feat/task-0040-ai-sdk-streaming
pr:
reviewer:
created: 2026-02-13
updated: 2026-02-13
labels: [ai-graphs, streaming, ui]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# AI SDK Streaming Migration

## Requirements

### Package upgrades

- `@assistant-ui/react` upgraded from `^0.11.52` to `^0.12.10` (peer dep required by react-ai-sdk)
- `@assistant-ui/react-data-stream` upgraded to `^0.12.4` (peer alignment)
- `@assistant-ui/react-markdown` upgraded to match `0.12.x` range (peer alignment)
- `@assistant-ui/react-ai-sdk` added as new dependency
- All existing assistant-ui components verified to build and render after upgrade

### Contract change

- Chat contract input changes from `{ messages[], model, graphName, stateKey? }` to `{ stateKey?, message: string, model, graphName }`
- Server rejects `messages[]` — client sends only the new user message text
- Completion contract (`ai.completion.v1.contract.ts`) is **unchanged** — separate entry point, separate contract

### Server streaming

- Route uses `createUIMessageStream()` (from `ai` package) instead of `createAssistantStreamResponse` (from `assistant-stream`)
- AiEvent → AI SDK stream part mapping follows the event mapping table in `docs/spec/thread-persistence.md` lines 87-97
- `assistant_final` reconciliation pattern preserved (gateway truncation fix from bug.0011)
- UIMessage accumulator and two-phase persistence unchanged (already uses `UIMessage` from `ai` package)

### Internal pipeline unchanged

- `toCoreMessages()` in `src/features/ai/services/mappers.ts` — **no changes** (stays as-is)
- `uiMessagesToMessageDtos()` — **no changes** (thread loaded from DB, converted through existing pipeline)
- `GraphRunRequest.messages: Message[]` — **no changes** to port contract
- `completionStream()` facade signature — **no changes** (internal pipeline untouched)
- Completion route (`/api/v1/ai/completion/`) — **no changes** (uses separate contract + facade)
- Internal graphs route (`/api/internal/graphs/`) — **no changes** (bypasses facade entirely)
- Billing decorator, observability decorator — **no changes**

### Client migration

- `useDataStreamRuntime` (from `@assistant-ui/react-data-stream`) replaced by `useChatRuntime` (from `@assistant-ui/react-ai-sdk`)
- Client sends `{ message, stateKey, model, graphName }` instead of `{ messages[], model, graphName, stateKey }`

### Bug fixes (side effects)

- bug.0036 (closed controller TypeError) — no longer reproducible with `createUIMessageStream` lifecycle
- bug.0011 (gateway truncation) — `assistant_final` reconciliation preserved in new bridge

## Allowed Changes

- `package.json` — upgrade assistant-ui packages to 0.12.x, add `@assistant-ui/react-ai-sdk`
- `src/contracts/ai.chat.v1.contract.ts` — narrow input: remove `messages[]`, add `message: string`
- `src/app/api/v1/ai/chat/route.ts` — replace `createAssistantStreamResponse` with `createUIMessageStream` bridge; simplify user message extraction (now comes as `input.message` directly)
- `src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx` — swap `useDataStreamRuntime` → `useChatRuntime`, body sends `{ message, stateKey, model, graphName }`
- `src/components/vendor/assistant-ui/thread.tsx` — verify/fix for 0.12.x API changes
- `src/components/vendor/assistant-ui/tool-fallback.tsx` — verify/fix for 0.12.x API changes
- `tests/contract/app/ai.chat.*.test.ts` — update for new input shape + stream format
- `tests/stack/ai/` — update stack tests that send `messages[]`

### Explicitly NOT changed

- `src/app/_facades/ai/completion.server.ts` — facade pipeline unchanged
- `src/features/ai/services/mappers.ts` — `toCoreMessages()`, `uiMessagesToMessageDtos()` unchanged
- `src/ports/graph-executor.port.ts` — `GraphRunRequest.messages: Message[]` unchanged
- `src/app/api/v1/ai/completion/route.ts` — separate contract, not affected
- `src/app/api/internal/graphs/[graphId]/runs/route.ts` — bypasses facade, not affected

## Plan

- [ ] Upgrade `@assistant-ui/react` to `^0.12.10`, `@assistant-ui/react-data-stream` to `^0.12.4`, `@assistant-ui/react-markdown` to matching range
- [ ] Verify all assistant-ui components build and render (`pnpm check`, manual smoke test)
- [ ] Add `@assistant-ui/react-ai-sdk` package
- [ ] Update contract: `AssistantUiInputSchema` → accept `{ message: string, stateKey?, model, graphName }` instead of `messages[]`
- [ ] Update route: replace `createAssistantStreamResponse` callback with `createUIMessageStream` adapter mapping AiEvent → AI SDK stream parts
- [ ] Preserve `assistant_final` reconciliation in new bridge
- [ ] Preserve UIMessage accumulator + two-phase persistence (no changes needed — already uses `UIMessage`)
- [ ] Update client: `useDataStreamRuntime` → `useChatRuntime`, body sends `{ message, stateKey, model, graphName }`
- [ ] Update contract tests for new input schema + response stream format
- [ ] Update stack tests that send `messages[]` to send `message` instead
- [ ] Verify bug.0036 no longer reproduces (no unhandled TypeError on stream close)
- [ ] Verify bug.0011 reconciliation still works (gateway response not truncated)
- [ ] `pnpm check` passes

## Validation

**Command:**

```bash
pnpm check
pnpm test tests/contract/app/ai.chat
pnpm test:stack:dev  # with dev stack running
```

**Expected:** All tests pass. Chat works end-to-end with new streaming. No unhandled TypeError on stream close. Gateway responses not truncated.

## Review Checklist

- [ ] **Work Item:** `task.0042` linked in PR body
- [ ] **Spec:** thread-persistence invariants upheld (CLIENT_SENDS_USER_ONLY, AIEVENT_NEVER_VERBATIM, PERSIST_AFTER_PUMP, ASSISTANT_FINAL_REQUIRED)
- [ ] **Tests:** contract tests updated for new input schema, stack test passes multi-turn
- [ ] **Scope:** No changes to `toCoreMessages()`, `GraphRunRequest`, facade, or completion route
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0042.handoff.md)

## Attribution

-
