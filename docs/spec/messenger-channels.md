---
id: messenger-channels
type: spec
title: Messenger Channels — Multi-Tenant Channel Management via OpenClaw
status: draft
spec_state: draft
trust: draft
summary: Multi-tenant messenger integration — maps Cogni billing accounts to OpenClaw channel accounts, defines credential lifecycle, proxy endpoint contracts, isolation guarantees, and channel management invariants
read_when: Implementing messenger channel support, adding a new channel type, debugging channel auth, or modifying the gateway channel config
implements: proj.messenger-channels
owner: cogni-dev
created: 2026-02-13
verified:
tags: [messenger, openclaw, channels, auth, multi-tenant]
---

# Messenger Channels — Multi-Tenant Channel Management via OpenClaw

> Cogni tenants connect messaging platforms (WhatsApp, Telegram, Discord) to AI agents via OpenClaw's built-in channel plugins. Cogni is a **thin management proxy** — it stores tenant-channel mappings, proxies management actions over WS, and captures billing. All channel-protocol logic (Baileys, Bot API, discord.js) stays in OpenClaw. **Zero per-channel code in Cogni.**

### Key References

|                 |                                                                                 |                               |
| --------------- | ------------------------------------------------------------------------------- | ----------------------------- |
| **Project**     | [proj.messenger-channels](../../work/projects/proj.messenger-channels.md)       | Roadmap and planning          |
| **Parent**      | [proj.openclaw-capabilities](../../work/projects/proj.openclaw-capabilities.md) | Parent project                |
| **Research**    | [spike.0020](../research/messenger-integration-openclaw-channels.md)            | Channel plugin research       |
| **Sandbox**     | [openclaw-sandbox-spec](openclaw-sandbox-spec.md)                               | OpenClaw execution modes      |
| **Connections** | [tenant-connections](tenant-connections.md)                                     | Credential brokering (future) |

## Design

### Multi-Tenant Channel Architecture

```
Cogni UI (Next.js)
  │
  │  POST /api/v1/channels/connect  { channel: "telegram", botToken: "..." }
  │  GET  /api/v1/channels/status
  │  POST /api/v1/channels/disconnect
  │
  ▼
Cogni API (authenticated via SIWE session → billingAccountId)
  │
  │  1. Derive accountId = "tenant-{billingAccountId}" (per-tenant namespace)
  │  2. Store/lookup channel_registrations row
  │  3. Proxy to OpenClaw gateway via WS
  │
  ▼  WS (token auth, custom frame protocol)
┌─────────────────────────────────────────────────────────────────────┐
│ OpenClaw Gateway (sandbox-internal:18789)                            │
│                                                                     │
│  Per-account isolation:                                              │
│    Account "tenant-ba_abc"                                           │
│      ├── WhatsApp: Baileys socket + auth @ STATE_DIR/whatsapp/…     │
│      ├── Telegram: Bot API polling                                   │
│      └── Discord: Bot WebSocket                                      │
│                                                                     │
│    Account "tenant-ba_def"                                           │
│      └── Telegram: different bot token, separate listener            │
│                                                                     │
│  Inbound message → resolve-route.ts → agent:main:{accountId}:…     │
│  Agent calls LLM → llm-proxy-openclaw:8080 → LiteLLM (billing)     │
│  Agent responds → channel plugin sends reply                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Credential Flow by Channel Type

```
Token-based (Telegram, Discord, Slack):

  User enters bot token in UI
    → POST /channels/connect { channel, credential }
    → Cogni encrypts token → channel_registrations row
    → Cogni calls gateway WS: channels.configure({ channel, accountId, token })
    → OpenClaw starts account listener
    → channels.status confirms connected

QR-based (WhatsApp):

  User clicks "Connect WhatsApp" in UI
    → POST /channels/connect { channel: "whatsapp" }
    → Cogni calls gateway WS: webLoginStart({ accountId })
    → OpenClaw returns QR code data
    → Cogni returns QR to UI (SSE stream or poll)
    → User scans QR with WhatsApp mobile
    → webLoginWait({ accountId }) resolves with success
    → Baileys auth state stored in STATE_DIR volume (per-account dir)
    → channel_registrations row created (credential_ref: "state_dir")
    → channels.status confirms connected
