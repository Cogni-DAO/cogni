---
id: bug.0297
type: bug
title: "POST /api/v1/agent/register is an unauthenticated account + API-key factory"
status: blocked
priority: 1
rank: 5
estimate: 3
summary: "PR #845 exposed /api/v1/agent/register in the proxy's public allowlist. Anyone on the internet can POST a name and receive a fresh user row plus a 30-day signed API key. No auth, no rate limit, no audit trail. Remediation redirected: bounded-by-quota (per-actor spend cap + IP rate limit) via the agent-first auth spec, NOT invitation-gating. Phase 1 (contract lock) is task.0312; Phase 2 (keypair proof-of-possession) closes the residual."
outcome: "Rate-limited registration and per-actor spend cap bound the blast radius without requiring an invitation flow. Each issued credential carries a 24h TTL and is explicitly revocable via the actors table. Phase 2 adds cryptographic proof-of-possession and 5-minute proof-bound access tokens."
spec_refs: [agent-first-auth, security-auth]
assignees: derekg1729
credit:
project: proj.accounts-api-keys
branch:
pr: https://github.com/Cogni-DAO/cogni-template/pull/845
reviewer:
revision: 0
blocked_by: [task.0312]
deploy_verified: false
created: 2026-04-13
updated: 2026-04-14
labels: [security, auth]
external_refs:
  - https://github.com/Cogni-DAO/cogni-template/pull/845
---

> **2026-04-14 direction change.** The original "admin-minted invitation token"
> remediation (§ Plan below) is SUPERSEDED by the agent-first auth contract at
> [`docs/spec/agent-first-auth.md`](../../docs/spec/agent-first-auth.md). The
> execution roadmap lives in [`proj.accounts-api-keys § Agent-First Auth
Track`](../projects/proj.accounts-api-keys.md). The critical-severity
> exposure is closed in two steps:
>
> 1. **Contract lock (task.0312)**: `AuthPrincipal` + wrapper refactor + `actors`
>    table + IP rate limit + per-actor daily spend cap + 24h TTL on the issued
>    bearer. Downgrades this bug from critical to medium.
> 2. **Proof-of-possession follow-up (A3 in the project track)**: keypair
>    registration + 5-minute proof-bound access tokens. Closes this bug
>    entirely.
>
> The "Identity Model Gaps" section below (Gaps 1, 4, 5, 6, 7, 8) is still
> valid; most gaps land naturally under the contract lock (actors table → 1, 4;
> quota → implicit idempotency bounding → 8; `revoked_at` → 6). Gaps 5 and 7
> are orthogonal and stay tracked here.

# Agent register endpoint is an open account factory

## Problem

`POST /api/v1/agent/register` was added in PR #845 and placed behind `isPublicApiRoute` in `nodes/{operator,node-template}/app/src/proxy.ts`. The route handler calls `randomUUID()`, inserts a row into `users`, creates a billing account via `serviceAccountService.getOrCreateBillingAccountForUser`, and returns a 30-day HMAC-signed API key — all for any caller who can send an HTTP POST.

Current effective permission boundary:

```
┌──────────────┐                             ┌──────────────────────────┐
│ Internet POST│──── name: "anything" ───►   │ users row created        │
│ (no auth)    │                             │ billing account created  │
│              │◄── apiKey (30-day sig) ───  │ user:<uuid> bearer issued│
└──────────────┘                             └──────────────────────────┘
```

## Impact

- **Unauthenticated identity minting.** Anyone can create arbitrary user rows, polluting analytics, ownership tables, and any audit-log table keyed on `users.id`.
- **Credential factory.** Each call returns a valid bearer token that passes `resolveRequestIdentity` on every `/api/v1/*` route that accepts machine auth (chat/completions, ai/\*, agent/runs). No per-user spend ceiling has been observed on these tokens — a single attacker loop fans out into N tokens, each burning LiteLLM / OpenRouter quota under different actor ids.
- **Billing-account proliferation.** `getOrCreateBillingAccountForUser` side-effects a ledger write. Unbounded calls inflate TigerBeetle accounts and muddy billing reconciliation.
- **Cost-control blast radius.** MEMORY records a prior incident where unbounded Opus usage burned $20 in 30 minutes. An open credential factory on an LLM proxy is strictly worse: the attacker doesn't even need to breach a single credential.

