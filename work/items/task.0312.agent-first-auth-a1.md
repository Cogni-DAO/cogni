---
id: task.0312
type: task
title: "Agent-first auth A1 — AuthPrincipal + wrapper policy refactor"
status: needs_implement
priority: 1
rank: 5
estimate: 3
assignees: [derekg1729]
created: 2026-04-14
updated: 2026-04-14
project: proj.accounts-api-keys
branch: feat/agent-first-auth-a1
spec_refs: [agent-first-auth]
blocked_by:
labels: [auth, identity, agent-first]
summary: "A1 of the proj.accounts-api-keys agent-first auth track. Introduce the canonical AuthPrincipal type in packages/node-shared, refactor wrapRouteHandlerWithLogging to accept policy strings (public | authenticated | session_only | admin), replace session.ts + request-identity.ts with resolveAuthPrincipal, flip every /api/v1/* route across all nodes to the new wrapper, and lint-enforce no raw session access in route handlers. No schema changes — actorId is a runtime cast over users.id until A2 (task.0313) lands the real actors table."
outcome: "Every authenticated /api/v1/* route receives a typed AuthPrincipal from the wrapper; raw session access is forbidden in route handlers (lint-enforced); session_only is an opt-in carve-out for a documented set of human-only routes; a route that omits `auth` is a TypeScript error. Contract is locked — A2 and A3 can swap storage and proof backends without touching any route file."
---

# task.0312 — Agent-first auth A1 (contract lock)

## Context

Post PR #845, the agent-first API lane works end-to-end, but the identity story has two gaps that A1 closes:

1. **Principal model is ambiguous.** Routes receive a `SessionUser` that was built either from a cookie or a bearer, and there is no canonical "who is acting" type. The wrapper's `auth: { getSessionUser }` parameter forces each route file to pick its own resolver — a discipline-based invariant, not a type-system one. A route that forgets the agent-capable import silently becomes session-only.
2. **`actorId` is fictional.** The spec in [identity-model.md](../../docs/spec/identity-model.md) names `actor_id` as a primitive, but in code it is a runtime cast over `userId`. There is no domain type that exposes `actorId` to handlers as a real field.

A1 locks the handler-facing contract without changing the storage model. A2 (`task.0313`) then backs `actorId` with a real `actors` table and closes `bug.0297` by rate-limiting registration and enforcing per-actor caps. A3 swaps the proof backend to proof-of-possession.

**Why A1 first**: the external review's recommendation was "empower `actorId` now, harden the credential later." Locking the handler-facing contract makes A2 a pure storage/register rewrite and makes A3 a single-file proof-backend swap — zero route changes in either follow-up. Skipping A1 leaves the principal model ambiguous for however long A2+A3 take.

Spec: [agent-first-auth.md](../../docs/spec/agent-first-auth.md) — source of truth for invariants, `AuthPrincipal` shape, and the decorator policy surface.

Project track: [proj.accounts-api-keys § Agent-First Auth Track](../projects/proj.accounts-api-keys.md) — this task is A1. `task.0313` is A2.

## Design

### Outcome

Every authenticated `/api/v1/*` route receives a typed `AuthPrincipal` whose `actorId` is non-null, regardless of whether the request came in on a session cookie or a bearer token. Raw session access is forbidden in route handlers. The wrapper's `auth` field is a literal string; a route that omits it is a TypeScript error. The entire surface is ready for A2 to swap storage and A3 to swap proof without any route file touching.

### Approach

**Solution**: One atomic PR — the three pieces below are each other's prerequisites.

1. **`AuthPrincipal` + `AuthPolicy` types in `packages/node-shared/src/auth/`**:

   ```ts
   export type PrincipalType = "user" | "agent" | "system";

   export type AuthPolicy =
     | "public"
     | "authenticated"
     | "session_only"
     | "admin";

   export type AuthPrincipal = Readonly<{
     principalType: PrincipalType;
     principalId: string;
     actorId: string;
     userId: string | null;
     tenantId: string;
     scopes: readonly string[];
     policyTier: string;
   }>;
   ```

