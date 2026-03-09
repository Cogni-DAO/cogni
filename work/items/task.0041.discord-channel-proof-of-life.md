---
id: task.0041
type: task
title: Discord channel proof of life — bot connected, Cogni reads + sends via OpenClaw gateway
status: done
priority: 0
estimate: 2
summary: Create a Discord bot, enable channel support in the OpenClaw gateway config, connect the bot, and verify Cogni can receive inbound Discord messages and send AI responses in a group channel
outcome: A Discord bot is live in a server channel; inbound messages route to the OpenClaw agent; agent responds via the LLM proxy; billing is captured in the proxy audit log
spec_refs: messenger-channels
assignees:
  - derekg1729
credit:
project: proj.messenger-channels
branch: fix/discord-gateway-config
pr: https://github.com/Cogni-DAO/node-template/pull/428
reviewer:
created: 2026-02-13
updated: 2026-02-17
labels: [openclaw, messenger, discord, channels]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Discord Channel Proof of Life — Bot Connected, Cogni Reads + Sends via OpenClaw Gateway

## Requirements

- A Discord bot application exists (created via Discord Developer Portal)
- Gateway config (`openclaw-gateway.json`) has a `channels:` section with Discord enabled
- `message` and `sessions_send` removed from tool deny list in gateway config
- Gateway compose service has a named Docker volume for `OPENCLAW_STATE_DIR` (not `/tmp` — per spec STATE_DIR_VOLUME_REQUIRED)
- The bot token is passed to the gateway via environment variable (not hardcoded in config)
- The bot joins a Discord server and listens in a group channel
- Inbound messages in the channel route to the OpenClaw agent
- The agent calls the LLM via `llm-proxy-openclaw:8080` and responds in-channel
- LLM calls appear in the proxy audit log with billing headers (per spec MESSENGER_BILLING_VIA_PROXY)
- Gateway restart reconnects the Discord bot automatically (per spec GATEWAY_RESTART_RECONNECTS)

**Not in scope for this task:**

- Cogni HTTP proxy endpoints (`/api/v1/channels/*`) — separate task
- `channel_registrations` DB table — separate task
- AES-256-GCM credential encryption — separate task
- Channel management UI — separate task
- Multi-tenant accountId namespacing — single-tenant proof of life only
- Individual user DM auth — group channel is sufficient

## Allowed Changes

- `services/sandbox-openclaw/openclaw-gateway.json` — add `channels:` section, update `tools.deny`
- `services/sandbox-openclaw/openclaw-gateway.test.json` — mirror changes (parity)
- `platform/infra/services/runtime/docker-compose.yml` — add named volume for STATE_DIR, update `openclaw-gateway` env
- `platform/infra/services/runtime/docker-compose.dev.yml` — mirror compose changes
- `src/shared/env/server.ts` — add `DISCORD_BOT_TOKEN` env var (optional, for gateway injection)
- `.env.local.example` — document new env var
- `docs/spec/messenger-channels.md` — update Open Questions if resolved during this work

## Plan (completed)

- [x] **1. Create Discord bot application** — done via Discord Developer Portal. Enabled Message Content Intent, Server Members Intent, Presence Intent. Bot invited to Cogni guild.
- [x] **2. Update gateway config** — `channels.discord` section added with `token`, `groupPolicy: "open"`, and `plugins.entries.discord.enabled: true`. Token passed via `${DISCORD_BOT_TOKEN}` env var.
- [x] **3. Compose already wired** — `DISCORD_BOT_TOKEN` env var and `OPENCLAW_STATE_DIR` volume were already in docker-compose from earlier PRs (#426).
- [x] **4. Fix config bug** — token was incorrectly nested under `accounts.default.token`. OpenClaw reads it from `channels.discord.token` (top-level). Fixed in bug.0073 / PR #428.
- [x] **5. Verify bot receives messages and responds** — confirmed working after config fix. Slash commands and DMs work. Guild messages route to agent.

## Validation

**Command:**

```bash
# Start the stack with Discord bot token
DISCORD_BOT_TOKEN=<token> pnpm dev:stack

# Check gateway logs for Discord channel start
docker logs cogni-openclaw-gateway 2>&1 | grep -i discord

# After sending a Discord message, check proxy audit log
docker exec cogni-llm-proxy-openclaw cat /tmp/audit.log | tail -5
```

**Expected:**

- Gateway logs show Discord channel starting and connecting
- Discord bot responds to messages in the server channel
- Proxy audit log shows LLM call with `x-litellm-end-user-id` header
- After `docker compose restart openclaw-gateway`, bot reconnects and responds again

## Review Checklist

- [ ] **Work Item:** `task.0041` linked in PR body
- [ ] **Spec:** CHANNELS_ENABLED_IN_GATEWAY, STATE_DIR_VOLUME_REQUIRED, GATEWAY_RESTART_RECONNECTS, MESSENGER_BILLING_VIA_PROXY upheld
- [ ] **Tests:** Manual verification documented (no automated tests for this infra-only task)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- PR: https://github.com/Cogni-DAO/node-template/pull/428
- Bug: [bug.0073](bug.0073.discord-gateway-no-dispatch-events.md) — root cause was config structure
- Handoff: [handoff](../handoffs/task.0041.handoff.md)
- Follow-up: task.0075 (governance→Discord updates), task.0076 (dedicated agent), task.0077 (billing attribution)

## Attribution

-
