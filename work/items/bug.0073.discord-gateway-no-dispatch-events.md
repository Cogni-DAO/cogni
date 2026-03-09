---
id: bug.0073
type: bug
title: Discord gateway receives zero dispatch events — MESSAGE_CREATE never delivered despite valid connection
status: done
priority: 0
estimate: 2
summary: Carbon GatewayPlugin connects to Discord and the bot logs in via REST, but no gateway dispatch events (MESSAGE_CREATE, GUILD_CREATE, etc.) are ever received. After ~12 minutes the WebSocket drops with code 1006 and enters a permanent 1005 resume loop.
outcome: Discord @Cogni mentions in guild channels trigger MESSAGE_CREATE events that reach OpenClaw's DiscordMessageListener and produce agent replies
spec_refs: messenger-channels
assignees:
  - derekg1729
credit:
project: proj.messenger-channels
branch: fix/discord-gateway-config
pr: https://github.com/Cogni-DAO/node-template/pull/428
reviewer:
created: 2026-02-16
updated: 2026-02-16
labels: [openclaw, discord, carbon, gateway]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Discord Gateway Receives Zero Dispatch Events

## Requirements

### Observed

The OpenClaw gateway container (`openclaw-gateway`) connects to Discord via `@buape/carbon@0.14.0`'s `GatewayPlugin`. The bot appears online in the Discord guild. REST API calls work (fetch user, list guilds, read messages, send messages). But **zero gateway dispatch events are ever received** — not MESSAGE_CREATE, not GUILD_CREATE, nothing.

After ~12 minutes the WebSocket silently drops (code 1006), then enters an infinite resume loop where each attempt immediately closes with code 1005:

```
11:21:41Z [discord] logged in to discord as 1472841000530739200
11:33:19Z [discord] gateway: WebSocket connection closed with code 1006
11:33:32Z [discord] gateway: Attempting resume with backoff: 1000ms
11:33:32Z [discord] gateway: WebSocket connection closed with code 1005
  ... (repeats indefinitely)
```

Critically, **the "logged in" message is misleading** — it is printed after a REST API call (`client.fetchUser("@me")`) at `openclaw/src/discord/monitor/provider.ts:530-531`, NOT after a gateway READY event. There is no evidence the IDENTIFY→READY handshake completes.

INTERACTION_CREATE (slash commands) was observed once during an early session, proving the WebSocket can carry events, but has not been reliably reproducible.

### Expected

After gateway login, the bot should receive READY, then GUILD_CREATE for each guild, then MESSAGE_CREATE for messages in channels where the bot has VIEW_CHANNEL permission. `@Cogni` mentions should reach `DiscordMessageListener` and trigger agent replies.

### Reproduction

1. Start the dev stack: `pnpm dev:stack` (with `DISCORD_BOT_TOKEN` set)
2. Wait for `[discord] logged in to discord as ...` in `docker logs openclaw-gateway`
3. Send `@Cogni hello` in any text channel in the Cogni Discord guild
4. Observe: zero log output from the message handler, zero `[EventQueue]` logs for MESSAGE_CREATE
5. Verify the message exists via REST: `curl -H "Authorization: Bot $TOKEN" https://discord.com/api/v10/channels/<id>/messages?limit=1`
6. Wait ~12 minutes: WebSocket drops with 1006, enters 1005 resume loop

### Impact

**Blocks task.0041 (Discord channel proof of life).** The Discord bot cannot respond to any messages. The entire messenger-channels project is stalled on this.

## Investigation Summary

### What has been ruled out

