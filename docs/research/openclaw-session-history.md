---
id: openclaw-session-history
type: research
title: "OpenClaw Session Introspection: sessions_list + sessions_history for Multi-Tenant Gateway"
status: active
trust: reviewed
verified: 2026-02-15
summary: Analysis of OpenClaw's session introspection tools (sessions_list, sessions_history) — what they do, how to disable them, and multi-tenant isolation concerns for Cogni's gateway deployment. Identifies cross-tenant visibility risk and governance visibility anti-pattern.
read_when: Configuring OpenClaw gateway tools, investigating session visibility issues, or designing multi-tenant agent isolation
owner: cogni-dev
created: 2026-02-15
tags: [openclaw, gateway, multi-tenant, session-tools, security]
---

# OpenClaw Session Introspection: sessions_list + sessions_history for Multi-Tenant Gateway

> spike: /research openclaw "session history" | date: 2026-02-15

## Question

1. What are `sessions_list` and `sessions_history` tools in OpenClaw?
2. Can we turn them off, and how?
3. If we want them enabled, how do they work with our multi-tenant gateway (where each tenant gets isolated sessions via `billingAccountId` scoping)?
4. What is the governance visibility problem revealed by bug.0065?

## Context

Production OpenClaw gateway logs (2026-02-15) showed a "pairing required" error when the agent called `sessions_list()`:

```
2026-02-15T13:54:41.128Z [tools] sessions_list failed: gateway closed (1008): pairing required
```

This occurred when a user asked "what did the governance runs do?" The agent attempted to use `sessions_list()` and `sessions_history()` to query governance results, which failed. Further investigation revealed this was the **wrong tool choice** — governance outputs live in FILES (git commits, heartbeat markdown, `memory/edo_index.md`), not in session state.

Meanwhile, our multi-tenant gateway architecture uses session keys scoped by `billingAccountId`:

```typescript
const sessionKey = `agent:main:${caller.billingAccountId}:${stateKey}`;
```

This raises the question: do session introspection tools respect tenant boundaries, or can one tenant's agent see another tenant's sessions?

## Findings

### 1. What These Tools Do

OpenClaw provides a suite of **session introspection tools** for multi-agent coordination:

| Tool               | Purpose                                                                   | Primary Use Case              |
| ------------------ | ------------------------------------------------------------------------- | ----------------------------- |
| `sessions_list`    | List all active/recent sessions with metadata (kind, channel, timestamps) | Discover what sessions exist  |
| `sessions_history` | Fetch message/conversation history for a specific session                 | Read what another session did |
| `sessions_send`    | Send a message to another session (agent-to-agent messaging)              | Cross-session collaboration   |
| `sessions_spawn`   | Spawn a sub-agent in an isolated session                                  | Delegate tasks to sub-agents  |

**sessions_list** (`src/agents/tools/sessions-list-tool.ts`):

- Queries the gateway's session store (`sessions.json` metadata)
- Returns array of session rows with: `key`, `kind`, `channel`, `displayName`, `updatedAt`, `sessionId`, `model`, token counts, last delivery context
- Supports filters: `kinds` (main/group/cron/hook), `limit`, `activeMinutes`, `messageLimit`
- Optional `messageLimit > 0` includes last N messages per session (calls `chat.history` internally)

**sessions_history** (`src/agents/tools/sessions-history-tool.ts`):

- Fetches full message transcript for ONE session
- Calls gateway method `chat.history` with `sessionKey` + optional `limit`
- Returns sanitized messages (truncates long text, strips large image data, removes tool result details for compactness)
- Hard cap: 80KB JSON output, max 4000 chars per text field
- Optional `includeTools: false` filters out `role: "toolResult"` messages

**Common pattern**: `sessions_list` discovers sessions → `sessions_history` reads their transcripts.

### 2. Built-in Security Features

OpenClaw has **three layers** of session visibility control:

#### Layer 1: Sandbox Session Visibility

When an agent runs in sandboxed mode (`agents.defaults.sandbox.mode: "off"` is NOT sandboxed; `"default"` or `"all"` would be), session tools enforce **spawned-only visibility**:

```json5
{
  agents: {
    defaults: {
      sandbox: {
        sessionToolsVisibility: "spawned", // or "all" (default: "spawned")
      },
    },
  },
}
```

