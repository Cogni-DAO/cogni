---
id: task.0045
type: task
title: "Enable OpenClaw subagent spawning — upstream header fix + Cogni config + delegation instructions"
status: needs_design
priority: 1
estimate: 3
summary: Enable sessions_spawn in the gateway, fix upstream outboundHeaders inheritance so subagent LLM calls are billed to the parent account, configure multi-model tiers (flash for scanning, strong for writes), and update AGENTS.md with delegation strategy.
outcome: Gateway agent can spawn flash-tier subagents for scanning tasks; all subagent LLM calls carry the parent's billing headers; proxy audit log and LiteLLM spend logs show correct end_user for both parent and child calls.
spec_refs: openclaw-subagents-spec
assignees:
  - derekg1729
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-13
updated: 2026-02-13
labels: [openclaw, billing, subagents]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 11
---

# Enable OpenClaw subagent spawning — upstream header fix + Cogni config + delegation instructions

## Requirements

### Problem

The gateway agent runs as a single model (gemini-2.5-flash) for all tasks. Scanning 50 files and synthesizing results uses the same model as writing a single function. OpenClaw has a full `sessions_spawn` tool for delegating to subagents with per-spawn model overrides, but:

1. `sessions_spawn` is in the `tools.deny` list — subagents are disabled
2. OpenClaw's `sessions-spawn-tool.ts` does NOT propagate `outboundHeaders` to child sessions — subagent LLM calls would have no billing headers (invariant 34: SUBAGENT_BILLING_INHERITED violated)
3. No `subagents` config section exists in `openclaw-gateway.json`
4. AGENTS.md has no delegation strategy instructions

### Acceptance Criteria

- [ ] **Upstream PR merged**: OpenClaw `sessions-spawn-tool.ts` propagates parent session's `outboundHeaders` to child sessions
- [ ] `sessions_spawn` removed from `tools.deny` in `openclaw-gateway.json` and `openclaw-gateway.test.json`
- [ ] `agents.defaults.subagents` configured: flash default model, maxConcurrent: 3, archiveAfterMinutes: 30
- [ ] `agents.defaults.model.primary` set to a strong-tier model (e.g., `cogni/claude-opus-4.5`)
- [ ] Gateway `AGENTS.md` documents delegation strategy: when to spawn flash subagents vs keep in main
- [ ] Manual test: agent spawns subagent, proxy audit log shows same `x-litellm-end-user-id` on both parent and child LLM calls
- [ ] Manual test: LiteLLM spend logs for billing account include entries from both parent and subagent calls under same `run_id`

## Allowed Changes

### OpenClaw repo (upstream PR — separate repo, separate PR)

- `src/agents/tools/sessions-spawn-tool.ts` — read parent session outboundHeaders, pass to child agent call
- Tests for outboundHeaders inheritance

### Cogni repo (this PR)

- `services/sandbox-openclaw/openclaw-gateway.json` — remove `sessions_spawn` from deny, add subagents config, update default model
- `services/sandbox-openclaw/openclaw-gateway.test.json` — same changes
- `services/sandbox-openclaw/gateway-workspace/AGENTS.md` — add delegation strategy section
- `docs/spec/openclaw-subagents.md` — advance spec_state if Open Questions resolved

## Plan

### Part 1: Upstream PR (OpenClaw repo — blocks Part 2)

- [ ] In `sessions-spawn-tool.ts`: before `callGateway("agent", ...)`, read parent session entry's `outboundHeaders`
- [ ] Pass inherited headers to child agent call params
- [ ] Add test: parent session has outboundHeaders → child session's LLM calls include same headers
- [ ] Add test: parent session has no outboundHeaders → child session works without error (no regression)
- [ ] File PR in OpenClaw repo, get merged

### Part 2: Cogni config changes (this repo — after upstream merges)

- [ ] Update `openclaw-gateway.json`:
  - Remove `sessions_spawn` from `tools.deny`
  - Add `agents.defaults.subagents: { model: "cogni/gemini-2.5-flash", maxConcurrent: 3, archiveAfterMinutes: 30 }`
  - Change `agents.defaults.model.primary` to strong-tier model
- [ ] Mirror changes in `openclaw-gateway.test.json`
- [ ] Update gateway `AGENTS.md` with delegation strategy section:
  - When to use `sessions_spawn` (bulk reads, grep-and-summarize, data extraction)
  - When to keep in main agent (file writes/edits, code generation, architecture decisions)
  - Model tier guidance (which models are flash, which are strong)

### Part 3: Validation

- [ ] Rebuild/restart gateway with new config
- [ ] Send message triggering delegation (e.g., "scan all TypeScript files for unused exports and summarize")
- [ ] Verify proxy audit log: subagent LLM calls have correct `x-litellm-end-user-id`
- [ ] Verify LiteLLM spend logs: entries from parent + child under same billing account
- [ ] Verify subagent uses flash model, main agent uses strong model (check `model` field in audit log)

## Validation

**Upstream fix verified:**

```bash
# In OpenClaw repo — run existing + new tests
pnpm test -- --grep "sessions_spawn"
```

**Config deployed:**

```bash
docker compose restart openclaw-gateway && sleep 5
docker exec openclaw-gateway cat /etc/openclaw/openclaw-gateway.json | jq '.tools.deny'
# Expected: sessions_spawn NOT in list
docker exec openclaw-gateway cat /etc/openclaw/openclaw-gateway.json | jq '.agents.defaults.subagents'
# Expected: { model: "cogni/gemini-2.5-flash", maxConcurrent: 3, archiveAfterMinutes: 30 }
```

**Billing attribution verified:**

```bash
# After triggering a subagent-producing conversation:
docker exec llm-proxy-openclaw cat /tmp/audit.log | tail -20
# Expected: both parent and subagent requests show same x-litellm-end-user-id

curl -sH "Authorization: Bearer $LITELLM_MASTER_KEY" \
  "http://localhost:4000/spend/logs?end_user=${BILLING_ACCOUNT_ID}" | \
  jq '[.[] | select(.metadata.run_id == "'$RUN_ID'")] | length'
# Expected: > 1 (parent + subagent calls)
```

**Docs:**

```bash
pnpm check:docs
```

**Expected:** All checks pass.

## Review Checklist

- [ ] **Work Item:** `task.0045` linked in PR body
- [ ] **Spec:** invariants 34-39 from [openclaw-subagents-spec](../../docs/spec/openclaw-subagents.md) upheld
- [ ] **Upstream:** OpenClaw PR merged before Cogni config changes deployed
- [ ] **Tests:** Manual validation (subagent spawning, billing attribution, model tiers)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Spec: [openclaw-subagents-spec](../../docs/spec/openclaw-subagents.md)
- Parent spec: [openclaw-sandbox-spec](../../docs/spec/openclaw-sandbox-spec.md) — invariants 13-28
- Billing spec: [external-executor-billing](../../docs/spec/external-executor-billing.md)
- OpenClaw source: `src/agents/tools/sessions-spawn-tool.ts` (upstream fix target)
- Related: task.0023 (gateway workspace — prerequisite for AGENTS.md updates)

## Attribution

- Spec + investigation: claude-opus-4.6 + derekg1729
