---
id: openclaw-subagents-spec
type: spec
title: OpenClaw Subagent Spawning & Billing Linkage
status: draft
spec_state: draft
trust: draft
summary: Multi-model subagent delegation via sessions_spawn — flash models for scanning, strong models for writes — with billing attribution preserved across parent and child sessions
read_when: Enabling subagent spawning in gateway config, debugging billing for subagent LLM calls, or designing multi-model agent workflows
implements: proj.openclaw-capabilities
owner: derekg1729
created: 2026-02-13
verified: 2026-02-13
tags: [openclaw, billing, ai-agents, subagents]
---

# OpenClaw Subagent Spawning & Billing Linkage

> Multi-model delegation: the gateway agent spawns subagents via `sessions_spawn` with per-spawn model overrides. All subagent LLM calls must be billed to the same Cogni billing account as the parent session. OpenClaw does NOT inherit outbound headers today — an upstream fix is required.

### Key References

|             |                                                                                 |                                          |
| ----------- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| **Project** | [proj.openclaw-capabilities](../../work/projects/proj.openclaw-capabilities.md) | Roadmap and planning                     |
| **Spec**    | [openclaw-sandbox-spec](./openclaw-sandbox-spec.md)                             | Core integration invariants 13-28        |
| **Spec**    | [external-executor-billing](./external-executor-billing.md)                     | Billing reconciliation via LiteLLM       |
| **Spec**    | [openclaw-workspace](./openclaw-workspace.md)                                   | Gateway workspace, system prompt context |

## Design

### Current Architecture (single-agent)

```
Cogni Route → SandboxGraphProvider
  │  configureSession(sessionKey, outboundHeaders, model)
  │  runAgent(message, sessionKey, outboundHeaders)
  ▼
OpenClaw Gateway (agent: main)
  │  outboundHeaders on every LLM call:
  │    x-litellm-end-user-id: ${billingAccountId}
  │    x-litellm-spend-logs-metadata: { run_id, graph_id }
  │    x-cogni-run-id: ${runId}
  ▼
LLM Proxy → LiteLLM → upstream provider
```

All LLM calls carry billing headers because `SandboxGraphProvider.createGatewayExecution()` sets them on the session via `configureSession()` before `runAgent()`.

### Target Architecture (with subagents)

```
Cogni Route → SandboxGraphProvider
  │  configureSession(sessionKey, outboundHeaders, model)
  │  runAgent(message, sessionKey, outboundHeaders)
  ▼
OpenClaw Gateway (agent: main, model: opus/kimi)
  │  Full system prompt (AGENTS.md, SOUL.md, TOOLS.md, MEMORY.md)
  │  Has sessions_spawn tool
  │  Decides when to delegate scanning/collection to flash subagents
  │
  ├──── sessions_spawn(task: "scan files", model: "flash")
  │       │
  │       ▼
  │     Subagent session (agent:main:subagent:${uuid})
  │       │  Minimal prompt (AGENTS.md + TOOLS.md only)
  │       │  outboundHeaders: INHERITED from parent ← REQUIRED (upstream fix)
  │       │  LLM calls billed to same billingAccountId
  │       ▼
  │     LLM Proxy → LiteLLM (flash model, fast, cheap)
  │
  ├──── sessions_spawn(task: "analyze results", model: "opus")
  │       │  outboundHeaders: INHERITED from parent
  │       ▼
  │     LLM Proxy → LiteLLM (strong model, for synthesis/writes)
  │
  ▼
Main agent receives subagent results
  │  File writes/edits happen in main agent context (strong model)
  ▼
LLM Proxy → LiteLLM (main agent's own calls, also billed)
```

### Billing Header Flow (detail)