2. **`wrapRouteHandlerWithLogging` refactor** — the `auth` field becomes a literal string:

   ```ts
   wrapRouteHandlerWithLogging(
     { routeId, auth: "authenticated" },
     async (ctx, req, principal) => {
       /* principal: AuthPrincipal */
     }
   );
   ```

   Rules:
   - `"authenticated"` — resolves bearer OR session cookie → `AuthPrincipal`. 401 if neither.
   - `"session_only"` — resolves session cookie only. Rejects bearers with 401.
   - `"public"` — handler signature omits the `principal` argument entirely (type-level guarantee that the handler cannot accidentally read identity).
   - `"admin"` — `"authenticated"` + a check for the `"admin"` scope. 403 if missing.
   - A route that omits `auth` is a TypeScript error.

3. **`resolveAuthPrincipal` module** replaces `session.ts` + `request-identity.ts`'s resolver exports. One function, one entry point, returns `AuthPrincipal | null`. Internally calls `resolveRequestIdentity` (keeping the HMAC bearer + cookie logic from PR #845 unchanged) and constructs the `AuthPrincipal` from its output.

**Storage model during A1 (explicitly temporary)**:

No schema changes. The `AuthPrincipal` is constructed from the existing `users` row + existing bearer claims. `actorId` is the runtime cast `userActor(toUserId(userId))` that already exists in the codebase — the difference is that the cast now happens in ONE place (the wrapper) and handlers see a real `actorId` field, not a fictional one. A2 replaces the cast with an `actors` table lookup — the handler-facing type does not change.

**Route audit** (every `/api/v1/*` route across all nodes):

- Every route currently importing `@/app/_lib/auth/session.getSessionUser` becomes `auth: "authenticated"`.
- Every route currently importing `@/lib/auth/server.getServerSessionUser` becomes `"session_only"` or `"admin"` per the 3-bucket audit in the spec.
- `v1/activity` moves from session-only to `"authenticated"` — an agent should be able to see its own activity feed.
- Handler signatures change from `(ctx, req, sessionUser)` to `(ctx, req, principal)` with the appropriate type.

**Lint enforcement**:

- ESLint rule (preferred) or dep-cruiser forbidden rule banning imports of `getServerSessionUser`, `next/headers` (`cookies`, `headers`), and the NextAuth `getServerSession` in any file under `**/app/api/**/route.ts`.
- CI fails if any route file imports any of the above.

**Deprecation window**:

- `SessionUser` becomes a one-release type alias for `AuthPrincipal` to keep in-flight feature branches compiling. Deleted in a follow-up PR once all branches rebase.

**Explicitly NOT in scope for A1** (handled by A2 = task.0313):

- `actors` table migration
- Register route rewrite
- IP rate limit on `/register`
- Per-actor daily spend cap enforcement
- `apiKey` TTL change (stays at 30d in A1; drops to 24h in A2)
- `agent.register.v1.contract.ts` output shape change

This decoupling works because A2 only mutates (a) the storage of `actorId` (users.id → actors.id) and (b) the register route's output shape. Neither crosses the A1 contract surface — `AuthPrincipal.actorId` stays a string, and handlers don't know or care where it came from.

**Reuses**:

