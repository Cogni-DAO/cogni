---
id: task.0164
type: task
title: OpenAI-compatible completions — document endpoint + surface agent status streams
status: done
priority: 1
rank: 10
estimate: 2
summary: Document the /v1/chat/completions endpoint in a proper spec and forward StatusEvents through the OpenAI SSE stream so clients can see agent activity phases.
outcome: Completions endpoint has a dedicated spec; streaming responses include agent status events as custom SSE chunks; chat endpoint latency is unchanged.
spec_refs: streaming-status, graph-execution
assignees: derekg1729
credit:
project:
branch: claude/openai-compatible-completions-mRQCh
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-06
updated: 2026-03-13
labels: [ai, streaming, documentation, api]
external_refs:
---

# Task: OpenAI-compatible completions — document endpoint + surface agent status streams

## Context

The `/v1/chat/completions` endpoint is a working, production-quality OpenAI-compatible API. However:

1. **No dedicated spec** — the endpoint is referenced across multiple specs (openclaw-sandbox, billing-sandbox, accounts-api-endpoints) but has no single spec documenting its contract, wire format, auth, and extension fields.
2. **StatusEvents are silently dropped** — the chat route (`/v1/ai/chat`) already surfaces `StatusEvent` as `data-status` transient chunks via AI SDK. The completions route drops them entirely (only handles `text_delta` and `tool_call_start`). Users cannot see what agents are doing during streaming completions.

**Constraint: NO_CHAT_LATENCY_REGRESSION** — changes MUST NOT touch the `/v1/ai/chat` route's hot path. The chat endpoint's streaming pipeline, thread persistence, and wire format are not modified.

## Design

### Outcome

Completions endpoint is properly documented; streaming completions surface agent activity phases (thinking, tool use, compacting) so clients can observe what agents are actively doing.

### Approach

**Part 1: Documentation** — Create `docs/spec/completions-api.md` spec covering:

- Wire protocol (OpenAI Chat Completions format)
- Streaming SSE format (`data: {json}\n\n` + `data: [DONE]\n\n`)
- Non-streaming JSON response format
- Extension fields (`graph_name`) and their behavior
- Auth model (session-based, same as chat)
- Error format (OpenAI-compatible `{ error: { message, type, param, code } }`)
- Relationship to chat endpoint (shared `completionStream` facade, same billing path)

**Part 2: Status event streaming** — Forward `StatusEvent` through the OpenAI SSE stream as custom chunks. This is a non-breaking extension — standard OpenAI clients will ignore unrecognized fields.

In `createOpenAiSseStream()` within `/v1/chat/completions/route.ts`, add a handler for `event.type === "status"`:

```typescript
} else if (event.type === "status") {
  // Non-breaking OpenAI extension: surface agent activity
  const chunk: ChatCompletionChunk = {
    id: completionId,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: null,
    }],
    // Extension field — ignored by standard OpenAI clients
    cogni_status: {
      phase: event.phase,
      ...(event.label ? { label: event.label } : {}),
    },
  };
  controller.enqueue(encoder.encode(sseEncode(JSON.stringify(chunk))));
}
```

**Reuses**: Existing `StatusEvent` type from `@cogni/ai-core`, existing `completionStream` facade (unchanged), existing status event emission from providers (OpenClaw gateway client + LangGraph).

**Rejected alternatives**:

- **Separate polling endpoint for active runs**: Too much new infrastructure for v0. Active runs are already visible in the stream itself. Cross-session visibility is a future concern.
- **Custom SSE event types (not `data:`)**: Would break OpenAI client libraries that expect only `data:` lines. Using the standard chunk format with an extension field is safer.
- **Modifying chat endpoint**: Explicitly rejected — chat already has status via `data-status` transient chunks. No touch needed.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] NO_CHAT_LATENCY_REGRESSION: `/v1/ai/chat` route.ts is NOT modified. Zero changes to chat hot path. (constraint: user requirement)
- [ ] STATUS_IS_EPHEMERAL: Status events are streaming-only; not persisted anywhere (spec: streaming-status)
- [ ] STATUS_BEST_EFFORT: Missing status events must not break streaming or billing (spec: streaming-status)
- [ ] STATUS_NEVER_LEAKS_CONTENT: `cogni_status.label` contains at most a tool name, never args or results (spec: streaming-status)
- [ ] OPENAI_COMPAT_PRESERVED: Standard OpenAI fields (`id`, `object`, `created`, `model`, `choices`) remain unchanged. Extension field is additive only. (spec: architecture)
- [ ] UNIFIED_GRAPH_EXECUTOR: Both endpoints share the same `completionStream` facade; no divergent execution paths (spec: graph-execution)
- [ ] SIMPLE_SOLUTION: Leverages existing StatusEvent emission + existing SSE stream with minimal new code
- [ ] ARCHITECTURE_ALIGNMENT: Follows contracts-first pattern; spec written before implementation (spec: architecture)

### Contract Changes

The `ChatCompletionChunkSchema` in `ai.completions.v1.contract.ts` needs a new optional field:

```typescript
const CogniStatusSchema = z.object({
  phase: z.enum(["thinking", "tool_use", "compacting"]),
  label: z.string().optional(),
}).optional();

// Add to ChatCompletionChunkSchema:
cogni_status: CogniStatusSchema,
```

This is a **non-breaking additive change** — existing consumers that don't parse `cogni_status` are unaffected.

### Files

<!-- High-level scope -->

- Create: `docs/spec/completions-api.md` — dedicated spec for `/v1/chat/completions` endpoint
- Modify: `src/contracts/ai.completions.v1.contract.ts` — add optional `cogni_status` to chunk schema
- Modify: `src/app/api/v1/chat/completions/route.ts` — handle `event.type === "status"` in `createOpenAiSseStream()`
- Modify: `src/features/ai/AGENTS.md` — update public routes documentation to note status streaming
- Modify: `src/app/api/AGENTS.md` — add reference to new completions spec
- Test: `tests/unit/app/api/v1/chat/completions/` — verify status events appear in SSE output; verify standard chunks unchanged

## Validation

- [ ] `pnpm check` passes (lint + types + format)
- [ ] Streaming response includes `cogni_status` chunks when provider emits StatusEvents
- [ ] Streaming response without StatusEvents is byte-identical to current behavior
- [ ] Non-streaming path is completely unchanged
- [ ] Chat route (`/v1/ai/chat`) is not modified (diff verification)
- [ ] New spec `docs/spec/completions-api.md` passes `pnpm check:docs`
