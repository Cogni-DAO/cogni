---
id: agent-first-auth-spec
type: spec
title: "Agent-First Authentication & Identity"
status: draft
spec_state: proposed
trust: draft
summary: "Canonical contract for making the agent a first-class principal on /api/v1/*. Defines the AuthPrincipal type, the wrapRouteHandlerWithLogging policy surface (public | authenticated | session_only | admin), the actors table schema, the route bucket rules, the register-endpoint flow, and the quota envelope. Contract only — execution roadmap lives in proj.accounts-api-keys."
read_when: "Designing or reviewing anything that touches /api/v1/agent/*, /api/v1/chat/completions, machine-agent registration, wrapRouteHandlerWithLogging's auth parameter, or the actors table."
owner: derekg1729
created: 2026-04-14
tags: [auth, identity, agent-first, security]
implements: proj.accounts-api-keys
---

# Agent-First Authentication & Identity

## Goal

Make the agent a first-class principal on every authenticated `/api/v1/*` route. Registration is an agent self-service seam (not a human-owned factory), identity is anchored in a cryptographic credential the agent controls (not a shared static bearer), and the blast radius of an unauthenticated onboarding endpoint is bounded by per-actor quotas rather than gatekeeping the door.

## Non-Goals

- Full OIDC / device-code flow for agent onboarding. Revisit only after there is >1 external agent operator.
- Migration to a third-party workload-identity plane (SPIFFE/SPIRE). Tracked as a future option, not designed here.
- A2A / CB4A / CAAM interop wire formats. Designed-in compatibility is OK; adoption is not.
- Multi-node de-duplication of `request-identity.ts` / `session.ts` modules across `nodes/*`. Orthogonal cleanup.
- Replacing the in-house HMAC codec with `jose` JWTs unless a downstream need forces it.
- Designing the on-chain wallet/SIWE auth surface for humans. See [security-auth](./security-auth.md) and [proj.accounts-api-keys](../../work/projects/proj.accounts-api-keys.md) for the human track.

## Core Invariants

1. **ACTOR_IS_PRINCIPAL** — `actorId` is the stable, canonical principal identifier across all authenticated routes. Every authenticated request resolves to an `AuthPrincipal` whose `actorId` is non-null. Humans and agents are distinguished by `principalType`, not by two parallel ID fields in business logic.
2. **ACTOR_ID_IS_PUBLIC** — The `actorId` returned by register is a public identifier, not a secret. Proof-of-identity is a separate credential the agent controls.
3. **PRINCIPAL_NOT_SESSION_IN_HANDLERS** — Route handlers MUST NOT ask "do I have a session?"; they ask "what principal was authenticated?" Raw session access (`getServerSessionUser`, `cookies()`, `headers()`) is forbidden inside route-handler files under `**/app/api/**/route.ts`. The wrapper is the only place that reads raw credentials and constructs the `AuthPrincipal`. Enforced by lint / dep-cruiser rule.
4. **SPLIT_IDENTITY_PROOF_AUTHORIZATION** — Three concerns must not be conflated: _identity_ = who is this (`actorId`, `userId`), _proof_ = how did they prove it (session cookie, bearer, signed challenge, DPoP), _authorization_ = what can they do (`scopes`, `policyTier`, spend cap). Business logic reads identity + authorization; it never inspects proof.
5. **DECORATOR_OWNS_STRATEGY** — Route handlers declare auth **policy** as a string literal (`"public" | "authenticated" | "session_only" | "admin"`), never a resolver function. The wrapper owns proof verification and returns a fully-constructed `AuthPrincipal`. Swapping the identity backend touches one file.
6. **DEFAULT_IS_DUAL_ACCESS** — The `authenticated` policy accepts both agents and humans and is the default for `/api/v1/*`. `session_only` is the narrow, opt-in carve-out for routes that MUST reject machine identities (OAuth link flows, human profile, governance UI).
7. **CREDENTIAL_IS_HELD_BY_AGENT** — The long-lived agent secret (keypair) never leaves the agent. The platform holds only the public half and short-lived exchanged access tokens.
8. **TOKENS_ARE_SHORT_LIVED** — Access tokens on `/api/v1/*` expire in minutes under the target state. Revocation is implicit (TTL) before it is explicit (DB flag).
9. **BOUNDED_BY_QUOTA_NOT_GATE** — Registration is rate-limited and every issued actor has a hard per-actor spend + concurrency ceiling. Open enrollment is safe when the ceiling is low enough that a mass-mint attack cannot exceed the operator's pre-paid LLM budget envelope.
10. **OPTIONAL_HUMAN_LINKAGE** — A human session holder may later claim an orphan agent-actor, adding delegation rights. The agent identity exists independently of that claim. Represented as `actors.owner_user_id`, nullable.

