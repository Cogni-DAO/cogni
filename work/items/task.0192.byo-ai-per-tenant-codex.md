---
id: task.0192
type: task
title: "v1: Per-tenant BYO-AI — connectionId + credential broker + app-server"
status: needs_implement
priority: 2
rank: 15
estimate: 5
summary: "Profile page 'Connect ChatGPT' button triggers OAuth PKCE flow, stores encrypted tokens in provider_credentials table. Credential broker resolves connectionId to tokens. Codex app-server sidecar with chatgptAuthTokens for multi-tenant execution."
outcome: "Any authenticated user can link their ChatGPT account on the profile page, select Codex graphs in chat, and run AI at $0 using their own subscription. connectionId abstraction keeps the graph executor storage-agnostic."
spec_refs: []
assignees: [derekg1729]
credit:
project: proj.byo-ai
branch: feat/byo-ai-per-tenant
pr:
reviewer:
created: 2026-03-23
updated: 2026-03-22
labels: [ai, oauth, byo-ai, codex, multi-tenant]
external_refs:
  - docs/research/openai-oauth-byo-ai.md
revision: 2
blocked_by: [task.0191]
deploy_verified: false
---

## Design

### Outcome

Authenticated users can connect their ChatGPT subscription via a "Link" button on the profile page, then select Codex graphs in the chat UI and execute AI using their own subscription at $0 marginal cost.

### Approach

**Solution**: Three-layer architecture — (1) OAuth + encrypted credential storage, (2) credential broker that resolves a `connectionId` to live tokens, (3) Codex app-server sidecar using `chatgptAuthTokens` auth mode for runtime execution.

The graph executor receives a `connectionId` (opaque reference to a `provider_credentials` row), never raw tokens. The credential broker handles decryption and refresh. The Codex adapter receives resolved tokens from the broker and supplies them to the app-server via the `account/login/start` JSON-RPC method with `type: "chatgptAuthTokens"`. When the app-server needs a token refresh (401), it sends a `chatgptAuthTokens/refresh` request — the host (our adapter) responds by refreshing via `@mariozechner/pi-ai/oauth` and persisting the new tokens.

**Reuses**:

- Profile page `SettingRow` + `ConnectedBadge` components (same UX as GitHub/Discord/Google linking)
- `@mariozechner/pi-ai/oauth` — `refreshOpenAICodexToken()` for token refresh (already a dependency)
- OpenAI PKCE OAuth constants/flow from `scripts/dev/codex-login.mts` (same client ID, endpoints, scope)
- Codex app-server protocol — `chatgptAuthTokens` auth mode (host-supplied tokens, in-memory only, host handles refresh)
- Drizzle schema patterns from `packages/db-schema` (pgTable, RLS, check constraints)

**Rejected**:

- **Temp auth.json + SDK env injection**: v0 hack. Writing per-user auth.json files and manipulating HOME is filesystem-based credential routing, not a real auth boundary. Doesn't scale to concurrent users. OpenAI's auth.json is for trusted private runners only.
- **LiteLLM virtual keys**: Codex uses non-standard transport (WebSocket + Responses API to `chatgpt.com`), not OpenAI API. LiteLLM can't route Codex traffic.
- **Token paste UX**: Poor UX, exposes raw tokens to clipboard, requires CLI access.

### Architecture

```
Profile (OAuth)          Credential Broker              Codex Adapter
┌──────────────┐    ┌─────────────────────┐    ┌──────────────────────────┐
│ Connect      │    │ CredentialBroker     │    │  CodexGraphProvider      │
│ ChatGPT      │    │                     │    │                          │
│   [Link]     │    │ resolve(connId):    │    │ 1. broker.resolve(connId)│
│     │        │    │   → decrypt tokens  │    │ 2. app-server login      │
│     ▼        │    │   → check expiry    │    │    { type: "chatgpt-     │
│ OAuth PKCE   │    │   → refresh if stale│    │      AuthTokens",       │
│ → callback   │    │   → persist refresh │    │      accessToken,       │
│ → encrypt    │    │   → return tokens   │    │      chatgptAccountId } │
│ → store row  │    │                     │    │ 3. turn/start(prompt)    │
│ → connId     │    │ connectionId = row  │    │ 4. on 401 → broker      │
│              │    │   ID in provider_   │    │    .refresh(connId)      │
│              │    │   credentials table │    │    → respond to server   │
└──────────────┘    └─────────────────────┘    └──────────────────────────┘
                                                        │
                                                        ▼
                                                ┌──────────────────┐
                                                │ codex app-server │
                                                │ (WS sidecar)     │
                                                │                  │
                                                │ chatgptAuthTokens│
                                                │ mode: host owns  │
                                                │ tokens, in-memory│
                                                │ only             │
                                                └──────────────────┘
```

