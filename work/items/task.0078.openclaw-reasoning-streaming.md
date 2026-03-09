---
id: task.0078
type: task
title: OpenClaw reasoning token streaming — display model thinking in collapsible UI
status: needs_design
priority: 0
estimate: 2
summary: "Enable OpenClaw reasoningLevel via sessions.patch, forward reasoning tokens through gateway WS, map to AI SDK reasoning parts, render with assistant-ui Reasoning component. Filter reasoning from persistence and model transcript."
outcome: When reasoning models (DeepSeek, Claude, Gemini) think, the chat UI shows a collapsible 'Thought for N seconds' block with the reasoning content. Reasoning is never persisted in ai_threads or sent back to the model.
spec_refs: streaming-status, graph-execution, openclaw-sandbox-spec, thread-persistence
assignees: []
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-02-17
labels: [openclaw, streaming, ux, reasoning]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 23
---

# OpenClaw reasoning token streaming — display model thinking in collapsible UI

## Context

OpenClaw supports reasoning/thinking token extraction from models (DeepSeek, Claude, Gemini) with three modes: `"off"`, `"on"`, `"stream"`. Currently we don't configure `reasoningLevel` on the session, so reasoning tokens are hidden.

The gateway protocol supports `reasoningLevel` as a `sessions.patch` parameter. When `"stream"` is set, OpenClaw emits reasoning via `onReasoningStream` callbacks. The question is how these reach WS clients — investigation needed on whether the gateway forwards reasoning via WS events or if it requires an intermediate mapping.

assistant-ui provides a built-in `Reasoning` component (`npx assistant-ui add reasoning`) that renders AI SDK `reasoning` parts as collapsible "Thought for N seconds" blocks — exactly like ChatGPT's UI. No bespoke UI needed.

**Relationship to task.0074**: task.0074 added ephemeral phase indicators (`data-status` transient chunks: thinking/tool_use/compacting). This task adds actual reasoning TEXT display. They are complementary — phase indicators show what the agent is doing, reasoning shows what the model is thinking.

## Requirements

- `configureSession()` sends `reasoningLevel: "stream"` via `sessions.patch` for reasoning-capable models
- Reasoning tokens from OpenClaw are captured from the gateway WS protocol and yielded as `GatewayAgentEvent`
- `SandboxGraphProvider` maps reasoning events to a new `ReasoningDeltaEvent` (or reuses AI SDK reasoning protocol)
- Chat route emits `reasoning-start`, `reasoning-delta`, `reasoning-end` AI SDK chunks
- assistant-ui Reasoning component renders reasoning as collapsible blocks
- **REASONING_NEVER_PERSISTED**: Reasoning parts are NOT saved in `ai_threads.messages` — the route accumulator ignores reasoning events
- **REASONING_NEVER_SENT_BACK**: `uiMessagesToMessageDtos()` does NOT include reasoning parts in the transcript sent to the model (already true — it only maps `text` and `dynamic-tool` parts)
- **REASONING_BEST_EFFORT**: Missing reasoning tokens don't break streaming, persistence, or billing (same as STATUS_BEST_EFFORT)
- Streams from non-reasoning models work identically to today (graceful degradation)

## Design

### Investigation Needed

The critical unknown is how reasoning tokens travel from OpenClaw's internal `onReasoningStream` callback to the gateway WS client. Possible paths:

1. **Agent event stream** — reasoning emitted as `stream: "reasoning"` agent events (needs verification)
2. **Chat event field** — chat delta events carry a `thinking` field alongside `text` (protocol schemas show `thinking: Type.Optional(Type.String())`)
3. **Separate WS event type** — reasoning has its own event type

Start with investigation: send a message to a reasoning model (DeepSeek v3.2) with `reasoningLevel: "stream"` and capture raw WS frames to see what arrives.

### Pipeline (once WS format is known)

```
OpenClaw gateway WS frame (reasoning content)
  → openclaw-gateway-client.ts: yield { type: "reasoning_delta", text }
  → sandbox-graph.provider.ts: yield { type: "reasoning_delta", delta }
  → route.ts: writer.write({ type: "reasoning-start/delta/end" })
  → AI SDK streaming protocol: reasoning parts
  → assistant-ui Reasoning component: collapsible "Thought for N seconds" block
```

### Persistence Safety

- `uiMessagesToMessageDtos()` only maps `text` and `dynamic-tool` parts → reasoning parts are already filtered out
- Route accumulator (`accumulatedText`, `accToolParts`) only tracks text and tool parts → reasoning is not accumulated
- `saveThread()` persists UIMessage parts from the accumulator → reasoning never reaches the DB
- Reasoning parts MAY appear in the in-memory UIMessage during streaming (for Reasoning component rendering) but are NOT included in the persisted UIMessage built by the route

