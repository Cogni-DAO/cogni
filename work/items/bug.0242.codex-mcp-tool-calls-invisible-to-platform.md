---
id: bug.0242
type: bug
title: "Codex MCP tool calls invisible to platform — no persistence, no observability, no history"
status: needs_triage
priority: 0
rank: 1
estimate: 5
summary: "When Codex calls MCP tools via its internal agent loop, zero tool_call_start/tool_call_result AiEvents are emitted. Thread persistence, Langfuse traces, SSE tool streaming, and subsequent-turn history are all blind to what tools ran. The model's own tool activity is erased from the platform's view."
outcome: "Codex MCP tool calls emit tool_call_start and tool_call_result AiEvents. Thread persistence includes structured tool parts. Langfuse traces show tool spans. Chat UI renders tool invocations. Subsequent turns see accurate tool history."
spec_refs:
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-31
updated: 2026-03-31
labels: [ai-graphs, byo-ai, mcp, observability, persistence]
external_refs:
---

# Codex MCP tool calls invisible to platform

## Observed

When a user selects a Codex-backed model (e.g. `gpt-5.3-codex-spark`) and the agent calls MCP tools (Grafana, Playwright, etc.), the platform has **zero visibility** into those tool calls.

### What actually happens

1. Codex subprocess calls MCP tools internally via `config.toml` — this works, the tools execute.
2. The Codex SDK emits `item.started`/`item.completed` events with `item.type: "mcp_tool_call"` containing `server`, `tool`, `arguments`, `result`, `status`.
3. `codex-llm.adapter.ts:237-256` ignores all items except `agent_message` — `mcp_tool_call` items are silently dropped.
4. No `tool_call_start` or `tool_call_result` AiEvents are ever emitted.

### What breaks downstream

| System                     | What's lost                                                                                                                                                                                                                             | Code pointer                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Thread persistence**     | `assembleAssistantMessage()` builds tool parts from `tool_call_start`/`tool_call_result` events. Zero events → zero tool parts persisted. Next turn, model sees only flat text, not structured tool history.                            | `assemble-assistant-message.ts:46-64` |
| **Langfuse observability** | Tool spans are created from `tool_call_start`/`tool_call_result` in the trace. No events → no tool spans → invisible tool usage in Langfuse.                                                                                            | `runs/route.ts:581-586`               |
| **SSE tool streaming**     | Chat route writes `tool-input-start`, `tool-input-available`, `tool-output-available` chunks from these events. Without them, UI shows no tool activity — user sees blank gap, then garbled text summary.                               | `chat/route.ts:354-390`               |
| **Completions API**        | Same events drive tool call chunks in the OpenAI-compatible endpoint. External consumers get nothing.                                                                                                                                   | `chat/completions/route.ts`           |
| **Agent continuity**       | On the 2nd message in a thread, persisted messages are replayed via `runs/route.ts:538`. Without tool parts, the model loses context about what it already looked up. It may re-call the same tools or hallucinate about prior results. | `runs/route.ts:538-548`               |

### Garbled output symptom

The user sees text like `"patterns.ble.oyment.startedat2026-03-"` — the model is receiving raw MCP JSON results internally and attempting to summarize them as prose. Because no structured tool display exists, the raw data leaks into the text stream, mangled by the model's attempt to narrate it.

## Expected

Codex MCP tool calls produce the same `AiEvent` stream as LiteLLM-backed models:

- `tool_call_start` when `item.started` fires for `mcp_tool_call` items
- `tool_call_result` when `item.completed` fires for `mcp_tool_call` items
- Thread persistence includes tool parts (toolCallId, toolName, input, output)
- Langfuse traces show tool spans
- Chat UI renders tool call cards (same as other providers)

## Reproduction

1. Start dev stack: `pnpm dev:stack`
2. Open chat, select a Codex model (e.g. `gpt-5.3-codex-spark` with a ChatGPT connection)
3. Ask: "what grafana preview logs are there" (triggers Grafana MCP tool call)
4. Observe: no tool cards in UI, garbled text output, no tool parts in thread history
5. Send a follow-up message — model has no structured memory of the tool call

## Impact

- **Severity: high** — affects all Codex+MCP usage (the primary BYO-AI path)
- **Data loss** — tool call history not persisted, unrecoverable after stream completes
- **Observability gap** — tool usage invisible in Langfuse, impossible to debug or audit
- **Agent degradation** — model loses tool context across turns, degrades multi-turn reasoning

## Root cause

`codex-llm.adapter.ts` is an `LlmService` adapter — it only emits `ChatDeltaEvent` (`text_delta`, `tool_call_delta`, `error`, `done`). The `InProcCompletionUnitAdapter` that consumes it only forwards `text_delta` to the graph.

In the normal LiteLLM flow: LLM returns tool*calls → LangGraph invokes tools via `toolRunner` → `toolRunner` emits `tool_call_start`/`tool_call_result` AiEvents. The LLM adapter doesn't need to emit tool events because the tool loop happens \_above* it.

With Codex: the tool loop happens _inside_ the subprocess. The LLM adapter sees completed tool results in the event stream (`mcp_tool_call` items) but has no way to surface them as AiEvents — the `ChatDeltaEvent` type doesn't include tool lifecycle events, and `InProcCompletionUnitAdapter` doesn't forward `tool_call_delta`.

### Codex SDK event types (from `@openai/codex-sdk@0.116.0`)

```typescript
type McpToolCallItem = {
  id: string;
  type: "mcp_tool_call";
  server: string; // MCP server name
  tool: string; // tool name
  arguments: unknown; // tool input
  result?: { content: ContentBlock[]; structured_content: unknown };
  error?: { message: string };
  status: McpToolCallStatus;
};
```

Events: `item.started` (status: in_progress), `item.completed` (status: completed/failed).

## Allowed Changes

- `apps/operator/src/adapters/server/ai/codex/codex-llm.adapter.ts` — handle `mcp_tool_call` items
- `apps/operator/src/adapters/server/ai/inproc-completion-unit.adapter.ts` — forward tool events if needed
- `apps/operator/src/ports/llm.port.ts` — extend `ChatDeltaEvent` if needed
- `packages/langgraph-graphs/src/inproc/runner.ts` — handle tool events from completion stream
- `packages/ai-core/src/events/ai-events.ts` — only if new event type needed

## Plan

- [ ] Design: determine where to emit AiEvents — adapter level or runner level
- [ ] Handle `mcp_tool_call` items in codex adapter event loop
- [ ] Emit `tool_call_start` on `item.started` with `type: "mcp_tool_call"`
- [ ] Emit `tool_call_result` on `item.completed` with `type: "mcp_tool_call"`
- [ ] Ensure events flow through to `assembleAssistantMessage` for persistence
- [ ] Verify Langfuse traces include tool spans
- [ ] Verify chat UI renders tool cards for Codex MCP calls
- [ ] Test multi-turn: 2nd message sees structured tool history

## Validation

**Command:**

```bash
pnpm dev:stack
# Manual: Codex model + MCP tool call → tool cards in UI + tool parts in thread
pnpm check:fast
```

**Expected:** Tool calls visible in UI, persisted in thread, traced in Langfuse.

## Review Checklist

- [ ] **Work Item:** `bug.0242` linked in PR body
- [ ] **Spec:** TOOLS_VIA_TOOLRUNNER deviation documented and mitigated
- [ ] **Tests:** unit test for mcp_tool_call → AiEvent mapping
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
