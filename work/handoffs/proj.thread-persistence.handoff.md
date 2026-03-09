---
id: proj.thread-persistence.handoff
type: handoff
work_item_id: proj.thread-persistence
status: active
created: 2026-02-10
updated: 2026-02-13
branch: feat/task-0040-ai-sdk-streaming
last_commit: b958ef55
---

# Handoff: Thread Persistence — What's Next

## Context

- Server-authoritative conversation persistence using AI SDK `UIMessage[]` per thread, stored in `ai_threads` JSONB with RLS
- **P0 (Done — task.0030):** DB schema, `ThreadPersistencePort`, adapter, route bridge (load→execute→persist), secrets redaction, multi-turn stack test
- **P1 streaming (Done — task.0042):** Contract narrowed to `{ message, model, graphName, stateKey? }`, route uses `createUIMessageStream`, client uses `useChatRuntime` + `DefaultChatTransport`. PR #396
- The remaining P1 work is **thread list UI** (task.0035) and **sandbox observability enrichment** (no work item yet)
- Canonical spec: [`docs/spec/thread-persistence.md`](../../docs/spec/thread-persistence.md). Project roadmap: [`work/projects/proj.thread-persistence.md`](../projects/proj.thread-persistence.md)

## Current State

- **Done:** ai_threads table, ThreadPersistencePort, DrizzleThreadPersistenceAdapter, RLS, optimistic concurrency, UIMessage accumulator, secrets redaction, AI SDK streaming end-to-end
- **Done:** Contract + route + client migrated to AI SDK Data Stream Protocol. Tests updated (contract, SSE reconciliation, free/paid model, langfuse, thread-persistence, chat-streaming stack tests)
- **Todo (task.0035):** Thread history sidebar — `listThreads` endpoint exists in the port but has no route or UI. Users currently get a fresh thread on page refresh.
- **Todo:** History load on mount — when a user returns to a thread (via stateKey URL or sidebar), client should display server-loaded messages before allowing new input
- **Not started:** LangGraph executor-conditional history loading (only relevant when `langgraph_server` gets durable checkpoints)
- **Not started:** Gateway tool-use streaming enrichment (OpenClaw WS only emits `text_delta` + `chat_final`, no tool events)

## Decisions Made

- UIMessage[] JSONB per thread — [spec: Key Decision 1](../../docs/spec/thread-persistence.md#1-uimessage-jsonb-vs-normalized-message-rows)
- AiEvent stays internal, bridged at route layer — [spec: Key Decision 2](../../docs/spec/thread-persistence.md#2-aievent-stays-internal)
- Wire format: `createUIMessageStream` (AI SDK SSE) — [spec: Key Decision 3](../../docs/spec/thread-persistence.md#3-wire-format-ai-sdk-data-stream-protocol)
- Message conversion preserves `toCoreMessages()` pipeline — [spec: Key Decision 4](../../docs/spec/thread-persistence.md#4-message-conversion-preserve-existing-pipeline)
- `assistant-stream` package still in deps (used nowhere in chat route) — can be removed once no other consumer exists

## Next Actions

- [ ] **task.0035: Thread history sidebar** — `listThreads` API route + basic sidebar UI for thread selection
- [ ] **task.0035: History load on mount** — client fetches thread messages from server when stateKey is known (URL param or sidebar click)
- [ ] **Remove `assistant-stream` dep** — verify no remaining imports, then remove from package.json
- [ ] **bug.0036 verification** — confirm the closed-controller TypeError is gone with `createUIMessageStream` (expected fixed as side effect)
- [ ] **bug.0011 verification** — confirm gateway truncation is still handled by `assistant_final` reconciliation in the new bridge
- [ ] **Gateway tool-use enrichment** — extend `OpenClawGatewayClient` to emit `tool_call_start`/`tool_call_result` AiEvents from WS stream (no work item yet)
- [ ] **Spec update: Executor State Duality** — document that `ai_threads` is a UI projection for external executors

## Risks / Gotchas

- `tests/helpers/data-stream.ts` has legacy aliases (`readDataStreamEvents`, `DataStreamChunkType`) — safe to remove after confirming no stack test uses the old names
- Thread-persistence stack test removed the "FABRICATED_BY_CLIENT" assertion since client no longer sends history — the invariant is now enforced by contract validation, not server-side filtering
- `useChatRuntime` sends full local UIMessage[] to `prepareSendMessagesRequest` — the callback extracts only the last user text. If assistant-ui changes this API, the extraction logic in `ChatRuntimeProvider.client.tsx:extractLastUserText` may need updating
- `finish` chunk omits `usage` data (AI SDK `strictObject` validation rejects it) — usage is consumed by the billing decorator internally, not exposed to client

## Pointers

| File / Resource                                                                                                                        | Why it matters                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`docs/spec/thread-persistence.md`](../../docs/spec/thread-persistence.md)                                                             | Canonical spec — invariants, schema, event mapping, port interface                  |
| [`work/projects/proj.thread-persistence.md`](../projects/proj.thread-persistence.md)                                                   | Project roadmap — P0/P1/P2 deliverable tables with status                           |
| [`work/items/task.0035.thread-history-sidebar.md`](../items/task.0035.thread-history-sidebar.md)                                       | Next work item — thread list + history load                                         |
| [`src/app/api/v1/ai/chat/route.ts`](../../src/app/api/v1/ai/chat/route.ts)                                                             | Chat route — createUIMessageStream bridge, UIMessage accumulator, two-phase persist |
| [`src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx`](../../src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx) | Client runtime — useChatRuntime, DefaultChatTransport, extractLastUserText          |
| [`src/contracts/ai.chat.v1.contract.ts`](../../src/contracts/ai.chat.v1.contract.ts)                                                   | Wire contract — `{ message, model, graphName, stateKey? }`                          |
| [`src/ports/thread-persistence.port.ts`](../../src/ports/thread-persistence.port.ts)                                                   | Port interface — loadThread, saveThread, softDelete, listThreads                    |
| [`tests/helpers/data-stream.ts`](../../tests/helpers/data-stream.ts)                                                                   | SSE test parser — readSseEvents, SseEvent, type guards                              |
