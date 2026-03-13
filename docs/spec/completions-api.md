---
id: completions-api
type: spec
title: OpenAI-compatible Chat Completions API
status: draft
spec_state: proposed
trust: draft
summary: Documents the /v1/chat/completions endpoint — wire protocol, streaming SSE format, cogni_status extension, error format, and execution path.
read_when: Working on the completions endpoint, OpenAI SDK integration, cogni_status streaming, or client-facing API surface.
owner: cogni-dev
created: 2026-03-06
verified: 2026-03-06
tags: [api, ai-graphs, streaming, openai-compat]
---

# OpenAI-compatible Chat Completions API

> POST `/api/v1/chat/completions` — drop-in OpenAI Chat Completions endpoint with additive Cogni extensions.

### Key References

|          |                                               |                                           |
| -------- | --------------------------------------------- | ----------------------------------------- |
| **Spec** | [Graph Execution](./graph-execution.md)       | Unified executor, billing, streaming      |
| **Spec** | [Streaming Status](./streaming-status.md)     | StatusEvent design, provider mapping      |
| **Spec** | [Thread Persistence](./thread-persistence.md) | AiEvent → wire mapping                    |
| **Code** | `src/contracts/ai.completions.v1.contract.ts` | Zod schemas (input, output, chunk, error) |
| **Code** | `src/app/api/v1/chat/completions/route.ts`    | Route handler                             |

## Goal

Provide an OpenAI-compatible completions endpoint that any standard OpenAI SDK client can use, while surfacing Cogni-specific agent activity phases through an additive `cogni_status` extension on streaming chunks.

## Non-Goals

- Thread persistence (handled by `/v1/ai/chat`)
- Modifying the `/v1/ai/chat` endpoint (`NO_CHAT_LATENCY_REGRESSION`)
- Replacing any OpenAI standard fields with custom ones

## Design

### Wire Protocol

#### Request

Standard OpenAI `POST /v1/chat/completions` body. All fields from the [OpenAI API reference](https://platform.openai.com/docs/api-reference/chat/create) are accepted. Extension fields are additive only.

| Field            | Type    | Required | Notes                                                 |
| ---------------- | ------- | -------- | ----------------------------------------------------- |
| `model`          | string  | yes      | Model ID (routed through LiteLLM)                     |
| `messages`       | array   | yes      | OpenAI message format (system, user, assistant, tool) |
| `stream`         | boolean | no       | Enable SSE streaming                                  |
| `stream_options` | object  | no       | `{ include_usage: true }` to get usage chunk          |
| `graph_name`     | string  | no       | **Extension**: graph name for routing                 |

All other standard OpenAI fields (`temperature`, `top_p`, `tools`, `tool_choice`, etc.) are accepted and passed through.

#### Non-streaming Response

Standard `ChatCompletion` object:

```json
{
  "id": "chatcmpl-{reqId}",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello!" },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

#### Streaming Response (SSE)

Content-Type: `text/event-stream`. Each event is `data: {json}\n\n`. Stream terminates with `data: [DONE]\n\n`.

**Chunk order:**

1. **Role announcement** — `delta: { role: "assistant", content: "" }`
2. **Status chunks** (zero or more) — `cogni_status: { phase, label? }` with empty delta
3. **Content/tool deltas** (zero or more) — `delta: { content }` or `delta: { tool_calls }`
4. **Finish chunk** — `delta: {}`, `finish_reason: "stop"|"length"|"tool_calls"|"content_filter"`
5. **Usage chunk** (if `stream_options.include_usage`) — empty choices, `usage` object
6. **`data: [DONE]\n\n`**

### `cogni_status` Extension

An additive, non-breaking extension on `ChatCompletionChunk` that surfaces agent activity phases. Standard OpenAI SDK clients ignore unknown fields, so this preserves full compatibility.

```json
{
  "id": "chatcmpl-abc",
  "object": "chat.completion.chunk",
  "created": 1710000000,
  "model": "gpt-4o",
  "choices": [{ "index": 0, "delta": {}, "finish_reason": null }],
  "cogni_status": {
    "phase": "thinking",
    "label": "search"
  }
}
```

| Field   | Type    | Values                                         | Notes                                                           |
| ------- | ------- | ---------------------------------------------- | --------------------------------------------------------------- |
| `phase` | string  | `"thinking"` \| `"tool_use"` \| `"compacting"` | Current agent phase                                             |
| `label` | string? | optional                                       | Display hint (e.g., tool name). Never contains args or results. |

### Authentication

SIWE session auth required (via `wrapRouteHandlerWithLogging` with `auth: { mode: "required" }`). Returns 401 for unauthenticated requests.

### Error Format

All errors use the OpenAI error shape:

```json
{ "error": { "message": "...", "type": "...", "param": null, "code": null } }
```

| HTTP | type                    | code                                    | Trigger                                      |
| ---- | ----------------------- | --------------------------------------- | -------------------------------------------- |
| 400  | `invalid_request_error` | —                                       | Bad JSON, validation failure, message errors |
| 401  | —                       | —                                       | No session (from auth wrapper)               |
| 403  | `invalid_request_error` | `billing_not_found` / `invalid_api_key` | Billing/key errors                           |
| 408  | `timeout_error`         | —                                       | Request timeout                              |
| 429  | `insufficient_quota`    | `insufficient_quota`                    | Insufficient credits                         |
| 429  | `rate_limit_error`      | `rate_limit_exceeded`                   | LiteLLM rate limit                           |
| 404  | `invalid_request_error` | `model_not_found`                       | Unknown model                                |
| 503  | `server_error`          | —                                       | LiteLLM service error                        |

### Execution Path

```
POST /v1/chat/completions
  → route.ts (parse + validate via contract)
  → completion.server.ts facade (chatCompletion / chatCompletionStream)
  → preflightCreditCheck
  → GraphExecutorPort.runGraph()
  → AiEvent stream → SSE transform (text_delta → content, tool_call_start → tool_calls, status → cogni_status)
  → Response
```

## Invariants

| ID                           | Rule                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `STATUS_IS_EPHEMERAL`        | Status events are never persisted in `ai_threads.messages`                     |
| `STATUS_BEST_EFFORT`         | Missing status events must not break streaming, persistence, or billing        |
| `STATUS_NEVER_LEAKS_CONTENT` | Label contains at most a tool name, never arguments or results                 |
| `OPENAI_COMPAT_PRESERVED`    | Extension fields are additive only; no standard fields are modified or removed |
| `NO_CHAT_LATENCY_REGRESSION` | The `/v1/ai/chat` route is never touched by changes to this endpoint           |

## Relationship to `/v1/ai/chat`

| Aspect             | `/v1/chat/completions`            | `/v1/ai/chat`                |
| ------------------ | --------------------------------- | ---------------------------- |
| Wire format        | OpenAI ChatCompletion             | assistant-stream protocol    |
| Thread persistence | None (stateless)                  | Server-authoritative threads |
| Status events      | `cogni_status` on chunk           | `status` part type           |
| Target clients     | OpenAI SDK, curl, any HTTP client | Cogni web UI                 |