| Hypothesis                     | Status    | Evidence                                                                                                                                                                                                                                           |
| ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong intents                  | Ruled out | Carbon `GatewayIntents` values match Discord spec exactly. Computed = 46593 (Guilds\|GuildMessages\|MessageContent\|DirectMessages\|GuildMessageReactions\|DirectMessageReactions). Verified in `openclaw/node_modules/@buape/carbon/.../types.js` |
| Bot not a guild member         | Ruled out | `GET /users/@me/guilds` returns the Cogni guild. Bot appears in server member list                                                                                                                                                                 |
| Privileged intents not enabled | Ruled out | `GET /applications/@me` shows `GATEWAY_MESSAGE_CONTENT_LIMITED`, `GATEWAY_GUILD_MEMBERS_LIMITED`, `GATEWAY_PRESENCE_LIMITED` flags set (valid for <100 guild bots)                                                                                 |
| Listener not registered        | Ruled out | `registerDiscordListener(client.listeners, new DiscordMessageListener(...))` at `provider.ts:555` runs before the "logged in" log at line 587. `EventQueue.processEvent()` reads `client.listeners` at dispatch time (`EventQueue.js:58`)          |
| `eventFilter` blocking         | Ruled out | No `eventFilter` option passed to `GatewayPlugin` constructor (`provider.ts:505-512`)                                                                                                                                                              |
| `MESSAGE_CREATE` not in enum   | Ruled out | `ListenerEvent` includes `GatewayDispatchEvents` which contains `MESSAGE_CREATE` (`listeners.js:8-13`)                                                                                                                                             |
| Channel permissions            | Ruled out | All channels have empty `permission_overwrites`. `groupPolicy: "open"` allows all channels                                                                                                                                                         |
| Session quota                  | Ruled out | `GET /gateway/bot` shows 976/1000 sessions remaining                                                                                                                                                                                               |

### Primary suspect: IDENTIFY→READY handshake never completes

The "logged in" log is triggered by REST, not by gateway READY. Carbon's `GatewayPlugin.registerClient()` calls `this.connect()` (non-blocking) at `GatewayPlugin.js:84`, which opens the WebSocket. But there is **no log confirming READY was received**. The 1006 disconnect after ~12 min and failed resumes (no valid session_id to resume) are consistent with READY never arriving.

Carbon's HELLO timeout (`provider.ts:620-641`) watches for the "WebSocket connection opened" debug event, then sets a 30s timer for HELLO. But this listener is attached AFTER the Client constructor returns — the connect() call inside registerClient() may have already opened and processed the WebSocket before the timeout is wired up.

### Key code path

**Client construction** — `provider.ts:490-513`:

```ts
const client = new Client(
  { clientId: applicationId, token, ... },
  { commands, listeners: [], components },
  [new GatewayPlugin({
    intents: resolveDiscordGatewayIntents(discordCfg.intents),
    autoInteractions: true,
    reconnect: { maxAttempts: Infinity },
  })]
);
// Inside constructor: plugin.registerClient(this) → this.connect()
// WebSocket is already opening before the next line runs
```

**IDENTIFY** — `GatewayPlugin.js:386-398`:

```js
identify() {
  const payload = createIdentifyPayload({
    token: this.client.options.token,
    intents: this.options.intents,  // 46593
    properties: { os: process.platform, browser: "@buape/carbon", ... }
  });
  this.send(payload);
}
```

**Event dispatch** — `GatewayPlugin.js:189-245`: Receives DISPATCH (opcode 0), checks `ListenerEvent.includes(t1)`, then calls `this.client.eventHandler.handleEvent(...)` → `EventQueue.enqueue()` → `EventQueue.processEvent()` which filters `client.listeners` by `type === event.type`.

### Diagnostic data collected (2026-02-16)

**Container environment:**

```
OpenClaw: 2026.2.6-3
@buape/carbon: 0.14.0
Node: v22.22.0
Container image: cogni-sandbox-openclaw:latest
Networks: sandbox-internal (internal:true), cogni-edge (internal:false), internal
read_only: true, tmpfs /tmp:128m
```

**Discord bot state (all confirmed via REST API from inside container):**

```
Bot ID: 1472841000530739200, Username: Cogni
Guild: Cogni (1472839918882656301) — bot IS a member
Channels visible: 6 text channels, all with empty permission_overwrites
Application flags: 8953856 (MESSAGE_CONTENT_LIMITED, GUILD_MEMBERS_LIMITED, PRESENCE_LIMITED)
Gateway sessions: 976/1000 remaining
Install params: scopes=[applications.commands, bot], permissions=377957715008
```

