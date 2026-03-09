---
id: task.0074
type: task
title: OpenClaw streaming status events — surface agent activity in UI
status: done
priority: 1
estimate: 2
summary: "Consume OpenClaw agent events (currently dropped) and emit transient data-status chunks so the client shows Thinking, Using tool, Compacting instead of silence"
outcome: During OpenClaw agent execution, the chat UI shows real-time status indicators for agent phases (thinking, tool use, compaction) — zero OpenClaw code changes
spec_refs: streaming-status, graph-execution, openclaw-sandbox-spec
assignees: []
credit:
project: proj.openclaw-capabilities
branch: feat/openclaw-thinking-streaming
pr:
reviewer:
created: 2026-02-16
updated: 2026-02-17
labels: [openclaw, streaming, ux]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# OpenClaw streaming status events — surface agent activity in UI

## Context

OpenClaw already broadcasts `"agent"` events (lifecycle, tool, compaction) alongside `"chat"` events on the WebSocket. Cogni drops them at `openclaw-gateway-client.ts:354`. This means users see silence while the agent thinks, calls tools, or compacts — sometimes for 30+ seconds.

This task picks up those events, maps them through the AiEvent pipeline, and emits transient `data-status` chunks to the client. Zero OpenClaw code changes — config change + Cogni-side plumbing only.

**Spec:** [streaming-status](../../docs/spec/streaming-status.md)

## Requirements

- OpenClaw `"agent"` WS events with matching `sessionKey` are consumed (not dropped)
- Agent events map to `StatusEvent` AiEvent: `{ type: "status", phase, label? }`
- Chat route emits `{ type: "data-status", data: { phase, label }, transient: true }` via `DataUIMessageChunk`
- Status events are never persisted in `ai_threads.messages` (STATUS_IS_EPHEMERAL)
- `label` contains only tool name, never args or results (STATUS_NEVER_LEAKS_CONTENT)
- Missing status events don't break streaming, persistence, or billing (STATUS_BEST_EFFORT)
- Gateway config sets `verboseDefault: "full"` (VERBOSE_FULL_DEFAULT)
- `stream: "assistant"` agent events are ignored (redundant with chat deltas)
- `stream: "error"` agent events are ignored (handled by existing chat_error)
- Streams with zero StatusEvents work identically to today (graceful degradation)

## Allowed Changes

- `packages/ai-core/src/events/ai-events.ts` — add StatusEvent to union
- `src/adapters/server/sandbox/openclaw-gateway-client.ts` — consume agent events
- `src/adapters/server/sandbox/sandbox-graph.provider.ts` — yield StatusEvent
- `src/app/api/v1/ai/chat/route.ts` — map StatusEvent → data-status chunk
- `services/sandbox-openclaw/openclaw-gateway.json` — set verboseDefault
- Test files for the above
- `docs/spec/streaming-status.md` — update status to active after implementation

## Plan

- [ ] **1. Add StatusEvent to AiEvent union** (`ai-events.ts`)
  - Add `StatusEvent` interface with `type: "status"`, `phase`, `label?`
  - Add to `AiEvent` union type
  - Run `pnpm packages:build` — fix any exhaustive switch errors downstream

- [ ] **2. Extend GatewayAgentEvent type** (`openclaw-gateway-client.ts`)
  - Add `{ type: "status"; phase: "thinking" | "tool_use" | "compacting"; label?: string }` to union
  - In the WS message handler, add a branch for `frame.event === "agent"` (alongside existing `"chat"` branch)
  - Filter by sessionKey (same WS_EVENT_CAUSALITY check as chat events)
  - Only accept `stream === "lifecycle" | "tool" | "compaction"` — drop `"assistant"` and `"error"`
  - Map to `GatewayAgentEvent.status` and yield

- [ ] **3. Map in SandboxGraphProvider** (`sandbox-graph.provider.ts`)
  - In the `for await` loop over `gatewayClient.runAgent()`, handle `event.type === "status"`
  - Yield `{ type: "status", phase: event.phase, label: event.label }` as AiEvent

- [ ] **4. Emit data-status in chat route** (`route.ts`)
  - In the `createUIMessageStream` execute callback, handle `event.type === "status"`
  - Write `{ type: "data-status", data: { phase, label }, transient: true }`
  - Define `CogniDataTypes` for type safety (or use `as UIMessageChunk` cast for v0)

- [ ] **5. Set verboseDefault in gateway config** (`openclaw-gateway.json`)
  - Set `agents.defaults.verboseDefault: "full"`

- [ ] **6. Verify graceful degradation**
  - Confirm existing streaming still works when no agent events arrive
  - Confirm `pnpm check` passes

## Validation

**Automated:**

```bash
pnpm check          # types + lint
pnpm packages:build # ai-core package builds with StatusEvent
```

**Manual (requires dev:stack with OpenClaw gateway running):**

1. Open chat UI, select OpenClaw agent
2. Send a message that triggers tool use (e.g., ask it to search files)
3. Verify browser network tab shows `data-status` chunks in SSE stream
4. Verify final message persists normally (no status data in thread)
5. Verify streaming works normally if `verboseDefault` is set back to `"off"`

## Review Checklist

- [ ] **Work Item:** `task.0074` linked in PR body
- [ ] **Spec:** All streaming-status invariants upheld (STATUS_IS_EPHEMERAL, STATUS_BEST_EFFORT, STATUS_SESSIONKEY_FILTERED, STATUS_NEVER_LEAKS_CONTENT, VERBOSE_FULL_DEFAULT)
- [ ] **Tests:** StatusEvent handling in route doesn't break existing streaming tests
- [ ] **No content leakage:** label contains only tool name string
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Spec: [streaming-status](../../docs/spec/streaming-status.md)

## Attribution

- Design: Claude (Opus 4.6)
- Implementation: TBD
