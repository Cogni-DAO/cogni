---
id: task.0300
type: task
title: "API Key Auth — Dual-Mode Bearer + Session on Completions"
status: needs_implement
priority: 1
rank: 1
estimate: 2
summary: "Add app_api_keys table and dual-mode auth (session OR Bearer key) on /api/v1/chat/completions. Keys bind to user_id → billing_account_id. Enables agents, CLI tools, and external callers to use completions without browser sessions."
outcome: "curl -H 'Authorization: Bearer sk_live_...' POST /api/v1/chat/completions works. Keys created via session-authenticated endpoint. Charges attributed to key owner's billing account."
initiative: proj.agentic-interop
assignees: [derekg1729]
labels: [identity, auth, api, agents, interop]
branch: worktree-task-agent-api-keys
pr:
reviewer:
created: 2026-04-06
updated: 2026-04-06
---

# API Key Auth — Dual-Mode Bearer + Session on Completions

> Project: [proj.agentic-interop](../../work/projects/proj.agentic-interop.md) P0.0
> Accelerates: [proj.accounts-api-keys](../../work/projects/proj.accounts-api-keys.md) P3
> Identity model: [docs/spec/identity-model.md](../../docs/spec/identity-model.md)
> Accounts spec: [docs/spec/accounts-design.md](../../docs/spec/accounts-design.md)

## Problem

All `/api/v1/` routes require `getSessionUser()` — a NextAuth server-side session cookie. External agents, CLI tools, cron jobs, and other nodes cannot call the completions endpoint.

## Design

### Outcome

External callers (agents, CLI tools, curl) can call `POST /api/v1/chat/completions` with `Authorization: Bearer <key>` and get the same behavior as a browser session user — same billing, same graphs, same rate limits.

### Approach

**Solution**: Add `app_api_keys` table (as planned in proj.accounts-api-keys P3), add dual-mode auth resolution to the completions route. Keys bind to `user_id` → resolved to `billing_account_id` via existing `getOrCreateBillingAccountForUser()`. No new billing pipeline, no new identity primitives.

**Reuses**:
- `extractBearerToken()` + `safeCompare()` from `api/internal/graphs/[graphId]/runs/route.ts` (lines 72-96) — extract to shared utility
- `getOrCreateBillingAccountForUser()` from AccountService — already resolves user → billing account
- `wrapRouteHandlerWithLogging` auth modes pattern — add `"dual"` mode
- `SessionUser` interface from `packages/node-shared` — API key resolution returns same shape
- `virtual_keys` table already exists with `billingAccountId` FK — no new billing plumbing

**Rejected**:
- ~~actor_id FK~~ — actors table doesn't exist. Over-designs for future identity model. Bind to `user_id` (what exists), upgrade to `actor_id` when that table lands.
- ~~argon2id hashing~~ — adds a native dependency. SHA-256 is sufficient for API key verification (keys are high-entropy random tokens, not passwords). LiteLLM and OpenRouter both use SHA-256 for key hashing.
- ~~New rate limit system~~ — OpenRouter already rate-limits free models globally. Per-key RPM is premature. Use billing account credit check as the existing throttle.
- ~~Agent self-provisioning / scope delegation~~ — P3+ concern per proj.accounts-api-keys. P0 = user creates keys via session-authenticated endpoint.
- ~~Separate api_keys package~~ — single table + one adapter function. Shared package boundary not warranted until AccountService port absorbs key management.

### Schema: `app_api_keys` table

Per proj.accounts-api-keys P3 plan (lines 190-193), adapted for immediate use:

```sql
CREATE TABLE app_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash      TEXT NOT NULL,           -- SHA-256 hex digest
  key_prefix    TEXT NOT NULL,           -- first 8 chars for identification
  label         TEXT NOT NULL DEFAULT 'Default',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ
);

-- RLS: user can only see/manage own keys
-- Index on key_hash for fast lookup
CREATE INDEX idx_app_api_keys_hash ON app_api_keys(key_hash) WHERE active = true AND revoked_at IS NULL;
```

**Key format**: `sk_live_<32 random hex chars>` (64 chars total)
- `sk_live_` prefix identifies it as a Cogni app key in logs/debugging
- 32 hex chars = 128 bits of entropy (sufficient for API key)

**No billing_account_id column** — resolved at auth time via `getOrCreateBillingAccountForUser(userId)`, same as session auth. Keeps one source of truth for user→billing mapping.

### Auth Resolution: Dual-Mode

```
POST /api/v1/chat/completions
  Authorization: Bearer sk_live_abc123...
  │
  ├─ 1. Check Authorization header
  │    extractBearerToken(header)  ← reuse from internal route
  │    if token starts with "sk_live_":
  │      hash = sha256(token)
  │      row = SELECT user_id FROM app_api_keys WHERE key_hash = hash AND active AND revoked_at IS NULL
  │      if row → return SessionUser { id: row.user_id, walletAddress: null, displayName: null, avatarColor: null }
  │
  ├─ 2. Fallback: existing getSessionUser()
  │    if session → return SessionUser (unchanged)
  │
  └─ 3. Neither → 401
```

The completion facade receives the same `SessionUser` type regardless of auth method. **Zero changes to facade, billing, or graph execution.**

### Integration Point: `wrapRouteHandlerWithLogging`

Add a new auth mode `"dual"` that tries Bearer key first, falls back to session:

