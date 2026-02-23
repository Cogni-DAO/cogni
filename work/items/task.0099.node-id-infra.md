---
id: task.0099
type: task
title: "Node + scope identity infra: repo-spec, DB persistence, scope_id columns, boot-time drift protection"
status: needs_design
priority: 1
rank: 3
estimate: 3
summary: "Make node_id and scope_id real, persisted identities: node_id generated at init, scope_id as UUID (uuidv5(node_id, scope_key)) with multi-scope via .cogni/projects/*.yaml. Both persisted in DB, validated on boot."
outcome: "Every deployment has a stable node_id; ledger tables carry scope_id UUID NOT NULL; composite invariants (node_id, scope_id) enforced at DB level; .cogni/projects/*.yaml manifests are the source of truth for named scopes; startup fails on node_id mismatch."
labels: [ledger, infra, identity]
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
created: 2026-02-21
updated: 2026-02-22
---

# Node ID infra (MVP)

## Requirements

### node_id (deployment identity)

- **Repo-spec**: add `node_id: <uuid>` (minted during the "generate DAO / init" flow).
- **DB**: add `node_meta` (or `nodes`) table with `node_id UUID PRIMARY KEY`, `created_at TIMESTAMPTZ DEFAULT now()`.
- **Boot rule**:
  - If table empty → insert `node_id` from repo-spec (fallback: `NODE_ID` env var for legacy).
  - If table has value → **hard fail** if it doesn't match repo-spec (or env fallback).
- **Clone safety**: init to generate a new UUID if repo-spec lacks node_id; refuse to overwrite unless `--force`.

### scope_id (governance/payout domain)

- **Ledger schema**: add `scope_id UUID NOT NULL` to all epoch-level tables: `epochs`, `activity_events`, `source_cursors`, `epoch_allocations` (via epoch FK), `epoch_pool_components` (via epoch FK), `payout_statements` (via epoch FK). `scope_id` is derived deterministically: `uuidv5(node_id, scope_key)`.
- **Composite constraints**:
  - `ONE_OPEN_EPOCH` → `UNIQUE(node_id, scope_id, status) WHERE status = 'open'`
  - `EPOCH_WINDOW_UNIQUE` → `UNIQUE(node_id, scope_id, period_start, period_end)`
  - `source_cursors` PK → `(node_id, scope_id, source, stream, source_scope)`
- **Index update**: `activity_events` index `(node_id, event_time)` → `(node_id, scope_id, event_time)`.
- **V0 default**: `scope_key = 'default'`, `scope_id = uuidv5(node_id, 'default')` declared in `repo-spec.yaml`. No `.cogni/projects/` directory required for V0.
- **Manifest discovery**: When `.cogni/projects/*.yaml` files exist, read them at boot and validate that any `scope_id` values in the DB match declared scopes. Log a warning (not hard fail) for unrecognized scopes — they may be leftover from a removed project.
- **Validation at ingestion**: Activity events must have their `scope_id` validated against current manifests at ingestion time (SCOPE_VALIDATED invariant). Unrecognized scope IDs are rejected, not silently dropped.

## Allowed Changes

- `packages/db-schema/src/*` + new migration (node_meta table + scope_id columns + composite constraints)
- `src/shared/env/*` (read node_id from repo-spec / env fallback)
- `src/shared/config/*` (read `.cogni/projects/*.yaml` manifests for scope registry)
- `src/bootstrap/*` (seed + assert for node_id; scope manifest discovery)
- `repo-spec.yaml` schema + setup/init script that writes it
- Minimal unit test for "seed once + mismatch fails"
- Minimal unit test for "scope_id DEFAULT 'default' on epoch insert"

## Plan

### node_id

- [ ] Add `node_meta` table + migration
- [ ] Read `node_id` from repo-spec; fallback to `NODE_ID` env for existing deployments
- [ ] Implement seed/assert in bootstrap
- [ ] Update setup/init script to mint `node_id` and write to repo-spec
- [ ] Add test: mismatch triggers startup error

### scope_id

- [ ] Add `scope_id UUID NOT NULL` column to `epochs`, `activity_events`, `source_cursors` in `packages/db-schema/src/ledger.ts`
- [ ] Update composite unique constraints/indexes to include `scope_id`
- [ ] Migration: add column with default (zero-downtime for existing rows)
- [ ] Add scope manifest reader: parse `.cogni/projects/*.yaml` → `Map<scopeId, ProjectManifest>`
- [ ] Add SCOPE_VALIDATED check in ingestion path (reject unknown scope_ids)
- [ ] Add test: epoch insert requires explicit scope_id UUID (no default)
- [ ] Add test: `ONE_OPEN_EPOCH` enforced per (node_id, scope_id) — two scopes can each have an open epoch

## Identity Semantics

`node_id` is **deployment identity only** — it identifies the running instance (one DB, one infra, one `docker compose up`). It must never be overloaded for governance domain or epoch scoping.

`scope_id` is **governance/payout domain** — it identifies which project an epoch belongs to. V0: always `'default'`. Multi-scope activates when `.cogni/projects/*.yaml` manifests are added.

See [identity-model.md](../../docs/spec/identity-model.md) for the full taxonomy and [epoch-ledger.md §Project Scoping](../../docs/spec/epoch-ledger.md#project-scoping) for composite invariants.

## Validation

### node_id

- Fresh DB + repo-spec node_id → boots and seeds
- Existing DB seeded + matching config → boots
- Mismatch (DB != config) → **fails fast**

### scope_id

- Epoch insert with no explicit scope_id → `scope_id = 'default'`
- Two scopes can each have one open epoch simultaneously (composite constraint)
- Ingestion rejects events with unrecognized scope_id (SCOPE_VALIDATED)
- No `.cogni/projects/` directory → single `'default'` scope (V0 compat)
