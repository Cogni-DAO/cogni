---
id: bug.0297
type: bug
title: "POST /api/v1/agent/register is an unauthenticated account + API-key factory"
status: needs_design
priority: 1
rank: 5
estimate: 3
summary: "PR #845 exposed /api/v1/agent/register in the proxy's public allowlist. Anyone on the internet can POST a name and receive a fresh user row plus a 30-day signed API key. No auth, no rate limit, no audit trail."
outcome: "Register is closed by default: only a holder of a short-lived, admin-minted invitation token can redeem it for an API key. One redemption per invitation. Rate-limited. All attempts auditable."
spec_refs: [security-auth]
assignees: derekg1729
credit:
project: proj.accounts-api-keys
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-13
updated: 2026-04-13
labels: [security, auth]
external_refs:
  - https://github.com/Cogni-DAO/cogni-template/pull/845
---

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
