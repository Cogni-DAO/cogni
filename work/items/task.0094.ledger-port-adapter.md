---
id: task.0094
type: task
title: "Ledger port interface + Drizzle adapter + schema migration + container wiring"
status: done
priority: 1
rank: 2
estimate: 2
summary: "Define ActivityLedgerStore port in @cogni/attribution-ledger, implement DrizzleAttributionAdapter in @cogni/db-client, add three-layer schema migration (activity_events/activity_curation/epoch_allocations/source_cursors/statement_signatures + epochs/epoch_pool_components/payout_statements modifications), wire into bootstrap container."
outcome: "ActivityLedgerStore port with CRUD for activity events, curation, allocations, cursors, epochs, pool, statements, and signatures. Single DrizzleAttributionAdapter shared by app + worker. Container exposes activityLedgerStore. All node_id scoped."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/activity-ledger-v0
pr: https://github.com/Cogni-DAO/node-template/pull/456
reviewer:
revision: 1
blocked_by: task.0093
deploy_verified: false
created: 2026-02-20
updated: 2026-02-21
labels: [governance, ledger, adapter]
external_refs:
---

# Ledger Port + Drizzle Adapter + Schema Migration

## Design

### Three-Layer Immutability Model

- **Layer 1 (Raw Activity)**: `activity_events` — append-only facts. DB trigger rejects UPDATE/DELETE. No `user_id` column — identity resolution happens at curation layer. No `epoch_id` — epoch membership assigned in curation.
- **Layer 2 (Curation)**: `activity_curation` — admin decisions about event inclusion, identity resolution, weight overrides. Mutable while epoch open, frozen by trigger when epoch closes (CURATION_FREEZE_ON_CLOSE).
- **Layer 3 (Ledger Statement)**: `payout_statements` + `statement_signatures` — derived, immutable artifacts. Post-signing corrections use `supersedes_statement_id`.

### Key Decisions

- `node_id UUID` on all ledger tables (NODE_SCOPED)
- Port interface in `@cogni/attribution-ledger` (shared by app + worker)
- Single `DrizzleAttributionAdapter` in `@cogni/db-client` (no duplication)
- Old migrations 0010 + 0011 deleted (never shipped), replaced with 0014 (DDL) + 0015 (triggers)

## Implementation Summary

### Completed

- [x] `packages/ledger-core/src/model.ts` — removed receipt types, renamed `ApprovedReceipt` → `FinalizedAllocation`
- [x] `packages/ledger-core/src/errors.ts` — removed `ReceiptSignatureInvalidError`, `IssuerNotAuthorizedError`
- [x] `packages/ledger-core/src/signing.ts` — deleted, replaced by `hashing.ts`
- [x] `packages/ledger-core/src/hashing.ts` — `computeAllocationSetHash()`
- [x] `packages/ledger-core/src/store.ts` — `ActivityLedgerStore` interface + all param/result types
- [x] `packages/ledger-core/src/index.ts` — updated barrel exports
- [x] `packages/db-schema/src/ledger.ts` — full rewrite: 8 tables, 3-layer model, node_id
- [x] `migrations/0014_supreme_captain_marvel.sql` — DDL for all new tables
- [x] `migrations/0015_ledger_triggers.sql` — append-only + freeze-on-close triggers
- [x] `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` — single shared adapter
- [x] `packages/db-client/package.json` — added `@cogni/attribution-ledger` dependency
- [x] `packages/db-client/tsconfig.json` — added ledger-core reference
- [x] `src/ports/ledger-store.port.ts` — port re-export
- [x] `src/ports/index.ts` — added ledger exports
- [x] `src/shared/db/schema.ts` — added `@cogni/db-schema/ledger` re-export
- [x] `src/shared/env/server-env.ts` — added `NODE_ID` env var (UUID)
- [x] `src/bootstrap/container.ts` — wired `activityLedgerStore`
- [x] `src/core/ledger/public.ts` — updated re-exports
- [x] `src/core/public.ts` — updated re-exports
- [x] `tests/unit/core/ledger/rules.test.ts` — updated for `FinalizedAllocation`
- [x] `tests/unit/core/ledger/hashing.test.ts` — new unit test
- [x] `tests/_fixtures/env/base-env.ts` — added `NODE_ID`
- [x] `docs/spec/epoch-ledger.md` — updated schema + invariants
- [x] `packages/ledger-core/src/errors.ts` — added `EpochNotFoundError`, `AllocationNotFoundError` + type guards (review fix)
- [x] `packages/db-client/src/adapters/drizzle-ledger.adapter.ts` — `closeEpoch` distinguishes not-found vs already-closed; `updateAllocationFinalUnits` throws on missing allocation (review fix)
- [x] `scripts/validate-docs-metadata.mjs` — added `needs_review` to valid status enum
- [x] File header DH004 fixes (scope negative clause on both new files)

### Remaining

- [ ] `tests/component/db/drizzle-ledger.adapter.int.test.ts` — component test against real DB (testcontainers)

## Validation

```bash
pnpm check                     # typecheck + lint + format
pnpm test                      # unit tests (existing + new)
pnpm check:docs                # docs validation
```

**Status:** typecheck pass, arch:check pass, all 1028 unit tests pass.

## Review Checklist

- [ ] **Work Item:** `task.0094` linked in PR body
- [ ] **Spec:** ACTIVITY_APPEND_ONLY, ACTIVITY_IDEMPOTENT, CURATION_FREEZE_ON_CLOSE, NODE_SCOPED, EPOCH_WINDOW_UNIQUE
- [ ] **Tests:** unit tests pass, contract test covers port methods
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0094.handoff.md)

## Attribution

-