```typescript
// New option:
auth: {
  mode: "dual",
  getSessionUser,           // existing session resolver
  resolveApiKey,            // new: (token: string) => Promise<SessionUser | null>
}
```

Only the completions route uses `"dual"` initially. All other routes stay `"required"` (session-only) unchanged.

### API Endpoints

**Create key** (session-authenticated):
```
POST /api/v1/auth/api-keys
  Cookie: next-auth session
  Body: { label?: string }
  Response: { id: UUID, key: "sk_live_...", keyPrefix: "sk_live_a", label: string, createdAt: string }
  ⚠️ key returned ONCE — plaintext not stored
```

**List keys** (session-authenticated):
```
GET /api/v1/auth/api-keys
  Cookie: next-auth session
  Response: { keys: [{ id, keyPrefix, label, active, createdAt, revokedAt }] }
```

**Revoke key** (session-authenticated):
```
DELETE /api/v1/auth/api-keys/:id
  Cookie: next-auth session
  Response: { ok: true }
  Sets revoked_at = NOW(), active = false
```

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] NO_PLAINTEXT_SECRETS: key_hash stored, plaintext returned once at creation (spec: accounts-design)
- [ ] NO_CLIENT_LITELLM_KEYS: app keys never reach browser storage or logs (spec: accounts-design)
- [ ] ONE_USER_ONE_BILLING_ACCOUNT: key → user_id → billing_account via existing resolution (spec: accounts-design)
- [ ] CUSTOMER_DATA_UNDER_CUSTOMER_ACCOUNT: RLS on app_api_keys by user_id (spec: accounts-design)
- [ ] ZERO_FACADE_CHANGES: completion facade, billing pipeline, graph execution unchanged
- [ ] SESSION_AUTH_UNBROKEN: existing session auth on all routes works identically
- [ ] CONSTANT_TIME_COMPARISON: key hash comparison uses timingSafeEqual (reuse safeCompare)

### Files

**Create:**
- `packages/db-schema/src/api-keys.ts` — Drizzle schema for `app_api_keys`
- `packages/db-schema/drizzle/migrations/XXXX_app_api_keys.sql` — migration
- `nodes/node-template/app/src/bootstrap/http/resolve-api-key.ts` — Bearer → SessionUser resolver (uses extractBearerToken + DB lookup)
- `nodes/node-template/app/src/app/api/v1/auth/api-keys/route.ts` — CRUD endpoints (POST, GET)
- `nodes/node-template/app/src/app/api/v1/auth/api-keys/[id]/route.ts` — DELETE (revoke)

**Modify:**
- `nodes/node-template/app/src/bootstrap/http/wrapRouteHandlerWithLogging.ts` — add `"dual"` auth mode
- `nodes/node-template/app/src/app/api/v1/chat/completions/route.ts` — switch from `auth: "required"` to `auth: "dual"`
- `packages/db-schema/src/index.ts` — export new schema

**Extract (from internal route → shared):**
- `extractBearerToken()` and `safeCompare()` from `api/internal/graphs/[graphId]/runs/route.ts` → `packages/node-shared/src/auth/bearer.ts`

**Test:**
- `nodes/operator/app/tests/contract/auth.api-keys.v1.contract.test.ts` — CRUD + key verification
- `nodes/operator/app/tests/stack/ai/completions-api-key.stack.test.ts` — full round-trip: create key → Bearer auth → completion → charge_receipt

### Upgrade Path

When `actors` table lands (identity-model.md):
- Add `actor_id` column to `app_api_keys` (nullable FK)
- Key creation resolves `user_id → actor_id` (kind=user)
- Agent actors (kind=agent) get keys via parent user's session
- No schema break — `user_id` stays as the stable FK

## Dependencies

- **users + billing_accounts tables** — exist on canary ✅
- **virtual_keys table** — exists, used for billing attribution ✅
- **wrapRouteHandlerWithLogging** — exists, needs dual mode addition
- **extractBearerToken / safeCompare** — exist in internal route, need extraction

## Test Plan

1. **Contract:** Create key → verify hash stored, plaintext NOT stored
2. **Contract:** List keys → returns prefix only, not hash or plaintext
3. **Contract:** Revoke key → sets revoked_at, active=false
4. **Contract:** Bearer auth with valid key → resolves to correct user_id
5. **Contract:** Bearer auth with revoked key → 401
6. **Contract:** Bearer auth with invalid key → 401
7. **Contract:** Session auth still works on completions (no regression)
8. **Stack:** Create key via session → use key for Bearer completion → verify charge_receipt.billingAccountId matches user's account

## Security

- SHA-256 for key hashing (high-entropy tokens, not passwords — argon2id unnecessary)
- Constant-time hash comparison via `timingSafeEqual`
- Plaintext shown once at creation, never stored or logged
- `key_prefix` (first 8 chars) stored for identification in UI/logs
- RLS enforces user can only see/manage own keys
- Max auth header length: 512 bytes (reuse from internal route)
- Max token length: 256 bytes (reuse from internal route)

## Validation

- [ ] `pnpm check:fast` passes
- [ ] Contract tests for key CRUD + Bearer auth resolution
- [ ] Stack test: create key → Bearer completion → charge_receipt attributed to correct billing account
- [ ] Session auth on completions works identically (no regression)
- [ ] Revoked/invalid keys return 401
