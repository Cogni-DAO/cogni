---
id: thread-persistence
type: spec
title: Thread Persistence & Transcript Authority
status: draft
spec_state: active
trust: draft
summary: Server-authoritative conversation persistence using AI SDK UIMessage[] per thread. Client sends a single message string; server loads authoritative history from DB, executes graph, streams via createUIMessageStream (AI SDK Data Stream Protocol), and persists response UIMessages after pump completion. AiEvent remains the internal executor stream contract.
read_when: Working on thread API, message persistence, multi-turn conversation state, assistant-ui transport, or message security model
implements: proj.thread-persistence
owner: cogni-dev
created: 2026-02-10
verified: 2026-02-14
tags:
  - ai-graphs
  - security
  - data
  - tenant-isolation
---

# Thread Persistence & Transcript Authority

> Server owns conversation history as `UIMessage[]` per thread. Client sends `{ message: string, model, graphName, stateKey? }`; server loads authoritative history from `ai_threads`, maps to `MessageDto[]` → `toCoreMessages()` pipeline, runs graph, streams response via `createUIMessageStream` (AI SDK Data Stream Protocol / SSE), constructs response `UIMessage` from AiEvent stream, persists full thread after pump completion. AiEvent is the internal executor/decorator stream contract. No bespoke event-sourcing, no run_artifacts for message content.

### Key References