```
SandboxGraphProvider sets outboundHeaders on parent session:
  sessions.patch(key: "agent:main:${billingAccountId}:${stateKey}",
                 outboundHeaders: { x-litellm-end-user-id: "acct_123", ... })

Parent agent spawns subagent:
  sessions_spawn({ task: "...", model: "cogni/gemini-2.5-flash" })

  ┌─ OpenClaw sessions-spawn-tool.ts ──────────────────────────┐
  │  1. Read parent session entry → get outboundHeaders         │
  │  2. Create child session key: agent:main:subagent:${uuid}   │
  │  3. callGateway("agent", {                                  │
  │       sessionKey: childKey,                                  │
  │       outboundHeaders: parentSession.outboundHeaders, ← FIX │
  │       message: task,                                         │
  │     })                                                       │
  └─────────────────────────────────────────────────────────────┘

Child agent LLM calls:
  POST /v1/chat/completions
    x-litellm-end-user-id: acct_123        ← same as parent
    x-litellm-spend-logs-metadata: {...}   ← same run_id as parent
    x-cogni-run-id: ${parentRunId}         ← same run correlation
```

### Model Tier Strategy

| Tier                   | Models                                                         | Use cases                                                                    | Who invokes                    |
| ---------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------ |
| **Flash** (scanning)   | `gemini-2.5-flash`, `gpt-4o-mini`, `grok-4.1-fast`             | File scanning, pattern matching, data collection, summarization, search      | Subagents via `sessions_spawn` |
| **Strong** (authoring) | `claude-opus-4.5`, `kimi-k2-thinking`, `gpt-5`, `gemini-3-pro` | File writes/edits, code generation, architecture decisions, complex analysis | Main agent directly            |

The main agent decides when to delegate. SOUL.md instructs:

- **Delegate (flash)**: read, scan, grep, collect, summarize, synthesize — no file mutations
- **Keep in main (strong)**: all writes, edits, commits, code generation, architecture decisions, EDOs

### OpenClaw Config Changes

```jsonc
// openclaw-gateway.json
{
  "agents": {
    "defaults": {
      "model": { "primary": "cogni/claude-opus-4.5" }, // strong model for main
      "subagents": {
        "model": "cogni/gemini-2.5-flash", // flash default for subagents
        "maxConcurrent": 3,
        "archiveAfterMinutes": 30,
      },
    },
    "list": [
      { "id": "main", "default": true, "workspace": "/workspace/gateway" },
    ],
  },
  "tools": {
    "deny": [
      "browser",
      "cron",
      "gateway",
      "nodes",
      "sessions_send",
      // "sessions_spawn" REMOVED from deny list
      "message",
    ],
  },
}
```

### Session Key Anatomy

```
Parent:     agent:main:${billingAccountId}:${stateKey}
                  │          │                  │
                  │          │                  └── Cogni conversation state key
                  │          └── Cogni billing account (set by SandboxGraphProvider)
                  └── OpenClaw agent ID

Subagent:   agent:main:subagent:${uuid}
                  │       │        │
                  │       │        └── Random UUID (per spawn)
                  │       └── Subagent marker (triggers minimal prompt mode)
                  └── Target agent ID
```

The subagent session key does NOT encode the billing account. Billing attribution is carried exclusively via `outboundHeaders` on the session entry — this is why header inheritance is mandatory.

## Goal

Enable the gateway agent to spawn subagents with different models while preserving billing attribution. Flash models handle high-speed scanning and data collection; strong models handle file writes, code generation, and complex reasoning. All LLM calls — parent and child — bill to the same Cogni account.

## Non-Goals

