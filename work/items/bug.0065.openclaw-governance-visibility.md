---
id: bug.0065
type: bug
title: OpenClaw gateway agent uses wrong tools for governance visibility — sessions_history vs git/files
status: done
priority: 1
estimate: 2
summary: Gateway agent tries to query governance results via sessions_history() which fails with pairing errors. Should read governance outputs from git commits and files instead.
outcome: Agent can show users governance run results by reading edo_index.md, budget headers, and git history
spec_refs: []
assignees: []
credit:
project:
branch: openclaw-agent-hotfixes
pr:
reviewer:
created: 2026-02-15
updated: 2026-02-15
labels: [openclaw, governance, agent-prompt]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# OpenClaw gateway agent uses wrong tools for governance visibility

## Requirements

### Observed

When user asks "what did the governance runs do?", gateway agent (services/sandbox-openclaw/gateway-workspace/SOUL.md):

1. **Calls wrong tools**: `sessions_list()`, `sessions_history(sessionKey="gov-community")` etc.
2. **Tools fail**: "gateway closed (1008): pairing required" even though gateway IS working (user is connected through it)
3. **Lists missing files**: Reports IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md as "Unfortunately missing" with apologetic tone
4. **No error recovery**: Gives up after tool failures instead of pivoting to file-based data sources

**Code pointers:**

- `services/sandbox-openclaw/gateway-workspace/SOUL.md` lines 48-56 tell agent about `docs/` and `work/` but NOT about governance file outputs
- Langfuse trace `33edddad-e95d-4dba-a900-99a578f5f94c` (2026-02-15 14:01:54) shows this pattern
- OpenClaw gateway logs 2026-02-15 13:54:41 UTC show 9 rapid pairing failures when agent tries `sessions_list`

**Why this is wrong:**

- `sessions_history()` queries OTHER active OpenClaw sessions (multi-session gateway feature)
- Governance outputs are persisted to FILES, not held in session state
- The agent IS connected through the gateway, so pairing error is a red herring - it's using the wrong approach entirely

### Expected

Agent should read governance data from FILES:

1. `memory/edo_index.md` - recent Executive Decision Orders
2. `memory/_budget_header.md` - budget gate status (allow_runs, burn_rate, token limits)
3. `git log --grep="governance"` or `git log --author="Cogni"` - governance commits
4. Charter-specific heartbeat files (COMMUNITY.heartbeat.md, etc.) for latest run summaries
5. NOT call `sessions_history` - that's for querying other concurrent sessions, not persisted outputs

Agent should also:

- NOT complain about missing optional workspace files (IDENTITY.md, USER.md, etc.)
- Use direct, technical tone ("No governance EDOs found in memory/edo_index.md") not corporate helpdesk speak ("Unfortunately...")

### Reproduction

1. Deploy gateway agent with governance schedules enabled
2. Connect via webchat
3. Ask: "What did the last governance run do?"
4. **Observe**: Agent calls `sessions_history()`, gets pairing error, gives up
5. **Expected**: Agent reads `memory/edo_index.md` and git history, reports findings

### Impact

- **Users**: Can't see governance decisions or activity (critical for story.0063 governance visibility dashboard)
- **Agent perception**: Looks incompetent - uses wrong tools, corporate tone, no initiative
- **Developer friction**: Can't debug governance runs without manually checking files/logs

## Allowed Changes

- `services/sandbox-openclaw/gateway-workspace/SOUL.md` - add governance visibility instructions
- `services/sandbox-openclaw/gateway-workspace/AGENTS.md` - clarify where governance data lives
- Optional workspace stub files (IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md) to suppress "missing" warnings

## Plan

- [ ] Update SOUL.md § Finding Context to include governance-specific data sources
- [ ] Add explicit section: "To see governance run results, check: git log, memory/edo_index.md, memory/\_budget_header.md, heartbeat files"
- [ ] Add note: "DO NOT use sessions_history for governance visibility - outputs are in files, not session state"
- [ ] Create minimal stub files (IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md) with 2-5 lines each
- [ ] Remove "Unfortunately" language from system prompt examples

## Validation

**Manual test:**

1. Start dev stack with gateway
2. Trigger governance run via scheduler or manual POST
3. Connect to gateway via webchat
4. Ask: "What governance decisions were made in the last hour?"
5. **Pass**: Agent reads files (not sessions_history), reports EDOs/heartbeats without apologies

**Command:**

```bash
# Check SOUL.md contains governance data source instructions
grep -A5 "governance" services/sandbox-openclaw/gateway-workspace/SOUL.md
```

**Expected:** SOUL.md explicitly lists memory/edo_index.md, git log, budget headers as governance data sources.

## Review Checklist

- [ ] **Work Item:** `bug.0065` linked in PR body
- [ ] **Spec:** N/A (agent prompt fix)
- [ ] **Tests:** Manual validation (agent conversation test)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [OpenClaw Agent Hotfixes](../handoffs/hotfix.openclaw-agent.handoff.md)
- Related bugs: bug.0066 (billing), bug.0067 (model allowlist)
- Branch: `openclaw-agent-hotfixes` (partial fix - workspace files remain) Evidence: Langfuse trace `33edddad-e95d-4dba-a900-99a578f5f94c`
- Related: story.0063 (governance visibility dashboard)
- Handoff: [handoff](../handoffs/bug.0065.handoff.md)

## Attribution

- Reported: derekg1729
- Investigation: Claude Code agent