- `wrapRouteHandlerWithLogging` — existing decorator; parameterized today with the wrong shape.
- `resolveRequestIdentity` — existing bearer-or-session resolver (PR #845); becomes the internal of the `"authenticated"` branch.
- `getServerSessionUser` — existing session-only resolver; becomes the internal of the `"session_only"` branch.
- Zod — for policy union validation.
- Pino envelope — existing audit log primitive; no new event names.
- No new dependencies; no new packages; no new runtime primitives.

**Rejected alternatives**:

- **Extend `SessionUser` in place** — add `actorId`, `principalType`, `tenantId`, `scopes`, `policyTier` fields to the existing `SessionUser` type and rename to `AuthPrincipal` later. _Rejected because_: `SessionUser`'s shape is wrong in subtle ways (nullable `userId` for the human case is actively misleading; `readonly` is missing; `avatarColor` is a UI concern that must not leak into auth). Changing it in place is the same amount of work as introducing a new type, AND requires updating every call site anyway since the field semantics change. A clean new type forces the handler-signature migration that is the point of A1.
- **Ship `AuthPrincipal` first, route audit in a follow-up PR.** Rejected: the wrapper's `auth` field is a union type that the compiler cannot narrow unless every call site is migrated at once. Leaving N routes on the old shape would require preserving the old wrapper signature as a second overload, doubling the maintenance surface during the migration window.
- **Bundle A2 (actors table + register rewrite + quotas) into A1.** Rejected per design review: the storage change is logically separable from the contract lock, review surface doubles when bundled, and A1 is the safer-to-ship half because it has no schema migration. A2 follows on the same branch after A1 lands.
- **Jump straight to proof-of-possession (A3) and skip the contract lock.** Rejected per the external review: "Waiting to 'do auth later' is the mistake." Locking the contract now makes A3 a single-file backend swap.
- **Keep the function-valued `getSessionUser` parameter.** Rejected: the dual-access default has to be maintained by discipline across N route files, and a route that forgets the agent-capable import silently becomes session-only. The failure mode is invisible.
- **Put `AuthPrincipal` in a node-local module.** Rejected per boundary placement in `packages-architecture.md`: >1 runtime (operator, node-template, poly, resy) needs the same shape; it is a pure domain type; vendor containment shields routes from auth backend churn.
- **Create a new `packages/node-auth` capability package.** Considered. Rejected for now because the full capability surface is just two types and one resolver function — under the threshold where a new package pays off. Revisit during A3 if the proof backend grows enough to warrant extraction.
- **Rename `actorId` to `agentId`.** Rejected: `agentId` is too narrow. Future principals (system, service, delegated runner, webhook) are actors but not agents.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] ACTOR_IS_PRINCIPAL: every authenticated request resolves to an `AuthPrincipal` with a non-null `actorId` (spec: agent-first-auth).
- [ ] PRINCIPAL_NOT_SESSION_IN_HANDLERS: no route-handler file imports `getServerSessionUser`, `getServerSession`, `cookies`, or `headers`. Lint-enforced (spec: agent-first-auth).
- [ ] SPLIT_IDENTITY_PROOF_AUTHORIZATION: handler code reads `principal.actorId`, `principal.tenantId`, `principal.scopes` — never how the principal was proved (spec: agent-first-auth).
- [ ] DECORATOR_OWNS_STRATEGY: routes declare `auth: "public" | "authenticated" | "session_only" | "admin"` as a string literal; a route that omits `auth` is a TypeScript error (spec: agent-first-auth).
- [ ] DEFAULT_IS_DUAL_ACCESS: the `"authenticated"` policy accepts both bearer and session; `"session_only"` is the narrow carve-out (spec: agent-first-auth).
- [ ] CONTRACTS_FIRST: `packages/node-shared/src/auth/principal.ts` is the source of truth for `AuthPrincipal` and `AuthPolicy`; no parallel definitions (spec: architecture, per root AGENTS.md §"API Contracts are the Single Source of Truth").
- [ ] HEXAGONAL_ALIGNMENT: `AuthPrincipal` is a domain type in a package; the wrapper is runtime wiring in `bootstrap/http`; no business logic leaks into the wrapper (spec: architecture).
- [ ] LAYER_DEPENDENCY_DIRECTION: `packages/node-shared` has no `src/` imports; `bootstrap/http` imports `@cogni/node-shared` via workspace alias (spec: packages-architecture).
- [ ] SIMPLE_SOLUTION: reuses `wrapRouteHandlerWithLogging`, `resolveRequestIdentity`, `getServerSessionUser`, Zod, Pino envelope — zero new dependencies (spec: this design).
- [ ] NO_A2_BLEED: no schema changes; no `actors` table; no register-route rewrite; no rate limit; no spend cap. Those belong to `task.0313` (spec: this task, Approach).

### Files

<!-- High-level scope — actual paths finalized during /implement -->

**Create**:

- `packages/node-shared/src/auth/principal.ts` — `AuthPrincipal`, `AuthPolicy`, `PrincipalType`
- `packages/node-shared/src/auth/index.ts` — re-exports
- `nodes/operator/app/src/app/_lib/auth/resolveAuthPrincipal.ts` — unified resolver returning `AuthPrincipal | null`
- `nodes/node-template/app/src/app/_lib/auth/resolveAuthPrincipal.ts` — same
- `nodes/poly/app/src/app/_lib/auth/resolveAuthPrincipal.ts` — same
- `nodes/resy/app/src/app/_lib/auth/resolveAuthPrincipal.ts` — same
- `tests/stack/security/auth-bucket-enforcement.stack.test.ts` — security test battery (see Validation)
- `tests/contract/auth-principal.contract.test.ts` — `AuthPrincipal` shape invariants (non-null actorId, readonly, principalType is a literal union)
- `tests/integration/wrapRouteHandlerWithLogging.int.test.ts` — all four policies exercised with mocked resolvers

