---
id: bug.0078
type: bug
title: "OpenClaw subagent spawn fails with 'pairing required' — callGateway resolves LAN IP instead of loopback"
status: done
priority: 1
estimate: 1
summary: "sessions_spawn calls callGateway() which resolves to the Docker LAN IP (172.18.0.x) instead of 127.0.0.1. Gateway treats non-loopback connections as remote, requires device pairing, and rejects the subagent WS handshake."
outcome: Subagents spawn successfully — callGateway() connects via loopback so auto-pairing approves the connection
spec_refs: openclaw-sandbox-spec
assignees: []
credit:
project:
branch:
pr:
reviewer:
created: 2026-02-17
updated: 2026-02-17
note: Fixed via internalCallConfig() in sessions-spawn-tool.ts — forces bind:loopback for in-process callGateway() calls. Verified 2026-02-17 (gateway log showed "device pairing auto-approved").
labels: [openclaw, subagents, gateway]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# OpenClaw subagent spawn fails with "pairing required"

## Requirements

### Observed

When the gateway agent calls `sessions_spawn`, the tool internally calls `callGateway()` to open a new WS connection for the child agent. This connection is rejected:

```
2026-02-16T17:20:54.530Z gateway connect failed: Error: pairing required
[ws] closed before connect remote=172.18.0.8 host=172.18.0.8:18789 code=1008 reason=pairing required
```

The subagent retries once and fails again. The main agent tells the user it can't spawn.

### Expected

`callGateway()` connects to `127.0.0.1:18789` (loopback). The gateway's auto-approve logic (`message-handler.ts:691-710`) detects loopback → marks pairing as `silent: true` → auto-approves. Subagent runs normally.

### Root Cause

`callGateway()` resolves the gateway URL via `buildGatewayConnectionDetails()` in `openclaw/src/gateway/call.ts:92-154`. When `gateway.bind` is `"lan"`, it resolves to the primary LAN IPv4 (`172.18.0.8` — the Docker network IP). The gateway's pairing check in `message-handler.ts:691` uses `isLocalClient` to decide auto-approval, but `172.18.0.8` is not loopback, so pairing is required.

**The catch-22**: Changing `bind` to `"loopback"` fixes subagent spawning but breaks external Cogni app connections (the gateway only binds to `127.0.0.1`). We need `bind: "lan"` for external access AND loopback for internal `callGateway()`.

### Reproduction

1. Gateway config: `gateway.bind: "lan"`, `sessions_spawn` not in `tools.deny`
2. Send chat message via Cogni UI: "Spawn a research agent to enumerate work items"
3. Agent calls `sessions_spawn` → `callGateway()` → WS to `172.18.0.x:18789` → rejected

### Impact

**High** — Subagent spawning is completely broken. The agent cannot delegate work, limiting it to single-model, single-context execution. This blocks the agent's ability to use flash-tier models for scanning and strong-tier for synthesis (task.0045 model tier strategy).

## Allowed Changes

### OpenClaw repo (upstream fix)

- `src/gateway/call.ts` — `buildGatewayConnectionDetails()`: use loopback for same-process calls
- `src/agents/tools/sessions-spawn-tool.ts` — pass explicit `url: "ws://127.0.0.1:{port}"` to `callGateway()`
- Tests for loopback resolution in `callGateway()`

### Cogni repo (if config-only fix possible)

- `services/sandbox-openclaw/openclaw-gateway.json` — any new config fields

## Plan

**Option A** (simplest — upstream PR in OpenClaw):

- [ ] In `sessions-spawn-tool.ts`, pass `url: "ws://127.0.0.1:${resolveGatewayPort()}"` to all `callGateway()` calls
- [ ] Same for any other internal tool that calls `callGateway()` (search for usages)
- [ ] Test: subagent spawns when `bind: "lan"`

**Option B** (cleaner — upstream PR):

- [ ] In `call.ts`, detect same-process gateway (gateway server running in current Node process) and force loopback
- [ ] Or add `gateway.internalUrl` config option

## Relevant Code (OpenClaw repo)

| File                                                  | Lines            | What                                                                               |
| ----------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `src/gateway/call.ts`                                 | 92-154           | `buildGatewayConnectionDetails()` — URL resolution based on bind mode              |
| `src/gateway/call.ts`                                 | 23-24            | `CallGatewayOptions.url` — optional URL override (exists but unused by spawn tool) |
| `src/agents/tools/sessions-spawn-tool.ts`             | 196-200, 219-226 | `callGateway()` calls without URL override                                         |
| `src/gateway/server/ws-connection/message-handler.ts` | 691-730          | Pairing check + local auto-approve logic                                           |
| `src/gateway/net.ts`                                  | —                | Bind mode → IP address resolution                                                  |

## Relevant Code (Cogni repo)

| File                                                     | What                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `services/sandbox-openclaw/openclaw-gateway.json:245`    | `"bind": "lan"` — triggers LAN IP resolution                 |
| `src/adapters/server/sandbox/openclaw-gateway-client.ts` | Cogni's external WS client (works fine, different code path) |

## Validation

```bash
# After upstream fix deployed:
# 1. Gateway config still has bind: "lan"
# 2. Send message triggering subagent spawn
# 3. Verify no "pairing required" errors in gateway logs
docker logs openclaw-gateway 2>&1 | grep "pairing"
# Expected: no pairing failures

# 4. Verify subagent actually ran
docker logs openclaw-gateway 2>&1 | grep "embedded run start"
# Expected: two embedded runs (parent + child)
```

## Review Checklist

- [ ] **Work Item:** `bug.0078` linked in PR body
- [ ] **Upstream:** OpenClaw PR merged and image rebuilt
- [ ] **Tests:** Subagent spawns with `bind: "lan"` config
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: task.0045 (subagent billing header inheritance — separate concern, same tool)
- Related: task.0074 (streaming status events — unblocked, working independently)
- OpenClaw source: `src/agents/tools/sessions-spawn-tool.ts`

## Attribution

- Investigation: claude-opus-4.6
