---
id: bug.0021
type: bug
title: "Gateway WS client receives uncorrelated chat events — heartbeat HEARTBEAT_OK contaminates user responses"
status: done
priority: 0
estimate: 2
summary: OpenClaw gateway broadcasts chat events to all WS clients. Our gateway client processes all chat events without filtering by runId/sessionKey, so heartbeat output (HEARTBEAT_OK) or other concurrent runs can contaminate the user's response stream. Heartbeats fire immediately after agent calls complete (1s retry loop), making this a near-certain race on rapid follow-up messages.
outcome: Every streamed token delivered to the UI is causally attributable to exactly one user request. HEARTBEAT_OK never surfaces in chat output.
spec_refs: openclaw-sandbox-spec
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch: fix/openclaw-gateway-connectivity
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-11
labels: [security, correctness, openclaw]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Gateway WS client receives uncorrelated chat events — heartbeat HEARTBEAT_OK contaminates user responses

## Requirements

### Observed

User chat responses intermittently return `HEARTBEAT_OK` instead of the actual AI response. Both `text_delta` streaming and the authoritative `chat_final` content are contaminated. Reproduced in dev with `dev:stack` running.

**Evidence from logs (2026-02-10):**

- Success: `accLen:5, finalLen:32` — correct response "Hello! How can I help you today?"
- Fail: `accLen:12, finalLen:12` — entire response is "HEARTBEAT_OK" (12 chars)

**Root cause — two compounding issues:**

1. **Client-side: no event correlation** (`src/adapters/server/sandbox/openclaw-gateway-client.ts:297-337`):
   The Phase 3 message handler listens to ALL `frame.type === "event" && frame.event === "chat"` frames with no filtering by runId, sessionKey, or requestId. The gateway broadcasts chat events to every connected WS client (see OpenClaw `server-chat.ts:251` `broadcast("chat", payload)`), so heartbeat deltas, other users' deltas, or any concurrent agent run leaks into the stream.

2. **Gateway-side: heartbeat fires immediately after agent calls** (OpenClaw `infra/heartbeat-wake.ts:39-43`):
   When a heartbeat fires while the agent lane is busy (our call in-flight), it retries every `DEFAULT_RETRY_MS = 1_000` (1 second). The moment our call completes, the queued heartbeat executes immediately. If the user sends a follow-up message within that window (~1-2s), the heartbeat response races with the new request. Combined with issue #1, the heartbeat's `HEARTBEAT_OK` gets delivered as the user's chat response.

3. **Config-side: heartbeats enabled by default** (`services/sandbox-openclaw/openclaw-gateway.json`):
   No `heartbeat.every` is set, so OpenClaw applies a 30-minute default (OpenClaw `config/defaults.ts:377-383`). Heartbeats serve no purpose for backend agent usage.

### Expected

- Every output token delivered to UI is causally attributable to exactly one user request (runId/requestId).
- Outputs for one `(billingAccountId, userId, runId)` are never observable by any other WS connection.
- `HEARTBEAT_OK` never appears in user-facing chat output.

### Reproduction

1. Start `dev:stack` (OpenClaw gateway running with default heartbeat config)
2. Send a chat message → observe correct response
3. Immediately send a follow-up message (within 2-3 seconds)
4. Observe `HEARTBEAT_OK` returned as the response (intermittent, ~30-50% of rapid follow-ups)

**Key files:**

- `src/adapters/server/sandbox/openclaw-gateway-client.ts:297-337` — unfiltered chat event handler
- `src/adapters/server/sandbox/openclaw-gateway-client.ts:300-315` — delta accumulation with regression guard that resets `prevText` on length shrink (amplifies cross-run contamination)
- `services/sandbox-openclaw/openclaw-gateway.json:158-164` — missing `heartbeat.every: "0"` in agent defaults
- OpenClaw `src/gateway/server-chat.ts:230-252` — `emitChatDelta` broadcasts to all WS clients
- OpenClaw `src/infra/heartbeat-wake.ts:39-43` — 1-second retry loop on "requests-in-flight"
- OpenClaw `src/auto-reply/heartbeat.ts:96-157` — `stripHeartbeatToken()` reference implementation for filtering

### Impact

- **User-facing:** Chat responses randomly replaced with `HEARTBEAT_OK`. Breaks core chat UX.
- **Multi-tenant risk:** Without runId filtering, any concurrent agent run on the same gateway can leak into any user's stream (not just heartbeats).
- **Severity:** P0 — correctness and isolation violation. Affects all users of the OpenClaw gateway path.

## Allowed Changes

- `src/adapters/server/sandbox/openclaw-gateway-client.ts` — add runId/sessionKey correlation filtering to chat event handler
- `services/sandbox-openclaw/openclaw-gateway.json` — disable heartbeats
- `services/sandbox-openclaw/openclaw-gateway.test.json` — same
- New or updated tests in `tests/` for WS event isolation

## Plan

### P0 — Immediate (this PR)

- [ ] **Config: disable heartbeats** — add `"heartbeat": { "every": "0" }` to `agents.defaults` in `openclaw-gateway.json` (and `.test.json`). OpenClaw's `resolveHeartbeatIntervalMs` returns `null` for `ms <= 0`, disabling the runner entirely.

- [ ] **Client: filter chat events by correlation key** — after the `accepted` ACK res (which carries a `runId`), capture the gateway-assigned runId. In the chat event handler (`line 297`), check `payload.runId` (or `payload.sessionKey`) against the expected value. Drop frames that don't match. This follows the OpenClaw server-side pattern where `shouldSuppressHeartbeatBroadcast` checks `getAgentRunContext(runId)`.

- [ ] **Client: strip HEARTBEAT_OK as defense-in-depth** — following OpenClaw's `stripHeartbeatToken(text, { mode: "message" })` pattern from `auto-reply/reply/agent-runner-execution.ts:111-117`. If the final content starts/ends with `HEARTBEAT_OK`, strip it. If the entire content is just `HEARTBEAT_OK`, treat as error and surface a retry or error message.

### P1 — Hardening (follow-up)

- [ ] **Concurrency isolation test** — open two WS clients, start two agent runs concurrently, interleave traffic. Assert client A never receives any token originating from runB (fail on any mismatch).

- [ ] **Heartbeat contamination regression test** — force a heartbeat wake while a run is in-flight. Assert `HEARTBEAT_OK` never reaches the UI stream, and `assistant_final` content matches the expected LLM response.

## Validation

**Command:**

```bash
# After config fix, verify heartbeat is disabled:
docker restart openclaw-gateway && sleep 5 && docker logs openclaw-gateway 2>&1 | grep -i heartbeat
# Expected: "heartbeat: disabled" (not "heartbeat: started")

# After client fix, run gateway integration test:
pnpm vitest run tests/component/sandbox-openclaw-gateway
```

**Expected:** Heartbeat disabled in gateway logs. No `HEARTBEAT_OK` in any chat response. Integration tests pass.

## Review Checklist

- [ ] **Work Item:** `bug.0021` linked in PR body
- [ ] **Spec:** WS_EVENT_CAUSALITY invariant enforced — every output token attributable to one request
- [ ] **Tests:** new/updated tests cover correlation filtering and heartbeat stripping
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: bug.0009 (empty payloads), bug.0011 (streaming truncation), task.0008 (protocol lifecycle)
- OpenClaw reference: `src/auto-reply/heartbeat.ts` (stripHeartbeatToken), `src/gateway/server-chat.ts` (shouldSuppressHeartbeatBroadcast)

## Attribution

- Investigation: claude-opus-4.6 + derekg1729