**Modify**:

- `nodes/operator/app/src/bootstrap/http/wrapRouteHandlerWithLogging.ts` — `auth` becomes a string literal union; handler receives `AuthPrincipal | undefined`; owns all four policies
- `nodes/node-template/app/src/bootstrap/http/wrapRouteHandlerWithLogging.ts` — same
- `nodes/poly/app/src/bootstrap/http/wrapRouteHandlerWithLogging.ts` — same
- `nodes/resy/app/src/bootstrap/http/wrapRouteHandlerWithLogging.ts` — same
- `nodes/*/app/src/app/api/v1/**/route.ts` — every route file: replace `auth: { mode, getSessionUser }` with `auth: "authenticated" | "session_only" | "public" | "admin"`; rename handler parameter `sessionUser` → `principal`; remove `getSessionUser` import. `v1/activity/route.ts` moves from the session-only import to `"authenticated"`.
- `nodes/*/app/src/app/_lib/auth/session.ts` — becomes a re-export of `resolveAuthPrincipal` for the one-release alias window
- `packages/node-shared/src/index.ts` (or equivalent) — re-export the new auth types
- `packages/node-shared/src/SessionUser.ts` (or wherever it lives) — add `type SessionUser = AuthPrincipal` alias with a `@deprecated` JSDoc pointing at `AuthPrincipal`
- `eslint.config.mjs` — add a `no-restricted-imports` rule forbidding `next/headers`, `@/lib/auth/server`, and `next-auth`'s `getServerSession` in files matching `**/app/api/**/route.ts`
- `docs/guides/agent-api-validation.md` — refresh to say "all `/api/v1/*` routes accept bearer tokens; `AuthPrincipal` is the handler type." Remove stale shortcomings #2 and #3.

**Test**:

- `tests/contract/auth-principal.contract.test.ts` — shape invariants
- `tests/integration/wrapRouteHandlerWithLogging.int.test.ts` — policy-enforcement unit tests (all 4 policies, mocked resolver)
- `tests/stack/security/auth-bucket-enforcement.stack.test.ts` — the security battery below

## Validation

### Automated — before merge

`pnpm check` clean once, and the security test battery below green:

- [ ] **Type check**: no file outside `packages/node-shared/src/auth/` defines `AuthPrincipal`, `AuthPolicy`, or a parallel shape.
- [ ] **Lint**: CI fails if any `**/app/api/**/route.ts` imports `getServerSessionUser`, `next/headers`, or `next-auth`'s `getServerSession`. Verified by deliberately reverting one route's import and observing the red build locally.
- [ ] **Contract test (`auth-principal.contract.test.ts`)**: `AuthPrincipal.actorId` is `string` and non-nullable; `principalType` is the literal union; all fields are `readonly`.
- [ ] **Unit test (`wrapRouteHandlerWithLogging.int.test.ts`)**: four policy paths, eight total cases:
  - `"public"` — no credential → handler called, `principal` argument absent
  - `"authenticated"` + no credential → 401
  - `"authenticated"` + bearer → handler called, `principal.principalType === "agent"`
  - `"authenticated"` + session cookie → handler called, `principal.principalType === "user"`
  - `"session_only"` + bearer → 401 (bearer rejected)
  - `"session_only"` + session cookie → handler called
  - `"admin"` + session without admin scope → 403
  - `"admin"` + session with admin scope → handler called
- [ ] **Security battery (`auth-bucket-enforcement.stack.test.ts`)**: exercises every real route end-to-end, not just the wrapper:
  - `GET /api/v1/ai/runs` with bearer → 200, `principalType: "agent"` (dual-access sanity)
  - `GET /api/v1/ai/runs` with no credential → 401
  - `GET /api/v1/ai/runs` with a _bad_ bearer signature → 401
  - `GET /api/v1/users/me` with bearer → 401 (session-only rejects bearer)
  - `GET /api/v1/users/me` with session cookie → 200
  - `GET /api/v1/governance/status` with session lacking `"admin"` scope → 403
  - One route from each of the four buckets, not just a sampler — full enumeration is what catches a mis-flipped route
