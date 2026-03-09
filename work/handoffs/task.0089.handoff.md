---
id: task.0089.handoff
type: handoff
work_item_id: task.0089
status: active
created: 2026-02-22
updated: 2026-02-22
branch: feat/user-identity-bindings
last_commit: "15c9ed3b"
---

# Handoff: User Identity Bindings — Schema, Binding Flows, Backfill

## Context

- CogniDAO needs auth-method-agnostic identity: `users.id` (UUID) is the canonical identity, and wallet/Discord/GitHub are evidenced bindings — never the identity itself
- This task adds `user_bindings` (current-state index) and `identity_events` (append-only audit trail) tables to support multi-provider account linking
- The activity-ingestion pipeline (proj.transparent-credit-payouts) depends on this for attributing GitHub/Discord activity to users
- No DID/VC at this phase — DID is a P2 portability concern. No new session fields or crypto dependencies.

## Current State

- **Schema done**: `user_bindings` + `identity_events` Drizzle definitions in `packages/db-schema/src/identity.ts`
- **Migrations done**: 0012 (DDL + constraints + indexes) and 0013 (append-only trigger + wallet backfill)
- **`createBinding()` done**: Transactional utility at `src/adapters/server/identity/create-binding.ts` — inserts binding + identity event atomically, idempotent via ON CONFLICT DO NOTHING
- **Auth integration done**: `src/auth.ts` SIWE login calls `createBinding('wallet', address, { method: 'siwe', ... })` on every login
- **Tests done**: 3 unit tests covering new binding creation, idempotency, and multi-provider
- **Package wiring done**: identity slice exported from db-schema package, tsup config, shared schema barrel
- **Status**: `needs_closeout` — implementation complete, needs docs pass + PR creation
- **All checks pass**: `pnpm check` clean (typecheck, lint, format, 905 tests, docs, arch)

## Decisions Made

- **UNIQUE(provider, external_id)** not bare UNIQUE(external_id) — GitHub numeric ID can equal a Discord snowflake ([spec: NO_AUTO_MERGE](../../docs/spec/decentralized-identity.md#invariants))
- **No `evidence` column on `user_bindings`** — proof lives solely in `identity_events.payload` ([spec: BINDINGS_ARE_EVIDENCED](../../docs/spec/decentralized-identity.md#invariants))
- **Append-only trigger reuses `ledger_reject_mutation()`** from migration 0011 — same function, new trigger on `identity_events`
- **`createBinding()` lives in `src/adapters/server/identity/`** not `packages/db-schema/` — business logic doesn't belong in the schema package
- **`Database` type from `@cogni/db-client`** used instead of `PgDatabase<any>` — matches existing adapter patterns and satisfies exactOptionalPropertyTypes
- **Wallet backfill is idempotent** — CTE with RETURNING ensures identity_events only emitted for actually-inserted bindings

## Next Actions

- [ ] Run `/closeout 0089` — docs pass (AGENTS.md, file headers) + PR creation to staging
- [ ] Reviewer approval + merge to staging
- [ ] Verify migration runs cleanly on staging DB (backfill creates bindings for existing wallet users)
- [ ] Begin task.0094 (ActivityLedgerStore port + adapter) — next on the critical path for proj.transparent-credit-payouts
- [ ] Begin task.0097 (GitHub + Discord source adapters) — blocked by this task + task.0094

## Risks / Gotchas

- **Migration 0011 snapshot collision was fixed** — 0010 and 0011 had identical snapshot IDs (same `id`/`prevId`). Fixed by giving 0011 a new unique ID with `prevId` pointing to 0010. If `drizzle-kit generate` complains, check snapshot chain continuity.
- **Backfill assumes small user base** — runs in a single transaction. If user count grows significantly before migration runs, may need batching.
- **`createBinding()` is fire-and-forget in auth** — if the binding INSERT fails (e.g. DB down), the SIWE login still succeeds. The binding is additive, not required for auth.
- **Discord/GitHub binding flows are NOT in this task** — this provides the schema and utility; actual OAuth binding UX is a follow-up.

## Pointers

| File / Resource                                                                        | Why it matters                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `docs/spec/decentralized-identity.md`                                                  | Authoritative spec — 8 invariants, schema, auth flow, file pointers |
| `work/items/task.0089.user-identity-bindings.md`                                       | Work item — requirements, design, validation criteria               |
| `packages/db-schema/src/identity.ts`                                                   | `userBindings` + `identityEvents` table definitions                 |
| `src/adapters/server/identity/create-binding.ts`                                       | `createBinding()` — transactional binding + event INSERT            |
| `src/auth.ts:148-153`                                                                  | SIWE integration point — `createBinding('wallet', ...)` call        |
| `src/adapters/server/db/migrations/0012_chief_vargas.sql`                              | DDL migration — tables, constraints, indexes                        |
| `src/adapters/server/db/migrations/0013_identity_append_only_trigger_and_backfill.sql` | Trigger + wallet backfill migration                                 |
| `tests/unit/adapters/server/identity/create-binding.test.ts`                           | 3 unit tests — new binding, idempotency, multi-provider             |
| `work/projects/proj.decentralized-identity.md`                                         | Parent project — identity roadmap                                   |
| `work/projects/proj.transparent-credit-payouts.md`                                     | Consumer — ledger pipeline depends on identity bindings             |
