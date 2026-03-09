---
id: discord-bot-setup-guide
type: guide
title: Discord Bot Setup
status: draft
trust: draft
summary: Create a new Discord server and connect Cogni's AI agent via the OpenClaw gateway.
read_when: Setting up Discord integration for Cogni AI agents.
owner: derekg1729
created: 2026-02-16
verified: 2026-02-16
tags: [discord, openclaw, integration]
---

# Discord Bot Setup

> Connect a Discord server to Cogni's AI agent via the OpenClaw gateway. Takes ~10 minutes.

## Prerequisites

- Access to the [Discord Developer Portal](https://discord.com/developers/applications)
- A Discord server you admin (or create a new one)
- The Cogni stack running locally (`pnpm dev:stack`) or deployed

## 1. Create a Discord Server

1. Open Discord → tap **"+"** → **"Create My Own"** → **"For a club or community"**
2. Name it (e.g., "Cogni DAO")
3. Go to **Server Settings → Enable Community** — this gives you a welcome screen, rules channel, and onboarding flow out of the box

## 2. Create a Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **"New Application"** → name it (e.g., "Cogni")
3. Go to **Bot** in the left sidebar
4. Under **Privileged Gateway Intents**, enable **"Message Content Intent"** (required — without this the bot can't read messages)
5. Click **"Reset Token"** → copy the token immediately (shown once)

## 3. Set the Bot Token

**Local dev:**

Add to `.env.local`:

```
DISCORD_BOT_TOKEN=your-token-here
```

**Production (GitHub Actions):**

```bash
gh secret set DISCORD_BOT_TOKEN --repo Cogni-DAO/node-template
```

## 4. Invite the Bot to Your Server

**The bot won't appear in your server until you complete this step.**

1. In the Developer Portal, go to **OAuth2 → URL Generator**
2. Select scopes: **`bot`**
3. Enter permissions integer: **`85056`**, or manually select:
   - Send Messages
   - Read Message History
   - View Channels (Read Messages)
   - Embed Links
   - Add Reactions
4. Copy the generated URL → open it in your browser → select your server → **Authorize**
5. Verify: the bot should now appear in your server's member list (offline until the gateway starts)

## 5. Start the Stack

```bash
pnpm dev:stack
```

The OpenClaw gateway picks up `DISCORD_BOT_TOKEN` from the environment, connects the bot, and starts listening. The bot should go online in your Discord server.

## Verify It Works

1. Send a message in a channel the bot can see (mention the bot or DM it)
2. The bot should respond via the OpenClaw agent
3. Check gateway logs: `docker logs cogni-openclaw-gateway 2>&1 | grep -i discord`
4. Check billing: `docker exec cogni-llm-proxy-openclaw cat /tmp/audit.log | tail -5`

## How It Works

```
Discord message → OpenClaw gateway (Discord channel plugin)
  → agent processes message → LLM proxy → LiteLLM (billing)
  → agent responds → bot sends reply in Discord
```

- All conversation logic lives in OpenClaw — Cogni has zero Discord-specific code
- Billing flows through the LLM proxy audit log, same as sandbox agents
- The bot auto-reconnects on gateway restart (token persisted in STATE_DIR volume)
- Both group channels and DMs work — same bot, same agent

## Troubleshooting

| Symptom                             | Fix                                                            |
| ----------------------------------- | -------------------------------------------------------------- |
| Bot stays offline                   | Check `DISCORD_BOT_TOKEN` is set and gateway logs for errors   |
| Bot online but no responses         | Verify "Message Content Intent" is enabled in Developer Portal |
| Bot can't see messages in a channel | Check bot has View Channels + Read Message History permissions |
| `403 Forbidden` in logs             | Bot lacks Send Messages permission in that channel             |

## Related

- [Messenger Channels Spec](../spec/messenger-channels.md) — multi-tenant architecture (future)
- [OpenClaw Sandbox Spec](../spec/openclaw-sandbox-spec.md) — gateway execution mode
- [task.0041](../../work/items/task.0041.discord-channel-proof-of-life.md) — proof of life work item