## Design

### The `AuthPrincipal` type

Canonical handler-facing identity carrier. Replaces `SessionUser` as the only type a route handler ever receives.

```ts
// packages/node-shared/src/auth/principal.ts
export type PrincipalType = "user" | "agent" | "system";

export type AuthPolicy = "public" | "authenticated" | "session_only" | "admin";

export type AuthPrincipal = Readonly<{
  principalType: PrincipalType;
  principalId: string; // stable, canonical id — always set
  actorId: string; // canonical actor UUID — always set
  userId: string | null; // set when principalType === "user" OR a user has claimed this actor
  tenantId: string; // billing / ownership tenant
  scopes: readonly string[]; // authorization grants
  policyTier: string; // rate/cap bucket ("default" for v0)
}>;
```

Invariant notes tied to the type:

- `actorId` is always set — for agents it is the `actors.id`; for humans it is the actor row representing that user.
- `userId` is only set when a user is involved (human session, or agent-owned-by-user via `owner_user_id`).
- `scopes` is the authorization seam. Fine-grained scopes may land later; the initial vocabulary is `"user"`, `"agent"`, `"admin"`.
- Handlers read `principal.actorId`, `principal.tenantId`, `principal.principalType`, `principal.scopes`. They MUST NOT inspect how the principal was proved.

### Decorator policy surface

```ts
wrapRouteHandlerWithLogging(
  { routeId, auth: "authenticated" }, // accept user or agent — default for /api/v1/*
  async (ctx, req, principal) => { ... /* principal is AuthPrincipal, non-null */ }
)

wrapRouteHandlerWithLogging(
  { routeId, auth: "session_only" }, // narrow carve-out: OAuth, human profile, governance UI
  async (ctx, req, principal) => { ... /* principal.principalType === "user" */ }
)

wrapRouteHandlerWithLogging(
  { routeId, auth: "public" }, // no principal argument — register, health
  async (ctx, req) => { ... }
)

wrapRouteHandlerWithLogging(
  { routeId, auth: "admin" }, // authenticated + "admin" scope
  async (ctx, req, principal) => { ... }
)
```

Rules enforced by the wrapper:

- `"authenticated"` — resolves bearer OR session cookie → `AuthPrincipal`. 401 if neither.
- `"session_only"` — resolves session cookie only. Rejects bearers with 401. Returns a `user`-typed principal.
- `"public"` — handler signature has no `principal` argument. Type-level guarantee the handler cannot read identity.
- `"admin"` — `"authenticated"` plus a `"admin"` scope check. Denies with 403.
- A route that omits `auth` is a TypeScript error (no silent default).

### Route bucket rules

Every authenticated route falls into exactly one bucket by policy. The rules are the invariant; the specific route inventory at any point in time is an audit artifact owned by the implementing work item.

```
┌───────────────────────────┬────────────────┬─────────────────────────────────────┐
│ Bucket                    │ Policy         │ Rule                                │
├───────────────────────────┼────────────────┼─────────────────────────────────────┤
│ 1. Dual-access (default)  │ authenticated  │ Any request with a valid agent      │
│                           │                │ bearer OR a valid human session     │
│                           │                │ cookie is accepted. Used for all    │
│                           │                │ /api/v1/* unless another bucket     │
│                           │                │ is explicitly justified.            │
├───────────────────────────┼────────────────┼─────────────────────────────────────┤
│ 2. True human-only        │ session_only   │ The route provably cannot be        │
│                           │                │ meaningful for a machine identity   │
│                           │                │ (OAuth redirect handlers, human     │
│                           │                │ profile, external identity link     │
│                           │                │ completion). Documented reason      │
│                           │                │ required.                           │
├───────────────────────────┼────────────────┼─────────────────────────────────────┤
│ 3. Internal/admin         │ admin          │ Requires the "admin" scope.         │
│                           │                │ Governance, operator-only controls. │
├───────────────────────────┼────────────────┼─────────────────────────────────────┤
│ 4. Public seams           │ public         │ No principal. Rate-limited.         │
│                           │                │ Onboarding and health endpoints.    │
└───────────────────────────┴────────────────┴─────────────────────────────────────┘
```

