---
id: proj.messenger-channels
type: project
primary_charter:
title: Messenger Channels — OpenClaw Channel Management for Tenants
state: Active
priority: 1
estimate: 4
summary: Expose OpenClaw's channel plugin system (WhatsApp, Telegram, Discord, etc.) to Cogni tenants via 3 proxy endpoints + a management UI — zero per-channel logic in Cogni
outcome: Tenants can connect, monitor, and disconnect messenger channels from the Cogni UI; OpenClaw handles all channel-protocol details; Cogni stores tenant-channel mappings and proxies management calls
assignees:
  - derekg1729
created: 2026-02-11
updated: 2026-02-11
labels: [openclaw, messenger, channels]
---

# Messenger Channels — OpenClaw Channel Management for Tenants

> Cogni treats channels as **data-driven**: `(channelId, accountId, status)` tuples proxied to OpenClaw. No per-channel protocol code lives in Cogni. OpenClaw owns WhatsApp/Baileys, Telegram bot API, Discord WebSocket, etc. — Cogni owns tenant mapping, UI, and billing.

> **Parent project:** [proj.openclaw-capabilities](proj.openclaw-capabilities.md) — this project extends the OpenClaw gateway integration with channel management for tenants.
>
> Research: [spike.0020](../items/spike.0020.messenger-integration-openclaw-channels.md) → [docs/research/messenger-integration-openclaw-channels.md](../../docs/research/messenger-integration-openclaw-channels.md)

## Goal

Let tenants connect messaging platforms to their Cogni AI agents via the existing OpenClaw gateway. Cogni provides 3 thin proxy endpoints (status, login/pair, logout) and a management UI page. OpenClaw provides the 15+ channel plugins, protocol implementations, and message routing. Start with Telegram (token-only, simplest), then WhatsApp (QR flow).

## Roadmap

### Crawl (P0) — Channel Management Proxy + UI

**Goal:** Tenants can connect a Telegram bot or WhatsApp account via the Cogni UI. Status is visible. Disconnect works. No message bridging — OpenClaw handles conversations autonomously; Cogni captures billing via the LLM proxy audit log.

#### OpenClaw Gateway Channel Config

The existing gateway compose service needs channel sections enabled in its config. Currently `openclaw-gateway.json` only configures the LLM provider. Channels require a `channels:` section and enabling `message`/`sessions_send` tools.

| Deliverable                                                                                                       | Status      | Est | Work Item |
| ----------------------------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| Add `channels:` section to `openclaw-gateway.json` (Discord first, then Telegram + WhatsApp)                      | Not Started | 1   | task.0041 |
| Remove `message` and `sessions_send` from tool deny list in gateway config                                        | Not Started | 0   | task.0041 |
| Add `OPENCLAW_STATE_DIR` volume mount in gateway compose for persistent channel auth state                        | Not Started | 1   | task.0041 |
| Namespace state dirs by accountId — each account's auth state in `${STATE_DIR}/channels/${channel}/${accountId}/` | Not Started | 1   | —         |
| Verify gateway restarts reconnect Discord (bot token) automatically                                               | Not Started | 1   | task.0041 |
| Dedicated Discord community agent — separate agent with bindings, workspace, cost-effective model                 | Not Started | 2   | task.0076 |
| Governance scheduled runs post status updates to `#continuous-cogni-updates` Discord channel                      | Not Started | 2   | task.0075 |

#### 3 Proxy Endpoints (Cogni → OpenClaw Gateway)

Cogni exposes 3 HTTP endpoints that proxy to OpenClaw gateway WS methods. Cogni adds tenant scoping (billing account filtering) and persistence. All channel-protocol logic stays in OpenClaw.

| Deliverable                                                                                                                                                                         | Status      | Est | Work Item |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| `GET /api/v1/channels/status` — proxies `channels.status` WS call, filters to tenant's registered accounts, returns `ChannelAccountSnapshot[]`                                      | Not Started | 2   | —         |
| `POST /api/v1/channels/connect` — starts login: for token-based (Telegram), passes bot token to config + starts account; for QR (WhatsApp), calls `webLoginStart` + returns QR data | Not Started | 2   | —         |
| `POST /api/v1/channels/disconnect` — proxies `channels.logout` WS call for the tenant's account, updates Cogni mapping                                                              | Not Started | 1   | —         |
| Extend gateway client with `channelsStatus()`, `channelsLogout()`, `webLoginStart()`, `webLoginWait()` methods using existing WS frame protocol                                     | Not Started | 2   | —         |

#### Tenant-Channel Persistence + Credential Encryption

Per [messenger-channels spec](../../docs/spec/messenger-channels.md): `channel_registrations` table with AES-256-GCM encrypted credentials. AccountId = `"tenant-{billingAccountId}"` (per spec ACCOUNT_ID_IS_TENANT_SCOPED). QR-based auth state (WhatsApp) stays in STATE_DIR volume.

