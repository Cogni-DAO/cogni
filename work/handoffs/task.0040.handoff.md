---
id: task.0040.handoff
type: handoff
work_item_id: task.0040
status: active
created: 2026-02-13
updated: 2026-02-13
branch: feat/task-0040-ai-sdk-streaming
last_commit:
---

# Handoff: AI SDK Streaming Migration

## Context

- Chat streaming uses `assistant-stream` (`createAssistantStreamResponse`) on server and `@assistant-ui/react-data-stream` (`useDataStreamRuntime`) on client — legacy bridge that causes bug.0036 (TypeError on close) and bug.0011 (gateway truncation)
- Thread persistence (task.0030) shipped on this bridge deliberately — this task is the planned P1 migration to AI SDK native streaming
- The migration replaces the wire protocol only — internal pipeline (`toCoreMessages`, `GraphRunRequest`, ports, billing) is untouched

## Current State

- **Done:** Branch `feat/task-0040-ai-sdk-streaming` created from staging, clean `pnpm check`
- **Done:** Package upgrades — `@assistant-ui/react ^0.12.10`, `@assistant-ui/react-data-stream ^0.12.4`, `@assistant-ui/react-markdown ^0.12.3`, `@assistant-ui/react-ai-sdk ^1.3.7` all installed. `pnpm check` passes with upgrades (no component API breakage from 0.11→0.12).
- **Not started:** Contract change, route rewrite, client migration, test updates

### Key API findings from research (verified against installed packages)

**Server:** `createUIMessageStream({ execute: async ({ writer }) => { ... } })` from `ai` package returns `ReadableStream<UIMessageChunk>`. Wrap with `createUIMessageStreamResponse({ stream })` to get HTTP Response. Wire format is SSE (`data: {json}\n\n`), NOT the old `type:json\n` format.

**Writer API:** `writer.write(part)` emits chunks. Text: `text-start` → `text-delta` → `text-end` (each needs an `id` field). Tools: `tool-input-start` → `tool-input-available` → `tool-output-available`. Lifecycle: `start`/`finish` may be auto-emitted by framework.

**Client:** `useChatRuntime` from `@assistant-ui/react-ai-sdk` wraps `useChat` from `@ai-sdk/react`. Uses `AssistantChatTransport` (extends `DefaultChatTransport`). By default sends `{ messages: [...], id, trigger, ... }`. To send `{ message: string, ... }` instead, pass `prepareSendMessagesRequest` to customize request body. Source: `node_modules/@assistant-ui/react-ai-sdk/dist/ui/use-chat/AssistantChatTransport.js`

## Decisions Made

- **Keep internal pipeline unchanged** — `toCoreMessages()`, `uiMessagesToMessageDtos()`, `GraphRunRequest.messages: Message[]` all stay
- **Wire format changes** — SSE (`data: {json}\n\n`) replaces old data-stream format (`type:json\n`)
- **Test helper must change** — `tests/helpers/data-stream.ts` parses old format; needs SSE parser
- **`assistant-stream` stays as dependency** — don't remove in this PR, verify no other imports first
- **Completion route unaffected** — separate contract, separate facade entry point

## Next Actions

- [ ] Update contract: `AssistantUiInputSchema` from `{ messages[], ... }` to `{ message: z.string().min(1).max(16000), stateKey?, model, graphName }` — remove `AssistantUiMessageSchema` (only used by input)
- [ ] Rewrite route: replace `createAssistantStreamResponse` callback with `createUIMessageStream` + `createUIMessageStreamResponse`. Map AiEvent → UIMessageChunk via `writer.write()`. Keep accumulator + `assistant_final` reconciliation + two-phase persistence
- [ ] Update client: replace `useDataStreamRuntime` with `useChatRuntime`. Pass custom `AssistantChatTransport` with `prepareSendMessagesRequest` that extracts last user message text and sends `{ message, model, graphName, stateKey }`
- [ ] Rewrite `tests/helpers/data-stream.ts` to parse SSE format (`data: {json}\n\n`)
- [ ] Update `tests/_fakes/ai/request-builders.ts`: `createChatRequest` sends `{ message, model, graphName }` instead of `{ messages[], ... }`
- [ ] Update contract tests (`tests/contract/ai.chat.v1.contract.test.ts` — new input schema)
- [ ] Update SSE reconciliation tests (`tests/contract/app/ai.chat.sse-reconciliation.test.ts`)
- [ ] Update credit gate tests (`tests/contract/app/ai.chat.*.test.ts`)
- [ ] Update stack tests that build `messages[]` payloads (14+ files — see work item Allowed Changes)
- [ ] Verify bug.0036/bug.0011 no longer reproduce
- [ ] Final `pnpm check`

## Risks / Gotchas

- **SSE wire format is different** — current tests parse `type:json\n`; new format is `data: {json}\n\n` with `data: [DONE]\n\n` terminator. Every test consuming chat responses needs the new parser.
- **`useChatRuntime` sends full messages[] by default** — must customize via `prepareSendMessagesRequest` on `AssistantChatTransport` to send only `{ message: string }`. See `node_modules/@assistant-ui/react-ai-sdk/dist/ui/use-chat/AssistantChatTransport.js` lines 8-33.
- **`text-delta` chunks need an `id` field** — unlike old format, AI SDK stream parts require `{ type: 'text-delta', delta: '...', id: partId }`. Generate a stable part ID per text block.
- **`assistant_final` reconciliation is critical** — must be preserved in new bridge or gateway responses truncate
- **`onFinish` callback on `createUIMessageStream`** receives `{ messages, responseMessage, finishReason }` — could simplify persistence (gets the assembled UIMessage directly)

## Pointers

| File / Resource                                                                                                                        | Why it matters                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`work/items/task.0040.ai-sdk-streaming-migration.md`](../items/task.0040.ai-sdk-streaming-migration.md)                               | Full requirements, plan, allowed changes, NOT-changed list                     |
| [`docs/spec/thread-persistence.md`](../../docs/spec/thread-persistence.md)                                                             | Event mapping table (lines 87-97), persistence invariants                      |
| [`src/app/api/v1/ai/chat/route.ts`](../../src/app/api/v1/ai/chat/route.ts)                                                             | Current route — `createAssistantStreamResponse` + accumulator + reconciliation |
| [`src/contracts/ai.chat.v1.contract.ts`](../../src/contracts/ai.chat.v1.contract.ts)                                                   | Contract to narrow: `AssistantUiInputSchema`                                   |
| [`src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx`](../../src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx) | Client — `useDataStreamRuntime` → `useChatRuntime`                             |
| [`tests/helpers/data-stream.ts`](../../tests/helpers/data-stream.ts)                                                                   | Test helper — must rewrite for SSE format                                      |
| [`tests/_fakes/ai/request-builders.ts`](../../tests/_fakes/ai/request-builders.ts)                                                     | `createChatRequest` — update for new input shape                               |
| [`node_modules/@assistant-ui/react-ai-sdk/dist/ui/use-chat/`](../../node_modules/@assistant-ui/react-ai-sdk/dist/ui/use-chat/)         | `useChatRuntime` + `AssistantChatTransport` source                             |
| [`docs/research/ai-sdk-transcript-authority-analysis.md`](../../docs/research/ai-sdk-transcript-authority-analysis.md)                 | Research: API names, migration path                                            |
