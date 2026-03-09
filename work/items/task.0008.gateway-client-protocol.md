---
id: task.0008
type: task
title: "Gateway client: correct protocol lifecycle for OpenClaw chat E2E"
status: done
priority: 0
estimate: 3
summary: Fix OpenClawGatewayClient to implement the full gateway protocol state machine — ACK res, chat deltas, chat final signal (non-terminal), and authoritative final "ok" res with result.payloads
outcome: OpenClaw agent is usable from the Cogni chat UI — responses contain real content (not ACK JSON), billing entries land in proxy audit log, stack tests pass
spec_refs: openclaw-sandbox-spec, openclaw-sandbox-controls-spec
assignees: derekg1729
credit:
project: proj.openclaw-capabilities
branch: feat/concurrent-openclaw
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-09
labels: [openclaw, gateway, p0]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 18
---

# Gateway client: correct protocol lifecycle for OpenClaw chat E2E

## Context

The OpenClaw gateway uses a custom WS frame protocol (NOT JSON-RPC). After the 3-step handshake (`challenge → connect(auth) → hello-ok`), an `agent` request produces **two** `res` frames for the same request ID:

1. **ACK**: `{ status: "accepted", runId }` — metadata only, NOT terminal
2. **Final**: `{ status: "ok", result: { payloads, meta } }` — authoritative content, terminal

Between these, the gateway sends `event` frames: chat deltas (streaming), lifecycle events, and a `chat` final signal (which is a **signal only**, NOT terminal).

The upstream reference implementation handles this via `expectFinal` semantics in `request()` — when `pending.expectFinal && status === "accepted"`, it skips the ACK and keeps waiting.

**Upstream reference**: `~/dev/openclaw/src/gateway/client.ts` (lines 320-325: `expectFinal` skip logic; lines 415-440: `request()` method with `expectFinal` option).

## Requirements

- `runAgent()` AsyncGenerator yields typed `GatewayAgentEvent` events in correct order:
  - `accepted` (carries `runId`) — from ACK res
  - `text_delta` (0–N) — from `chat` event with `state: "delta"`, diff-streamed
  - `chat_final` (terminal) — content extracted from the **final "ok" res** `result.payloads[0].text`, NOT from the chat final signal event
  - `chat_error` (terminal) — from error res, chat error/aborted events, or timeout
- `extractTextFromResult()` reads from `payload.result.payloads[0].text` (the authoritative content source per upstream `agentCommand`)
- Chat `state: "final"` event is treated as a **signal only** — does NOT resolve the generator
- `SandboxGraphProvider.createGatewayExecution()` correctly consumes the generator and emits `text_delta`, `assistant_final`, `usage_report`, and `done` AiEvents
- UI displays real agent content, not stringified `{"runId":"...","status":"accepted","acceptedAt":...}`
- Billing entries appear in proxy audit log for each gateway call

## Allowed Changes

- `src/adapters/server/sandbox/openclaw-gateway-client.ts` — protocol state machine, `extractTextFromResult()`, event types
- `tests/stack/sandbox/sandbox-openclaw.stack.test.ts` — assertions for real content, billing entries
- `scripts/diag-openclaw-gateway.mjs` — diagnostic improvements (phase tracking, payload inspection)
- `src/adapters/server/sandbox/sandbox-graph.provider.ts` — only if provider-side changes are needed to consume the generator correctly (should be minimal)
- `src/adapters/server/sandbox/AGENTS.md` — header updates if module contract changes

## Out of Scope

- Persistent WS connection (P1: task TBD)
- Auto-reconnect / tick liveness (P1: task TBD)
- Generic `request<T>()` with `expectFinal` refactor (P1: task TBD)
- `configureSession()` / `sessions.patch` (already done)
- Dynamic agent catalog / `useAgents()` hook (P1: task TBD)

## Plan

- [x] Verify unstaged changes to `openclaw-gateway-client.ts` correctly implement the state machine (ACK skip, chat final signal non-terminal, final "ok" res terminal)
- [x] Verify `extractTextFromResult()` reads from `payload.result.payloads[0].text`
- [x] Verify chat `state: "final"` event handler returns without pushing `done`
- [x] Verify error paths: `status: "error"` res, chat `state: "error"/"aborted"`, unexpected status
- [x] Run diagnostic script (`node scripts/diag-openclaw-gateway.mjs`) and confirm full protocol sequence: ACK → lifecycle → chat final signal → authoritative final res with payloads
- [ ] Run stack tests (`pnpm test:stack:dev -- tests/stack/sandbox/sandbox-openclaw.stack.test.ts`) and confirm all 3 tests pass with real content
- [ ] Verify `chatFinal.text` assertion confirms real text content, not ACK JSON
- [ ] Test via Cogni UI: select OpenClaw agent, send a message, confirm response renders as chat text (not raw JSON)
- [ ] Verify billing: after UI chat, check proxy audit log shows `run_id` + `litellm_call_id`
- [ ] Stage and commit all changes on `feat/concurrent-openclaw`

## Validation

**Diagnostic (protocol verification):**

```bash
node scripts/diag-openclaw-gateway.mjs
```

**Expected:** Logs show `phase=accepted` → `phase=streaming` or `phase=chat_final_signal` → `phase=final_res` → `*** AUTHORITATIVE FINAL RES — protocol complete ***`. Payloads count > 0 with text content.

**Stack tests:**

```bash
pnpm test:stack:dev -- tests/stack/sandbox/sandbox-openclaw.stack.test.ts
```

**Expected:** All 3 tests pass:

- "gateway responds to agent call via WS" — `chatFinal.text` contains real content, not ACK JSON
- "billing entries appear in proxy audit log" — `entries.length > 0`, `litellmCallId` present
- "gateway container does not have LITELLM_MASTER_KEY in env" — output contains "SAFE"

**UI smoke test (manual):**

1. Start dev server (`pnpm dev`)
2. Select "OpenClaw" agent in chat dropdown
3. Send message
4. Verify: response is real text, not `{"runId":"...","status":"accepted"}`

## Review Checklist

- [ ] **Work Item:** `task.0008` linked in PR body
- [ ] **Spec:** BILLING_INDEPENDENT_OF_CLIENT (billing via proxy headers, not agent), SECRETS_HOST_ONLY (no LiteLLM keys in gateway container)
- [ ] **Tests:** stack test assertions verify real content (not ACK), billing entries present
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Branch: `feat/concurrent-openclaw`
- Upstream reference: `~/dev/openclaw/src/gateway/client.ts` (expectFinal semantics)
- Diagnostic output confirms protocol: `scripts/diag-openclaw-gateway.mjs`
- Research: `docs/research/openclaw-gateway-integration-handoff.md`

## Attribution

-