- `"spawned"`: Agent can ONLY see sessions it spawned via `sessions_spawn` (sub-agents)
- `"all"`: Agent can see all sessions in the store (requires sandboxed agents to be trusted)

**Implementation** (`sessions-list-tool.ts:191-194`, `sessions-history-tool.ts:199-203`):

- If `sandboxed === true` AND `visibility === "spawned"` AND requester is NOT a sub-agent → filter to spawned sessions only
- Check via `callGateway({ method: "sessions.list", params: { spawnedBy: requesterSessionKey } })`
- If target session is NOT in the spawned list → return `{ status: "forbidden", error: "Session not visible from this sandboxed agent session" }`

#### Layer 2: Agent-to-Agent Policy

Cross-agent history access (requester agent ≠ target agent) requires explicit allowlist:

```json5
{
  tools: {
    agentToAgent: {
      enabled: true, // default: false
      allow: [
        { from: "coder", to: ["researcher", "reviewer"] },
        // if omitted: any agent can see any agent (when enabled=true)
      ],
    },
  },
}
```

**Enforcement** (`sessions-history-tool.ts:231-248`):

- Extract `agentId` from `agent:<agentId>:...` session key
- If `requesterAgentId !== targetAgentId`:
  - Check `tools.agentToAgent.enabled` → if false, deny
  - Check `tools.agentToAgent.allow` policy → if denied, return forbidden

#### Layer 3: Session Send Policy

For `sessions_send`, runtime send policy can block delivery by channel/chat type:

```json5
{
  session: {
    sendPolicy: {
      rules: [
        { match: { channel: "discord", chatType: "group" }, action: "deny" },
      ],
      default: "allow",
    },
  },
}
```

Per-session override: `sendPolicy: "allow" | "deny" | inherit`

### 3. Multi-Tenant Isolation Analysis

**Current Cogni Gateway Setup**:

- Session key: `agent:main:{billingAccountId}:{stateKey}`
- Each tenant (billing account) gets unique session keys
- All sessions stored in single OpenClaw `OPENCLAW_STATE_DIR` (shared filesystem)

**Problem**: OpenClaw's session tools do NOT have tenant-aware filtering built in. They filter by:

- Sandbox visibility (spawned vs all)
- Agent-to-agent policy (agentId-based)
- Send policy (channel/chatType-based)

But NOT by `billingAccountId` or any other tenant identifier embedded in the session key.

**Cross-Tenant Visibility Risk**:

If we enable `sessions_list` with default config:

1. Tenant A's agent calls `sessions_list()`
2. OpenClaw returns ALL sessions in the store (no tenant filtering)
3. Tenant A sees session keys like: `agent:main:billing_456:abc`, `agent:main:billing_789:xyz`
4. Tenant A can then call `sessions_history({ sessionKey: "agent:main:billing_789:xyz" })`
5. If agent-to-agent policy is enabled (or both are `agent:main`), Tenant A reads Tenant B's conversation

**Why sandbox visibility doesn't help**:

