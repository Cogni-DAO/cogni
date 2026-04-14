---
id: task.0312
type: task
title: "Agent-first auth contract lock — AuthPrincipal + wrapper refactor + actors table"
status: needs_implement
priority: 1
rank: 5
estimate: 5
assignees: [derekg1729]
created: 2026-04-14
updated: 2026-04-14
project: proj.accounts-api-keys
branch: design/agent-first-auth
spec_refs: [agent-first-auth]
blocked_by:
labels: [auth, identity, agent-first, security]
summary: "Lock the auth contract before hardening the proof. A1+A2 deliverables of the proj.accounts-api-keys agent-first auth track: introduce a canonical AuthPrincipal type, refactor wrapRouteHandlerWithLogging to accept policy strings (public | authenticated | session_only | admin), ship the actors table with minimal fields, and flip /api/v1/agent/register to return { actorId, tenantId, policyTier, spendCapCents, apiKey } — where apiKey's claims encode actorId. Adds IP rate limit + per-actor spend cap. Downgrades bug.0297 from critical to medium without waiting for the proof-of-possession follow-up (A3)."
outcome: "Every authenticated /api/v1/* route receives a typed AuthPrincipal from the wrapper; raw session access is forbidden in route handlers (lint-enforced); the actors table exists with an agent-kind row per registered agent; bug.0297 is no longer preview-blocking because registration is rate-limited and each actor has a hard spend ceiling."
---

# task.0312 — Agent-first auth contract lock

## Context

Post PR #845, the agent-first API lane works end-to-end, but the identity story is wrong in three ways:

1. **Principal model is ambiguous.** Routes receive a `SessionUser` that was built either from a cookie or a bearer, and business logic cannot tell which (nor should it need to — but today it _can_, because the wrapper exposes `getSessionUser` as a function-valued parameter that varies per route). There is no canonical "who is acting" type.
2. **`actorId` is fictional.** The spec in [identity-model.md](../../docs/spec/identity-model.md) names `actor_id` as a primitive, but in code it's a runtime cast over `userId`. No schema backs it. `register` returned `userId` until PR #845 deleted the redundant field, but even now the agent is represented as a row in `users` with no `kind` discriminator.
3. **Register is an open account factory (bug.0297).** No rate limit, no per-actor spend cap, returns a 30-day static bearer. The spec [agent-first-auth.md](../../docs/spec/agent-first-auth.md) defines the full target contract; this task implements the A1 + A2 deliverables from the project's Agent-First Auth Track — the contract lock that must land before the proof-of-possession follow-up (A3).

The external review that drove this design direction: **"Empower actorId now. Do not wait for full crypto-perfect agent auth before making identity first-class. Ship the contract first — AuthPrincipal + wrapper + actors table — then harden the proof immediately after."**

Spec: [agent-first-auth.md](../../docs/spec/agent-first-auth.md) — source of truth for invariants, contracts, `AuthPrincipal` shape, and `actors` schema.

Project track: [proj.accounts-api-keys § Agent-First Auth Track](../projects/proj.accounts-api-keys.md) — this task is the A1 + A2 deliverables of that track.

## Design

### Outcome

Every authenticated `/api/v1/*` route receives a typed `AuthPrincipal` whose `actorId` is the canonical, stable identifier for the acting party — regardless of whether the request came in on a session cookie or a bearer token. Raw session access is forbidden in route handlers. `bug.0297` stops being a preview-flight blocker because open registration is rate-limited and hard-capped per-actor.

### Approach

