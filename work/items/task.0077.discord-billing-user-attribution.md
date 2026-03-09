---
id: task.0077
type: task
title: "Discord billing user attribution — identify which Discord user triggered each LLM call"
status: needs_design
priority: 1
estimate: 2
summary: Discord messages bypass Cogni's per-user billing — all LLM costs land on the system account. Propagate Discord user identity into LLM proxy headers and enforce per-user/channel/guild spend caps.
outcome: "Each Discord LLM call carries discord_user_id in billing metadata. Per-user ($0.25/day), per-channel ($3/day), per-guild ($10/day) spend caps enforced at the OpenClaw handler level before any LLM call."
spec_refs: messenger-channels
assignees:
  - derekg1729
credit:
project: proj.messenger-channels
branch:
pr:
reviewer:
created: 2026-02-16
updated: 2026-02-19
labels: [openclaw, discord, billing, channels]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 13
---

# Discord Billing User Attribution

## Requirements

### Problem

Discord messages route through OpenClaw directly to the LLM proxy. All costs land on the system Cogni account with no record of which Discord user triggered the run. This is fine while we're small and want users, but creates two risks:

1. **No cost visibility** — can't tell if one user is burning $50/day
2. **No rate limiting lever** — can't throttle or tier individual Discord users
3. **Abuse vector** — anyone in the Discord can trigger unlimited LLM calls

### Solution Tiers

**Tier 1 (this task):** Propagate Discord user ID into LLM proxy billing metadata AND enforce spend caps. Attribution + guard in one pass.

**Tier 2 (P1, with identity linking):** Discord users link to Cogni subject DIDs (VC-based). Costs shift from system account to the user's billing account. Prepaid credits only — deny if `available_credits < estimated_cost`. See proj.decentralized-identity P1.

### This Task = Tier 1 (Attribution + Spend Guard)

**Part A — Attribution (OpenClaw upstream change):**

In `processDiscordMessage()`, before `dispatchInboundMessage()`, call `sessions.patch` to set outboundHeaders:

```json
{
  "x-litellm-end-user-id": "discord:<senderId>",
  "x-litellm-spend-logs-metadata": "{\"channel\":\"discord\",\"guild_id\":\"<guildId>\",\"channel_name\":\"#ideas\",\"discord_user_id\":\"<senderId>\",\"discord_username\":\"<senderUsername>\",\"message_sid\":\"<messageSid>\"}",
  "x-cogni-run-id": "discord:<guildId>:<channelId>:<messageSid>"
}
```

All data is already available in the handler — `sender.id`, `sender.name`, `guildInfo.id`, `message.id`, channel slug.

**Part B — Spend Guard (OpenClaw upstream change):**

Same handler, before agent dispatch. Check cumulative spend against hard caps:

| Scope       | Daily USD Limit |
| ----------- | --------------- |
| Per guild   | $10             |
| Per channel | $3              |
| Per user    | $0.25           |

Also enforce per-call limits: `max_output_tokens: 500`, `max_context_tokens: 4000`.

On limit hit: return early with no LLM call + log structured event `spend_denied { scope, reason, remaining }`. Optional: downgrade model to cheapest tier before hard denial.

**Not in scope:**

- Cogni account linking / credit charging (Tier 2 — requires proj.decentralized-identity P1)
- Changes to Cogni billing ingest (system account attribution stays for now)
- Rerouting Discord through Cogni's GraphExecutorPort (premature — do when identity linking ships)

### Investigation Resolved

- **How does OpenClaw set headers?** Discord messages bypass Cogni's `SandboxGraphProvider` entirely. They enter OpenClaw's agent runner directly via the channel plugin. No `sessions.patch` currently sets `outboundHeaders` for Discord sessions — that's the gap.
- **Where to fix?** OpenClaw's `src/discord/monitor/message-handler.process.ts` — add `sessions.patch` with billing headers before `dispatchInboundMessage()`.
- **Config or code?** Code change in OpenClaw required. Cannot be done via config alone.

## Allowed Changes

- `services/sandbox-openclaw/openclaw-gateway.json` — billing metadata config if supported
- `services/sandbox-openclaw/openclaw-gateway.test.json` — mirror
- OpenClaw upstream issue/PR if code changes needed in OpenClaw itself

## Validation

```bash
# Send a Discord message as a known user
# Check proxy audit log for user attribution
docker exec cogni-llm-proxy-openclaw cat /tmp/audit.log | python3 -c "
import sys, json
for line in sys.stdin:
    entry = json.loads(line)
    meta = entry.get('metadata', {})
    if 'discord_user_id' in str(meta):
        print(json.dumps(meta, indent=2))
"
```

**Expected:** Audit log entries from Discord-triggered runs include `discord_user_id` matching the sender's snowflake.

## PR / Links

- Related: task.0048 (sub-agent billing attribution — separate but complementary)
- Related: bug.0066 (LiteLLM zero-cost billing — needs to be fixed for any billing to matter)
- Project: [proj.messenger-channels](../projects/proj.messenger-channels.md)

## Attribution

-