- We run gateway agents with `sandbox.mode: "off"` (not in OpenClaw's internal sandbox)
- `sandboxed` parameter in tool creation would need to be `true` to trigger spawned-only filtering
- Even if we set `sandboxed: true`, it only filters to "sessions I spawned" — doesn't prevent cross-tenant leakage if one tenant spawns sessions and another queries the store

**Why agent-to-agent policy doesn't help**:

- All Cogni tenants use the same `agent:main` agent ID
- Policy filters by `agentId`, not by `billingAccountId`
- `agent:main:billing_123` and `agent:main:billing_456` are both `agentId="main"` → policy allows

**Conclusion**: OpenClaw's session tools are designed for **single-tenant, multi-agent** deployments, not **multi-tenant, single-agent** (our model).

### 4. How to Disable

**Option A: Deny in tool policy** (RECOMMENDED):

```json
{
  "tools": {
    "deny": ["sessions_list", "sessions_history", "sessions_send"]
  }
}
```

Current `services/sandbox-openclaw/openclaw-gateway.json` already denies:

- `"browser"`, `"cron"`, `"gateway"`, `"nodes"`, `"sessions_send"`, `"message"`

**Missing**: `sessions_list`, `sessions_history`

**Option B: Disable agent-to-agent** (doesn't fully solve it):

```json
{
  "tools": {
    "agentToAgent": {
      "enabled": false // default: already false
    }
  }
}
```

This blocks cross-agent history access, but NOT same-agent (and all tenants are `agent:main`).

**Option C: Sandbox visibility restriction** (doesn't work for our use case):

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "sessionToolsVisibility": "spawned" // default: already "spawned"
      }
    }
  }
}
```

Only applies when `sandboxed: true` in tool creation. We don't set this.

### 5. The Governance Visibility Anti-Pattern (bug.0065)

**What happened**:

1. User asked: "What did the governance runs do?"
2. Gateway agent (from `services/sandbox-openclaw/gateway-workspace/SOUL.md`) called `sessions_list()` and `sessions_history()`
3. Tools failed with "pairing required" (code 1008 WebSocket close)

**Why it failed**:

- The agent was ALREADY connected through the gateway (user had an active webchat session)
- "Pairing required" suggests the tool tried to connect to ANOTHER gateway instance (not itself)
- This is likely because `sessions_list` internally calls `callGateway({ method: "sessions.list" })` which attempts to connect to the gateway's WebSocket endpoint
- But the gateway expects token-based pairing for external connections
- When called from WITHIN a gateway session, this creates a self-connection loop that fails auth

**Why it's the wrong tool**:

Governance outputs in Cogni are **file-based**, not **session-based**:

- Executive Decision Orders (EDOs) → `memory/edo_index.md`
- Budget gate status → `memory/_budget_header.md`
- Governance run summaries → `COMMUNITY.heartbeat.md`, `PLATFORM.heartbeat.md`
- Governance git commits → `git log --grep="governance"` or `git log --author="Cogni"`

The agent should read FILES, not query other sessions. Even if `sessions_list` worked, it would only show SESSION metadata (timestamps, token counts), not the governance OUTPUTS (what decisions were made, what code was changed).

**Correct approach** (already documented in bug.0065):

1. Read `memory/edo_index.md` for recent decisions
2. Read `memory/_budget_header.md` for budget status
3. Read charter-specific heartbeat files for latest run summaries
4. Use `git log` to see governance commits
5. Use direct file reads (`read()` tool) for detailed outputs

## Recommendation

### P0: Deny Session Introspection Tools

**Goal**: Prevent cross-tenant data leakage. Spawned-only visibility is NOT achievable via config alone (see below).

**Why spawned-only filter is a dead end for our deployment**:

OpenClaw's spawned-only filter requires `sandboxed: true` at tool creation time. This flag is derived from `resolveSandboxRuntimeStatus()` (`openclaw/src/agents/sandbox/runtime-status.ts`):

```typescript
function shouldSandboxSession(cfg, sessionKey, mainSessionKey) {
  if (cfg.mode === "off") {
    return false; // ← OUR CONFIG → sandboxed = false ALWAYS
  }
  if (cfg.mode === "all") {
    return true;
  }
  return sessionKey.trim() !== mainSessionKey.trim();
}
```

Our config MUST have `sandbox.mode: "off"` (invariant 13: OPENCLAW_SANDBOX_OFF — Docker not available inside container). This means `sandboxed` is **always `false`**, which means `sessionToolsVisibility: "spawned"` is **completely ignored**. The spawned-only filter never activates.

Changing `sandbox.mode` to `"all"` would cause OpenClaw to try running agents in Docker containers → crash (no Docker-in-Docker).

**Conclusion**: With `sandbox.mode: "off"`, session tools are either **wide open** (no tenant filter) or **denied**. There is no config-only middle ground.

**Action**: Add session tools to deny list in `services/sandbox-openclaw/openclaw-gateway.json`:

```json
{
  "tools": {
    "deny": [
      "browser",
      "cron",
      "gateway",
      "nodes",
      "sessions_send",
      "sessions_list",
      "sessions_history",
      "sessions_spawn",
      "message"
    ]
  }
}
```

**Trade-offs accepted**:

- ❌ No sub-agent spawning (requires P1 OpenClaw fork to enable safely)
- ❌ No session history introspection
- ✅ Zero cross-tenant data leakage risk
- ✅ Config-only change, no code modifications
- ✅ Governance visibility uses files instead (bug.0065 fix)

### P1: Tenant-Scoped History (Requires OpenClaw Fork)

**Scenario**: User wants to see their own past conversations across requests ("show me what we discussed yesterday").

**Problem**: P0 denies all session tools. To re-enable them safely, we need tenant-aware filtering via OpenClaw fork (since `sandbox.mode: "off"` makes the built-in spawned-only filter a no-op).

**Solution**: Fork OpenClaw's session tools and add tenant-aware filtering:

1. **Extract billingAccountId from sessionKey**:

   ```typescript
   // agent:main:{billingAccountId}:{stateKey}
   function extractBillingAccountId(sessionKey: string): string | null {
     const parts = sessionKey.split(":");
     return parts[2] || null; // agent:main:{THIS}:{stateKey}
   }

   function extractAgentId(sessionKey: string): string {
     const parts = sessionKey.split(":");
     return parts[1] || "main"; // agent:{THIS}:...
   }
   ```

2. **Filter sessions in sessions_list** (fork `sessions-list-tool.ts`):

   ```typescript
   // Add after existing spawned-only filter
   const requesterBillingId = extractBillingAccountId(opts.agentSessionKey);

   // Filter to same billingAccountId (tenant isolation)
   const tenantFilteredSessions = rawSessions.filter((s) => {
     const sessionBillingId = extractBillingAccountId(s.key);
     return sessionBillingId === requesterBillingId;
   });

   // Apply existing filters (kinds, activeMinutes, etc) to tenantFilteredSessions
   ```

3. **Validate in sessions_history** (fork `sessions-history-tool.ts`):

   ```typescript
   // Add before existing agent-to-agent policy check
   const requesterBillingId = extractBillingAccountId(opts.agentSessionKey);
   const targetBillingId = extractBillingAccountId(resolvedKey);

   if (requesterBillingId !== targetBillingId) {
     return jsonResult({
       status: "forbidden",
       error: "Cross-tenant session access denied",
     });
   }
   ```

4. **Optional: Governance cross-session coordination** (if needed):

   ```typescript
   // Allow governance agents to see other governance sessions
   const requesterAgentId = extractAgentId(opts.agentSessionKey);
   const targetAgentId = extractAgentId(resolvedKey);

   // Governance agents (future: dedicated agent:governance:*)
   // can see each other for coordination
   const isGovernanceToGovernance =
     requesterAgentId === "governance" && targetAgentId === "governance";

   if (!isGovernanceToGovernance && requesterBillingId !== targetBillingId) {
     return jsonResult({ status: "forbidden", error: "Cross-tenant denied" });
   }
   ```

**Files to fork**:

- `src/agents/tools/sessions-list-tool.ts` (~350 LOC)
- `src/agents/tools/sessions-history-tool.ts` (~285 LOC)
- `src/agents/tools/sessions-helpers.ts` (~600 LOC, shared utilities)

**Complexity**: ~200 LOC additions across 3 files. Ongoing maintenance: merge upstream changes periodically.

**Alternative**: Contribute tenant-scoping to upstream OpenClaw:

- Add config: `session.tools.tenantField: "billingAccountId"` + `session.tools.tenantFieldIndex: 2`
- OpenClaw extracts from session key and auto-filters
- PR to OpenClaw repo, benefits everyone with multi-tenant needs

### P0.1: Update Gateway SOUL.md

Remove references to `sessions_list` and `sessions_history` from governance visibility instructions.

**Before** (implied by bug.0065 behavior):

```markdown
To see what governance did, check active sessions...
```

**After**:

```markdown
## Finding Governance Results

