---
id: task.0089
type: task
title: "User bindings + identity events — schema, binding flows, backfill"
status: done
priority: 1
estimate: 2
summary: Add user_bindings table for wallet/Discord/GitHub account linking, add identity_events append-only audit trail, backfill existing wallet_address rows into user_bindings.
outcome: Every user has bindings for external accounts (proof in identity_events.payload); wallet_address backfilled; identity_events append-only with DB trigger; existing SIWE auth unchanged.
spec_refs:
  - decentralized-identity
  - authentication-spec
assignees: derekg1729
credit:
project: proj.decentralized-identity
branch: feat/user-identity-bindings
pr: https://github.com/Cogni-DAO/node-template/pull/454
reviewer:
created: 2026-02-18
updated: 2026-02-22
labels: [identity, auth]
external_refs:
revision: 2
blocked_by:
deploy_verified: false
rank: 25
---

# User Bindings + Identity Events — Schema, Binding Flows, Backfill

## Problem

Cogni identifies users by wallet address strings. Discord-first and GitHub-first users can't be attributed without a wallet. The fix: `users.id` (UUID) is the canonical identity, and wallet/Discord/GitHub are evidenced bindings in a `user_bindings` table with an append-only `identity_events` audit trail. No DID at this phase — DID is a P2 portability concern.

## Design

### Outcome

External accounts (wallet, Discord, GitHub) are linked to users via `user_bindings` (current-state index). Proof/evidence lives in `identity_events.payload` (append-only, DB-trigger-enforced). Existing wallet users are backfilled. No `SessionUser` changes needed — `id` is already `user_id`.

### Approach

**Solution**: Two new tables + wallet backfill + binding utility:

1. `user_bindings` table — provider + external_id, UNIQUE(provider, external_id). No evidence column — proof lives in identity_events.payload.
2. `identity_events` table — append-only audit trail (bind, revoke, merge) with DB trigger rejecting UPDATE/DELETE
3. Backfill migration: existing `users.wallet_address` → `user_bindings` rows
4. `createBinding()` utility for use in auth and future Discord/GitHub flows

**Reuses**:

- Existing SIWE `authorize()` flow in `src/auth.ts`
- Existing drizzle migration pipeline (`packages/db-schema`)
- Existing `SessionUser` type — no changes needed (`{ id, walletAddress }` is correct)
- Existing `users` table — no column changes needed

**Rejected**:

- Separate `contributors` table — "contributor" is a derived label, not an identity primitive
- `subject_did` column at P0 — DID deferred to P2 when federation is needed
- `did:key` / `did:pkh` derivation — no crypto dependencies needed for account linking
- Changing `SessionUser` — `id` is already `user_id`, which is the canonical identity

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] USER_ID_AT_CREATION: `users.id` (UUID) is the canonical identity — never wallet, Discord, or DID (spec: decentralized-identity)
- [ ] BINDINGS_ARE_EVIDENCED: Every binding has proof recorded in `identity_events.payload`. Bindings table is current-state index only. (spec: decentralized-identity)
- [ ] NO_AUTO_MERGE: `UNIQUE(provider, external_id)` on `user_bindings` — inserting an external_id already linked to another user for the same provider fails, never silently re-points (spec: decentralized-identity)
- [ ] APPEND_ONLY_EVENTS: `identity_events` rows are append-only; DB trigger rejects UPDATE/DELETE; revocation creates a new event, never deletes (spec: decentralized-identity)
- [ ] SIWE_UNCHANGED: Existing SIWE login flow continues working — bindings are additive (spec: authentication-spec)
- [ ] LEDGER_REFERENCES_USER: Receipts and epochs reference `user_id`, never wallet or DID (spec: decentralized-identity)
- [ ] SIMPLE_SOLUTION: Two tables, one utility, one backfill migration. No crypto deps, no DID, no new session fields.

### Files