- Multi-level subagent nesting (OpenClaw hardcodes single-level: subagents cannot spawn further subagents)
- Cross-agent spawning (only `main` agent, no multi-agent mesh)
- Subagent streaming back to the Cogni client (subagent results flow through the main agent's response)
- Custom subagent workspace files (subagents get minimal prompt: AGENTS.md + TOOLS.md only)
- Subagent-specific billing breakdown in Cogni UI (all calls aggregate under the parent run's billing)

## Invariants

> Numbering continues from [openclaw-workspace-spec](openclaw-workspace.md) invariants 29-33.

| Rule                             | Constraint                                                                                                                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 34. SUBAGENT_BILLING_INHERITED   | Subagent sessions MUST carry the parent session's `outboundHeaders` (specifically `x-litellm-end-user-id` and `x-litellm-spend-logs-metadata`). Every subagent LLM call is billed to the same Cogni billing account as the parent.     |
| 35. SUBAGENT_SINGLE_LEVEL        | Subagent sessions cannot spawn further subagents. OpenClaw enforces this in `sessions-spawn-tool.ts:122-126`. No configuration can override this.                                                                                      |
| 36. SUBAGENT_MODEL_OVERRIDE      | The `sessions_spawn` tool accepts a `model` parameter. If omitted, the subagent uses `agents.defaults.subagents.model` (flash tier). The main agent SHOULD pass an explicit model when it needs strong-tier reasoning from a subagent. |
| 37. SUBAGENT_PROMPT_MINIMAL      | Subagent sessions receive only `AGENTS.md` + `TOOLS.md` from the workspace. No SOUL.md, MEMORY.md, skills, heartbeat, or messaging sections. This reduces token overhead for fast tasks.                                               |
| 38. SUBAGENT_CONCURRENCY_BOUNDED | `agents.defaults.subagents.maxConcurrent` caps parallel subagents. Default: 3. Prevents runaway LLM spend from unbounded parallelism.                                                                                                  |
| 39. SUBAGENT_RUN_CORRELATION     | Subagent LLM calls carry the same `x-cogni-run-id` as the parent. The billing reader's `readEntries(runId)` returns entries from both parent and subagent calls, aggregated into the same Cogni run.                                   |

## Upstream Fix Required

**OpenClaw `sessions-spawn-tool.ts` does not propagate `outboundHeaders` to child sessions.**

Current code (lines 248-269):

```typescript
// callGateway("agent", { message: task, sessionKey: childKey, ... })
// NO outboundHeaders passed
```

**Required change**: Before spawning the child agent run, read the parent session's `outboundHeaders` and pass them to the child:

```typescript
// In sessions-spawn-tool.ts, before the agent call:
const parentEntry = sessions.get(requesterSessionKey);
const inheritedHeaders = parentEntry?.outboundHeaders;

// Pass to child agent call:
callGateway("agent", {
  message: task,
  sessionKey: childKey,
  outboundHeaders: inheritedHeaders,  // ← propagate billing headers
  ...
});
```

**File pointers for upstream PR:**

| File                                                    | Purpose                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/agents/tools/sessions-spawn-tool.ts:248-269`       | Add outboundHeaders inheritance from parent session               |
| `src/sessions/types.ts:51`                              | SessionEntry.outboundHeaders — already exists, just needs reading |
| `src/agents/pi-embedded-runner/extra-params.ts:144-184` | Confirms headers are applied to streamFn — no change needed       |

### Interim Workaround (before upstream fix)

If subagents are enabled before the upstream PR lands, subagent LLM calls will NOT carry billing headers. LiteLLM will log them with `end_user = null`. The billing reader's `readEntries(runId)` won't find them (filters by `x-cogni-run-id` from proxy audit log).

**Options**:

1. **Don't enable subagents** until upstream fix lands (safest)
2. **Accept billing gap** — subagent calls billed to default/anonymous (unacceptable for production)
3. **Gateway proxy overwrite** — configure the shared proxy to inject billing headers on ALL requests (breaks per-session isolation for concurrent users)

Option 1 is the only safe choice.

### OpenClaw Prompt Mode for Subagents

OpenClaw uses `promptMode` to determine what goes into the system prompt:

| Section                | Full (main agent)         | Minimal (subagent) |
| ---------------------- | ------------------------- | ------------------ |
| AGENTS.md              | Yes                       | Yes                |
| SOUL.md                | Yes                       | No                 |
| TOOLS.md               | Yes                       | Yes                |
| MEMORY.md              | Yes                       | No                 |
| Skills                 | Yes                       | No                 |
| Memory recall          | Yes                       | No                 |
| Heartbeat              | Yes (bug: still injected) | No                 |
| Reply tags / messaging | Yes                       | No                 |
| Runtime info           | Yes                       | Yes                |

This is appropriate — subagents need operating instructions (AGENTS.md) and environment context (TOOLS.md) but not personality, skills, or memory.

### File Pointers

| File                                                         | Purpose                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| `services/sandbox-openclaw/openclaw-gateway.json`            | Gateway config — tools.deny list, subagents config          |
| `services/sandbox-openclaw/gateway-workspace/AGENTS.md`      | Main agent instructions (must document delegation strategy) |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts:475`  | Session key construction, outboundHeaders setup             |
| `src/adapters/server/sandbox/openclaw-gateway-client.ts:415` | configureSession — sets headers on parent session           |
| OpenClaw: `src/agents/tools/sessions-spawn-tool.ts`          | Subagent spawning — needs outboundHeaders fix               |
| OpenClaw: `src/agents/pi-embedded-runner/extra-params.ts`    | Header injection into LLM streamFn                          |
| OpenClaw: `src/sessions/session-key-utils.ts:28-38`          | `isSubagentSessionKey()` detection                          |

## Acceptance Checks

**Automated (after upstream fix + config change):**

1. Parent agent can spawn a subagent:

   ```bash
   # In gateway logs, verify sessions_spawn tool call succeeds
   docker logs openclaw-gateway 2>&1 | grep "sessions_spawn"
   ```

2. Subagent LLM calls carry billing headers:

   ```bash
   # Proxy audit log shows x-litellm-end-user-id on subagent requests
   docker exec llm-proxy-openclaw cat /tmp/audit.log | grep "subagent"
   ```

3. Billing entries aggregate under parent run:
   ```bash
   # LiteLLM spend logs for the billing account include subagent calls
   curl -sH "Authorization: Bearer $LITELLM_MASTER_KEY" \
     "http://localhost:4000/spend/logs?end_user=${BILLING_ACCOUNT_ID}" | \
     jq '.[] | select(.metadata.run_id == "'$RUN_ID'")'
   ```

**Manual:**

- Send a message that triggers subagent delegation (e.g., "scan all TypeScript files for unused exports")
- Verify main agent uses strong model, subagent uses flash model (check proxy audit log for model field)
- Verify billing: all LLM calls (parent + child) show same `end_user` in LiteLLM spend logs
- Verify subagent concurrency: trigger 5+ parallel spawns, confirm only `maxConcurrent` run simultaneously

## Open Questions

- [ ] **OQ-1: Subagent run_id correlation** — Should subagent LLM calls carry the parent's `run_id` in `x-litellm-spend-logs-metadata`, or generate their own child run_id? Same run_id simplifies billing aggregation but makes it harder to distinguish parent vs subagent costs in observability. A `parent_run_id` + `child_run_id` scheme would preserve both.

- [ ] **OQ-2: Subagent timeout vs parent timeout** — `sessions_spawn` accepts `runTimeoutSeconds`. If a subagent hangs, it consumes the parent's wall-clock time. Should the parent's `timeoutSeconds: 540` apply as a hard cap across all subagent spawns, or should each subagent get its own timeout budget?

- [ ] **OQ-3: Subagent tool policy** — Should subagents have the same tool deny list as the main agent, or a more restrictive one? For flash scanning tasks, `write`/`edit`/`apply_patch` could be denied on subagents to enforce the "flash reads, strong writes" invariant at the tool level rather than relying on prompt instructions.

- [ ] **OQ-4: Upstream PR scope** — Should the outboundHeaders inheritance be opt-in (new config flag) or always-on? Always-on is simpler and correct for billing, but other OpenClaw users might not want header propagation.

## Related

- [openclaw-sandbox-spec](./openclaw-sandbox-spec.md) — Core invariants 13-28, container images, billing flow
- [openclaw-workspace](./openclaw-workspace.md) — Gateway workspace, system prompt context, skills
- [external-executor-billing](./external-executor-billing.md) — Reconciliation pattern, END_USER_IS_BILLING_ACCOUNT
- [task.0023](../../work/items/task.0023.gateway-agent-system-prompt.md) — Gateway workspace implementation (prerequisite)
- OpenClaw: `src/agents/tools/sessions-spawn-tool.ts` — Subagent spawning tool
- OpenClaw: `src/agents/subagent-registry.ts` — Subagent run tracking and cleanup
- OpenClaw: `src/agents/pi-embedded-runner/run/attempt.ts` — Graph execution per agent turn