### Key Abstractions

**`connectionId`**: Opaque string (the `provider_credentials.id`). Passed through `ExecutionContext` to the graph executor. The executor never sees raw tokens — it asks the broker.

**`CredentialBrokerPort`**: Interface in `ports/`:

```ts
interface CredentialBrokerPort {
  resolve(connectionId: string): Promise<ResolvedCredential | null>;
  refresh(connectionId: string): Promise<ResolvedCredential>;
}

interface ResolvedCredential {
  accessToken: string;
  accountId: string;
  expiresAt: Date;
}
```

**Codex app-server lifecycle**: Long-running WebSocket sidecar (`codex app-server --listen ws://127.0.0.1:PORT`). Per-user auth supplied via `account/login/start` JSON-RPC with `type: "chatgptAuthTokens"`. When the server gets a 401, it sends `chatgptAuthTokens/refresh` → our adapter calls `broker.refresh(connId)` → responds with fresh tokens.

**Note on `chatgptAuthTokens` stability**: The protocol schema marks this as `[UNSTABLE] FOR OPENAI INTERNAL USE ONLY`. This is the same mode the VS Code extension uses. Risk accepted: we pin the Codex CLI version and can fall back to the v0 `codex exec` subprocess path per-invocation if this mode breaks. The fallback would use `CODEX_HOME` env var per-invocation (contained adapter detail, not product architecture).

### Pre-Implementation Gates

1. **Redirect URI validation**: Test whether the public OAuth client ID (`app_EMoamEEZ73f0CkXaXp7hrann`) accepts non-localhost redirect URIs. If blocked:
   - **Fallback A**: Device Code flow (`codex login --device-auth`) — requires user to enable in ChatGPT settings (beta)
   - **Fallback B**: Popup relay — localhost callback + postMessage. Requires local Codex CLI.

2. **App-server multi-session**: Verify that a single app-server instance can handle sequential `account/login/start` calls with different user tokens (one turn at a time, different users). If not, we need a pool of app-server instances or fall back to per-request `codex exec` subprocess.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] CONNECTION_ID_ABSTRACTION: Graph executor receives `connectionId` via `ExecutionContext`, never raw tokens. Broker is the only component that decrypts.
- [ ] TOKENS_ENCRYPTED_AT_REST: Access/refresh tokens in `provider_credentials` encrypted with AES-256-GCM using `PROVIDER_CREDENTIAL_KEY` env var. Never stored plaintext.
- [ ] TOKENS_NEVER_LOGGED: Token values must never appear in logs, error messages, or API responses. Log `accountId` and `expiresAt` only.
- [ ] HOST_MANAGED_REFRESH: Token refresh is host-driven — broker handles it on demand (pre-execution expiry check) and reactively (app-server `chatgptAuthTokens/refresh` request on 401).
- [ ] CREDIT_CHECK_BYPASS_PRESERVED: `codex:` namespace continues to skip platform credit check (v0).
- [ ] SAME_UX_PATTERN: Profile page "Connect ChatGPT" uses the same `SettingRow` + `ConnectedBadge` pattern as GitHub/Discord/Google.
- [ ] ADAPTER_INTERNALS_CONTAINED: The choice of app-server vs subprocess is an adapter implementation detail. Product code deals only with `connectionId` and `CredentialBrokerPort`.
- [ ] ARCHITECTURE_ALIGNMENT: Follows hexagonal patterns — broker is a port+adapter, graph executor depends on port only.

### Files

#### DB Schema & Migration

