---
id: bug.0036
type: bug
title: "Chat route enqueues to closed assistant-stream controller — unhandled TypeError"
status: needs_triage
priority: 1
estimate: 1
summary: "After the AiEvent pump loop exits, the chat route tries to controller.enqueue() message-finish or error chunks, but createAssistantStreamResponse has already closed the underlying controller. This produces unhandled TypeError: Controller is already closed."
outcome: "No unhandled rejections from controller.enqueue/close after stream finalization. Error-path and happy-path both complete cleanly."
spec_refs:
assignees:
  - unassigned
credit:
project:
branch:
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-11
labels: [streaming, reliability]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 6
---

# Chat route enqueues to closed assistant-stream controller

## Requirements

### Observed

After the pump loop in `src/app/api/v1/ai/chat/route.ts` (line 386–459) exits, the route attempts to:

1. `controller.enqueue({ type: "message-finish", ... })` (line 525) — happy path
2. `controller.enqueue({ type: "error", ... })` (line 546) — error path (e.g. `assistant_final` missing)

But `createAssistantStreamResponse` (from `assistant-stream`) has already closed the underlying WritableStream by the time these lines execute. This produces:

```
TypeError: Invalid state: Controller is already closed
    at ignore-listed frames {
  code: 'ERR_INVALID_STATE'
}
⨯ unhandledRejection: TypeError: Invalid state: Controller is already closed
```

The unhandled rejection fires 2-3 times per request, polluting logs and triggering Node.js unhandledRejection handlers.

**Log sequence observed in production:**

```
WARN  "Ignoring event after termination (protocol violation)"    ← ai_runtime.ts:228
ERROR "ai.chat_assistant_final_missing — ASSISTANT_FINAL_REQUIRED violated"  ← route.ts:500
WARN  "ai.chat_stream_final_error" error:"internal"              ← route.ts:542
TypeError: Invalid state: Controller is already closed           ← route.ts:546 (enqueue)
INFO  "ai.thread_persisted" messageCount:6                       ← route.ts:584 (succeeds!)
INFO  "ai.chat_stream_closed"                                    ← route.ts:639
TypeError: Invalid state: Controller is already closed           ← (unhandled x2)
```

Note: thread persistence (phase 2) succeeds despite the controller errors — the bug is purely in the stream finalization path.

### Expected

- Route guards `controller.enqueue()` and `controller.close()` calls against already-closed state
- No unhandled `TypeError` rejections from the stream callback
- Error-path (no `assistant_final`) gracefully degrades without crashing the controller

### Reproduction

1. Start dev stack: `pnpm dev`
2. Send a multi-turn chat via the UI (any model)
3. Observe server logs for `TypeError: Invalid state: Controller is already closed`
4. The error appears on most/all streaming requests, not just edge cases

### Impact

- **Severity:** Medium — the chat response still reaches the client and persistence works, but every request produces unhandled rejections
- **User-visible:** No direct user impact (stream content arrives correctly), but Node.js may eventually terminate on too many unhandled rejections depending on configuration
- **Log noise:** 2-3 TypeError stack traces per chat request obscure real errors

## Allowed Changes

- `src/app/api/v1/ai/chat/route.ts` — lines 524–551 (post-pump enqueue/close)
- Possibly `src/features/ai/services/ai_runtime.ts` — pump termination guard (line 224–230) if the `done` event ordering is the root cause

## Plan

- [ ] Wrap `controller.enqueue()` calls at lines 525 and 546 in try/catch to catch `ERR_INVALID_STATE`
- [ ] Alternatively, check if `controller` exposes a `closed` or `writable` property before enqueuing
- [ ] Investigate why `createAssistantStreamResponse` closes the controller before the callback's post-pump code runs — may need to defer close until callback returns
- [ ] Add a regression test (contract-level) that verifies no unhandled rejections on stream finalization

## Validation

**Command:**

```bash
pnpm test:contract
```

**Expected:** All contract tests pass. No `ERR_INVALID_STATE` in test output. Manual E2E test shows no unhandled rejection in server logs.

## Review Checklist

- [ ] **Work Item:** `bug.0036` linked in PR body
- [ ] **Spec:** all invariants of linked specs (here, or project) are upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