|              |                                                                                             |                                          |
| ------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Project**  | [Thread Persistence](../../work/projects/proj.thread-persistence.md)                        | Implementation roadmap                   |
| **Spec**     | [Graph Execution](./graph-execution.md)                                                     | AiEvent stream, billing decorator, pump  |
| **Package**  | `packages/ai-core/src/events/ai-events.ts`                                                  | AiEvent types (streaming, not persisted) |
| **OSS**      | [AI SDK Message Persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence) | Canonical server persistence pattern     |
| **OSS**      | [assistant-ui AI SDK Runtime](https://www.assistant-ui.com/docs/runtimes/ai-sdk/use-chat)   | Client runtime integration               |
| **Research** | [AI SDK Analysis](../research/ai-sdk-transcript-authority-analysis.md)                      | Design research and decision rationale   |

## Design

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ POST /api/v1/ai/chat  { message: string, model, graphName, stateKey? }       │
│                                                                              │
│  1. Validate: Zod parse { message, model, graphName, stateKey? }             │
│  2. Resolve stateKey: use client-supplied value, or generate if absent       │
│  3. Load: UIMessage[] ← ThreadPersistencePort.loadThread(userId, stateKey)   │
│  4. Build user UIMessage from message string, append to server-loaded thread │
│  5. Phase 1 persist: saveThread(thread + user msg, expectedLen=old count)    │
│  6. Convert: UIMessage[] → MessageDto[] → toCoreMessages()                   │
│  7. Execute: completionStream({ messages, model, ... })                      │
│  8. Stream: AiEvent → createUIMessageStream() → SSE to client               │
│     + UIMessage accumulator (parallel, builds assistant UIMessage from events)│
│  9. Phase 2 persist (detached): saveThread(thread + assistant, expected=N+1) │
│ 10. Return: X-State-Key header (stateKey for thread continuity)              │
│                                                                              │
│  Client sends only message text — server loads history from ai_threads.      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### AiEvent → Wire Stream → Persisted UIMessage

AiEvent is the **internal** executor/decorator stream contract. The route handler consumes AiEvent for both the client wire protocol and persistence:

```
GraphExecutorPort.runGraph()
    │
    │  AsyncIterable<AiEvent>
    │  (text_delta, tool_call_start, tool_call_result,
    │   usage_report, assistant_final, done, error)
    │
    ├─ ObservabilityGraphExecutorDecorator ← intercepts assistant_final, done, error
    ├─ BillingGraphExecutorDecorator ← consumes usage_report (never forwarded)
    │
    ├─ RunEventRelay.pump() ← drives stream to completion
    │
    └─ Route handler ← dual consumer of AiEvent stream
         ├─ createUIMessageStream() ← AI SDK Data Stream Protocol (SSE) to client
         ├─ UIMessage accumulator ← constructs response UIMessage from events (parallel)
         └─ onFinish → saveThread() ← persists full UIMessage[] to DB
```

> **Wire format:** `createUIMessageStream()` + `createUIMessageStreamResponse()` from AI SDK. Client uses `useChatRuntime` from `@assistant-ui/react-ai-sdk` with `DefaultChatTransport`.

#### Event Mapping

| AiEvent            | Wire (AI SDK Data Stream Protocol)            | Persisted UIMessage Part                                                      |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------------------------- |
| `text_delta`       | `text-delta` (within text-start/end block)    | `{ type: "text", text: "..." }`                                               |
| `tool_call_start`  | `tool-input-start` + `tool-input-available`   | `{ type: "tool-call", toolCallId, toolName, args, state: "input-available" }` |
| `tool_call_result` | `tool-output-available`                       | Same part updated: `{ ..., result, state: "output-available" }`               |
| `assistant_final`  | _(no wire equivalent — reconciliation only)_  | Text reconciliation — ensures final text part is complete                     |
| `usage_report`     | _(consumed by billing decorator — not wired)_ | Not persisted in UIMessage                                                    |
| `done`             | `finish` (with finishReason)                  | Triggers `saveThread()`                                                       |
| `error`            | `error` (with errorText)                      | Error metadata on message or stream termination                               |

### Persistence Model

AI SDK 5's `UIMessage` is the persistence contract. Each thread stores a `UIMessage[]` array:

```typescript
// AI SDK type — we persist this directly
interface UIMessage {
  id: string; // server-generated (createIdGenerator())
  role: "user" | "assistant" | "system";
  parts: UIMessagePart[]; // typed: text, tool-call (with lifecycle), reasoning, etc.
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}
```

Tool calls and results live **inside the assistant message as parts** — not as separate message rows. A single `UIMessage[]` per thread captures the full conversation including all tool interactions.

### Response UIMessage Assembly

After the pump completes, the route constructs the response `UIMessage` using a **minimal accumulator** — not AI SDK's `toUIMessageStreamResponse()` or its internal stream-to-message machinery. The accumulator:

1. Accumulates `text_delta` events into a single `{ type: "text" }` part
2. Maps `tool_call_start` → `{ type: "tool-call", state: "input-available" }` part
3. Maps `tool_call_result` → updates the matching tool-call part to `state: "output-available"` with result
4. Uses `assistant_final` for text reconciliation (same existing pattern)
5. Produces one `UIMessage { role: "assistant", parts: [...] }` appended to the thread

This keeps the route thin — no dependency on AI SDK's streaming lifecycle state machine. We own the ~30-line accumulator; AI SDK types are used only as the data shape for persistence and wire serialization.

### Prompt Reconstruction

On each request, the server reconstructs the LLM prompt from persisted messages:

```typescript
const existingThread = await threadPersistence.loadThread(userId, stateKey);
const threadWithUser = [...existingThread, userUIMessage];
// Phase 1 persist — user message saved before execution
await threadPersistence.saveThread(userId, stateKey,
  redactSecretsInMessages(threadWithUser), existingThread.length);
// Convert persisted thread → DTOs → core messages → execute
const messageDtos = uiMessagesToMessageDtos(threadWithUser);
const { stream, final } = await completionStream({ messages: messageDtos, ... });
```

`uiMessagesToMessageDtos()` converts persisted `UIMessage[]` into `MessageDto[]` format, then feeds through the existing `toCoreMessages()` pipeline. The completion facade is unchanged. `UIMessage` is the persistence contract; `Message` from `src/core/chat/model.ts` is the internal executor format.

> **Note:** `langgraph_server` executor manages its own history via checkpoints — it would receive only the new user message, not the full thread. History loading is a caller decision based on executor type. The `ai_threads` table always stores the full UIMessage[] regardless of executor, so the UI has a uniform thread history view.

### Client Transport

```
Client sends: { message: string, model, graphName, stateKey? }
Server:
  1. Validates input via Zod (AssistantUiInputSchema)
  2. Loads authoritative history from ai_threads
  3. Appends user message, runs LLM, streams via createUIMessageStream
  4. Persists assistant response UIMessage after pump
```

Client uses `useChatRuntime` from `@assistant-ui/react-ai-sdk` with `DefaultChatTransport`. `prepareSendMessagesRequest` extracts the last user message text from the local UIMessage array and sends `{ message, model, graphName, stateKey? }`. The server never receives message history from the client.

## Goal

- Server owns all message history as `UIMessage[]` in `ai_threads` table
- Client sends only the new user message; cannot fabricate assistant/tool messages
- Multi-turn works across disconnects, refreshes, device switches (history in DB)
- Tool messages are inherently server-authored (constructed from AiEvent stream)
- Standard AI SDK patterns for persistence and streaming — no bespoke event-sourcing
- Billing/observability decorators unchanged (AiEvent internal contract preserved)

## Non-Goals

- Bespoke event-sourcing (no TranscriptEvent, no turn/seq, no run_events table)
- `run_artifacts` for message content — UIMessage persistence IS the transcript store
- Message editing/branching — messages grow only for MVP (no rewrite/delete of individual messages)
- Streaming delta persistence — UIMessage stores final state, not incremental deltas
- GDPR-compliant deletion in MVP — requires LangGraph checkpoint coordination (future)
- LangGraph checkpoint coordination — if `langgraph_server` executor gains durable checkpoints, `ai_threads` becomes a UI projection; revisit then

## Invariants

| Rule                      | Constraint                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SERVER_OWNS_MESSAGES      | All messages persisted server-side in `ai_threads`. The LLM prompt is loaded from DB and converted via `uiMessagesToMessageDtos()` → `toCoreMessages()`. Never from client-supplied history.                                                                                                                                                                        |
| CLIENT_SENDS_USER_ONLY    | Client sends `{ message: string }` — a single user message text. Server validates via Zod (`AssistantUiInputSchema`), loads authoritative history from `ai_threads`, and appends the user message. Client never sends message history or non-user roles.                                                                                                            |
| STATE_KEY_LIFECYCLE       | `stateKey` is the only client-visible thread identifier. If absent from the request, server generates one (`nanoid(21)`) and returns it in the `X-State-Key` response header. Validation: `^[a-zA-Z0-9_-]{1,128}$`. Client MUST echo the returned stateKey on subsequent messages in the same thread.                                                               |
| OPTIMISTIC_APPEND         | `saveThread()` uses optimistic concurrency: `UPDATE ... WHERE jsonb_array_length(messages) = expectedMessageCount`. On mismatch, throws `ThreadConflictError`; caller retries once (reload + re-append). No `SELECT ... FOR UPDATE` lock — lower contention for typical single-client-per-thread access pattern.                                                    |
| TOOLS_ARE_SERVER_AUTHORED | Tool-call and tool-result parts exist only because the server's graph executor emitted `tool_call_start`/`tool_call_result` AiEvents. No client path can create tool parts.                                                                                                                                                                                         |
| PERSIST_AFTER_PUMP        | Response UIMessage (with text + tool parts) is persisted after stream pump completes. Phase 2 persist is detached from the stream callback via a deferred promise (`pumpDone`), so client disconnect cannot prevent persistence.                                                                                                                                    |
| UIMESSAGE_IS_CONTRACT     | `ai_threads.messages` stores AI SDK `UIMessage[]` directly (JSONB). Parts-based: text, tool-call with lifecycle state, tool-result. No bespoke message shapes.                                                                                                                                                                                                      |
| TENANT_SCOPED             | All `ai_threads` rows include `owner_user_id` (NOT NULL) — the authenticated user ID, not billing account ID. RLS policy: `owner_user_id = current_setting('app.current_user_id', true)`. Postgres enforces with `FORCE ROW LEVEL SECURITY`. Missing setting = access denied. Same pattern as `billing_accounts`.                                                   |
| TENANT_SCOPED_THREAD      | Threads are scoped by `(owner_user_id, state_key)`. RLS ensures tenant isolation; the route validates that the authenticated user matches before any DB access. `state_key` alone is not globally unique — uniqueness is per-tenant.                                                                                                                                |
| REDACT_BEFORE_PERSIST     | Secrets redaction (`redactSecretsInMessages()`) applied to message content BEFORE `saveThread()`. Regex-based, best-effort — targets API keys, bearer tokens, JWTs, GitHub tokens. Stored content may still contain secrets — retention and deletion must treat all content as sensitive data. See `bug.0034` for structured fast-redact adoption.                  |
| SOFT_DELETE_DEFAULT       | All reads filter `WHERE deleted_at IS NULL`. Hard delete via scheduled job (future).                                                                                                                                                                                                                                                                                |
| MESSAGES_GROW_ONLY        | Application-level guarantee: the route always appends (user message before execute, assistant message after pump). The `OPTIMISTIC_APPEND` check prevents concurrent overwrites but does not explicitly reject shrinkage — the caller is responsible for only appending. Thread-level soft delete is the deletion primitive.                                        |
| MAX_THREAD_MESSAGES       | `saveThread()` rejects any call where `newMessages.length > 200`. Threads exceeding this limit require soft delete and a new thread. This prevents unbounded JSONB growth. The constant `MAX_THREAD_MESSAGES = 200` is defined in the adapter.                                                                                                                      |
| AIEVENT_NEVER_VERBATIM    | AiEvent is the internal stream contract between GraphExecutorPort, decorators, and RunEventRelay. AiEvent is never sent verbatim to the client — the route maps each AiEvent discriminant to the corresponding AI SDK Data Stream part (UIMessageChunk) via `createUIMessageStream`. The route also accumulates events into a response `UIMessage` for persistence. |

### Schema

**Table:** `ai_threads`

| Column          | Type        | Constraints                   | Description                                                            |
| --------------- | ----------- | ----------------------------- | ---------------------------------------------------------------------- |
| `id`            | uuid        | PK, DEFAULT gen_random_uuid() | Row identity                                                           |
| `owner_user_id` | text        | NOT NULL                      | Authenticated user ID for RLS (same pattern as billing_accounts)       |
| `state_key`     | text        | NOT NULL                      | Client-visible thread identifier (validated: `^[a-zA-Z0-9_-]{1,128}$`) |
| `messages`      | jsonb       | NOT NULL, DEFAULT '[]'        | `UIMessage[]` — complete conversation history                          |
| `metadata`      | jsonb       | nullable                      | Thread-level metadata (model, graphName, etc.)                         |
| `created_at`    | timestamptz | NOT NULL, DEFAULT now()       | Thread creation time                                                   |
| `updated_at`    | timestamptz | NOT NULL, DEFAULT now()       | Last message append time                                               |
| `deleted_at`    | timestamptz | nullable                      | Soft delete timestamp                                                  |

**Indexes:**

- `UNIQUE(owner_user_id, state_key)` — one row per tenant+thread (upsert target)
- `INDEX(owner_user_id, updated_at DESC)` — thread list sorted by recency

**RLS:** Same pattern as `charge_receipts` / `billing_accounts`:

- Enable + force RLS on table
- `USING` + `WITH CHECK`: `owner_user_id = current_setting('app.current_user_id', true)`
- Missing setting returns NULL → denies all access
- **Transaction scope required:** Adapter runs in explicit DB transaction. `SET LOCAL app.current_user_id = $1` at transaction start (same as `packages/db-client/src/tenant-scope.ts`).

### Port Interface

```typescript
// src/ports/thread-persistence.port.ts

/** Thrown when saveThread() detects a concurrent modification (stored count != expected). */
export class ThreadConflictError extends Error { ... }

export interface ThreadSummary {
  stateKey: string;
  /** Auto-derived from first user text part, or metadata.title if set. */
  title?: string | undefined;
  updatedAt: Date;
  messageCount: number;
  metadata?: Record<string, unknown> | undefined;
}

export interface ThreadPersistencePort {
  /** Load thread messages. Returns empty array if thread doesn't exist. */
  loadThread(ownerUserId: string, stateKey: string): Promise<UIMessage[]>;

  /**
   * Persist full message array (upsert). Creates thread if not exists.
   * OPTIMISTIC_APPEND: verifies stored message count matches expectedMessageCount.
   * Throws ThreadConflictError on mismatch — caller should reload and retry once.
   * MAX_THREAD_MESSAGES: rejects if messages.length > 200.
   */
  saveThread(
    ownerUserId: string,
    stateKey: string,
    messages: UIMessage[],
    expectedMessageCount: number,
    metadata?: Record<string, unknown>
  ): Promise<void>;

  /** Soft delete thread. Sets deleted_at, messages still in DB for retention. */
  softDelete(ownerUserId: string, stateKey: string): Promise<void>;

  /** List threads for owner, ordered by recency. Uses jsonb_array_length() — no full JSONB fetch. */
  listThreads(
    ownerUserId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<ThreadSummary[]>;
}
```

### File Pointers

| File                                                            | Purpose                                                                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ai-core/src/events/ai-events.ts`                      | AiEvent types — internal stream contract (unchanged)                                                                                          |
| `src/ports/thread-persistence.port.ts`                          | New: `ThreadPersistencePort` interface                                                                                                        |
| `packages/db-schema/src/ai-threads.ts`                          | New: `ai_threads` table definition (Drizzle)                                                                                                  |
| `src/adapters/server/ai/thread-persistence.adapter.ts`          | New: `DrizzleThreadPersistenceAdapter` with RLS                                                                                               |
| `src/contracts/ai.chat.v1.contract.ts`                          | Wire format: `{ message: string, model, graphName, stateKey? }`                                                                               |
| `src/app/api/v1/ai/chat/route.ts`                               | Load→execute→persist flow, createUIMessageStream bridge, UIMessage accumulator                                                                |
| `src/app/_facades/ai/completion.server.ts`                      | Unchanged. Future: replace `toCoreMessages()` with `convertToModelMessages()`                                                                 |
| `src/features/ai/services/mappers.ts`                           | `uiMessagesToMessageDtos()` mapper (UIMessage[] → MessageDto[])                                                                               |
| `src/features/ai/services/secrets-redaction.ts`                 | P0: `redactSecretsInMessages()` — credential redaction before persist                                                                         |
| `src/features/ai/chat/providers/ChatRuntimeProvider.client.tsx` | `useChatRuntime` + `DefaultChatTransport` — sends `{ message }` to server; accepts `initialMessages` + `initialStateKey` for thread switching |
| `src/features/ai/chat/hooks/useThreads.ts`                      | React Query hooks: `useThreads`, `useLoadThread`, `useDeleteThread`                                                                           |
| `src/contracts/ai.threads.v1.contract.ts`                       | Zod schemas for thread list/load/delete API operations                                                                                        |
| `src/app/_facades/ai/threads.server.ts`                         | App-layer facade: `listThreadsFacade`, `loadThreadFacade`, `deleteThreadFacade`                                                               |
| `src/app/api/v1/ai/threads/route.ts`                            | GET /api/v1/ai/threads — list threads (paginated, recency-ordered)                                                                            |
| `src/app/api/v1/ai/threads/[stateKey]/route.ts`                 | GET (load) + DELETE (soft-delete) per-thread endpoints                                                                                        |
| `src/core/chat/model.ts`                                        | `Message` type — retained as internal executor format only                                                                                    |

### Key Decisions

#### 1. UIMessage[] JSONB vs Normalized Message Rows

**Decision: JSONB per thread.**

- AI SDK's `saveChat()` pattern stores the full `UIMessage[]` array per save
- Tool-call parts are embedded in the assistant message (not separate rows) — normalizing would fight the type system
- Thread-level read/write is the only access pattern for chat
- If per-message search or individual deletion is needed later, normalize then

#### 2. AiEvent Stays Internal

**Decision: Keep AiEvent as-is, bridge at route layer.**

- AiEvent carries billing (`usage_report`), observability hooks, typed error codes — concerns AI SDK doesn't model
- Decorators (billing, observability) intercept AiEvent streams — changing AiEvent means rewriting working code
- The bridge from AiEvent → AI SDK stream parts is ~40 lines (already exists in similar form)
- AiEvent has 7 discriminants; AI SDK Data Stream has ~15 part types. Simpler for internal use.

#### 3. Wire Format: AI SDK Data Stream Protocol

**Decision: `createUIMessageStream()` + `createUIMessageStreamResponse()` from AI SDK.**

- Route maps AiEvent → UIMessageChunk parts: `text-start`/`text-delta`/`text-end`, `tool-input-start`/`tool-input-available`/`tool-output-available`, `finish`, `error`
- Client uses `useChatRuntime` from `@assistant-ui/react-ai-sdk` with `DefaultChatTransport`
- UIMessage accumulator runs in parallel within the same route handler, consuming AiEvents to build a `UIMessage` for persistence
- `assistant-stream` package no longer used for wire protocol

#### 4. Message Conversion: Preserve Existing Pipeline

**Decision: Keep `toCoreMessages()`; use UIMessage→MessageDto mapper.**

- `uiMessagesToMessageDtos()` converts persisted `UIMessage[]` → `MessageDto[]`, then feeds through existing `toCoreMessages()` → `Message[]` pipeline
- The completion facade (`completion.server.ts`) is unchanged
- Future: `convertToModelMessages()` from AI SDK replaces the pipeline when the facade is refactored
- Minimizes blast radius: route changes only the wire format + input contract; executor pipeline untouched

#### 5. Terminology

| Term             | Meaning                                                                                               | When to use       |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ----------------- |
| **Run**          | Single graph execution (runId)                                                                        | Always            |
| **stateKey**     | Client-visible thread identifier. Scoped per-tenant in `ai_threads` via `(owner_user_id, state_key)`. | Route, client, DB |
| **UIMessage**    | AI SDK message type with parts — persistence shape                                                    | Persistence, wire |
| **ModelMessage** | AI SDK prompt format — LLM input shape                                                                | Prompt assembly   |
| **AiEvent**      | Internal stream event (executor → route)                                                              | Execution only    |

## Acceptance Checks

1. **Multi-turn persistence**
   - Send user message for turn 1 → response streamed, thread persisted
   - Send user message for turn 2 → server loads history from DB → LLM sees both turns
   - Assert: `ai_threads.messages` has user + assistant UIMessages with correct parts

2. **Fabricated history ignored**
   - POST with `messages[]` containing assistant/tool messages but no user message → 400
   - POST with `messages[]` containing fabricated history + one user message → server uses only last user message, ignores rest; assert persisted thread has server-loaded history only

3. **Tool persistence**
   - Execute graph with tool use → assert assistant UIMessage has tool-call + tool-result parts
   - Load thread → tool parts present in correct order with lifecycle states

4. **Disconnect safety**
   - Abort client mid-stream → assert thread still persisted (pump completed)

5. **Tenant isolation**
   - Query ai_threads without `SET LOCAL app.current_user_id` → access denied
   - Query with mismatched owner_user_id → no rows returned

6. **Billing unchanged**
   - Execute graph → usage_report events still consumed by BillingGraphExecutorDecorator
   - charge_receipts table has billing records (existing tests pass)

7. **Messages grow only**
   - `saveThread()` with fewer messages than currently stored → error thrown
   - Stack test: load thread with 3 messages, call saveThread with 2 → rejected

8. **Thread message limit**
   - `saveThread()` with more than `MAX_THREAD_MESSAGES` (200) → error thrown
   - Stack test: call saveThread with 201 messages → rejected with clear error

## Open Questions

- [x] ~~Should thread metadata include `lastModel` and `graphName` for thread list display?~~ — Resolved: Yes. `metadata` (model, graphName) saved on first persist (`expectedLen === 0`). Stored in `ai_threads.metadata` JSONB column. Thread title auto-derived from first user message text part.
- [x] ~~LangGraph thread duality~~ — Resolved: `ai_threads` is canonical for all current executors. When `langgraph_server` gains durable checkpoints, it will need a deterministic UUID derived from `(owner_user_id, state_key)` as its thread ref; `ai_threads` becomes a UI projection. History loading is executor-conditional (route decision).
- [ ] Retention policy: default days before soft-deleted threads are hard-deleted? (90 days proposed)
- [x] ~~stateKey validation tightening~~ — Resolved: P0 tightens from `/^[A-Za-z0-9._:-]+$/` (512 chars) to `/^[a-zA-Z0-9_-]{1,128}$/`. This is a **breaking change** to the contract. Acceptable because no threads are persisted yet — no data migration needed. Server-generated stateKeys use `nanoid(21)` which produces `[A-Za-z0-9_-]` output, matching the new pattern. Tests using `.` or `:` in stateKeys must be updated.
- [x] ~~Wire format~~ — Resolved: `createUIMessageStream()` (AI SDK Data Stream Protocol). Client uses `useChatRuntime` + `DefaultChatTransport`.
- [x] ~~Message conversion~~ — Resolved: Preserves `toCoreMessages()` pipeline; uses `uiMessagesToMessageDtos()` mapper. `convertToModelMessages()` deferred to future refactor.

## Related

- [Graph Execution](./graph-execution.md) — AiEvent stream, billing decorator, RunEventRelay pump
- [AI Setup](./ai-setup.md) — AiEvent types, stream architecture
- [LangGraph Server](./langgraph-server.md) — Checkpoint ownership, thread_id scoping
- [LangGraph Patterns](./langgraph-patterns.md) — Graph patterns, tenant-scoped thread_id
- [Architecture](./architecture.md) — Hexagonal layers, port patterns
- [Database RLS](./database-rls.md) — RLS enforcement patterns
- [Thread Persistence Project](../../work/projects/proj.thread-persistence.md) — Implementation roadmap