- Create: `packages/db-schema/src/provider-credentials.ts` — `provider_credentials` table: `id` (text PK), `user_id` (FK → users), `provider` (text, CHECK IN ('openai-codex')), `access_token_enc` (bytea), `refresh_token_enc` (bytea), `expires_at` (timestamp), `account_id` (text), `encryption_key_id` (text), `created_at`, `updated_at`. RLS enabled. UNIQUE(user_id, provider).
- Modify: `packages/db-schema/src/index.ts` — export new table
- Create: `scripts/migrations/XXXX_add_provider_credentials.sql` — DDL + RLS policies

#### Credential Broker (Port + Adapter)

- Create: `apps/web/src/ports/credential-broker.port.ts` — `CredentialBrokerPort` interface + `ResolvedCredential` type
- Create: `apps/web/src/adapters/server/crypto/credential-cipher.ts` — AES-256-GCM encrypt/decrypt via Node.js `crypto`
- Create: `apps/web/src/adapters/server/credential-broker.adapter.ts` — Implements `CredentialBrokerPort`. Reads `provider_credentials`, decrypts, checks expiry (5min buffer), refreshes via `refreshOpenAICodexToken()`, persists refreshed tokens, returns `ResolvedCredential`.

#### OAuth Routes

- Create: `apps/web/src/app/api/v1/auth/openai-codex/authorize/route.ts` — GET. PKCE verifier/challenge, httpOnly cookie, redirect to `auth.openai.com/oauth/authorize`.
- Create: `apps/web/src/app/api/v1/auth/openai-codex/callback/route.ts` — GET. Exchange code → tokens, decrypt JWT for accountId, encrypt tokens, upsert `provider_credentials`, redirect to `/profile?linked=openai-codex`.
- Create: `apps/web/src/app/api/v1/auth/openai-codex/disconnect/route.ts` — POST. Delete `provider_credentials` row, redirect to `/profile`.

#### Codex App-Server Adapter

- Create: `apps/web/src/adapters/server/ai/codex/codex-app-server.adapter.ts` — Manages app-server lifecycle. Spawns `codex app-server --listen ws://127.0.0.1:PORT`. JSON-RPC client: `initialize`, `account/login/start` (chatgptAuthTokens), `turn/start`, handles `chatgptAuthTokens/refresh` requests from server by calling the credential broker.
- Modify: `apps/web/src/adapters/server/ai/codex/codex-graph.provider.ts` — Accept `connectionId` from `ExecutionContext`. Call `broker.resolve(connectionId)`. Use app-server adapter for execution. Falls back to v0 `codex exec` subprocess path when no connectionId (developer mode / file-backed auth).

#### Profile Page UI

- Modify: `apps/web/src/app/(app)/profile/view.tsx` — Add "AI Providers" section with ChatGPT `SettingRow`, "Connect" button / `ConnectedBadge`.
- Create: `apps/web/src/components/kit/data-display/OpenAIIcon.tsx` — OpenAI logomark SVG (same pattern as `GitHubIcon`).
- Modify: `apps/web/src/components/index.ts` — export `OpenAIIcon`

#### API: User Credentials Status

- Create: `apps/web/src/app/api/v1/users/me/ai-providers/route.ts` — GET. Returns `{ providers: [{ provider, connected, accountId, expiresAt }] }`. No tokens.

#### Tests

- Test: `tests/unit/adapters/credential-cipher.test.ts` — encrypt/decrypt roundtrip, wrong key fails
- Test: `tests/unit/adapters/credential-broker.test.ts` — resolve, refresh on expiry, null when not connected
- Test: `tests/contract/provider-credentials.test.ts` — DB schema contract
- Test: `tests/stack/byo-ai-profile-link.stack.test.ts` — full flow: OAuth → stored → connected → execution

## Validation

- [ ] User connects ChatGPT account via browser OAuth on profile page
- [ ] Tokens encrypted at rest in provider_credentials (AES-256-GCM)
- [ ] Codex graphs execute using the user's own subscription
- [ ] Token refresh works: pre-execution expiry check + reactive 401 refresh
- [ ] Multiple concurrent users with different subscriptions work
- [ ] Graph executor only sees connectionId, never raw tokens
- [ ] Disconnecting removes credentials from DB
- [ ] No tokens appear in logs or API responses
- [ ] Falls back to v0 codex exec subprocess when no connectionId (dev mode)