DO NOT use `sessions_list()` or `sessions_history()` for governance visibility.

Governance outputs are file-based:

1. `memory/edo_index.md` — Executive Decision Orders (recent decisions)
2. `memory/_budget_header.md` — Budget gate status (allow_runs, burn_rate, token limits)
3. `git log --grep="governance"` or `git log --author="Cogni"` — Governance commits
4. Charter-specific heartbeat files (e.g., `COMMUNITY.heartbeat.md`) — Latest run summaries

Use `read()` to access these files directly.
```

See work item: `bug.0065`

## Open Questions

- **Q1**: Do we need session continuity across requests (one `stateKey` = one long-running session)?
  - **A**: YES — already implemented. Gateway uses `stateKey` for session key, not `runId`. Fixed in openclaw-thread-persistence research.

- **Q2**: Could we scope OpenClaw gateway per tenant (one gateway container per billingAccountId)?
  - **Downside**: Resource overhead (N containers × memory footprint). Complexity in routing.
  - **Upside**: Natural tenant isolation. Each tenant gets isolated `OPENCLAW_STATE_DIR`.
  - **Verdict**: Not P0. Shared gateway with spawned-only visibility is simpler.

- **Q3**: What about `sessions_spawn` for sub-agent delegation?
  - **BLOCKED**: `sandbox.mode: "off"` makes spawned-only filter a no-op. Sub-agent spawning requires P1 fork to add tenant filtering.
  - Workaround: Governance delegation via file-based handoff (write brief → trigger schedule → read result)

## Proposed Layout

P0 denies session tools entirely (cross-tenant risk with no config-only mitigation). P1 re-enables them via OpenClaw fork with tenant-aware filtering.

### Immediate Tasks (P0 - Config-Only)

1. **task**: Deny session introspection tools in `openclaw-gateway.json`
   - File: `services/sandbox-openclaw/openclaw-gateway.json`
   - Change: Add `sessions_list`, `sessions_history`, `sessions_spawn` to `tools.deny` array

2. **task**: Update gateway SOUL.md — remove any session tool references
   - File: `services/sandbox-openclaw/gateway-workspace/SOUL.md`
   - Add: "For governance results, read files (edo_index.md, git log), NOT sessions"
   - Add: "You CAN spawn sub-agents for delegation via sessions_spawn()"
   - Validation: Manual test — ask "what did governance do?" → agent reads files, not sessions
   - PR: Include in bug.0065 fix

3. **task**: Update openclaw-sandbox-spec.md — document spawned-only session tool pattern
   - File: `docs/spec/openclaw-sandbox-spec.md`
   - Add: "Session Tools Multi-Tenant Isolation" section
   - Document: `sandboxed: true` + `sessionToolsVisibility: "spawned"` pattern
   - Note: Enables sub-agent delegation while blocking cross-tenant leakage

### Future Work (P1 - OpenClaw Fork)

5. **spike**: Tenant-scoped history design
   - Question: Do we fork OpenClaw tools or contribute upstream?
   - Options: (a) Fork 3 files + maintain, (b) PR to OpenClaw with `session.tools.tenantField` config, (c) Per-tenant gateway instances
   - Deliverable: Design doc with maintenance cost analysis

6. **task**: Implement tenant-filtered session tools (requires fork)
   - Fork: `sessions-list-tool.ts`, `sessions-history-tool.ts`, `sessions-helpers.ts` (~1200 LOC total)
   - Add: `extractBillingAccountId()` + `extractAgentId()` utilities (~30 LOC)
   - Modify: sessions_list filter, sessions_history validation (~150 LOC changes)
   - Tests: Stack test — Tenant A sees own history, cannot see Tenant B
   - Maintenance: Periodic merge from upstream OpenClaw

7. **optional**: Governance cross-session coordination (if needed)
   - Add `agent:governance:*` session key pattern
   - Extend tenant filter: allow `governance → governance` visibility
   - Use case: Community governance checks what Platform governance decided
   - Alternative: Continue using file-based coordination (EDOs, heartbeats)

## Related

- **Bug**: [bug.0065](../../work/items/bug.0065.openclaw-governance-visibility.md) — Wrong tool choice (sessions_list vs file reads)
- **Spec**: [OpenClaw Sandbox Spec](../spec/openclaw-sandbox-spec.md) — Gateway mode, session keys, billing headers
- **Research**: [OpenClaw Thread Persistence](./openclaw-thread-persistence-duplication.md) — Session key lifecycle, stateKey vs runId
- **Spec**: [Multi-Tenant Gateway](../spec/openclaw-sandbox-spec.md#gateway-mode-only) — Session key construction: `agent:main:{billingAccountId}:{stateKey}`
- **OpenClaw Docs**: [Session Tools](https://github.com/cogni-dao/openclaw/blob/main/docs/concepts/session-tool.md) — Upstream documentation
- **OpenClaw Source**: `/Users/derek/dev/openclaw/src/agents/tools/sessions-*.ts` — Tool implementation
