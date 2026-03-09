---
id: streaming-status
type: spec
title: Streaming Status Events
status: draft
spec_state: proposed
trust: draft
summary: Adds a StatusEvent to the AiEvent stream so clients can show agent activity phases (thinking, tool use, compaction) instead of silence. Leverages existing OpenClaw agent events and LangGraph update events with zero upstream changes.
read_when: Working on chat streaming, agent status indicators, OpenClaw gateway integration, or LangGraph stream translation
owner: cogni-dev
created: 2026-02-16
verified: 2026-02-17
tags: [ai-graphs, streaming, openclaw, ux]
---

# Streaming Status Events

> Surface agent activity phases (thinking, tool use, compaction) through the AiEvent stream so clients see status instead of silence during long-running agent execution.

### Key References

|              |                                                                              |                                     |
| ------------ | ---------------------------------------------------------------------------- | ----------------------------------- |
| **Spec**     | [Graph Execution](./graph-execution.md)                                      | AiEvent stream, billing, pump       |
| **Spec**     | [Thread Persistence](./thread-persistence.md)                                | AiEvent → wire mapping, UIMessage   |
| **Spec**     | [OpenClaw Sandbox](./openclaw-sandbox-spec.md)                               | Gateway protocol, session isolation |
| **Research** | [Gateway Header Injection](../research/openclaw-gateway-header-injection.md) | Session config, thinking field      |

## Design

### Event Flow

```
OpenClaw Gateway                           Cogni
─────────────────                          ──────────────────────────────────

emitAgentEvent({                    ┌──  WS frame: { type: "event",
  stream: "lifecycle",              │      event: "agent",
  data: { phase: "start" }         │      payload: { stream, data, sessionKey }
})                                  │    }
                                    │
emitAgentEvent({                    │    openclaw-gateway-client.ts
  stream: "tool",                   ├──▶   filter by sessionKey
  data: {                           │      map to StatusEvent
    phase: "start",                 │
    name: "exec",                   │    SandboxGraphProvider
    toolCallId: "tc1"               │      yield { type: "status", ... }
  }                                 │
})                                  │    Chat route
                                    │      writer.write({ type: "data-status", transient })
emitAgentEvent({                    │
  stream: "assistant",              │    Client
  data: { text: "..." }            │      status indicator UI
})                                  └──
```

### OpenClaw Agent Events (Already Emitted)

OpenClaw broadcasts `"agent"` events alongside `"chat"` events. Cogni currently drops them (`openclaw-gateway-client.ts:354`). These events carry:

| `stream`       | `data.phase` | `data` fields                | Maps to                                |
| -------------- | ------------ | ---------------------------- | -------------------------------------- |
| `"lifecycle"`  | `"start"`    | `startedAt`                  | `status:thinking`                      |
| `"lifecycle"`  | `"end"`      | `endedAt`                    | _(no emit — stream ends naturally)_    |
| `"lifecycle"`  | `"error"`    | `error`                      | _(handled by existing ErrorEvent)_     |
| `"tool"`       | `"start"`    | `toolCallId`, `name`, `args` | `status:tool_use`                      |
| `"tool"`       | `"end"`      | `toolCallId`, `result`       | `status:thinking` (back to thinking)   |
| `"compaction"` | `"start"`    | —                            | `status:compacting`                    |
| `"compaction"` | `"end"`      | `willRetry`                  | `status:thinking` (back to thinking)   |
| `"assistant"`  | —            | `text`                       | _(redundant with chat delta — ignore)_ |

Agent events include `sessionKey` in the payload (enriched by `server-chat.ts:327`), so the existing WS_EVENT_CAUSALITY filter applies.

### OpenClaw Verbose Level

Tool event emission is gated by a per-session `verboseLevel` setting:

- `"off"` — tool events suppressed (current default)
- `"on"` — tool name + args emitted as metadata-only messages with summaries, result stripped
- `"full"` — everything including results

Set via `agents.defaults.verboseDefault` in gateway config. For this feature, set to `"full"` — tool events include names, args, and results for maximum observability. (OpenClaw accepts `"off" | "on" | "full"`.)

### Provider Asymmetry (OpenClaw vs LangGraph)

**OpenClaw** — StatusEvent is the **only** signal for agent activity. The sandbox agent's tool calls are internal — Cogni only receives `text_delta` and `chat_final` via the chat stream. Without agent events, users see silence during tool execution. This is the primary UX problem this spec solves.

**LangGraph** — `tool_call_start` and `tool_call_result` AiEvents already exist in the stream. The route can derive `data-status` from these without changes to the translator. StatusEvent adds value only for the `compacting` phase (no equivalent in LangGraph). For MVP, LangGraph status is derived in the route from existing AiEvents — no translator changes needed.

