---
id: task.0010
type: task
title: "OpenClaw gateway model selection — session-level override or agent-per-specialty"
status: done
priority: 1
estimate: 3
summary: Design and implement dynamic model selection for OpenClaw gateway mode. GraphRunRequest.model must reach the actual LLM call. Two viable mechanisms exist in OpenClaw — session-level modelOverride via sessions.patch, or agent-per-specialty with distinct tool/workspace configs.
outcome: GraphRunRequest.model determines the actual LLM model used in gateway mode, with a whitelist mapping and traceability via spend logs metadata
spec_refs:
  - openclaw-sandbox-spec
project: proj.openclaw-capabilities
branch: fix/openclaw-billing-clean
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-12
labels: [openclaw, gateway, model-routing]
external_refs:
assignees: derekg1729
credit:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# OpenClaw gateway model selection

## Context

Formerly bug.0010. Reclassified as a task because this is a design+implementation problem, not a bug fix. The actual bug (charge-receipt model mismatch) is tracked in bug.0004.

## Problem

`SandboxGraphProvider.createGatewayExecution()` receives `GraphRunRequest.model` but never forwards it to OpenClaw. The gateway client hardcodes `agentId: "main"` (line 152 of `openclaw-gateway-client.ts`), and OpenClaw resolves the model from the agent config default — currently `cogni/nemotron-nano-30b`.

The WS `agent` method does **not** accept a `model` param. Model selection is purely:

1. Per-agent config (`agents.list[n].model.primary`) — strongest
2. Session state (`sessionEntry.modelOverride` + `providerOverride`) — runtime override
3. Global defaults (`agents.defaults.model.primary`) — fallback

## Investigation Results (2026-02-09)

From OpenClaw source (v2026.2.4):

- **No inline model param** on WS `agent` request — model is agent-config or session-state driven
- **Per-agent model override works** — `agents.list[n].model.primary` overrides defaults
- **Session-level `modelOverride`** — `sessions.patch` can set `modelOverride`/`providerOverride` per session, shadowing agent config
- **Dynamic agent creation** via WS `agents.create` — but agents are for workspace/persona/tool isolation, not model routing
- **Model resolution priority**: per-agent > session override > global defaults > hardcoded fallback

Key files in OpenClaw:

- `src/config/types.agents.ts` — agent config schema
- `src/gateway/server-methods/agent.ts` — WS agent handler, model resolution (lines 238-323)
- `src/agents/agent-scope.ts` — `resolveAgentModelPrimary()`
- `src/sessions/model-overrides.ts` — `applyModelOverrideToSessionEntry()`
- `src/gateway/protocol/schema/agent.ts` — WS request schema (no `model` field)

## Design Options

### Option A: Session-level model override (preferred for MVP)

Before each `agent` WS call, send `sessions.patch` with `modelOverride` and `providerOverride` for the session key. One agent (`main`), model varies per session.

**Pros:** No config changes, no agent proliferation, uses OpenClaw's designed mechanism.
**Cons:** Extra WS round-trip per call, need to verify `sessions.patch` exposes `modelOverride`.

### Option B: Agent-per-specialty (long-term)

Define distinct agents for real specialties (different tool profiles, workspaces, memory). Each specialty has its own model. `agentId` selection based on graph requirements, not just model.

**Pros:** Clean separation of concerns, workspace isolation.
**Cons:** Config maintenance, don't need it yet.

### Mapping layer (required for both)

- Whitelist mapping: `GraphRunRequest.model` → OpenClaw model ID (with `cogni/` prefix)
- Fallback to default if model not in allowlist
- Include `requested_model` + resolved `agentId` in `x-litellm-spend-logs-metadata`

## Execution Checklist

- [x] Verify `sessions.patch` accepts `modelOverride`/`providerOverride` via WS (test against running gateway)
- [ ] Add model allowlist mapping in `SandboxGraphProvider` (req.model → OpenClaw model ID) — deferred, passthrough works
- [ ] Gateway client: accept `agentId` param (don't hardcode `"main"`) — deferred, single-agent sufficient
- [x] Gateway client: `configureSession()` accepts required `model` param, forwards via `sessions.patch`
- [x] Wire `configureSession(sessionKey, outboundHeaders, model)` call before `runAgent()` in `createGatewayExecution()`
- [ ] Include `requested_model` + `agentId` in `x-litellm-spend-logs-metadata` — deferred, billing tracks model via audit log
- [x] Update `openclaw-gateway.json` with all supported models in `models.providers.cogni.models[]`
- [x] Add `litellm_model_id` to gateway proxy nginx audit log format
- [x] Validate: send request with non-default model, confirm correct LiteLLM deployment via `litellm_model_id` hash in proxy audit log (stack tests: test-free-model, test-paid-model)
- [x] Provider-level E2E stack test: `SandboxGraphProvider.runGraph()` with non-default model, assert audit log model ID

## Validation

- LiteLLM spend logs `model_group` matches the model from `GraphRunRequest.model`
- Charge receipts record correct actual model
- Requesting an unknown model falls back gracefully (not 500)

## PR / Links

- Billing fix: [bug.0004](bug.0004.activity-billing-join.md)
- Gateway protocol: [task.0008](task.0008.gateway-client-protocol.md)
- Project: [proj.openclaw-capabilities](../projects/proj.openclaw-capabilities.md)
- Config: `services/sandbox-openclaw/openclaw-gateway.json`
- Spec: [openclaw-sandbox-spec](../../docs/spec/openclaw-sandbox-spec.md)
