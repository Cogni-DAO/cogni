---
id: task.0192
type: task
title: "Walk: Per-tenant BYO-AI — Profile page OAuth + DrizzleConnectionBroker"
status: needs_implement
priority: 2
rank: 15
estimate: 3
summary: "Profile page 'Connect ChatGPT' button runs OAuth PKCE redirect flow. Tokens encrypted and stored in connections table. DrizzleConnectionBrokerAdapter wired in container. Replaces LocalConnectionBrokerAdapter and seed script."
outcome: "User clicks 'Connect ChatGPT' on profile page, authenticates at OpenAI, connection stored in DB. ChatGPT toggle in model picker auto-detects the connection. No seed script needed."
spec_refs: [spec.tenant-connections]
assignees: [derekg1729]
credit:
project: proj.byo-ai
branch: feat/byo-ai-per-tenant
pr: https://github.com/Cogni-DAO/node-template/pull/612
reviewer:
created: 2026-03-23
updated: 2026-03-26
labels: [ai, oauth, byo-ai, multi-tenant]
external_refs:
  - docs/research/openai-oauth-byo-ai.md
revision: 6
blocked_by: []
deploy_verified: false
---

## Design

### Outcome

User clicks "Connect ChatGPT" on the profile page, authenticates at OpenAI via standard OAuth PKCE redirect, and their tokens are encrypted and stored in the connections table. The ChatGPT toggle in the model picker auto-detects the connection. No CLI seed script required.

### Pre-Implementation Gate

**Redirect URI test**: The public Codex client ID (`app_EMoamEEZ73f0CkXaXp7hrann`) uses `redirect_uri=http://localhost:1455/auth/callback`. We need to test if it accepts a web callback URL like `https://<our-domain>/api/v1/auth/openai-codex/callback`. If rejected, fall back to Device Code flow (RFC 8628) or use `postMessage` relay from a localhost popup.

**30-minute spike before implementation**: Write a script that attempts the authorize URL with a non-localhost redirect_uri and reports success/failure.

### Approach

**Solution**: Standard OAuth 2.0 Authorization Code + PKCE flow implemented as two Next.js API routes. No `@mariozechner/pi-ai` dependency for the web flow — it's a CLI library. We implement PKCE directly using `node:crypto` (5 lines of code).

**Flow**:

1. User clicks "Connect ChatGPT" on profile → POST `/api/v1/auth/openai-codex/authorize`
2. Server generates PKCE verifier + challenge, stores verifier in a signed cookie (same pattern as our `link_intent` cookie)
3. Server returns redirect URL to `auth.openai.com/oauth/authorize`
4. Client redirects browser to OpenAI
5. User authenticates at OpenAI, grants consent
6. OpenAI redirects to `/api/v1/auth/openai-codex/callback?code=...&state=...`
7. Server validates state, exchanges code + verifier for tokens via POST to `auth.openai.com/oauth/token`
8. Server extracts `chatgpt_account_id` from JWT claims
9. Server AEAD-encrypts tokens, inserts into connections table
10. Redirects to `/profile?linked=chatgpt`

**Disconnect**: POST `/api/v1/auth/openai-codex/disconnect` — soft-deletes the connection (sets `revoked_at`).

**Container wiring**: Replace `LocalConnectionBrokerAdapter` with `DrizzleConnectionBrokerAdapter` when `CONNECTIONS_ENCRYPTION_KEY` is set. The local adapter stays as fallback for dev without DB.

**Reuses**:

- `connections` table + schema (already exists, already migrated)
- `DrizzleConnectionBrokerAdapter` (already built, just not wired)
- AEAD encrypt/decrypt (`shared/crypto/aead.ts`, already built + tested)
- Profile page `SettingRow` + `ConnectedBadge` pattern (identical to GitHub/Discord/Google rows)
- Link intent cookie pattern from `api/auth/link/[provider]` (signed JWT cookie for CSRF protection)
- Chat page connection detection query (already built)
- Model picker ChatGPT toggle (already built)

**Rejected**:

- `@mariozechner/pi-ai/oauth` for web flow — CLI library, spawns localhost HTTP server. Wrong tool.
- NextAuth provider — ChatGPT OAuth is credential storage, not identity. Mixing them is architecturally wrong.
- Device Code flow — more complex UX (poll + manual code entry). Only needed if redirect URI is rejected.

### Invariants

- [ ] ENCRYPTED_AT_REST: Tokens stored via AEAD with AAD binding `{billing_account_id, connection_id, provider}` (spec: spec.tenant-connections invariant 4)
- [ ] TENANT_SCOPED: Connection belongs to the authenticated user's billing account (spec: spec.tenant-connections invariant 3)
- [ ] TOKENS_NEVER_LOGGED: No tokens in logs, errors, or responses
- [ ] PKCE_REQUIRED: Authorization code exchange uses PKCE verifier (no client secret)
- [ ] STATE_VALIDATED: OAuth state parameter validated to prevent CSRF
- [ ] COOKIE_SIGNED: PKCE verifier stored in signed, HttpOnly, short-TTL cookie (same as link_intent pattern)
- [ ] SOFT_DELETE: Disconnect sets `revoked_at`, never hard-deletes

### Files

#### OAuth routes

- Create: `apps/operator/src/app/api/v1/auth/openai-codex/authorize/route.ts` — generates PKCE, sets cookie, returns redirect URL
- Create: `apps/operator/src/app/api/v1/auth/openai-codex/callback/route.ts` — exchanges code, encrypts tokens, inserts connection, redirects to profile
- Create: `apps/operator/src/app/api/v1/auth/openai-codex/disconnect/route.ts` — soft-deletes connection

#### Profile page

- Modify: `apps/operator/src/app/(app)/profile/view.tsx` — add "AI Providers" section with ChatGPT SettingRow

#### Container wiring

- Modify: `apps/operator/src/bootstrap/container.ts` — wire `DrizzleConnectionBrokerAdapter` when `CONNECTIONS_ENCRYPTION_KEY` set, keep `LocalConnectionBrokerAdapter` as fallback
- Modify: `apps/operator/src/bootstrap/graph-executor.factory.ts` — pass `container.connectionBroker` (already does this)

#### Chat page (already done)

- No changes needed — `page.tsx` already queries connections table, `view.tsx` already passes `chatGptConnectionId` to `ChatComposerExtras`

#### Cleanup

- Deprecate: `scripts/dev/codex-seed-connection.mts` — no longer primary path, keep as dev fallback

#### Tests

- Test: `tests/unit/auth/openai-codex-oauth.test.ts` — PKCE generation, state validation, token exchange mock
- Test: `tests/unit/shared/crypto/aead.test.ts` — already exists, already passing

## Validation

- [ ] User clicks "Connect ChatGPT" on profile → redirected to OpenAI
- [ ] After OpenAI auth, redirected back to profile with success message
- [ ] Connection visible in profile page as "Connected" badge
- [ ] ChatGPT toggle appears in model picker
- [ ] Graph executes via ChatGPT subscription
- [ ] "Disconnect" soft-deletes connection, toggle disappears
- [ ] No tokens in logs or API responses
- [ ] PKCE verifier not reusable (cookie consumed on callback)
