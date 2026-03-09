---
id: task.0075
type: task
title: "Governance scheduled runs post status updates to #continuous-cogni-updates Discord channel"
status: needs_triage
priority: 1
estimate: 2
summary: Wire governance scheduled runs (already running via Temporal) to post a summary to a designated Discord channel after each run completes. OpenClaw's sendMessageDiscord() can target a channel by ID — need to plumb the channel target into the governance run output path.
outcome: "Each governance charter run (ENGINEERING, SUSTAINABILITY, etc.) posts a concise status update to #continuous-cogni-updates in the Cogni Discord server automatically."
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
labels: [governance, discord, openclaw, channels]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 20
---

# Governance Scheduled Runs → Discord Status Updates

## Requirements

- Governance scheduled runs (task.0054, already working via Temporal) produce a summary after each charter run
- After a run completes, a status update is posted to a designated Discord channel (`#continuous-cogni-updates`)
- The channel ID is configured in `openclaw-gateway.json` or `repo-spec.yaml` — not hardcoded
- Updates include: which charter ran, key findings/actions, timestamp
- If the Discord channel is unreachable (bot offline, channel deleted), the governance run still succeeds — posting is best-effort

**Not in scope:**

- Interactive Discord responses to governance output (that's the community agent's job)
- Formatting beyond plain text + basic markdown (no embeds yet)
- Per-charter channel routing (all charters post to same channel for now)

## Approach

OpenClaw has `sendMessageDiscord(to, text)` in `src/discord/send.outbound.ts` which takes `"channel:CHANNEL_ID"` as a recipient. Two options:

1. **Agent skill**: Add a `discord-notify` skill that the governance agent calls at the end of each run. The agent composes the message and sends it via the `message` tool (already available if removed from deny list).
2. **Post-run hook**: Add a Temporal activity that calls the OpenClaw gateway API to send the message after the workflow completes.

Option 1 is simpler — the agent already has context from the run and can compose a meaningful summary. The `message` tool is the standard OpenClaw way to send outbound messages.

## Allowed Changes

- `services/sandbox-openclaw/openclaw-gateway.json` — add channel target config, ensure `message` tool is allowed
- `services/sandbox-openclaw/gateway-workspace/` — skills or SOUL.md instructions for governance posting
- `repo-spec.yaml` — optional: add discord channel ID to governance config
- Governance charter prompts — add instruction to post summary to Discord

## Validation

```bash
# Trigger a governance run
pnpm governance:schedules:sync

# Check Discord #continuous-cogni-updates for the posted summary
# Check gateway logs for outbound message
docker logs openclaw-gateway 2>&1 | grep -i "send.*discord\|outbound"
```

**Expected:** Status update appears in `#continuous-cogni-updates` within minutes of governance run completing.

## PR / Links

- Depends on: task.0041 (Discord proof of life — Done), task.0054 (governance run foundation — Done)
- Project: [proj.messenger-channels](../projects/proj.messenger-channels.md)

## Attribution

-
