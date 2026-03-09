---
id: bug.0056
type: bug
title: "Thread switch aborts in-flight stream — credits consumed, response lost to user"
status: needs_design
priority: 0
estimate: 3
summary: "ChatRuntimeProvider uses `key={activeThreadKey ?? 'new'}` to force full React unmount/remount on thread switch. This aborts the in-flight SSE stream, wasting already-consumed LLM tokens. The server-side persist (PERSIST_AFTER_PUMP) still saves the response, but the user never sees the streaming output and must manually reload the thread to see the completed response."
outcome: "Thread switching does not abort in-flight generation. Either: (a) execution is decoupled from the SSE connection (durable async), or (b) the runtime supports multiple concurrent threads without unmounting."
spec_refs: thread-persistence
assignees: derekg1729
credit:
project: proj.thread-persistence
branch:
pr:
reviewer:
created: 2026-02-14
updated: 2026-02-14
labels: [ai-graphs, ui, billing]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 5
---

# Thread switch aborts in-flight stream — credits consumed, response lost to user

## Symptoms

1. User is in thread A, assistant is streaming a response
2. User clicks thread B in the sidebar
3. `key={activeThreadKey}` changes → React unmounts ChatRuntimeProvider → SSE connection aborted
4. Server-side: `pumpDone` still resolves (PERSIST_AFTER_PUMP), LLM generation continues, response persisted to `ai_threads`
5. Client-side: user sees thread B, never sees the partial/complete response from thread A
6. Credits consumed for the full generation — user must switch back to thread A and reload to see the result

## Root Cause

`ChatRuntimeProvider` uses React `key` prop for thread identity:

```tsx
<ChatRuntimeProvider
  key={activeThreadKey ?? "new"}
  initialMessages={initialMessages}
  initialStateKey={activeThreadKey}
  ...
/>
```

Changing the key forces a full unmount → remount cycle. `useChatRuntime` (via AI SDK's `useChat`) tears down its internal `AbortController` on unmount, which terminates the fetch. The KEY_REMOUNT pattern was chosen because `useChatRuntime` has no API to swap thread context without remounting.

## Impact

- **Credit waste**: LLM tokens consumed for aborted streams (server finishes, client never displays)
- **UX regression**: Users cannot peek at another thread without killing the current generation
- **No multi-conversation workflow**: Power users who want to reference an old thread while waiting for a response are blocked

## Relationship to Unified Graph Launch

[unified-graph-launch.md](../../docs/spec/unified-graph-launch.md) proposes routing all graph execution through durable Temporal workflows. This would naturally solve the KEY_REMOUNT problem:

- Execution decoupled from HTTP connection — workflow runs to completion regardless of client state
- Client reconnects to stream via polling `/api/v1/ai/runs/{runId}/events`
- Thread switching = disconnect from SSE + reconnect later (no abort)
- Aligns with `ONE_RUN_EXECUTION_PATH` invariant

If unified-graph-launch ships first, the fix for this bug is architectural (durable execution) rather than UI-level (multi-runtime management).

## Possible Fixes

### Option A: Durable execution via unified-graph-launch (preferred)

- Execution lives in Temporal workflow, not inline in the route handler
- Client can disconnect/reconnect freely
- Requires: unified-graph-launch P0 (proj.unified-graph-launch)

### Option B: Multi-runtime management (UI-level)

- Keep multiple `useChatRuntime` instances alive (hidden, not unmounted)
- Switch visibility rather than unmounting
- Risk: memory/resource leaks from keeping N runtimes alive
- Risk: AI SDK may not support this pattern cleanly

### Option C: Graceful abort with auto-reload

- On thread switch, abort the stream but immediately queue a reload of the switched-from thread
- When user switches back, thread shows completed response from DB
- Cheapest fix, but still wastes the streaming UX

## Validation

```bash
# Manual: start a long generation, switch threads mid-stream, switch back
# Assert: response is visible after switching back (Option C minimum)
# Assert: response streams without interruption (Option A/B ideal)
```

## Related

- [Thread Persistence spec](../../docs/spec/thread-persistence.md) — PERSIST_AFTER_PUMP invariant
- [Unified Graph Launch spec](../../docs/spec/unified-graph-launch.md) — ONE_RUN_EXECUTION_PATH, durable execution
- task.0035 — Thread history sidebar (introduced KEY_REMOUNT)
- proj.unified-graph-launch — Architectural fix path
