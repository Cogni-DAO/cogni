---
id: task.0093
type: task
title: "Ledger DB schema (6 tables) + core domain (model, rules, signing, errors)"
status: done
priority: 1
rank: 1
estimate: 3
summary: "Define 6 Drizzle tables with append-only DB triggers, plus pure domain logic: payout math (BIGINT, largest-remainder), domain-bound receipt hashing, and error classes."
outcome: "Schema migrated, append-only triggers enforced, core rules unit-tested. No ports/adapters/routes yet — just the foundation."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-v0
pr: https://github.com/Cogni-DAO/node-template/pull/452
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-02-20
updated: 2026-02-21
labels: [governance, ledger, schema]
external_refs:
---

# Ledger DB Schema + Core Domain

## Requirements

- 6 Drizzle tables in `packages/db-schema/src/ledger.ts`: `ledger_issuers`, `epochs`, `work_receipts`, `receipt_events`, `epoch_pool_components`, `payout_statements`
- All credit/unit columns use BIGINT (`mode: "bigint"`)
- No RLS in V0 — tables do NOT use `.enableRLS()`. Worker uses a service-role DB connection that would bypass RLS anyway; adding RLS without policies would brick queries.
- DB-level CHECK constraints on enum columns: `epochs.status` IN (`open`, `closed`), `work_receipts.role` IN (`author`, `reviewer`, `approver`), `receipt_events.event_type` IN (`proposed`, `approved`, `revoked`). Immutable tables cannot tolerate garbage values.
- Partial unique index on `epochs`: `UNIQUE (status) WHERE status = 'open'` (ONE_OPEN_EPOCH)
- Unique index on `work_receipts.idempotency_key` (IDEMPOTENT_RECEIPTS)
- Unique index on `payout_statements.epoch_id` (one statement per epoch)
- Index on `work_receipts(epoch_id)` for epoch receipt listing
- Index on `receipt_events(receipt_id, created_at DESC)` for latest-event-per-receipt queries
- `ledger_issuers` has boolean role columns: `can_issue`, `can_approve`, `can_close_epoch` (ISSUER_AUTHORIZED)
- Custom SQL migration with DB triggers rejecting UPDATE/DELETE on `work_receipts` (RECEIPTS_IMMUTABLE), `receipt_events` (EVENTS_APPEND_ONLY), and `epoch_pool_components` (POOL_IMMUTABLE)
- Pure domain logic in `packages/ledger-core/src/` (shared between app and `scheduler-worker` — worker cannot import from `src/`):
  - `model.ts` — receipt, epoch, pool component, payout statement types; role/event enums
  - `rules.ts` — `computePayouts(receipts, poolTotal)` with BIGINT arithmetic + largest-remainder rounding (ALL_MATH_BIGINT)
  - `signing.ts` — `buildReceiptMessage(fields)` returns the canonical domain-bound string per SIGNATURE_DOMAIN_BOUND; `hashReceiptMessage(msg)` returns SHA-256; `computeReceiptSetHash(receipts)` for epoch close
  - `errors.ts` — domain error classes (EpochNotOpenError, ReceiptSignatureInvalidError, IssuerNotAuthorizedError, EpochAlreadyClosedError, PoolComponentMissingError)
  - `index.ts` — barrel export
- `src/core/ledger/public.ts` — re-exports from `@cogni/ledger-core` so app code uses `@/core/ledger` unchanged
- All Ethereum addresses normalized to lowercase hex on write (ADDRESS_NORMALIZED) — EIP-55 checksum is UX-layer only
- UNIQUE(epoch_id, component_id) on `epoch_pool_components` (POOL_UNIQUE_PER_TYPE)
- Unit tests for payout math: edge cases (1 recipient, many recipients, zero units, exact division, remainder distribution)
- Unit tests for signing: canonical message format, hash determinism

## Allowed Changes

- `packages/db-schema/src/ledger.ts` (new)
- `packages/db-schema/src/index.ts` (add barrel export)
- `packages/db-schema/drizzle/migrations/` (new migration)
- `packages/ledger-core/` (new package: model.ts, rules.ts, signing.ts, errors.ts, index.ts, package.json, tsconfig.json)
- `src/core/ledger/public.ts` (re-export from `@cogni/ledger-core`)
- `src/core/public.ts` (add ledger re-export)
- `tests/unit/core/ledger/` (new test files — tests import from `@cogni/ledger-core`)

## Plan