Severity: **critical on any deploy that exposes `/api/v1/*` to untrusted networks** (candidate-a, preview, production). Today it is only masked by the fact that candidate-a's other-known OOM (circular auth resolver, fixed separately) keeps the pod from staying up long enough to be reliably exploited.

## Requirements

- R1 `/api/v1/agent/register` MUST reject requests that do not present a valid, single-use, admin-minted invitation token. Default 401.
- R2 Invitation tokens MUST be short-lived (≤ 24 h), single-redemption, and revocable before redemption.
- R3 Invitation tokens MUST be minted only by an authenticated admin session (or admin API key) — no shared bootstrap secret committed to env files in git-tracked compose/k8s manifests.
- R4 Every redemption attempt (success or failure) MUST emit a structured Pino audit log including source IP and invitation id (on success).
- R5 The endpoint MUST be rate-limited per source IP (proxy layer or route handler — pick one) to bound brute-force attempts even before the token check.
- R6 Revoking the capability MUST be an operational knob (env flag or admin toggle), not a code change, so incident response can close it in < 5 min.

## Allowed Changes

- `nodes/{operator,node-template}/app/src/app/api/v1/agent/register/route.ts` — handler rewrite
- `nodes/{operator,node-template}/app/src/proxy.ts` — remove register from `isPublicApiRoute`
- New admin mint route: `POST /api/v1/admin/agent-invitations` (session-authed)
- New or extended auth primitive for invitation tokens (reuse the HMAC codec in `request-identity.ts`, different prefix + claim set)
- Contract: `packages/node-contracts/src/agent.register.v1.contract.ts` — add `invitationToken` field, version bump
- Tests: stack + contract coverage for reject-without-token, reject-expired, accept-valid, reject-replayed

## Plan

- [ ] **Design** (this item, `/design`): pick between (a) admin-session-minted invitation tokens (preferred), (b) OIDC-issued invitations via an external IdP, (c) TTL-bound shared-secret bootstrap gated by source CIDR. Document rejection of alternatives.
- [ ] **Spec** (`docs/spec/security-auth.md`): add "agent onboarding" section with the invariants above.
- [ ] Implement admin mint route + invitation store (Redis TTL set or Postgres `agent_invitations` table — pick the simplest).
- [ ] Rewrite `register` handler: validate invitation → single-use consume → create user + key → emit audit log.
- [ ] Remove `/api/v1/agent/register` from `isPublicApiRoute`; proxy default-401 without invitation header.
- [ ] Add rate limit (reuse existing `ioredis` client — do not invent new dependencies).
- [ ] Tests: contract (unauth → 401), contract (valid → 201), contract (replay → 401), stack test that proxies traffic end-to-end.
- [ ] `pnpm check` once, commit, open PR.

## Identity Model Gaps — from PR #845 review

Surfaced during implementation review of PR #845 against `docs/spec/identity-model.md`. Nine
gaps total. The three surgical ones shipped on PR 845 as a pure-deletion commit (`294179c14`,
net -40 lines). The six remaining gaps all require schema work or real design; they belong to
this bug's scope because they all touch the register/onboarding seam. **None of the deferred
gaps is blocking for v0 functionality today** — the agent-first lane works end-to-end on PR 845.

### Done on PR #845 (commit `294179c14`)

- [x] **Gap 2 — `register` minted a non-UUID `actorId`.** The old code set
      `` const actorId = `user:${id}` `` which is not a UUID and therefore not a valid
      `ActorId` per `@cogni/ids`. Every other route in the agent-first lane computes
      `userActor(toUserId(sessionUser.id))` (a plain UUID), so the register response
      disagreed with every consumer. **Fix:** dropped from the register lane entirely.
      Clients derive from `userId` until gap 1 lands the real actors table.