- [ ] **Route audit script** (`scripts/verify-auth-policies.mjs` or an in-test assertion): machine-readable confirmation that every `/api/v1/*` route file declares `auth:` with one of the four literals. Any route missing an `auth:` literal is a build failure.
- [ ] `rg 'SessionUser' nodes/*/app/src/app/api` returns zero hits outside transitional aliases.

### Manual — post-merge, pre-preview-flight

- [ ] Local dev stack: curl `/api/v1/ai/runs` with a fresh bearer and a stale bearer; confirm 200 vs 401 per the security battery.
- [ ] Local dev stack: load the operator UI in a browser, verify session-cookie paths still work (no regression on `users/me`, `governance/status`, OAuth flows).
- [ ] Observability: Loki shows `route_id` and `principal.principalType` in the request envelope for every `/api/v1/*` call.

### Out of scope (deferred to A2 = task.0313)

- `actors` table migration
- Register route rewrite
- Per-actor spend cap
- IP rate limit on `/register`
- `apiKey` TTL change
- `bug.0297` downgrade

## PR / Links

- Handoff: [handoff](../handoffs/task.0312.handoff.md)

## Notes

- **Multi-node scope**: operator + node-template + poly + resy all touch the same wrapper. Per MEMORY.md, `session.ts` / `request-identity.ts` are duplicated across nodes today; A1 does NOT de-duplicate them but DOES ensure all nodes ship the same new wrapper signature.
- **Branch**: the spec lives on `design/agent-first-auth`; implementation branch is `feat/agent-first-auth-a1` (created at `/implement` start, branched from the design-branch tip so the docs + code land in one PR).
- **Estimate 3**: the contract/wrapper/resolver is small; the grind is the route audit across ~50 files × 4 nodes. Ballpark half a day per node + half a day for the tests = ~3 days.
- **Storage model during A1 is intentionally hacky**: `actorId = userId` via runtime cast. This is explicit in the wrapper's resolver, commented as "TEMPORARY — replaced in A2 by actors-table lookup." Do not propagate the assumption anywhere else; downstream code reads `principal.actorId` and must remain correct after A2's swap.

## Plan

Checkpoints are ordered so the tree stays green at every boundary. The wrapper ships BOTH old and new shapes as overloads (checkpoint 3); routes migrate incrementally (4–5); the legacy overload is deleted in checkpoint 7 once all routes are on the new shape. No "flag day" commit.

- [ ] **Checkpoint 1 — `AuthPrincipal` types package**
  - Milestone: `@cogni/node-shared` exports `AuthPrincipal`, `AuthPolicy`, `PrincipalType`. Any node app can `import { AuthPrincipal } from "@cogni/node-shared"`. No behavior change.
  - Invariants: ACTOR_IS_PRINCIPAL, CONTRACTS_FIRST, LAYER_DEPENDENCY_DIRECTION
  - Todos:
    - [ ] Create `packages/node-shared/src/auth/principal.ts`
    - [ ] Create `packages/node-shared/src/auth/index.ts` (barrel)
    - [ ] Re-export from the package's top-level barrel
    - [ ] Contract test: shape, non-null `actorId`, readonly fields, literal `principalType`
  - Validation:
    - [ ] `pnpm check:fast` green
    - [ ] `pnpm test packages/node-shared` green

- [ ] **Checkpoint 2 — `resolveAuthPrincipal` helper (operator)**
  - Milestone: single function `resolveAuthPrincipal(policy)`, returns `AuthPrincipal | null`, reuses `resolveRequestIdentity` + `getServerSessionUser` as primitives. Not yet wired into the wrapper.
  - Invariants: SPLIT_IDENTITY_PROOF_AUTHORIZATION, PRINCIPAL_NOT_SESSION_IN_HANDLERS
  - Todos:
    - [ ] Create `nodes/operator/app/src/app/_lib/auth/resolveAuthPrincipal.ts`
    - [ ] `"authenticated"` branch: call `resolveRequestIdentity`, lift → `AuthPrincipal` with temporary `actorId = userId` cast (commented)
    - [ ] `"session_only"` branch: call `getServerSessionUser`; reject if Authorization header was present (BEARER_CLAIMS_EXCLUSIVE)
    - [ ] `"admin"` branch: `"authenticated"` + scope check
    - [ ] `"public"` branch: returns null, handler never inspects
    - [ ] Unit tests for all four paths
  - Validation:
    - [ ] `pnpm check:fast` green
    - [ ] Unit tests green