**Solution**: Three coupled changes in one atomic PR (they are each other's prerequisites):

1. **`AuthPrincipal` type** in `packages/node-shared/src/auth/principal.ts`:

   ```ts
   type PrincipalType = "user" | "agent" | "system";
   type AuthPrincipal = Readonly<{
     principalType: PrincipalType;
     principalId: string;
     actorId: string;
     userId: string | null;
     tenantId: string;
     scopes: readonly string[];
     policyTier: string;
   }>;
   type AuthPolicy = "public" | "authenticated" | "session_only" | "admin";
   ```

2. **`wrapRouteHandlerWithLogging` refactor** — the `auth` field becomes a string:

   ```ts
   wrapRouteHandlerWithLogging(
     { routeId, auth: "authenticated" },
     async (ctx, req, principal) => {
       /* principal: AuthPrincipal */
     }
   );
   ```

   The wrapper owns resolution: `"authenticated"` accepts bearer or session, `"session_only"` rejects bearers, `"public"` has no principal argument, `"admin"` requires the `"admin"` scope. The wrapper constructs the `AuthPrincipal` and is the ONLY place the raw credential is read.

3. **`actors` table** — new migration, minimal fields per the spec:

   ```sql
   CREATE TABLE actors (
     id             UUID PRIMARY KEY,
     kind           TEXT NOT NULL CHECK (kind IN ('agent','user','system','org')),
     display_name   TEXT,
     public_key_jwk JSONB,                      -- nullable until A3 introduces proof-of-possession
     owner_user_id  UUID REFERENCES users(id),  -- nullable; set when a human claims an agent
     tenant_id      UUID NOT NULL,
     policy_tier    TEXT NOT NULL DEFAULT 'default',
     spend_cap_cents_per_day INTEGER NOT NULL,
     concurrency_cap         INTEGER NOT NULL,
     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
     revoked_at     TIMESTAMPTZ
   );
   ```

   Backfill: on migration, insert one `actors` row per existing `users` row with `kind='user'`, `id = users.id`, default policy tier. This keeps the runtime cast (`userActor(toUserId(userId))`) valid during the transition.

**Plus, in the same PR (because it's cheap once the wrapper is refactored)**:

- **Register rewrite**: on POST, create an `actors` row with `kind='agent'`, `owner_user_id=null`, default tenant + policy tier. Return `{ actorId, tenantId, policyTier, spendCapCents, apiKey }`. The `apiKey` is still issued (no proof-of-possession yet — A3 will remove it) but its claims encode `actorId`, and TTL drops from 30 days to 24 hours.
- **Register IP rate limit**: 5 req/min and 100 req/hour per source IP, backed by existing `ioredis` client. 429 with `Retry-After` on over-cap.
- **Per-actor spend cap enforcement**: the LLM dispatch path (`chat/completions` + `ai/chat`) reads `principal.policyTier` → looks up `actors.spend_cap_cents_per_day` → denies with `402` when the day's accumulated spend exceeds the cap. Reuses existing `InsufficientCreditsError` plumbing as a type seam.
- **Route audit**: every route currently using `@/app/_lib/auth/session` becomes `auth: "authenticated"`. Every route currently using `@/lib/auth/server` becomes `"session_only"` or `"admin"` per the 3-bucket audit in the spec. `v1/activity` moves from session-only to `"authenticated"`.
- **Lint enforcement**: ESLint rule (or depcruiser forbidden dep) banning imports of `getServerSessionUser`, `cookies`, `headers` inside files under `src/app/api/**/route.ts`. The ONLY path to identity is the `principal` argument from the wrapper.
- **Delete dead code**: after all routes migrate, delete `@/app/_lib/auth/session.ts` and `@/app/_lib/auth/request-identity.ts`'s legacy exports. Keep `SessionUser` as a one-release type alias for in-flight branches.

**Reuses**:

- `wrapRouteHandlerWithLogging` — existing decorator; already parameterized, just with the wrong shape.
- `resolveRequestIdentity` — existing bearer-or-session resolver; becomes the `"authenticated"` branch implementation.
- `serviceAccountService.getOrCreateBillingAccountForUser` — existing tenant attachment; rename to `getOrCreateTenantForActor` or alias.
- `ioredis` client — existing, reuse for rate limit buckets.
- `issueAgentApiKey` — existing HMAC issuer; update claims to encode `actorId` instead of `userId`, bump TTL ceiling.
- Drizzle migration infra — standard pattern, no new tooling.
- Pino envelope — existing audit log primitive.

**Rejected alternatives**:

- **Ship AuthPrincipal first, actors table in a follow-up PR.** Rejected: the principal type is degenerate without a real `actorId` source. Either the runtime cast (`userActor(toUserId(userId))`) stays visible to handlers (defeats the abstraction) or `actorId` is a fake value (defeats the contract). Lands as one atomic change.
- **Jump straight to proof-of-possession (A3) and skip the contract lock.** Rejected per the external review: "Waiting to 'do auth later' is the mistake." Locking the contract now makes A3 a single-file backend swap. Skipping the contract lock leaves the principal model ambiguous for however long A3 takes.
- **Keep `getSessionUser` as a function parameter on the wrapper (current shape).** Rejected: the dual-access default has to be maintained by discipline across N route files, and a route that forgets the agent-capable import silently becomes session-only. The failure mode is invisible.
- **Put `AuthPrincipal` in a node-local module instead of `packages/node-shared`.** Rejected per boundary placement: >1 runtime (operator, node-template, poly, resy) needs the same shape; it's a pure domain type; vendor containment shields routes from auth backend churn. Shared package is the right home.
- **Invitation-token gating for register (bug.0297's original remediation).** Rejected: requires an admin UI and a minting flow before the main fix lands. Quota-based bounding (rate limit + per-actor cap) achieves the same safety envelope with no UI surface.
- **Rename `actorId` to `agentId`.** Rejected: `agentId` is too narrow. Future principals (system, service, delegated runner, webhook) are actors but not agents. Stable core noun stays broad; product-surface language can still call them "agents."

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] ACTOR_IS_PRINCIPAL: every authenticated request resolves to an `AuthPrincipal` with a non-null `actorId` (spec: agent-first-auth).
- [ ] ACTOR_ID_IS_PUBLIC: `actorId` is returned in plaintext by register; no codepath treats it as a secret (spec: agent-first-auth).
- [ ] PRINCIPAL_NOT_SESSION_IN_HANDLERS: route handlers never import `getServerSessionUser`, `cookies()`, or `headers()`. Enforced by lint. The wrapper is the only reader of raw credentials (spec: agent-first-auth).
- [ ] SPLIT_IDENTITY_PROOF_AUTHORIZATION: business logic reads `principal.actorId`, `principal.tenantId`, `principal.scopes` — never how the principal was proved (spec: agent-first-auth).
- [ ] DECORATOR_OWNS_STRATEGY: routes declare `auth: "public" | "authenticated" | "session_only" | "admin"`; a route that omits `auth` is a TypeScript error (spec: agent-first-auth).
- [ ] DEFAULT_IS_DUAL_ACCESS: `"authenticated"` accepts both bearer and session. `"session_only"` is the narrow carve-out, not the default (spec: agent-first-auth).
- [ ] BOUNDED_BY_QUOTA_NOT_GATE: register is rate-limited per source IP and every actor has a per-day spend cap enforced before LLM dispatch (spec: agent-first-auth).
- [ ] CONTRACTS_FIRST: `packages/node-shared/src/auth/principal.ts` and updated `agent.register.v1.contract.ts` are the source of truth; no parallel type definitions anywhere (spec: architecture, per root AGENTS.md §"API Contracts are the Single Source of Truth").
- [ ] HEXAGONAL_ALIGNMENT: `AuthPrincipal` is a domain type; proof verification is an adapter concern; the wrapper is runtime wiring in `bootstrap/http`. No business logic leaks into the wrapper (spec: architecture).
- [ ] SIMPLE_SOLUTION: reuses `wrapRouteHandlerWithLogging`, `resolveRequestIdentity`, `issueAgentApiKey`, `ioredis`, Drizzle, Pino envelope — no new dependencies (spec: this design).

### Files

<!-- High-level scope — actual paths finalized during /implement -->

**Create**:

- `packages/node-shared/src/auth/principal.ts` — canonical `AuthPrincipal` and `AuthPolicy` types
- `packages/node-shared/src/auth/index.ts` — re-exports
- `packages/db-schema/src/identity.ts` — extend to add `actors` table
- `nodes/operator/app/drizzle/migrations/NNNN_actors_table.sql` — new migration + backfill
- `nodes/operator/app/src/app/_lib/auth/resolveAuthPrincipal.ts` — unified resolver returning `AuthPrincipal`
- `nodes/operator/app/src/bootstrap/http/rateLimit.ts` — IP rate-limit helper (if not already factored out)
- `nodes/operator/app/src/features/accounts/public/spendCapCheck.ts` — per-actor daily cap enforcement
- `tests/stack/api/agent-first-auth.stack.test.ts` — principal-shape + bucket-routing + rate-limit + cap tests

**Modify**:

- `nodes/operator/app/src/bootstrap/http/wrapRouteHandlerWithLogging.ts` — swap `auth` to policy string union, return `AuthPrincipal`, enforce all four policies
- `nodes/operator/app/src/app/api/v1/**/route.ts` — ALL files: remove `getSessionUser` imports, declare `auth: "…"`, update handler signature
- `nodes/operator/app/src/app/api/v1/agent/register/route.ts` — rewrite to create `actors` row + rate limit + return `{ actorId, tenantId, policyTier, spendCapCents, apiKey }`
- `packages/node-contracts/src/agent.register.v1.contract.ts` — output shape update
- `nodes/operator/app/src/app/_lib/auth/request-identity.ts` — update `issueAgentApiKey` claims to encode `actorId`, drop 30d TTL to 24h
- `nodes/node-template/app/src/...` — same treatment (multi-node parity)
- `nodes/poly/app/src/...` — same
- `nodes/resy/app/src/...` — same
- `eslint.config.mjs` (or `.dependency-cruiser.cjs`) — forbid `getServerSessionUser` / `cookies()` / `headers()` in `**/app/api/**/route.ts`
- `docs/guides/agent-api-validation.md` — refresh stale shortcomings (2, 3), document new register contract
- `work/items/bug.0297.agent-register-open-account-factory.md` — link to this spec; mark status as `blocked_by: task.0312`

**Delete (post-migration)**:

- `nodes/*/app/src/app/_lib/auth/session.ts` — replaced by `resolveAuthPrincipal.ts`
- `SessionUser` type — after one-release alias window

**Test**:

- `tests/contract/auth-principal.contract.test.ts` — AuthPrincipal shape + invariants (non-null actorId, etc.)
- `tests/stack/api/agent-first-auth.stack.test.ts`:
  - register returns `{ actorId, tenantId, ... }`, no `userId` field
  - register creates `actors` row with `kind='agent'`
  - bearer on `/api/v1/ai/runs` resolves to an `AuthPrincipal` with `principalType='agent'`
  - cookie on `/api/v1/users/me` works; bearer on same route → 401
  - 1000 POSTs to `/register` from one IP → 429 after N, no new actor rows
  - actor over daily spend cap → 402 from LLM dispatch path
  - admin route without admin scope → 403
- `tests/integration/wrapRouteHandlerWithLogging.int.test.ts` — all four policies exercised with mocked resolvers
- Lint: ci-job fails if a `route.ts` file imports `getServerSessionUser`

## Validation

### Pre-merge

- [ ] `pnpm check` clean once (spec invariant-aligned; architectural layering respected)
- [ ] Stack tests above all green on `pnpm check:full`
- [ ] Lint rule fires on a deliberately-broken route file (sanity check)
- [ ] Contract test: no route file outside `bootstrap/http` imports session primitives
- [ ] Actors backfill migration is idempotent (re-running the migration on a backfilled DB is a no-op)
- [ ] `/api/v1/agent/register` contract test: response shape matches `{ actorId, tenantId, policyTier, spendCapCents, apiKey }`; no `userId` field
- [ ] Audit grep: `rg 'SessionUser' nodes/*/app/src/app/api` returns zero hits outside transitional aliases

### Post-merge / preview flight

- [ ] Flight to preview: run the validation flow in `docs/guides/agent-api-validation.md` end-to-end
- [ ] Load test: 1000 `POST /register` over 60s from one source IP → 429 after rate-limit threshold; actors table row count stays bounded
- [ ] Per-actor cap: manually raise a single actor's spend cap to a tiny value, hit `/chat/completions` twice, verify second call returns `402` with cap-hit error shape
- [ ] `bug.0297` status transitions from `critical` to `medium` on the back of rate-limit + cap enforcement (the residual medium-severity item is "no cryptographic proof of possession", addressed in A3)
- [ ] Observability: Loki shows structured audit entries for each register attempt (success + 429), each spend-cap denial, each revocation

### Out of scope (deferred to later track deliverables)

- Keypair registration (`publicKeyJwk` on register input) — A3
- Short-lived (5min) proof-bound access tokens — A3
- `/api/v1/agent/token` exchange endpoint — A3
- DPoP sender-constrained tokens — A4
- Human-linkage claim flow (`actors.owner_user_id` set via a human session) — A5
- Replacing HMAC with `jose` JWTs — only if A3 needs it

## Notes

- Multi-node scope: operator, node-template, poly, resy all touch the same wrapper. Per MEMORY.md, the `request-identity.ts` / `session.ts` files are currently duplicated across nodes; this PR does NOT de-duplicate them (tracked separately), but DOES ensure all nodes ship the same new shape.
- Depends on the design spec at `docs/spec/agent-first-auth.md` — review that before starting implementation.
- The `apiKey` shipped by this task is intentionally still a 24h static bearer. This is the _only_ regression versus a "do it all now" design, and it is bounded by the rate limit + daily spend cap + 24h TTL. A3 removes it.
- After this lands, bug.0297 stays open for its residual medium-severity concern (no cryptographic proof of possession), to be closed by A3.
