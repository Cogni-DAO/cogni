---
id: task.0041.handoff
type: handoff
work_item_id: task.0041
status: active
created: 2026-02-16
updated: 2026-02-16
branch: feat/v0-work-items
last_commit: fb2f9991
---

# Handoff: Discord Channel Proof of Life

## Context

- Goal: get an OpenClaw-powered Discord bot responding to messages in a Cogni DAO Discord server
- OpenClaw gateway already runs as a compose service (`openclaw-gateway`); this task enables its built-in Discord channel plugin
- No Cogni application code changes needed — purely gateway config, compose env, and Discord Developer Portal setup
- Part of [proj.messenger-channels](../projects/proj.messenger-channels.md); spec at [messenger-channels](../../docs/spec/messenger-channels.md)
- Single-tenant only (DAO-owned bot) — multi-tenant auth is future scope

## Current State

- Discord bot application created (app ID `1472841000530739200`), all 3 privileged Gateway Intents enabled
- Bot invited to Cogni DAO Discord server with `scope=bot&permissions=85056` (Send Messages, Read Message History, View Channels, Embed Links, Add Reactions)
- Gateway config updated: `channels.discord.enabled: true`, `groupPolicy: "open"`, `plugins.entries.discord.enabled: true`, `message` and `sessions_send` removed from tool deny list
- Compose updated: `DISCORD_BOT_TOKEN` env var passed to gateway, config mount uses writable-copy pattern (see Decisions)
- Bot logs in successfully: `[discord] logged in to discord as 1472841000530739200`
- Slash commands (INTERACTION_CREATE) work — bot receives and responds to `/healthcheck` etc.
- **BLOCKED: MESSAGE_CREATE events are not received.** `@Cogni hello` produces zero log output. The WebSocket connection is alive (slash commands prove this), but regular message events do not arrive. This is the critical blocker.
- `DISCORD_BOT_TOKEN` is set as a GitHub repo secret for prod

## Decisions Made

- **Writable config pattern**: OpenClaw's `writeConfigFile()` uses atomic write (temp file + rename). Container is `read_only: true`, so config is mounted as `:ro` to `/opt/openclaw-config-source.json`, then copied to `/workspace/.openclaw-config/openclaw.json` (on the writable `cogni_workspace` volume) via entrypoint wrapper. See [docker-compose.yml:440](../../platform/infra/services/runtime/docker-compose.yml) and [docker-compose.dev.yml:539](../../platform/infra/services/runtime/docker-compose.dev.yml)
- **groupPolicy "open"**: allows bot to respond in all channels without per-channel allowlisting
- **plugins.entries.discord.enabled: true**: must be explicit — OpenClaw's `doctor` command defaults this to `false` and the auto-enable flow fails silently if it can't persist
- **Discord install link**: the default "Discord Provided Link" (`/oauth2/authorize?client_id=...`) does NOT include `scope=bot` — you must use URL Generator or manually append `&scope=bot&permissions=85056`

## Next Actions

- [ ] **Debug MESSAGE_CREATE delivery** — this is the only blocker. Bot connects, slash commands work, but regular messages never arrive. Intents are enabled (GuildMessages + MessageContent hardcoded in OpenClaw source at `src/discord/monitor/provider.ts:124-141`). Investigate: (1) is OpenClaw's Carbon library (`@buape/carbon v0.14`) correctly subscribing to MESSAGE_CREATE? (2) Is there a Discord gateway session issue where the bot needs to re-identify after guild join? (3) Try a completely fresh bot token.
- [ ] Verify bot responds to `@Cogni hello` in a Discord channel
- [ ] Verify LLM call appears in proxy audit log with billing headers
- [ ] Verify `docker restart openclaw-gateway` reconnects the bot automatically
- [ ] Update [discord-bot-setup.md](../../docs/guides/discord-bot-setup.md) — fix install link instructions (must use `scope=bot`, not default link)
- [ ] Update task.0041 status to Done once verified end-to-end

## Risks / Gotchas

- **OpenClaw `doctor --fix`** writes to the config file and can set `plugins.entries.discord.enabled: false` — never run it unless you understand what it mutates
- **Discord install link gotcha**: default provided link = integration only (slash commands). Need `scope=bot` for actual guild membership and message events.
- **Config mount is copied on every restart** — runtime mutations (from OpenClaw auto-config) are lost. This is intentional (fresh config each boot), but means any OpenClaw-side config changes must go into the source file
- **`sandbox-internal` network is `internal: true`** — gateway also needs `cogni-edge` for outbound Discord WebSocket (already configured)

## Pointers

| File / Resource                                                           | Why it matters                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `services/sandbox-openclaw/openclaw-gateway.json`                         | Source gateway config — channels, plugins, tools deny list  |
| `platform/infra/services/runtime/docker-compose.dev.yml:526-588`          | Dev compose gateway service — entrypoint, env, volumes      |
| `platform/infra/services/runtime/docker-compose.yml:427-489`              | Prod compose gateway service (same pattern)                 |
| `docs/guides/discord-bot-setup.md`                                        | Human-facing setup guide (needs install link fix)           |
| `docs/spec/messenger-channels.md`                                         | Multi-tenant channel management spec (future scope)         |
| `work/items/task.0041.discord-channel-proof-of-life.md`                   | Work item with full requirements and plan                   |
| `/Users/derek/dev/openclaw/src/discord/monitor/provider.ts`               | OpenClaw Discord provider — intents, login, event listeners |
| `/Users/derek/dev/openclaw/src/discord/monitor/listeners.ts`              | MESSAGE_CREATE listener registration                        |
| `/Users/derek/dev/openclaw/src/discord/monitor/native-command.ts:596-612` | "This channel is not allowed" logic                         |
| `/Users/derek/dev/openclaw/src/discord/monitor/allow-list.ts:381-401`     | groupPolicy evaluation (`open`/`allowlist`/`disabled`)      |
