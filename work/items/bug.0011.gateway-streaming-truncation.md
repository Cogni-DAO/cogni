---
id: bug.0011
type: bug
title: "Gateway streaming truncates output mid-sentence in UI"
status: needs_design
priority: 1
estimate: 1
summary: Real model responses via the OpenClaw gateway are truncated mid-sentence when displayed in the Cogni chat UI. Example — nemotron returns full content in raw stream but UI renders "Just let me know what you'd like to dive into, and I" then stops.
outcome: Full streaming content renders in UI without truncation
spec_refs:
  - openclaw-sandbox-spec
project: proj.openclaw-capabilities
branch: feat/concurrent-openclaw
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-10
labels: [openclaw, gateway, streaming, ui]
external_refs:
assignees: derekg1729
credit:
revision: 0
blocked_by:
deploy_verified: false
rank: 3
---

# Gateway streaming truncates output mid-sentence in UI

## Observed

With a real model (nemotron-nano-30b) producing content through the gateway, the UI truncates the response mid-sentence:

> "Just let me know what you'd like to dive into, and I" (nothing after)

The OPENCLAW_RAW_STREAM log shows full content with `text_end` and `assistant_message_end` events, and `curl` returns the complete response. So the content exists — it's being dropped somewhere in the UI rendering pipeline.

## Root Cause

**`route.ts` violated the `ASSISTANT_FINAL_REQUIRED` contract.** The `for await` loop that translates `AiEvent` → Data Stream Protocol SSE handled `text_delta` and `tool_call_*` but silently dropped `assistant_final`. The authoritative full text was never delivered to the client.

The streaming chain:

```
SandboxGraphProvider.createGatewayExecution()
  yields: text_delta*, assistant_final, usage_report*, done
    ↓
RunEventRelay (ai_runtime.ts)
  filters: usage_report → billing subscriber
  passes: text_delta, assistant_final, done → uiStream()
    ↓
route.ts for-await loop
  text_delta → controller.appendText()     ✅ handled
  assistant_final → SILENTLY DROPPED       ❌ was the bug
  tool_call_* → controller tool methods    ✅ handled
    ↓
assistant-stream → Data Stream Protocol SSE → browser
```

**Why gateway truncates but LangGraph inproc doesn't:** The gateway client (`openclaw-gateway-client.ts:282-295`) uses diff-based delta streaming. Each WS `chat` delta carries accumulated text; the client diffs against `prevText`. When the agent does multi-turn LLM calls, accumulated text resets between turns (regression guard at line 285 sets `prevText=""`), which can lose text across turn boundaries. LangGraph inproc streams reliably — each chunk produces one `text_delta`, all arrive in order, so `assistant_final` reconciliation is a no-op.

**Contributing factor:** ReadableStream backpressure. Even when reconciliation text was appended, fast event bursts could prevent `controller.appendText()` from flushing before stream close. A macrotask yield (`setTimeout(0)`) before `message-finish` is required as a flush barrier.

## Fix Applied

**Files changed:**

1. `src/app/api/v1/ai/chat/route.ts` (lines 461-578):
   - Added `accumulatedText`, `assistantFinalContent`, `eventSeq` tracking
   - `assistant_final` handler captures `event.content` with debug log (`ai.chat_assistant_final_received`)
   - Post-loop reconciliation: if `assistantFinalContent.startsWith(accumulatedText)` and is longer, `controller.appendText(remainder)` fills the gap
   - Divergent content (non-prefix) logs warning (`ai.chat_reconcile_content_diverged`)
   - Flush barrier: `await new Promise(r => setTimeout(r, 0))` after reconciliation, before `message-finish`

2. `tests/contract/app/ai.chat.sse-reconciliation.test.ts` (NEW):
   - Contract test with synthetic `AiEvent` streams
   - 6/6 passing — truncated deltas, complete deltas, severely truncated, zero deltas, no assistant_final, usage propagation

**Key invariant enforced by test:** `reconstructed SSE text === assistant_final.content`

## Real-Stack Validation (2026-02-10)

Tested with nemotron-nano-30b via gateway. Reconciliation fires correctly — logs confirm:

**Request 1** (single-turn, 10s): `accLen:10, finalLen:93, remainderLen:83` — deltas delivered 11% of text, reconciliation filled the rest. UI showed full text.

**Request 2** (multi-turn chain-of-thought, 87s, 6 LLM calls): `accLen:0, finalLen:78, remainderLen:78` — **zero deltas reached route.ts.** The gateway client's diff logic produced nothing across 6 turns. User saw blank for 87 seconds, then full text dumped at end via reconciliation.

The reconciliation prevents total text loss but does NOT fix the underlying streaming UX: users get no progressive text during multi-turn agent execution. The gateway client's diff-based delta logic (`openclaw-gateway-client.ts:282-295`) is fundamentally broken for multi-turn — accumulated text resets between turns and the regression guard at line 285 zeroes out `prevText`, causing all subsequent diffs to be empty when accumulated also resets.

## Remaining (P0 — gateway chat still unreliable)

- [ ] Fix gateway client delta logic for multi-turn: accumulated text resets between turns → zero deltas (no progressive streaming)
- [ ] Investigate agent input poisoning: multi-turn agent returned JSON parse error as its response — may be receiving corrupted chat history from prior truncated turns
- [x] Route.ts reconciliation (safety net for text delivery) — done
- [x] Flush barrier before stream close — done
- [x] Contract test: SSE text === assistant_final content — 6/6 passing
- [x] Real-stack validation — reconciliation fires, logs confirm

## Validation

- [ ] Send a multi-turn prompt through gateway and confirm progressive streaming (deltas > 0) during execution
- [ ] Confirm full response renders in UI without truncation across single-turn and multi-turn
- [ ] No `ai.chat_assistant_final_missing` errors in logs

## PR / Links

- Related: task.0008, bug.0009
- Handoff: [handoff](../handoffs/bug.0011.handoff.md)
- Contract: `packages/ai-core/src/events/ai-events.ts` (`ASSISTANT_FINAL_REQUIRED` invariant)
- Project: [proj.openclaw-capabilities](../projects/proj.openclaw-capabilities.md)