```

### Isolation Model

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Single OpenClaw Gateway Process                    │
│                                                                      │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐   │
│  │ Account: tenant-ba_abc      │  │ Account: tenant-ba_def      │   │
│  │                             │  │                             │   │
│  │ WhatsApp:                   │  │ Telegram:                   │   │
│  │  ├─ Own Baileys socket      │  │  └─ Own Bot API poller      │   │
│  │  ├─ Own auth dir            │  │     (separate task+abort)   │   │
│  │  │  (STATE_DIR/wa/ba_abc/)  │  │                             │   │
│  │  ├─ Own listener task       │  │ Session keys:               │   │
│  │  └─ Own AbortController     │  │  agent:main:telegram:       │   │
│  │                             │  │    tenant-ba_def:direct:… │   │
│  │ Session keys:               │  │                             │   │
│  │  agent:main:whatsapp:       │  │ Messages:                   │   │
│  │    tenant-ba_abc:direct:… │  │  Tagged with accountId      │   │
│  │                             │  │  Deduped per account        │   │
│  │ Messages:                   │  │  Routed independently       │   │
│  │  Tagged with accountId      │  │                             │   │
│  │  Deduped per account        │  └─────────────────────────────┘   │
│  │  Routed independently       │                                     │
│  └─────────────────────────────┘                                     │
│                                                                      │
│  Shared: config file, process memory, LLM proxy                      │
│  Isolated: auth state, listeners, sessions, message routing          │
└──────────────────────────────────────────────────────────────────────┘
```

## Goal

Define how Cogni tenants connect, manage, and disconnect messaging channels via the OpenClaw gateway. Establish the multi-tenant isolation boundaries, credential lifecycle, proxy endpoint contracts, and security invariants that protect tenants from cross-contamination — all without writing per-channel protocol code in Cogni.

## Non-Goals