- [x] Define 6 tables in `packages/db-schema/src/ledger.ts` following `billing.ts` patterns (BIGINT, CHECK constraints, indexes, no RLS)
- [x] Add `export * from "./ledger"` to `packages/db-schema/src/index.ts`
- [x] Generate Drizzle migration: `pnpm --filter @cogni/db-schema drizzle-kit generate`
- [x] Add custom SQL to migration for append-only triggers on `work_receipts`, `receipt_events`, and `epoch_pool_components`
- [x] Add UNIQUE(epoch_id, component_id) constraint on `epoch_pool_components` (POOL_UNIQUE_PER_TYPE)
- [x] Create `packages/ledger-core/` package with `package.json`, `tsconfig.json`, `tsup.config.ts`
- [x] Create `packages/ledger-core/src/model.ts` — types and enums
- [x] Create `packages/ledger-core/src/errors.ts` — domain errors with type guards
- [x] Create `packages/ledger-core/src/rules.ts` — `computePayouts()` with BIGINT largest-remainder
- [x] Create `packages/ledger-core/src/signing.ts` — canonical message builder + SHA-256 hashing
- [x] Create `packages/ledger-core/src/index.ts` barrel export
- [x] Create `src/core/ledger/public.ts` re-exporting from `@cogni/ledger-core`, update `src/core/public.ts`
- [x] Write unit tests for payout math and signing in `tests/unit/core/ledger/`

## Validation

**Command:**

```bash
pnpm check
pnpm test tests/unit/core/ledger/
```

**Expected:** Types pass, lint clean, all unit tests green. Migration file exists.

## Review Checklist

- [ ] **Work Item:** `task.0093` linked in PR body
- [x] **Spec:** RECEIPTS_IMMUTABLE, EVENTS_APPEND_ONLY, POOL_IMMUTABLE, POOL_UNIQUE_PER_TYPE, ONE_OPEN_EPOCH, IDEMPOTENT_RECEIPTS, ALL_MATH_BIGINT, SIGNATURE_DOMAIN_BOUND, ISSUER_AUTHORIZED, ADDRESS_NORMALIZED upheld
- [x] **Tests:** payout math edge cases, signing determinism, largest-remainder correctness
- [ ] **Reviewer:** assigned and approved

## Review Feedback

### Revision 1 — Blocking Issues

1. **Domain code in wrong location** — Must be in `packages/ledger-core/` (not `src/core/ledger/`) per design review. `services/scheduler-worker/` cannot import from `src/`. Create the package, move `model.ts`, `rules.ts`, `signing.ts`, `errors.ts` there, update `src/core/ledger/public.ts` to re-export from `@cogni/ledger-core`.

2. **`receipt_events` index missing DESC** — `ledger.ts:154-157` and migration line 85 create ASC index on `(receipt_id, created_at)`. Spec requires `(receipt_id, created_at DESC)` for LATEST_EVENT_WINS queries.

3. **`share` computation wrong for 100% share** — `rules.ts:122-125` hardcodes `"0."` prefix. Single-recipient produces `"0.1000000"` (10%) instead of `"1.000000"`. Fix: compute whole and fractional parts separately.

4. **No test coverage for `share` field** — Add assertions on `share` values in `rules.test.ts` (single-recipient 100%, 50/50 split, etc.).

## Activity-Ingestion Revision Notes

> Added 2026-02-21: The P0 scope has been revised from per-receipt wallet signing to automated activity ingestion. This task's deliverables are assessed below.

**Reused unchanged:**

- `computePayouts()` in `rules.ts` — exact same BIGINT largest-remainder math
- `ApprovedReceipt` type — used to feed `computePayouts()` from `epoch_allocations`
- `epoch_pool_components` table — defines credit budget (unchanged)
- `payout_statements` table — deterministic output (unchanged)
- `errors.ts` — `EpochNotOpenError`, `EpochAlreadyClosedError`, `PoolComponentMissingError` still relevant
- Append-only DB trigger pattern — reused for `activity_events`

**Dropped (replaced by activity-ingestion model):**

- `work_receipts` table + append-only trigger — replaced by `activity_events`
- `receipt_events` table + append-only trigger — replaced by `epoch_allocations`
- `ledger_issuers` table — replaced by simple admin check via existing SIWE + users
- `signing.ts` module (`buildReceiptMessage`, `hashReceiptMessage`, `computeReceiptSetHash`) — removed from `packages/ledger-core/`
- `ReceiptSignatureInvalidError`, `IssuerNotAuthorizedError` error classes — removed
- `SigningContext`, `ReceiptMessageFields` types — removed
- `policy_repo`, `policy_commit_sha`, `policy_path`, `policy_content_hash` columns on `epochs` — replaced by `weight_config`

Previous migrations (0010, 0011) have not shipped — delete them and regenerate fresh via `drizzle-kit generate` with the revised schema in task.0094.

**New schema (task.0094 generates a single fresh migration):**

- `epochs` table revised: add `period_start`, `period_end`, `weight_config`; remove policy columns
- `activity_events` table (append-only, provenance fields)
- `epoch_allocations` table (proposed + final units)
- `source_cursors` table (adapter sync state)
- `epoch_pool_components` table (unchanged)
- `payout_statements` table (unchanged)

## PR / Links

- Handoff: [handoff](../handoffs/task.0093.handoff.md)

## Attribution

-