- Create: `packages/db-schema/src/identity.ts` — `userBindings` + `identityEvents` table schemas
- Create: migration SQL — tables, indexes, append-only trigger, backfill
- Create: `src/adapters/server/identity/create-binding.ts` — `createBinding(provider, externalId, payload)` (INSERT binding + INSERT identity_event)
- Modify: `src/auth.ts` — on SIWE login, call `createBinding('wallet', address, { method: 'siwe', ... })`
- Modify: `packages/db-schema/src/index.ts` — add identity export
- Test: binding utility tests + auth callback binding creation test

## Implementation Notes

### Schema

Schema per [decentralized-identity spec §Schema](../../docs/spec/decentralized-identity.md#schema). Key points:

- `user_bindings`: no `evidence` column — proof lives in `identity_events.payload`
- `UNIQUE(provider, external_id)` — not bare `UNIQUE(external_id)` (GitHub numeric ID can equal Discord snowflake)
- `identity_events`: append-only DB trigger rejects UPDATE/DELETE (same pattern as ledger triggers)
- `NO_AUTO_MERGE`: DB-enforced via the composite unique constraint

### Backfill migration

```sql
-- Idempotent backfill: emit identity_events only for actually-inserted bindings
WITH inserted AS (
  INSERT INTO user_bindings (id, user_id, provider, external_id, created_at)
  SELECT
    gen_random_uuid()::text,
    u.id,
    'wallet',
    u.wallet_address,
    NOW()
  FROM users u
  WHERE u.wallet_address IS NOT NULL
  ON CONFLICT (provider, external_id) DO NOTHING
  RETURNING user_id, provider, external_id
)
INSERT INTO identity_events (id, user_id, event_type, payload, created_at)
SELECT
  gen_random_uuid()::text,
  i.user_id,
  'bind',
  jsonb_build_object('provider', i.provider, 'external_id', i.external_id, 'method', 'backfill:v0-migration'),
  NOW()
FROM inserted i;
```

Small user base — runs in seconds. `users.wallet_address` is kept for SIWE session coherence; `user_bindings` is the normalized binding table for multi-provider lookups.

### Auth flow changes (src/auth.ts)

In `authorize()`, after SIWE verification succeeds:

1. On **new user creation**:
   - Create user → `users.id` (existing behavior)
   - `createBinding('wallet', address, { method: 'siwe', ... })` → `user_bindings` INSERT + `identity_events` INSERT (proof in payload)
2. On **existing user login**:
   - `createBinding('wallet', address, { method: 'siwe', ... })` → ON CONFLICT(provider, external_id) DO NOTHING (idempotent)

No session type changes — `SessionUser { id, walletAddress }` is already correct.

### Discord + GitHub binding flows (future — not this task)

Discord and GitHub binding flows are P0 deliverables but tracked separately from this schema task. This task provides the tables and utility; binding UX is a follow-up.

## Validation

```bash
pnpm check        # type + lint
pnpm test          # unit tests pass
pnpm check:docs    # docs validation
```

- `createBinding()` correctly inserts binding + identity event (proof in payload)
- Backfill migration creates `user_bindings` rows + identity_events for existing wallet users
- Inserting a (provider, external_id) already linked to another user fails (NO_AUTO_MERGE)
- UPDATE/DELETE on identity_events rejected by DB trigger (APPEND_ONLY_EVENTS)
- SIWE login creates wallet binding idempotently
- Existing tests still pass (backward compat)

## Review Checklist

- [ ] **Work Item:** `task.0089` linked in PR body
- [ ] **Spec:** USER_ID_AT_CREATION, BINDINGS_ARE_EVIDENCED, NO_AUTO_MERGE upheld
- [ ] **Tests:** Binding utility tests + auth binding creation test
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Parent story: story.0079
- Spec: docs/spec/decentralized-identity.md
- Project: work/projects/proj.decentralized-identity.md
- Handoff: [handoff](../handoffs/task.0089.handoff.md)

## Attribution

-
