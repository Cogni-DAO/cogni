---
id: task.0076
type: task
title: "Dedicated Discord community agent — separate agent config with Discord-specific personality and skills"
status: needs_triage
priority: 1
estimate: 2
summary: Configure a dedicated OpenClaw agent for Discord community interactions, separate from the default gateway agent. Route all Discord channels to this agent via bindings. Give it a Discord-appropriate system prompt, skill set, and model budget.
outcome: "All Discord messages route to a dedicated 'discord-community' agent with its own workspace, system prompt, and model config. The default agent is not triggered by Discord traffic."
spec_refs: messenger-channels
assignees:
  - derekg1729
credit:
project: proj.messenger-channels
branch:
pr:
reviewer:
created: 2026-02-16
updated: 2026-02-16
labels: [openclaw, discord, channels, agent-config]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 21
---

# Dedicated Discord Community Agent

## Requirements

- A separate agent (`discord-community`) in `openclaw-gateway.json` `agents.list[]`
- All Discord guild messages route to this agent via `bindings` config (match on `channel: "discord"`)
- Agent has its own workspace directory with a SOUL.md tailored for Discord community interaction
- Model selection: use a cost-effective model (e.g. `cogni/deepseek-v3.2` or `cogni/gpt-4o-mini`) — this agent handles high-volume, short interactions
- Agent has access to relevant skills (governance lookups, repo info) but NOT elevated tools
- The `main` agent continues to handle gateway API / non-Discord traffic

**Not in scope:**

- Per-channel agent routing (all Discord channels → one agent for now)
- Custom slash commands beyond what OpenClaw auto-registers
- DM-specific agent (DMs go to the same community agent)

## Approach

OpenClaw supports multiple agents via `agents.list[]` and routing via `bindings`:

```json
{
  "agents": {
    "list": [
      { "id": "main", "default": true, "workspace": "/workspace/gateway" },
      { "id": "discord-community", "workspace": "/workspace/discord" }
    ]
  },
  "bindings": [
    {
      "agentId": "discord-community",
      "match": { "channel": "discord" }
    }
  ]
}
```

The `discord-community` agent gets its own workspace with a SOUL.md that sets the tone for community interaction — helpful, concise, aware of Cogni's governance and project status.

## Allowed Changes

- `services/sandbox-openclaw/openclaw-gateway.json` — add agent entry + bindings
- `services/sandbox-openclaw/openclaw-gateway.test.json` — mirror
- `services/sandbox-openclaw/discord-workspace/` — new workspace dir with SOUL.md
- `platform/infra/services/runtime/docker-compose.dev.yml` — volume mount for discord workspace
- `platform/infra/services/runtime/docker-compose.yml` — mirror

## Validation

```bash
# Send a message in Discord — should route to discord-community agent
docker logs openclaw-gateway 2>&1 | grep "discord-community"

# Send a message via gateway API — should route to main agent
curl -X POST http://localhost:3333/v1/chat/completions -H "Authorization: Bearer $TOKEN" -d '{"messages":[{"role":"user","content":"hello"}]}'
```

**Expected:** Discord traffic hits `discord-community` agent; API traffic hits `main` agent.

## PR / Links

- Depends on: task.0041 (Discord proof of life — Done)
- Project: [proj.messenger-channels](../projects/proj.messenger-channels.md)

## Attribution

-
