---
id: task.0210
type: task
title: "BYO-AI ChatGPT v0 — OAuth hardening + security review fixes"
status: needs_review
priority: 1
rank: 10
estimate: 1
summary: "Harden the paste-back OAuth PKCE flow: move verifier+state server-side, validate pasted URL origin, add refresh mutex. Addresses security review findings from the task.0192 implementation."
outcome: "PKCE verifier and state are server-held (encrypted cookie), pasted URL validated against expected redirect URI, concurrent refresh is safe. No changes to UX — paste-back flow stays the same."
spec_refs: [spec.tenant-connections]
assignees: [derekg1729]
credit:
project: proj.byo-ai
branch: feat/byo-ai-per-tenant
pr:
reviewer:
created: 2026-03-26
updated: 2026-03-26
labels: [ai, oauth, byo-ai, security]
external_refs:
  - work/items/task.0192.byo-ai-per-tenant-codex.md
revision: 1
blocked_by: []
deploy_verified: false
---

## Context

task.0192 shipped the end-to-end BYO-AI ChatGPT flow: profile page OAuth connect, AEAD-encrypted storage, DrizzleConnectionBrokerAdapter, CodexLlmAdapter, model picker, credit gate bypass. All tests pass. This task addresses security review findings before the branch merges to staging.

## Completed (task.0192)

- [x] OAuth PKCE authorize + exchange routes
- [x] AEAD encryption with AAD tenant binding (aead.ts + tests)
- [x] DrizzleConnectionBrokerAdapter with tenant verification
- [x] CodexLlmAdapter with temp auth cleanup
- [x] Profile page connect/disconnect UX
- [x] Model picker ChatGPT toggle
- [x] Credit gate bypass for BYO runs
- [x] Soft-delete revocation with audit trail
- [x] Tokens never logged (verified across all log calls)

## Security Review Findings

### P0 — Must fix before merge

- [x] **Verifier returned to client — PKCE nullified**: `/authorize` now stores verifier+state in signed HttpOnly cookie (next-auth/jwt encode, same pattern as link_intent). Response only returns `{ url }`.
- [x] **State not server-bound — CSRF nominal**: `/exchange` reads state from server cookie, validates against URL state. Client no longer sends verifier or state.

### P1 — Should fix before merge

- [x] **No origin validation on pasted URL**: `/exchange` now validates parsed URL origin+pathname matches `OPENAI_REDIRECT_URI` before extracting params.
- [x] **Concurrent token refresh race**: DrizzleConnectionBrokerAdapter uses per-connection in-memory mutex — concurrent callers wait for the in-progress refresh instead of racing.

### P2 — Track for next iteration

- [ ] **Refresh failure returns stale credentials**: When refresh fails, broker returns old blob silently. Downstream gets confusing 401. Consider marking connection degraded.
- [ ] **No encryption key rotation story**: Single `CONNECTIONS_ENCRYPTION_KEY` with `encryptionKeyId: "v1"` but no rotation code path.
- [ ] **Hardcoded Codex CLI client ID**: Using OpenAI's public Codex client — no control over revocation or scope changes.

## Design

### P0: Server-side verifier + state via encrypted cookie

**Approach**: Use the same link-intent cookie pattern already in the codebase. At `/authorize`, set an HttpOnly, SameSite=Lax, short-TTL cookie containing `{ verifier, state }` encrypted with `AUTH_SECRET`. At `/exchange`, read and consume the cookie, validate state from cookie against URL state, use verifier from cookie for token exchange.

**Cookie encryption**: Use `iron-session`-style sealed JWT or simple AES-GCM with AUTH_SECRET-derived key. Keep it simple — the cookie only lives ~5 minutes.

**Client changes**: `/authorize` response drops `verifier` and `state` fields — only returns `{ url }`. Client no longer holds or sends back PKCE params. `/exchange` body changes from `{ url, verifier, state }` to just `{ url }`.

### P1: Pasted URL validation

Add a check after `new URL(pastedUrl)`: verify `parsed.origin + parsed.pathname` matches `http://localhost:1455/auth/callback`. Reject with 400 if mismatch.

### P1: Refresh mutex

Add a simple in-memory mutex map keyed by connectionId. Before refresh, acquire lock. If already locked, wait for the in-progress refresh to complete and reuse its result. Release on completion.

## Files

- Modify: `apps/operator/src/app/api/v1/auth/openai-codex/authorize/route.ts` — set encrypted cookie, return only `{ url }`
- Modify: `apps/operator/src/app/api/v1/auth/openai-codex/exchange/route.ts` — read cookie, validate URL origin, drop client-sent verifier/state
- Modify: `apps/operator/src/app/(app)/profile/view.tsx` — remove verifier/state from client state, send only `{ url }` to exchange
- Modify: `apps/operator/src/adapters/server/connections/drizzle-broker.adapter.ts` — add refresh mutex

## Validation

- [ ] Connect flow still works end-to-end (paste-back UX unchanged)
- [ ] `/authorize` response contains only `{ url }` — no verifier or state
- [ ] `/exchange` rejects requests without valid cookie
- [ ] `/exchange` rejects pasted URLs with wrong origin
- [ ] State mismatch between cookie and URL is rejected
- [ ] Concurrent refresh calls don't invalidate each other's tokens

## PR / Links

- Handoff: [handoff](../handoffs/task.0210.handoff.md)
- [ ] `pnpm check` passes