### Register flow (target state)

```
Agent side                                         Platform side
───────────                                        ─────────────
generate Ed25519 keypair locally
   │
   ▼
POST /api/v1/agent/register
   { name, publicKeyJwk }                    ┌─► rate-limit per source IP
                                             │
                                             ▼
                                       mint actorId (uuid, public)
                                       store (actorId, kind='agent',
                                              publicKeyJwk, created_at,
                                              policy_tier, spend_cap_cents,
                                              concurrency_cap)
                                       attach to default tenant
                                             │
                                             ▼
                                       audit log (Pino + route_id=agent.register)
   ◄────────── 201 { actorId, tenantId, policyTier, spendCapCents } ──────────

                ─── later, on each request ───

sign challenge                             ┌─► verify signature via stored pubkey
 { actorId, ts, nonce, routeId }           │  check ts within skew window
   │                                       │  check nonce not replayed (redis set, TTL)
   ▼                                       │  check actorId not revoked
POST /api/v1/agent/token                   │  check spend / concurrency headroom
   { actorId, signedChallenge }    ────────┘
                                             │
                                             ▼
                                       mint short-lived access token
                                       (sub=actorId, ttl=5min,
                                        aud=operator-node, cnf=pubkeyThumb)
   ◄────────── 200 { accessToken, expiresAt } ──────────

Authorization: Bearer <accessToken>        ┌─► wrapper resolves token
                                           │  validates sig + exp + cnf
GET /api/v1/ai/runs                 ───────┘  constructs AuthPrincipal{ actorId, … }
```

Target-state contract properties:

- **`actorId` is public.** Returned in plaintext on register. Not a secret. Cannot be stolen in a way that grants access because access requires a signature from the held private key.
- **No `users` row is created for an agent.** The `actors` table holds the agent identity with `kind='agent'`.
- **No new `billing_account` per agent by default.** Agents attach to a default tenant on register; tenancy design is orthogonal.
- **Revocation is a DB field.** `revoked_at` on the actor row flips all future token exchanges to 401. Short-lived access tokens bound the window of a stolen token to the TTL, not 30 days.
- **`AUTH_SECRET` rotation is not the only kill switch.** Per-actor revocation exists.

### `actors` table schema

```sql
CREATE TABLE actors (
  id                      UUID PRIMARY KEY,             -- actorId (public)
  kind                    TEXT NOT NULL CHECK (kind IN ('agent','user','system','org')),
  display_name            TEXT,
  public_key_jwk          JSONB,                         -- agent kind only; null otherwise
  owner_user_id           UUID REFERENCES users(id),    -- set when a human claims an agent
  tenant_id               UUID NOT NULL,
  policy_tier             TEXT NOT NULL DEFAULT 'default',
  spend_cap_cents_per_day INTEGER NOT NULL,
  concurrency_cap         INTEGER NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at              TIMESTAMPTZ
);

CREATE UNIQUE INDEX actors_pubkey_thumb_idx
  ON actors ((public_key_jwk->>'thumbprint'))
  WHERE kind = 'agent';
```

Backfill: every existing `users` row gets one `actors` row with `id = users.id`, `kind='user'`, default policy tier. This preserves the runtime cast (`userActor(toUserId(userId))`) during the transition and keeps `actorId` = `userId` for the already-existing principals.

### Rate limit + quota envelope

These are the absolute rules; specific numbers are set per-deploy by operator config.

- `/api/v1/agent/register` is rate-limited per source IP (bucket backed by the existing `ioredis` client). Over-cap → `429 Retry-After`.
- Every `actors` row has a `spend_cap_cents_per_day` enforced in the LLM dispatch path before any provider call. Exceeding → `402` with a structured error shape.
- Every `actors` row has a `concurrency_cap` limiting in-flight graph runs. Exceeding → `429`.
- Register attempts (success + fail), token exchanges, and revocations emit structured Pino audit entries with `route_id`, source IP, and outcome.

### Contract — current state

`packages/node-contracts/src/agent.register.v1.contract.ts`

```
input:  { name }
output: { userId, apiKey, billingAccountId }
```

`wrapRouteHandlerWithLogging` (operator + multi-node):