- [x] **Gap 3 — JWT `actorId` field was write-only dead payload.**
      `AgentTokenPayload.actorId` was set on issue, existence-checked on parse, and then
      never read anywhere. The resolver built `SessionUser` from `payload.sub` only.
      **Fix:** purged from the type, the issuer signature, the signing path, and the
      parse validation.
- [x] **Gap 9 — `registerAgentOperation.output` exposed redundant `actorId + userId`.**
      The contract returned both keys in v0 where `actorId === userId` at runtime, violating
      the spec's "prohibited overloading" invariant. **Fix:** removed `actorId` from the
      zod output schema. v0 output is `{ userId, apiKey, billingAccountId }`.

### Deferred (schema work — each blocking "true agent identity")

- [ ] **Gap 1 — Land the `actors` table.** Spec describes an ECONOMIC LAYER (`actors`,
      `actor_bindings`, `budget_allocations`) with `kind IN (user | agent | system | org)` and
      `parent_actor_id` for hierarchy. None of it exists in `packages/db-schema/src/identity.ts`.
      `@cogni/ids` currently casts `ActorId` to `UserId` with zero runtime difference. First
      deliverable should be a migration that backfills `actors.id = users.id, kind='user'` for
      every existing user so the `userActor(userId)` cast stays valid.
- [ ] **Gap 4 — Register writes to `users` table with no kind discriminator.** Agents and
      humans are indistinguishable in the DB today. Once gap 1 ships, register must write
      `actors` with `kind='agent'` (and, eventually, `parent_actor_id`).
- [ ] **Gap 5 — Billing account tenancy is 1:1 per user, should be 1:N per actor.** Spec
      invariant: "multiple actors per tenant." Today `getOrCreateBillingAccountForUser({
userId })` mints a fresh billing account per registration, so every agent is its own
      tenancy island. Redesign once actor table exists so an agent can share its owner's
      billing account.
- [ ] **Gap 6 — No persistence of issued API keys, no revocation list.** API keys are
      self-contained HMAC tokens; no DB binding. Spec model has `actor_bindings` with a
      provider discriminator — machine API keys should be bound as a new provider with a
      revocation timestamp. Without this, revoking a compromised key requires rotating
      `AUTH_SECRET` globally.
- [ ] **Gap 7 — No `scope_id` captured at registration.** Every `activity_events` /
      `epoch_allocations` row is keyed by `(node_id, scope_id)`. Register creates no scope
      binding, so an agent's charge_receipts land in whatever default scope the runtime
      assumes. Onboarding should record "this agent was registered under which project."
- [ ] **Gap 8 — No idempotency on register.** Two POSTs with `{"name":"my-agent"}` create
      two distinct users + two billing accounts + two bearers. Add `external_id` uniqueness
      or an `Idempotency-Key` header.

### Related to the invitation-token design above

Some of these gaps collapse naturally into the invitation-token flow:

- Gap 6 (revocation) — the invitation record IS the first binding entry; revoke = delete invitation.
- Gap 8 (idempotency) — invitation tokens are single-use by design, so replayed redemption is already rejected.

Gaps 1, 4, 5, 7 are orthogonal and may split into a separate task under `proj.accounts-api-keys`
once the invitation flow design lands.

## Non-goals / Out of scope

- Full OAuth device-code flow for agent onboarding. Defer until > 1 external agent operator exists.
- Replacing the in-house HMAC bearer codec with real JWTs (`jose`). Track separately if needed.
- Multi-node code deduplication of `request-identity.ts` / `session.ts`. Track separately.

## Validation

1. `curl -X POST /api/v1/agent/register -d '{"name":"x"}'` → 401 with no token header.
2. Admin session creates invitation → redeem succeeds → second redemption of same token → 401.
3. 24 h after minting without redemption → 401 expired.
4. Audit log shows one structured entry per attempt with `route_id=agent.register` and `outcome` field.
5. Candidate-a soak: 1000 unauthenticated register attempts per minute → RSS flat, no new users created, rate-limiter buckets observable in metrics.

## Notes

Discovered during review of PR #845. The circular-re-export OOM in that same PR has been fixed in-place; this item tracks the orthogonal security exposure that the review surfaced. Linking for context, not for blocking — this bug stands on its own.