## Allowed Changes

- `src/adapters/server/sandbox/openclaw-gateway-client.ts` — add reasoning event handling, add reasoningLevel to configureSession
- `src/adapters/server/sandbox/sandbox-graph.provider.ts` — map reasoning events, pass reasoningLevel to configureSession
- `src/app/api/v1/ai/chat/route.ts` — emit reasoning-start/delta/end chunks
- `packages/ai-core/src/events/ai-events.ts` — add ReasoningDeltaEvent to AiEvent union (if needed)
- `packages/ai-core/src/index.ts` — export new type (if needed)
- `src/components/vendor/assistant-ui/thread.tsx` — add Reasoning component to AssistantMessage
- `src/components/vendor/assistant-ui/reasoning.tsx` — NEW: generated by `npx assistant-ui add reasoning`
- `services/sandbox-openclaw/openclaw-gateway.json` — no changes expected (reasoningLevel is per-session, not config-level)
- Test files for the above
- `docs/spec/streaming-status.md` — update with reasoning pipeline

## Plan

- [ ] **1. Investigate gateway WS reasoning format**
  - Set `reasoningLevel: "stream"` via `sessions.patch` manually (or in configureSession)
  - Send a message to DeepSeek v3.2 (reasoning model) and capture raw WS frames
  - Document what frame type/format reasoning tokens arrive in
  - If reasoning doesn't arrive via WS: investigate OpenClaw source for gateway-level reasoning forwarding

- [ ] **2. Add Reasoning component to assistant-ui**
  - Run `npx assistant-ui add reasoning` to generate the component
  - Add `Reasoning` to `AssistantMessage` in `thread.tsx` via `MessagePrimitive.Parts` components
  - Verify it renders when reasoning parts are present (can test with a mock)

- [ ] **3. Extend gateway client for reasoning events**
  - Add reasoning event handling in WS message handler (format from step 1)
  - Add `reasoningLevel` parameter to `configureSession()` → `sessions.patch`
  - Yield `{ type: "reasoning_delta", text }` as new `GatewayAgentEvent` variant

- [ ] **4. Wire through provider and route**
  - Add `ReasoningDeltaEvent` to AiEvent union (if needed, or handle inline)
  - Provider maps gateway reasoning events to AiEvent
  - Route emits `reasoning-start`, `reasoning-delta`, `reasoning-end` AI SDK chunks
  - Verify route accumulator does NOT include reasoning in persisted UIMessage

- [ ] **5. Verify persistence safety**
  - Confirm `uiMessagesToMessageDtos()` does not include reasoning parts (unit test)
  - Confirm persisted thread in DB has no reasoning content after a reasoning model response
  - Confirm subsequent turns don't send reasoning back to the model

- [ ] **6. Full validation**
  - `pnpm check` passes
  - Manual test: send message to DeepSeek v3.2, see collapsible thinking block in UI
  - Manual test: same thread, send follow-up — reasoning from previous turn is not in context

## Validation

**Automated:**

```bash
pnpm check
pnpm packages:build
pnpm test tests/unit/features/ai/mappers-uimessage.test.ts
```

**Manual (requires dev:stack with OpenClaw gateway running):**

1. Open chat UI, select DeepSeek v3.2 (reasoning model)
2. Send a message that triggers thinking (e.g., complex question)
3. Verify collapsible "Thought for N seconds" block appears in UI
4. Verify the thinking content is NOT in the persisted message (check DB or network tab)
5. Send a follow-up message — reasoning from previous turn should NOT appear in context
6. Test with non-reasoning model (gpt-4o-mini) — no reasoning blocks, streaming works normally

## Review Checklist

- [ ] **Work Item:** `task.0078` linked in PR body
- [ ] **Spec:** REASONING_NEVER_PERSISTED, REASONING_NEVER_SENT_BACK, REASONING_BEST_EFFORT upheld
- [ ] **Tests:** reasoning filtering in mappers tested, reasoning event handling tested
- [ ] **No bespoke UI:** uses assistant-ui Reasoning component, not custom implementation
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Spec: [streaming-status](../../docs/spec/streaming-status.md)
- Depends on: task.0074 (StatusEvent pipeline — Done)
- Handoff: [handoff](../handoffs/task.0078.handoff.md)

## Attribution

- Design: Claude (Opus 4.6)
- Implementation: TBD
