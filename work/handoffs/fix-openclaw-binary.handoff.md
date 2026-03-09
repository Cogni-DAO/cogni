---
id: handoff.fix-openclaw-binary.2026-02-16
type: handoff
work_item_id: story.0063
status: active
created: 2026-02-16
updated: 2026-02-16
branch: fix/openclaw-binary
last_commit: b28e683d119036e00177e38edd9b5c2bba45f6cb
---

# Handoff: OpenClaw binary PATH fix + governance agent unblocking

## Context

- Gateway agent can't run `openclaw` CLI — binary exists at `/app/openclaw.mjs` but `/app` is not on container PATH
- Agent tried `openclaw gateway status`, `openclaw status` — all fail with `sh: 1: openclaw: not found`
- OpenClaw's built-in system prompt injects CLI references (`## OpenClaw CLI Quick Reference`) that the agent follows
- SOUL.md line 60 says "Ignore OpenClaw CLI commands" but GPT-4o doesn't reliably obey the override
- Broader context: governance agents (SUSTAINABILITY, COMMUNITY, etc.) are failing for multiple reasons — this is one of them

## Current State

### Done (unstaged)

- `platform/infra/services/runtime/docker-compose.yml` — added `PATH=/app:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` to openclaw-gateway environment
- Verified `/app/openclaw.mjs` exists and works: `node /app/openclaw.mjs --help` returns OpenClaw v2026.2.6-3

### Not Done

- Container not restarted — change is unstaged, untested in live container
- Validation: ask agent `openclaw status` after restart, confirm it returns gateway info
- The PATH fix alone won't make governance runs succeed — see Next Actions

### Related (on `openclaw-agent-hotfixes` branch)

- Session tools deny list: `sessions_list`, `sessions_history` denied; `sessions_spawn` allowed
- BOOTSTRAP.md written with filesystem layout + memory initialization commands
- SUSTAINABILITY.heartbeat.md template restored
- Research doc: `docs/research/openclaw-session-history.md`

## Decisions Made

- **Session tools**: Deny `sessions_list`/`sessions_history` (cross-tenant data leakage risk with `sandbox.mode: "off"`). Allow `sessions_spawn` (safe — results auto-announce back, sub-agents already locked down by `DEFAULT_SUBAGENT_TOOL_DENY` in `pi-tools.policy.ts:79-89`)
- **Spawned-only filter is a no-op**: `sandbox.mode: "off"` → `shouldSandboxSession()` returns false → `sandboxed` always false → `sessionToolsVisibility: "spawned"` ignored. See `openclaw/src/agents/sandbox/runtime-status.ts:10-13`
- **Skills are not tools**: Agent must `read` SKILL.md and follow it, not `sessions_spawn` a skill name as an agent ID
- **Paths in skills are logical**: Skills reference `memory/`, `work/` without absolute paths. BOOTSTRAP.md maps these to container paths (`/workspace/gateway/memory/`, `/repo/current/work/`)

## Next Actions

- [ ] Commit and deploy the PATH fix
- [ ] Restart gateway container, validate `openclaw status` works from agent
- [ ] Tell agent to `read BOOTSTRAP.md` and run bootstrap commands (creates `memory/` dir)
- [ ] Trigger `SUSTAINABILITY` and verify the skill executes (reads SKILL.md → reads budget header → writes heartbeat)
- [ ] Merge `openclaw-agent-hotfixes` branch (session tools deny list, bootstrap, research doc)
- [ ] Subagent spawning: `sessions_spawn` is allowed but `subagents.allowAgents` is empty — need to configure if cross-agent spawning desired

## Risks / Gotchas

- **`subagents.allowAgents` is empty**: `sessions_spawn` works for same-agent spawning only. Cross-agent spawn (e.g. `agentId: "governance"`) blocked with `"allowed: none"`. Configure in `openclaw-gateway.json` under `agents.defaults.subagents.allowAgents` if needed.
- **GPT-4o skill comprehension**: Model doesn't reliably follow skill system (tried `sessions_spawn` instead of reading SKILL.md). May need stronger model or prompt reinforcement.
- **task.0057 (Backlog)**: Upstream OpenClaw PR needed to add `promptSections` config toggles — would let us disable CLI Reference, Heartbeats, Silent Replies sections that waste tokens and confuse the agent.
- **`memory/` is ephemeral**: Lost on container reset. Bootstrap must re-run. Future: task.0040 (cron worker to harvest before reset).

## Pointers

| File / Resource                                                 | Why it matters                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `platform/infra/services/runtime/docker-compose.yml:442`        | PATH env var for openclaw-gateway container                                  |
| `services/sandbox-openclaw/openclaw-gateway.json:210-221`       | Tool deny list (sessions_list, sessions_history denied)                      |
| `services/sandbox-openclaw/gateway-workspace/BOOTSTRAP.md`      | Filesystem layout + memory bootstrap commands                                |
| `services/sandbox-openclaw/gateway-workspace/memory-templates/` | Template files for governance memory initialization                          |
| `docs/research/openclaw-session-history.md`                     | Full analysis of session tools, cross-tenant risk, spawned-only filter       |
| `openclaw/src/agents/sandbox/runtime-status.ts:10-13`           | Why spawned-only filter is a no-op with `sandbox.mode: "off"`                |
| `openclaw/src/agents/pi-tools.policy.ts:79-89`                  | `DEFAULT_SUBAGENT_TOOL_DENY` — sub-agents already blocked from session tools |
| `openclaw/src/agents/tools/sessions-spawn-tool.ts:168`          | Child session key format: `agent:{agentId}:subagent:{uuid}`                  |
| `openclaw/src/agents/subagent-announce.ts`                      | Auto-announce flow: sub-agent results delivered back to parent automatically |
| `work/items/task.0057.openclaw-oss-prompt-section-toggles.md`   | Upstream PR needed for per-section system prompt toggles                     |