```
auth: { mode: "required" | "optional" | "none", getSessionUser: () => SessionUser | null }
handler receives: SessionUser (mode=required) or SessionUser | null (mode=optional|none)
```

### Contract — target state

`packages/node-shared/src/auth/principal.ts`

```
export type AuthPrincipal = Readonly<{ principalType; principalId; actorId;
                                       userId; tenantId; scopes; policyTier }>
export type AuthPolicy    = "public" | "authenticated" | "session_only" | "admin"
```

`packages/node-contracts/src/agent.register.v1.contract.ts`

```
input:  { name }
output: { actorId, tenantId, policyTier, spendCapCents, apiKey }
        // apiKey's claims encode actorId.
```

`packages/node-contracts/src/agent.register.v2.contract.ts` (target — replaces v1 when proof-of-possession ships)

```
input:  { name, publicKeyJwk: JsonWebKey }
output: { actorId, tenantId, policyTier, spendCapCents }
        // no apiKey — access via /agent/token proof exchange
```

`packages/node-contracts/src/agent.token.v1.contract.ts` (target — new)

```
input:  { actorId, signedChallenge: { ts, nonce, routeId, sig } }
output: { accessToken, expiresAt }
```

`wrapRouteHandlerWithLogging`

```
auth: "public" | "authenticated" | "session_only" | "admin"
handler receives: undefined ("public") or AuthPrincipal (all others, non-null)
```

## Acceptance Checks

**Automated** (any implementation of this spec must satisfy):

- Type check: no code outside `packages/node-shared/src/auth/` defines `AuthPrincipal`, `AuthPolicy`, or a parallel shape.
- Lint: no file under `nodes/*/app/src/app/api/**/route.ts` imports `getServerSessionUser`, `cookies`, or `headers`.
- Contract: `agent.register.v1.contract.ts` output includes `actorId` as the first field; no `userId` field.
- DB: `actors` table exists; every row in `users` has a matching `actors` row; `kind IN ('agent','user','system','org')`; `CHECK` constraint active.
- Wrapper test: `"session_only"` with a bearer token in the request → 401; `"authenticated"` with a valid bearer → `AuthPrincipal` with `principalType='agent'`; `"admin"` without `admin` scope → 403.

**Manual** (operator-facing):

- Load test `/api/v1/agent/register` at 1000 POST/min from one source IP: buckets trip `429`, `actors` row count stays bounded.
- Raise a single actor's `spend_cap_cents_per_day` to a tiny value; two consecutive `/chat/completions` calls → second returns `402`.
- Revoke an `actors` row mid-session; subsequent token exchanges return 401; Pino audit log shows revocation event.

## Related

- [proj.accounts-api-keys](../../work/projects/proj.accounts-api-keys.md) — parent project. Owns the roadmap, phase deliverables, and work-item decomposition for the agent-first auth track.
- [bug.0297 — Agent register open factory](../../work/items/bug.0297.agent-register-open-account-factory.md) — the security hole that triggered this spec. Remediation direction (bounded-by-quota) is defined here; tracking and phasing lives in the project.
- [security-auth](./security-auth.md) — human session + app-api-keys model. Orthogonal on the human track; superseded on the programmatic side by this spec.
- [identity-model](./identity-model.md) — defines the `actorId` primitive abstractly; this spec is the first concrete schema for `kind='agent'`.
- [agent-api-validation](../guides/agent-api-validation.md) — operator-facing validation guide. Kept in sync with the current-state contract above.

## Open Questions

1. **`ProofVerifier` port shape.** Whether proof verification factors out to a pluggable port or stays inline in `wrapRouteHandlerWithLogging`. Preference: inline for the HMAC bearer path (one implementation today), extract to a port only when a second proof backend lands.
2. **Public-key store.** Whether public keys live only in the `actors` table or also in a key/value cache. Preference: table only; public keys are not secrets; DB is durable; Redis is for nonces.
3. **Default `spendCapCents_per_day`.** Must be set from the operator's pre-paid LLM budget envelope. Not a spec constant.
4. **Tenant attachment on register.** One default tenant per node vs. accepting a `tenantKey` hint from a trusted internal caller. Default: one tenant.
5. **Claim flow for human linkage.** Who mints the claim, and whether it requires a SIWE signature from the claiming user. Defer to the claim-flow design.
6. **`SessionUser` retention window.** Whether `SessionUser` stays as a one-release type alias or is deleted immediately. Prefer one-release alias to reduce merge conflicts.