- [ ] **Checkpoint 3 — Operator wrapper accepts new AND old shapes**
  - Milestone: `wrapRouteHandlerWithLogging` accepts either `auth: { mode, getSessionUser }` (legacy, unchanged) or `auth: AuthPolicy` (new literal). All existing routes compile unchanged. New routes can opt in.
  - Invariants: DECORATOR_OWNS_STRATEGY, HEXAGONAL_ALIGNMENT
  - Todos:
    - [ ] Add new overload signatures for `"public" | "authenticated" | "session_only" | "admin"` literals
    - [ ] Implementation dispatches on `typeof auth`: string → new path, object → legacy path
    - [ ] Handler signature correctly typed per policy: `"public"` → no principal arg; rest → `AuthPrincipal` non-null
    - [ ] `"admin"` returns 403 on missing scope
    - [ ] Integration tests: all four policy paths
  - Validation:
    - [ ] `pnpm check:fast` green (all existing routes still compile)
    - [ ] `tests/integration/wrapRouteHandlerWithLogging.int.test.ts` green

- [ ] **Checkpoint 4 — Operator route audit**
  - Milestone: every `/api/v1/*` route in operator uses the new `auth: AuthPolicy` literal. `v1/activity` moves from session-only to `"authenticated"`.
  - Invariants: DEFAULT_IS_DUAL_ACCESS, NO_A2_BLEED
  - Todos:
    - [ ] Dual-access bucket (~35 routes) → `auth: "authenticated"`
    - [ ] Session-only carve-out (~7 routes) → `auth: "session_only"`
    - [ ] Admin (`governance/*`) → `auth: "admin"`
    - [ ] Public seam (`agent/register`) → `auth: "public"`
    - [ ] Remove `getSessionUser` / `getServerSessionUser` imports from every `/api/v1/**/route.ts`
  - Validation:
    - [ ] `pnpm check:fast` green
    - [ ] `rg '@/app/_lib/auth/session' nodes/operator/app/src/app/api` empty
    - [ ] `rg '@/lib/auth/server' nodes/operator/app/src/app/api/v1` empty

- [ ] **Checkpoint 5 — Multi-node parity (node-template, poly, resy)**
  - Milestone: same treatment for the other three nodes. All nodes ship the same wrapper signature and route shape.
  - Todos:
    - [ ] node-template: resolver + wrapper + route audit
    - [ ] poly: resolver + wrapper + route audit
    - [ ] resy: resolver + wrapper + route audit
  - Validation:
    - [ ] `pnpm check:fast` green
    - [ ] All four per-node typecheck targets green

- [ ] **Checkpoint 6 — Lint rule + security battery**
  - Milestone: lint fails loudly on raw session access in route handlers; security test battery enforces every bucket × policy.
  - Invariants: PRINCIPAL_NOT_SESSION_IN_HANDLERS
  - Todos:
    - [ ] `no-restricted-imports` in `eslint.config.mjs` scoped to `**/app/api/**/route.ts`; forbid `next/headers`, `@/lib/auth/server`, `next-auth`
    - [ ] Verify rule by deliberately reverting one route's import locally
    - [ ] Create `tests/stack/security/auth-bucket-enforcement.stack.test.ts` covering the full matrix from the Validation section above
  - Validation:
    - [ ] `pnpm lint` green
    - [ ] Security test green

- [ ] **Checkpoint 7 — Deprecation + docs + finalize**
  - Milestone: legacy wrapper overload removed; `SessionUser` is a one-release alias; docs reflect the new shape; full `pnpm check` green; pushed.
  - Todos:
    - [ ] Delete legacy `{ mode, getSessionUser }` overload from all four node wrappers
    - [ ] `SessionUser` → `type SessionUser = AuthPrincipal` with `@deprecated` JSDoc
    - [ ] Delete or reduce `@/app/_lib/auth/session.ts` to a re-export
    - [ ] Update `docs/guides/agent-api-validation.md` — remove stale shortcomings #2, #3
    - [ ] `pnpm check` (single full run)
    - [ ] status → `needs_closeout`, regenerate `_index.md`, commit, push
  - Validation:
    - [ ] `pnpm check` green (single pre-commit run)
    - [ ] `pnpm check:docs` green
