---
id: task.0042.handoff
type: handoff
work_item_id: task.0042
status: active
created: 2026-02-13
updated: 2026-02-13
branch:
last_commit:
---

# Handoff: AI SDK Streaming Migration

## Context

- Chat streaming currently uses `assistant-stream` package (`createAssistantStreamResponse`) on server and `@assistant-ui/react-data-stream` (`useDataStreamRuntime`) on client — this is a P0 bridge that's flaky
- bug.0036: `createAssistantStreamResponse` controller closes before route finalization → unhandled TypeErrors every request
- bug.0011: Gateway streaming truncation — `assistant-stream` diff-based delta logic loses text across multi-turn LLM calls
- Thread persistence P0 (task.0030) shipped on this bridge deliberately — P1 was always planned as the migration to AI SDK native streaming
- The migration replaces the wire protocol only — internal pipeline (`toCoreMessages`, `GraphRunRequest`, ports, billing) is untouched

## Current State

- **Done:** task.0030 merged (PR #381) — server persists `UIMessage[]` per thread, two-phase load→execute→persist, UIMessage accumulator
- **Done:** Research at `docs/research/ai-sdk-transcript-authority-analysis.md` — validated API names, migration path, and compatibility
- **Done:** task.0042 work item created with design-reviewed requirements and plan
- **Not started:** No implementation branch, no code changes, no package upgrades
- **Verified:** `createUIMessageStream` exists in `ai@6.0.79` (installed). `convertToModelMessages` exists (but NOT used in this task). `@assistant-ui/react-ai-sdk@1.3.7` exists on npm (not installed).
- **Blocker identified:** `@assistant-ui/react-ai-sdk` requires `@assistant-ui/react ^0.12.10` — we're on `^0.11.52`. Upgrade is first step.

## Decisions Made

- **Keep internal pipeline unchanged** — `toCoreMessages()`, `uiMessagesToMessageDtos()`, `GraphRunRequest.messages: Message[]` all stay. Replacing with `convertToModelMessages()` would change the port contract (returns `ModelMessage[]`, not `Message[]`). That's a separate future refactor.
- **One PR, coordinated change** — contract + server + client must ship together (breaking wire format change)
- **Completion route unaffected** — `/api/v1/ai/completion/` uses a separate contract (`ai.completion.v1`) and separate facade entry point. Not touched.
- **Internal graphs route unaffected** — `/api/internal/graphs/[graphId]/runs/` bypasses the facade entirely, constructs `Message[]` directly.
- See [thread-persistence spec](../../docs/spec/thread-persistence.md) lines 87-97 for the AiEvent → AI SDK stream part mapping table

## Next Actions

- [ ] Create branch `feat/task-0042-ai-sdk-streaming`
- [ ] Upgrade `@assistant-ui/react` to `^0.12.10`, `@assistant-ui/react-data-stream` to `^0.12.4`, `@assistant-ui/react-markdown` to matching range
- [ ] Verify assistant-ui components build after upgrade (`pnpm check`, smoke test Thread/ToolFallback)
- [ ] `pnpm add @assistant-ui/react-ai-sdk`
- [ ] Narrow contract: `AssistantUiInputSchema` from `{ messages[], ... }` to `{ message: string, stateKey?, model, graphName }`
- [ ] Replace `createAssistantStreamResponse` with `createUIMessageStream` in route, preserving `assistant_final` reconciliation
- [ ] Swap client from `useDataStreamRuntime` to `useChatRuntime`
- [ ] Update contract tests + stack tests for new input shape
- [ ] Verify bug.0036 and bug.0011 no longer reproduce

## Risks / Gotchas

- **assistant-ui 0.11→0.12 may break components** — pre-1.0 semver, minor bumps can be breaking. Check `Thread`, `ToolFallback`, `ChatComposerExtras` after upgrade. Run `pnpm check` before any other changes.
- **`useChatRuntime` API differs from `useDataStreamRuntime`** — the body/request shape and lifecycle hooks may differ. Read `@assistant-ui/react-ai-sdk` docs carefully before implementing.
- **`assistant_final` reconciliation is critical** — gateway streaming sends zero deltas during execution and dumps text at the end. The post-loop reconciliation logic (`route.ts:477-508`) must be preserved in the new `createUIMessageStream` bridge or gateway responses will truncate.
- **`assistant-stream` removal is a follow-up** — don't remove the package in this PR. Verify no other imports exist first.

## Pointers

| File / Resource                                                                                                                        | Why it matters                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`work/items/task.0042.ai-sdk-streaming-migration.md`](../items/task.0042.ai-sdk-streaming-migration.md)                               | Full requirements, plan, allowed changes, explicit NOT-changed list                                           |
| [`docs/spec/thread-persistence.md`](../../docs/spec/thread-persistence.md)                                                             | Canonical spec — event mapping table (lines 87-97), persistence invariants                                    |
| [`docs/research/ai-sdk-transcript-authority-analysis.md`](../../docs/research/ai-sdk-transcript-authority-analysis.md)                 | Research: API names, migration path, wire protocol options                                                    |
| [`src/app/api/v1/ai/chat/route.ts`](../../src/app/api/v1/ai/chat/route.ts)                                                             | Current route — `createAssistantStreamResponse` (line 345), reconciliation (lines 477-508), two-phase persist |
| [`src/contracts/ai.chat.v1.contract.ts`](../../src/contracts/ai.chat.v1.contract.ts)                                                   | Current contract — `AssistantUiInputSchema` (lines 244-267) to narrow                                         |
| [`src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx`](../../src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx) | Current client — `useDataStreamRuntime` (line 132) to swap                                                    |
| [`work/projects/proj.thread-persistence.md`](../projects/proj.thread-persistence.md)                                                   | Project roadmap — P1 Walk table references task.0042                                                          |
| [`work/items/bug.0036*`](../items/)                                                                                                    | Closed controller bug — fixed as side effect                                                                  |
| [`work/items/bug.0011*`](../items/)                                                                                                    | Gateway truncation bug — reconciliation must survive migration                                                |