- Per-channel protocol implementations in Cogni (Baileys, discord.js, Telegram Bot API — all in OpenClaw)
- Cogni-mediated message handling (inbound messages stay in OpenClaw's agent loop; Cogni-side graph execution is future scope — see [proj.messenger-channels](../../work/projects/proj.messenger-channels.md) P2)
- Cogni-side conversation persistence for messenger conversations (future)
- WhatsApp Cloud API / official Meta Business integration (future)
- Multi-gateway-instance scaling / instance-per-tenant isolation (future)
- OpenClaw dashboard or control UI (invariant NO_OPENCLAW_DASHBOARD from [openclaw-sandbox-spec](openclaw-sandbox-spec.md))

## Invariants

### Tenant Isolation

| Rule                               | Constraint                                                                                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACCOUNT_ID_IS_TENANT_SCOPED        | OpenClaw `accountId` is deterministically derived from Cogni `billingAccountId`: `"tenant-{billingAccountId}"`. One accountId per tenant. All channel operations for a tenant use the same accountId. This is the isolation boundary.    |
| ONE_ACCOUNT_PER_TENANT_PER_CHANNEL | A tenant may connect at most one account per channel type. Enforced by unique index on `(billing_account_id, channel)` in `channel_registrations`. Prevents ambiguous message routing and billing attribution.                           |
| TENANT_FILTER_ON_STATUS            | `GET /channels/status` returns only the requesting tenant's accounts. Cogni filters the OpenClaw `channels.status` response by the derived accountId — never exposes other tenants' snapshots.                                           |
| NO_CROSS_TENANT_OPERATIONS         | `connect`, `disconnect`, and `status` endpoints derive the accountId from the authenticated session's `billingAccountId`. No endpoint accepts an arbitrary accountId from the client. The client never learns other tenants' accountIds. |

### Credential Security

| Rule                          | Constraint                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TOKEN_ENCRYPTED_AT_REST       | Token-based credentials (Telegram bot tokens, Discord bot tokens, Slack OAuth tokens) are AES-256-GCM encrypted in the `channel_registrations` table. Encryption key from env (`CHANNEL_ENCRYPTION_KEY`), never from DB. Plaintext token exists only in-memory during connect flow and during gateway config injection.                                    |
| QR_STATE_IN_VOLUME            | QR-based credentials (WhatsApp/Baileys auth state) are stored in the OpenClaw `STATE_DIR` Docker volume, not in the DB. The auth state is a multi-file directory (~50KB, frequently updated by Baileys) — not suitable for DB storage. The `channel_registrations` row stores `credential_ref: "state_dir"` as a sentinel indicating volume-based storage. |
| STATE_DIR_PER_ACCOUNT         | OpenClaw's state directory is namespaced by accountId. Each tenant's Baileys auth state lives in `${STATE_DIR}/channels/whatsapp/${accountId}/`. OpenClaw enforces this via its `config.resolveAccount()` → `authDir` resolution. Cogni does not manage these files directly.                                                                              |
| CREDENTIAL_WIPE_ON_DISCONNECT | `POST /channels/disconnect` must: (1) call OpenClaw `channels.logout` (clears runtime state + auth files), (2) delete the `channel_registrations` row, (3) if token-based, zero the encrypted credential column. Order matters — OpenClaw logout first, then DB cleanup.                                                                                   |
| NO_TOKEN_IN_LOGS              | Credentials must never appear in Pino log output, Langfuse traces, or error messages. The `connect` endpoint logs `{ channel, accountId, billingAccountId }` but never the token value. Token validation errors return generic messages, not the invalid token.                                                                                            |

### Gateway Configuration

| Rule                                 | Constraint                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CHANNEL_CONFIG_SEPARATE_FROM_SANDBOX | The gateway's channel configuration is distinct from the sandbox execution config. The gateway compose service uses `openclaw-gateway.json` (with channels enabled). Ephemeral sandbox containers use per-run generated `openclaw.json` (channels disabled, `network=none`). These are different config files, different services, different networks. |
| CHANNELS_ENABLED_IN_GATEWAY          | The gateway config must have `message` and `sessions_send` removed from the `tools.deny` list to enable channel message delivery. `group:web` may remain denied (link previews are non-essential). The `channels:` config section must be present in `openclaw-gateway.json`.                                                                          |
| STATE_DIR_VOLUME_REQUIRED            | The gateway compose service must mount a named Docker volume at `OPENCLAW_STATE_DIR` for persistent channel auth state. `/tmp` paths are forbidden — they do not survive container restarts. The volume mount must use a named volume (not a bind mount) for portability.                                                                              |
| GATEWAY_RESTART_RECONNECTS           | After a gateway container restart, OpenClaw must automatically reconnect channels using persisted auth state from `STATE_DIR`. Token-based channels (Telegram, Discord) reconnect using stored tokens. QR-based channels (WhatsApp) reconnect using persisted Baileys session — no re-scan required unless the session has been revoked by WhatsApp.   |

### Billing

| Rule                           | Constraint                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MESSENGER_BILLING_VIA_CALLBACK | Messenger conversations are billed via LiteLLM generic_api callback (COST_AUTHORITY_IS_LITELLM). OpenClaw's agent calls LLM through `llm-proxy-openclaw:8080` with billing headers. The proxy passes through `x-litellm-end-user-id` and `x-litellm-spend-logs-metadata` from the OpenClaw session's `outboundHeaders`. No separate billing path for messenger vs sandbox. |
| OUTBOUND_HEADERS_PER_ACCOUNT   | OpenClaw's gateway must set `outboundHeaders` per-session to include `x-litellm-end-user-id: {billingAccountId}`. The billingAccountId is extracted from the accountId (`tenant-{billingAccountId}` → `billingAccountId`). This ensures LLM calls from messenger conversations are attributed to the correct tenant.                                                       |

### Endpoint Contracts

| Rule                  | Constraint                                                                                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| THREE_ENDPOINTS_ONLY  | Cogni exposes exactly three channel management endpoints. All channel-protocol specifics are handled by OpenClaw. Adding a new channel type must not require new Cogni endpoints — only OpenClaw config changes and a new row in `channel_registrations`. |
| CONNECT_IS_IDEMPOTENT | `POST /channels/connect` for an already-connected channel returns the current status, not an error. Reconnecting a channel with a new token updates the stored credential and restarts the listener.                                                      |
| DISCONNECT_IS_SAFE    | `POST /channels/disconnect` for an already-disconnected channel returns success (200), not an error. The operation is idempotent.                                                                                                                         |

## Schema

### Table: `channel_registrations`

Lightweight tenant-channel mapping with encrypted credentials. This table is NOT the full `connections` table from [tenant-connections.md](tenant-connections.md) — it is purpose-built for channel management. If `proj.tenant-connections` P0 lands first, this table may be replaced by rows in `connections` with `provider: "openclaw:<channel>"`.

| Column                 | Type        | Constraints                   | Description                                                 |
| ---------------------- | ----------- | ----------------------------- | ----------------------------------------------------------- |
| `id`                   | uuid        | PK, DEFAULT gen_random_uuid() | Row identifier                                              |
| `billing_account_id`   | text        | NOT NULL, FK billing_accounts | Tenant scope                                                |
| `channel`              | text        | NOT NULL                      | Channel identifier: `"telegram"`, `"whatsapp"`, `"discord"` |
| `account_id`           | text        | NOT NULL                      | OpenClaw accountId: `"tenant-{billing_account_id}"`         |
| `display_name`         | text        |                               | Human label (e.g., bot username, phone number)              |
| `credential_type`      | text        | NOT NULL                      | `"bot_token"`, `"oauth_token"`, `"state_dir"`               |
| `encrypted_credential` | bytea       |                               | AES-256-GCM encrypted token. NULL for `state_dir` type.     |
| `encryption_key_id`    | text        |                               | Key version for rotation. NULL for `state_dir` type.        |
| `connected_at`         | timestamptz | NOT NULL, DEFAULT now()       | When channel was connected                                  |
| `disconnected_at`      | timestamptz |                               | Soft-delete timestamp                                       |

**Indexes:**

- `UNIQUE (billing_account_id, channel) WHERE disconnected_at IS NULL` — one active registration per tenant per channel
- `INDEX (account_id)` — fast lookup by OpenClaw accountId

**RLS policy:** `billing_account_id = current_setting('app.current_user_id')` — standard tenant scoping.

### Endpoint: `GET /api/v1/channels/status`

**Auth:** SIWE session (existing proxy.ts enforcement)

**Response:**

```typescript
// Contract: channels.status.v1
{
  channels: Array<{
    channel: string; // "telegram" | "whatsapp" | "discord" | ...
    accountId: string; // "tenant-{billingAccountId}"
    displayName: string | null;
    status: {
      connected: boolean;
      running: boolean;
      configured: boolean;
      lastConnectedAt: string | null; // ISO 8601
      lastInboundAt: string | null; // ISO 8601
      lastError: string | null;
    };
  }>;
}
```

**Behavior:**

1. Load `channel_registrations` rows for the tenant
2. Call OpenClaw WS `channels.status`
3. Filter OpenClaw response by tenant's accountId
4. Merge DB state (display_name, connected_at) with runtime state (connected, running, lastError)
5. Return merged result

**Error responses:**

- `502 Bad Gateway` — OpenClaw gateway unreachable (WS connect failed)
- `504 Gateway Timeout` — OpenClaw WS call timed out (10s default)

### Endpoint: `POST /api/v1/channels/connect`

**Auth:** SIWE session

**Request (token-based):**

```typescript
{
  channel: "telegram" | "discord" | "slack";
  credential: string; // bot token or OAuth token
}
```

**Request (QR-based):**

```typescript
{
  channel: "whatsapp";
  // No credential — QR flow starts
}
```

**Response (token-based, synchronous):**

```typescript
{
  accountId: string;
  channel: string;
  status: "connected" | "connecting" | "failed";
  displayName: string | null;
  error: string | null;
}
```

**Response (QR-based):**

```typescript
{
  accountId: string;
  channel: "whatsapp";
  status: "awaiting_scan";
  qr: string; // QR code data (not an image — client renders)
}
```

The client polls `GET /channels/status` or uses a separate `GET /channels/connect/poll?channel=whatsapp` endpoint to detect scan completion.

**Behavior (token-based):**

1. Derive `accountId = "tenant-{billingAccountId}"`
2. Encrypt credential with AES-256-GCM (key from `CHANNEL_ENCRYPTION_KEY` env)
3. Upsert `channel_registrations` row
4. Call OpenClaw WS to configure and start channel account
5. Verify connection via `channels.status`
6. Return result

**Behavior (QR-based):**

1. Derive accountId
2. Call OpenClaw WS `webLoginStart({ accountId })`
3. Return QR data to client
4. Client polls for completion
5. On successful scan, create `channel_registrations` row with `credential_type: "state_dir"`

**Error responses:**

- `400 Bad Request` — invalid channel name or empty credential
- `409 Conflict` — channel already connected for this tenant (use disconnect first, or connect will re-connect with new credential)
- `502 Bad Gateway` — OpenClaw gateway unreachable
- `504 Gateway Timeout` — QR login or token verification timed out

### Endpoint: `POST /api/v1/channels/disconnect`

**Auth:** SIWE session

**Request:**

```typescript
{
  channel: string; // "telegram" | "whatsapp" | "discord" | ...
}
```

**Response:**

```typescript
{
  channel: string;
  status: "disconnected";
}
```

**Behavior:**

1. Derive accountId
2. Call OpenClaw WS `channels.logout({ channelId, accountId })` (clears runtime + auth files)
3. Update `channel_registrations`: set `disconnected_at`, zero `encrypted_credential`
4. Return success

**Error responses:**

- `404 Not Found` — no active registration for this tenant + channel
- `502 Bad Gateway` — OpenClaw gateway unreachable

## Key Decisions

### 1. Why accountId namespacing instead of instance-per-tenant?

OpenClaw supports multi-account channels natively. Each accountId gets its own filesystem state, socket connection, listener task, and AbortController. Session keys include accountId for message routing isolation. This provides sufficient isolation for a single-gateway deployment without the operational complexity of managing N gateway instances.

**What is isolated:** auth state (per-directory), socket connections (per-task), message routing (per-accountId session keys), message deduplication (per-accountId keys).

**What is shared:** process memory, config file, LLM proxy. A bug in OpenClaw's channel plugin could theoretically leak across accounts within the same process. This is acceptable for early tenants. Instance-per-tenant is deferred to scale-out phase.

### 2. Why encrypt tokens in DB instead of deferring to proj.tenant-connections?

The design review identified plaintext credential storage as a blocking issue. Bot tokens are full-access credentials — a database breach would compromise every connected bot. AES-256-GCM with `node:crypto` is ~20 lines of code. The `CHANNEL_ENCRYPTION_KEY` env var follows the same pattern as other secrets in this codebase. This is not the full `ConnectionBroker` from tenant-connections — it's a minimal encrypt/decrypt pair scoped to channel management.

### 3. Why `channel_registrations` instead of reusing `connections` table?

The `connections` table from `tenant-connections.md` is designed for tool auth (OAuth tokens, API keys) with grant intersection, broker-at-invocation, and capability injection. Channel credentials have different semantics: long-lived, used at gateway boot (not per-invocation), no grant scoping needed. A purpose-built table avoids overloading the connections schema. If `proj.tenant-connections` ships first, migration is a simple data copy + table drop.

### 4. Why QR state stays in volume, not DB?

Baileys auth state is a multi-file directory (~50KB) that Baileys updates autonomously on every WhatsApp protocol event (key rotation, session refresh). Storing it in a DB column would require constant serialization/deserialization and conflict with Baileys' direct filesystem access pattern. The STATE_DIR volume is the natural storage layer. Cogni tracks the registration metadata in DB; OpenClaw manages the actual auth state on disk.

### File Pointers

| File                                                       | Purpose                                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/contracts/channels.status.v1.contract.ts`             | Status endpoint Zod contract (to be created)                     |
| `src/contracts/channels.connect.v1.contract.ts`            | Connect endpoint Zod contract (to be created)                    |
| `src/contracts/channels.disconnect.v1.contract.ts`         | Disconnect endpoint Zod contract (to be created)                 |
| `src/features/channels/services/status.ts`                 | Status feature service (to be created)                           |
| `src/features/channels/services/connect.ts`                | Connect feature service (to be created)                          |
| `src/features/channels/services/disconnect.ts`             | Disconnect feature service (to be created)                       |
| `src/ports/channel-management.port.ts`                     | Port for OpenClaw channel WS operations (to be created)          |
| `src/adapters/server/channels/openclaw-channel.adapter.ts` | Adapter implementing channel port via gateway WS (to be created) |
| `src/shared/db/schema.channels.ts`                         | Drizzle schema for `channel_registrations` (to be created)       |
| `src/shared/crypto/channel-credentials.ts`                 | AES-256-GCM encrypt/decrypt for bot tokens (to be created)       |
| `src/app/api/v1/channels/status/route.ts`                  | Status route (to be created)                                     |
| `src/app/api/v1/channels/connect/route.ts`                 | Connect route (to be created)                                    |
| `src/app/api/v1/channels/disconnect/route.ts`              | Disconnect route (to be created)                                 |
| `services/sandbox-openclaw/openclaw-gateway.json`          | Gateway config — needs `channels:` section added                 |
| `platform/infra/services/runtime/docker-compose.yml`       | Compose — needs STATE_DIR named volume                           |
| `src/adapters/server/sandbox/openclaw-gateway-client.ts`   | Existing gateway WS client — needs channel methods               |

## Acceptance Checks

**Automated:**

- `pnpm check:docs` — spec frontmatter and heading validation
- `tests/unit/shared/crypto/channel-credentials.test.ts` — AES-256-GCM round-trip, key rotation, zero-on-delete
- `tests/contract/channels.connect.contract.ts` — connect endpoint validates input, encrypts token, returns status
- `tests/contract/channels.status.contract.ts` — status endpoint filters by tenant, returns only own channels
- `tests/unit/security/no-cross-tenant-channel.test.ts` — accountId derivation is deterministic and tenant-scoped

**Manual:**

1. Connect Telegram bot → verify `channel_registrations` row has non-null `encrypted_credential` (not plaintext)
2. `docker compose down && docker compose up` → verify Telegram bot auto-reconnects without user action
3. Connect as tenant A, query status as tenant B → verify tenant B sees empty result
4. Disconnect channel → verify `encrypted_credential` is zeroed, OpenClaw account stopped

## Open Questions

- [ ] **OQ-1: Gateway channel config injection at runtime.** Can OpenClaw accept new channel/account configurations via WS methods at runtime, or does it require a config file restart? If restart-required, the `connect` flow needs to write to the config file and restart the gateway — a significant operational complexity increase. Research required against OpenClaw's `channels.configure` or equivalent runtime method.

- [ ] **OQ-2: Billing attribution for messenger conversations.** The current gateway `outboundHeaders` are set per-session via `configureSession()`. For messenger conversations, OpenClaw creates sessions automatically on inbound messages (via `resolve-route.ts`). How do outboundHeaders get set for auto-created sessions? If they don't, messenger LLM calls will lack billing attribution. May need OpenClaw-side changes (default outboundHeaders per accountId in config) or a hook.

- [ ] **OQ-3: QR code security.** The WhatsApp QR code grants full account access. How long does the QR remain valid? Is there a timeout? Can a QR be used twice? Should the connect endpoint enforce that only one QR login flow is active per tenant at a time? OpenClaw's `activeLogins` Map is per-accountId, which provides some protection.

- [ ] **OQ-4: Baileys GPL-3.0 implications.** OpenClaw bundles `@whiskeysockets/baileys` (GPL-3.0) in its Docker image. Cogni deploys this image for tenants. Does the copyleft obligation apply to Cogni's codebase, or only to the OpenClaw image? Legal review needed before offering WhatsApp to external tenants. Telegram (MIT-licensed bot API) has no such concern.

- [ ] **OQ-5: Agent behavior for messenger conversations.** When an inbound message arrives via a channel, OpenClaw routes it to an agent. What system prompt / SOUL.md / AGENTS.md does that agent use? For sandbox execution, `SandboxGraphProvider` pre-creates workspace behavior files. For messenger, the gateway agent's workspace is the STATE_DIR — who provisions the agent behavior files? Likely needs a `workspace/` volume mount with pre-created behavior files.

## Related

- [OpenClaw Sandbox Integration](openclaw-sandbox-spec.md) — Execution modes, gateway protocol, billing (invariants 13–28)
- [OpenClaw Sandbox Controls](openclaw-sandbox-controls.md) — Agent registry, credential strategy (invariants 20–25)
- [Tenant Connections](tenant-connections.md) — Full credential brokering spec (future integration point)
- [Security & Auth](security-auth.md) — API key auth, auth surfaces
- [Authentication](authentication.md) — SIWE session model
- [proj.messenger-channels](../../work/projects/proj.messenger-channels.md) — Roadmap, deliverable tracking
- [spike.0020 research](../research/messenger-integration-openclaw-channels.md) — Channel plugin survey, WhatsApp options analysis