### GatewayAgentEvent Extension

The gateway client type must be extended to carry agent lifecycle events:

```typescript
// openclaw-gateway-client.ts — extend union
export type GatewayAgentEvent =
  | { type: "accepted"; runId: string }
  | { type: "text_delta"; text: string }
  | { type: "chat_final"; text: string }
  | { type: "chat_error"; message: string }
  | {
      type: "status";
      phase: "thinking" | "tool_use" | "compacting";
      label?: string;
    }; // new
```

The gateway client maps inbound `event: "agent"` WS frames to `GatewayAgentEvent.status`:

- Filter: only `stream === "lifecycle" | "tool" | "compaction"` — drop `"assistant"` (redundant) and `"error"` (handled by chat_error)
- SessionKey filter applies identically to chat events (WS_EVENT_CAUSALITY)

### Agent Event Flood Mitigation

OpenClaw emits tool events at high frequency. Chat deltas are already throttled to 150ms (`server-chat.ts:230`), but agent events have no such throttle. Mitigation:

- Gateway client filters to only the 3 relevant streams (lifecycle, tool, compaction)
- `status` events are best-effort — the route can drop them if the stream is backpressured
- No state machine or dedup needed in v0; the client simply displays the latest status received

### New AiEvent Type

```typescript
// packages/ai-core/src/events/ai-events.ts

export interface StatusEvent {
  readonly type: "status";
  /** Current agent phase. */
  readonly phase: "thinking" | "tool_use" | "compacting";
  /** Optional label for display (e.g., tool name). Obfuscated in v0. */
  readonly label?: string;
}

export type AiEvent =
  | TextDeltaEvent
  | ToolCallStartEvent
  | ToolCallResultEvent
  | UsageReportEvent
  | AssistantFinalEvent
  | StatusEvent // new
  | DoneEvent
  | ErrorEvent;
```

### Wire Mapping (AiEvent → AI SDK Data Stream)

StatusEvent is mapped to an AI SDK **`DataUIMessageChunk`** with `transient: true`. This is the SDK mechanism for ephemeral custom data — sent alongside the stream but not persisted in UIMessage parts:

```typescript
// Define custom UIDataTypes for the stream
type CogniDataTypes = {
  status: { phase: "thinking" | "tool_use" | "compacting"; label?: string };
};

// In chat route, within createUIMessageStream execute callback:
if (event.type === "status") {
  writer.write({
    type: "data-status",
    data: { phase: event.phase, label: event.label },
    transient: true,
  });
}
```

**Rationale**: Status events are ephemeral — they represent the current agent phase during streaming, not persisted conversation content. `DataUIMessageChunk` with `transient: true` is the AI SDK v6 mechanism for exactly this: custom metadata alongside the stream that the client can consume but that doesn't become part of the message. (Note: the spec previously proposed `{ type: "annotation" }` which does not exist in AI SDK v6.0.85.)

### Client Consumption

```typescript
// Client reads transient data parts from the stream
// assistant-ui runtime exposes data parts via message.parts filtering
// DataUIPart { type: "data", data: { phase, label } }
// v0: simple text indicator — "Thinking...", "Using tool: exec", "Compacting..."
```

### Session Activity (Problem 2)

For v0, session activity visibility is derived from the StatusEvent stream itself — no new infrastructure needed:

1. **During streaming**: The client already knows the agent is active because it's receiving SSE events. StatusEvents just add specificity (thinking vs tool_use).
2. **Cross-session visibility**: Deferred. Requires either a polling endpoint or a presence system. Not in this spec.

The gateway client already tracks `accepted` → `done` lifecycle. If the client receives `accepted` but no `done` within a timeout, it can show "agent is working" generically.

## Goal

Enable clients to show meaningful status indicators during agent execution instead of silence. Zero OpenClaw code changes. Consistent across OpenClaw and LangGraph providers.

## Non-Goals

- Exposing internal agent reasoning or tool results (obfuscated in v0)
- Cross-session activity dashboard ("who else is active?")
- Persisting status events in UIMessage or ai_threads
- Extended thinking block streaming (model-level thinking content)
- Real-time presence system or heartbeat infrastructure

## Invariants