**Messages confirmed present via REST but never received via gateway:**

```
2026-02-16T11:39:58Z | derekg1729 | <@1472841000530739200> please say hello back
2026-02-16T11:02:57Z | derekg1729 | <@1472841000530739200> are you in there? give me an ack
(5+ additional @Cogni messages across multiple restarts, zero gateway delivery)
```

**Bot-sent message via REST DID appear in Discord** (proving REST write works, but gateway read doesn't):

```
POST /channels/1472839919453077541/messages → 200 "gateway diagnostic ping 11:41:52"
(appeared in Discord, but gateway itself did not receive the resulting MESSAGE_CREATE)
```

**Full gateway log after clean restart (entire output, nothing omitted):**

```
11:39:00Z [env] OPENCLAW_RAW_STREAM=1
11:39:18Z [canvas] host mounted
11:39:18Z [heartbeat] disabled
11:39:18Z [gateway] agent model: cogni/deepseek-v3.2
11:39:18Z [gateway] listening on ws://0.0.0.0:18789 (PID 1)
11:39:19Z [discord] [default] Discord Message Content Intent is limited
11:39:19Z [discord] [default] starting provider (@Cogni)
11:39:23Z [discord] logged in to discord as 1472841000530739200
(... then NOTHING until web chat activity or 1006 disconnect ~12min later)
```

### What we could not verify

- Whether HELLO is received (no Carbon-level logging at non-verbose level)
- Whether IDENTIFY is sent successfully
- Whether READY is received (the only evidence is the absence of any subsequent events)
- Exact WebSocket frame traffic (can't connect a second diagnostic session — Discord allows only 1 per token)
- Whether this is a Carbon bug or a Docker networking issue (not tested outside Docker)

## Root Cause

**Config structure mismatch.** The Discord bot token was nested under `channels.discord.accounts.default.token`, but OpenClaw reads it from `channels.discord.token` (top-level). The incorrect nesting meant the gateway plugin connected (REST API worked fine with the token from the plugin config), but the channel handler had no token — so no dispatch events were processed.

Fix: moved `token` to `channels.discord.token` per the [OpenClaw configuration reference](https://docs.openclaw.ai/gateway/configuration-reference#discord). That's it.

All the investigation into Carbon internals, Docker networking, IDENTIFY/READY handshakes, and WebSocket frame routing was unnecessary. We just needed to read the docs.

## Allowed Changes

- `services/sandbox-openclaw/openclaw-gateway.json` — config changes
- `platform/infra/services/runtime/docker-compose.dev.yml` — container networking, env vars
- `platform/infra/services/runtime/docker-compose.yml` — same for prod
- OpenClaw upstream issue if the bug is in `@buape/carbon`

## Plan

- [x] **Fix:** Move token from `channels.discord.accounts.default.token` to `channels.discord.token` in `openclaw-gateway.json` and `openclaw-gateway.test.json`

## Validation

**Command:**

```bash
# After fix: send @Cogni message and verify response
docker logs openclaw-gateway 2>&1 | grep -E "MESSAGE_CREATE|message.*handler|preflight"
```

**Expected:** MESSAGE_CREATE events appear in logs within seconds of sending a message. Bot responds in Discord.

## Review Checklist

- [ ] **Work Item:** `bug.0073` linked in PR body
- [ ] **Spec:** CHANNELS_ENABLED_IN_GATEWAY, GATEWAY_RESTART_RECONNECTS invariants upheld
- [ ] **Tests:** manual verification documented (infra bug, no automated test applicable)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Blocks: task.0041 (Discord channel proof of life)
- Handoff: [task.0041.handoff](../handoffs/task.0041.handoff.md)
- OpenClaw repo: `/Users/derek/dev/openclaw/`
- Carbon source: `openclaw/node_modules/.pnpm/@buape+carbon@0.14.0_hono@4.11.7/node_modules/@buape/carbon/`

## Attribution

-