| Deliverable                                                                                                                | Status      | Est | Work Item |
| -------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | --------- |
| `channel_registrations` table with encrypted_credential column (see spec schema)                                           | Not Started | 1   | —         |
| AES-256-GCM encrypt/decrypt utility (`src/shared/crypto/channel-credentials.ts`) + `CHANNEL_ENCRYPTION_KEY` env var        | Not Started | 1   | —         |
| AccountId derivation: `"tenant-{billingAccountId}"` — deterministic, one per tenant (see spec ACCOUNT_ID_IS_TENANT_SCOPED) | Not Started | 0   | —         |
| RLS policy on `channel_registrations` — standard tenant scoping via `billing_account_id`                                   | Not Started | 0   | —         |

#### Channel Management UI

Single Next.js page showing connected channels with connect/disconnect actions.

| Deliverable                                                                                            | Status      | Est | Work Item |
| ------------------------------------------------------------------------------------------------------ | ----------- | --- | --------- |
| `/channels` page: list available channels (from `channels.status`), show connection status per channel | Not Started | 2   | —         |
| Telegram connect flow: input field for bot token → connect → status turns green                        | Not Started | 1   | —         |
| WhatsApp connect flow: click Connect → QR code displayed → scan → status turns green                   | Not Started | 2   | —         |
| Disconnect button per connected channel account                                                        | Not Started | 0   | —         |

### Walk (P1) — Operational Hardening + Connections Migration

**Goal:** Reconnect behavior is reliable. Rate limiting and audit logging protect channel operations. Migrate to `connections` table if `proj.tenant-connections` is available.

| Deliverable                                                                                                                                                                     | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Migrate `channel_registrations` to `connections` table from `proj.tenant-connections` — `provider: "openclaw:<channel>"`, `credential_type: "bot_token"` or `"channel_session"` | Not Started | 2   | (create at P1 start) |
| Rate limits on connect/disconnect endpoints (prevent QR abuse, token brute-force)                                                                                               | Not Started | 1   | (create at P1 start) |
| Audit log: connect/disconnect events recorded with timestamp + billingAccountId + channel + accountId                                                                           | Not Started | 1   | (create at P1 start) |
| Health poll: periodic `channels.status` probe, push alerts to observability if account disconnects unexpectedly                                                                 | Not Started | 1   | (create at P1 start) |
| Discord billing user attribution — propagate Discord user ID into LLM proxy billing metadata                                                                                    | Not Started | 2   | task.0077            |

### Run (P2+) — Cogni-Mediated Messaging + Cloud API + Scaling

**Goal:** Cogni intercepts inbound messages for graph execution. Official WhatsApp Cloud API for production compliance. Multi-instance scaling.

| Deliverable                                                                                                    | Status      | Est | Work Item            |
| -------------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Inbound message bridge: OpenClaw → Cogni webhook/WS → Cogni graph execution → OpenClaw `send()` for response   | Not Started | 3   | (create at P2 start) |
| Conversation persistence: Cogni-side message storage for messenger conversations (reuse chat persistence spec) | Not Started | 2   | (create at P2 start) |
| WhatsApp Cloud API: separate OpenClaw channel plugin or Cogni-native adapter, Meta Business verification       | Not Started | 3   | (create at P2 start) |
| Multi-instance: instance-per-tenant or sharded gateways for tenant isolation at scale                          | Not Started | 3   | (create at P2 start) |
| Per-tenant resource limits and billing attribution for messenger conversations                                 | Not Started | 2   | (create at P2 start) |

## Constraints

- Cogni has zero per-channel protocol logic — all channel specifics (Baileys, Telegram Bot API, Discord.js) live in OpenClaw
- Channels are data-driven in Cogni: `(channelId, accountId, status)` + connect/disconnect actions proxied to OpenClaw gateway WS
- One OpenClaw accountId per tenant per channel — prevents cross-tenant message leakage and simplifies billing
- OpenClaw state volume persists across restarts — Cogni does not attempt to backup/restore Baileys auth state
- P0 has no Cogni-side message persistence — OpenClaw handles full conversation loop autonomously; Cogni captures billing via proxy audit log only
- Telegram first (bot token, no session state, simplest onboarding), WhatsApp second (QR flow, Baileys session state, more complex)
- Gateway client methods for channel management reuse the existing WS frame protocol (same handshake, same req/res correlation)

## Dependencies

- [x] OpenClaw gateway running on `sandbox-internal` (compose service operational)
- [x] LLM proxy with billing headers (`llm-proxy-openclaw` → LiteLLM)
- [ ] task.0008 — Gateway client protocol lifecycle (P0 channel methods build on this)
- [ ] task.0019 — Gateway auth parameterization (channels endpoints need authenticated gateway WS)
- [ ] proj.tenant-connections P0 — Connection model for P1 migration (NOT required for P0 — P0 uses `channel_registrations` with standalone AES-256-GCM)

## As-Built Specs

- [messenger-channels.md](../../docs/spec/messenger-channels.md) — Multi-tenant channel management: isolation model, credential lifecycle, endpoint contracts, invariants

## Design Notes

Design content (accountId namespacing, WS method mapping, isolation model, credential flow) lives in the [messenger-channels spec](../../docs/spec/messenger-channels.md). This project owns the roadmap and deliverable tracking only.

### Research Artifacts

- [spike.0020 — Messenger integration research](../../docs/research/messenger-integration-openclaw-channels.md) — Full findings, WhatsApp options analysis, OSS survey