| Rule                       | Constraint                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STATUS_IS_EPHEMERAL        | StatusEvent is never persisted in `ai_threads.messages`. It maps to a transient `DataUIMessageChunk` (`transient: true`), not a UIMessage part. The UIMessage accumulator ignores transient data. |
| STATUS_BEST_EFFORT         | StatusEvent emission is best-effort. Missing status events must not break streaming, persistence, or billing. Client must handle streams with zero StatusEvents gracefully.                       |
| STATUS_SESSIONKEY_FILTERED | OpenClaw agent events are filtered by `sessionKey` using the same WS_EVENT_CAUSALITY invariant as chat events. Agent events with mismatched or missing sessionKey are dropped.                    |
| STATUS_NEVER_LEAKS_CONTENT | StatusEvent `label` field contains at most a tool name (e.g., `"exec"`, `"memory_search"`). Never tool arguments, results, or reasoning content.                                                  |
| AIEVENT_NEVER_VERBATIM     | Unchanged — StatusEvent is an AiEvent mapped to wire format by the route, never sent verbatim.                                                                                                    |
| VERBOSE_FULL_DEFAULT       | OpenClaw gateway config sets `agents.defaults.verboseDefault: "full"` to enable full tool event emission (names, args, results). Valid values: `"off" \| "on" \| "full"`.                         |

### File Pointers

| File                                                        | Purpose                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| `packages/ai-core/src/events/ai-events.ts`                  | Add `StatusEvent` to AiEvent union                       |
| `src/adapters/server/sandbox/openclaw-gateway-client.ts`    | Consume `"agent"` events (currently dropped at line 354) |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts`     | Map gateway agent events → StatusEvent                   |
| `src/app/api/v1/ai/chat/route.ts`                           | Map StatusEvent → `data-status` in createUIMessageStream |
| `services/sandbox-openclaw/openclaw-gateway.json`           | Set `verboseDefault: "full"`                             |
| `src/adapters/server/ai/langgraph/dev/stream-translator.ts` | Future: derive StatusEvent from LangGraph update events  |

## Acceptance Checks

1. **StatusEvent in AiEvent union**
   - `pnpm check` passes with StatusEvent added to ai-events.ts
   - TypeScript enforces exhaustive handling in switch statements on AiEvent.type

2. **OpenClaw agent events consumed**
   - Gateway client yields StatusEvent when receiving `stream: "tool"` agent events
   - SessionKey filter applies to agent events (mismatched keys dropped)
   - `stream: "assistant"` agent events are ignored (redundant with chat delta)

3. **Wire data chunk emitted**
   - Chat route writes `{ type: "data-status", data: { phase, label }, transient: true }` for StatusEvent
   - UIMessage accumulator does NOT persist transient data parts

4. **Status not persisted**
   - After a streaming chat turn, `ai_threads.messages` contains no status data
   - Only text parts and tool-call parts are persisted (existing behavior unchanged)
   - `transient: true` flag ensures AI SDK does not include data-status in message parts

5. **Graceful degradation**
   - If OpenClaw `verboseDefault` is `"off"`, no StatusEvents are emitted and streaming works unchanged
   - If gateway drops agent events, chat delta/final events still produce correct output

6. **No content leakage**
   - StatusEvent `label` contains only tool name string, never args or results
   - Stack test: assert StatusEvent payloads contain no content beyond phase + label

## Resolved Questions

- [x] **AI SDK wire format**: `annotation` type does not exist in AI SDK v6.0.85. Use `DataUIMessageChunk` with `transient: true` via custom `UIDataTypes`. See Wire Mapping section.
- [x] **LangGraph status**: Derive from existing `tool_call_start`/`tool_call_result` AiEvents in the route. No translator changes for MVP.
- [x] **GatewayAgentEvent type**: Extend with `{ type: "status"; phase; label? }` member. See GatewayAgentEvent Extension section.
- [x] **Provider asymmetry**: OpenClaw StatusEvent is the only tool signal (sandbox tools are invisible). LangGraph already has ToolCallStart/Result. Documented in Provider Asymmetry section.

## Open Questions

- [ ] Should LangGraph InProc provider emit `status:thinking` on first `text_delta`? (Would require synthetic StatusEvent before first content — adds complexity for marginal UX gain with InProc graphs)
- [ ] Should the client derive `status:thinking` implicitly from stream start + no content yet, or should the provider emit it explicitly? (Explicit is cleaner but requires lifecycle.start to arrive before first delta)
- [ ] Does assistant-ui's `DataUIPart` render hook support transient-only parts, or do we need a custom `useStatusIndicator` that reads from the raw stream? (Needs verification against @assistant-ui/react-ai-sdk)

## Related

- [Graph Execution](./graph-execution.md) — AiEvent stream, billing decorator, pump mechanics
- [Thread Persistence](./thread-persistence.md) — AiEvent → wire mapping, UIMessage accumulator
- [OpenClaw Sandbox](./openclaw-sandbox-spec.md) — Gateway protocol, WS_EVENT_CAUSALITY invariant
- [OpenClaw Sandbox Controls](./openclaw-sandbox-controls.md) — Session configuration, model override
