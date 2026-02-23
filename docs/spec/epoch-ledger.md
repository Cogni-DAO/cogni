---
id: epoch-ledger-spec
type: spec
title: "Epoch Ledger: Weekly Activity Pipeline for Credit Payouts"
status: draft
spec_state: proposed
trust: draft
summary: "Epoch-based ledger where source adapters ingest contribution activity (GitHub, Discord), the system proposes credit allocations via weight policy, and an admin finalizes the distribution. Payouts are deterministic and recomputable from stored data."
read_when: Working on credit payouts, activity ingestion, epoch lifecycle, weight policy, source adapters, or the ledger API.
implements: proj.transparent-credit-payouts
owner: derekg1729
created: 2026-02-20
verified: 2026-02-23
tags: [governance, transparency, payments, ledger]
---

# Epoch Ledger: Weekly Activity Pipeline for Credit Payouts

> The system is a **transparent activity-to-payout pipeline**. Every week it collects contribution activity from configured sources (GitHub, Discord), attributes events to contributors via identity bindings, proposes a credit distribution using a weight policy, and lets an admin finalize the result. Payouts are deterministic and recomputable from stored data. No server-held signing keys in V0.

## Key References

|              |                                                                                           |                                                            |
| ------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Project**  | [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) | Project roadmap                                            |
| **Spike**    | [spike.0082](../../work/items/spike.0082.transparency-log-design.md)                      | Original design research                                   |
| **Research** | [epoch-event-ingestion-pipeline](../research/epoch-event-ingestion-pipeline.md)           | Ingestion pipeline research                                |
| **Spec**     | [billing-evolution](./billing-evolution.md)                                               | Existing billing/credit system                             |
| **Spec**     | [architecture](./architecture.md)                                                         | System architecture                                        |
| **Spec**     | [decentralized-identity](./decentralized-user-identity.md)                                | Identity bindings (user_bindings)                          |
| **Spec**     | [identity-model](./identity-model.md)                                                     | All identity primitives (node_id, scope_id, user_id, etc.) |

## Core Invariants

| Rule                        | Constraint                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACTIVITY_APPEND_ONLY        | DB trigger rejects UPDATE/DELETE on `activity_events`. Once ingested, activity records are immutable facts.                                                                                                                                                                                                                      |
| ACTIVITY_IDEMPOTENT         | `activity_events.id` is deterministic from source data (e.g., `github:pr:owner/repo:42`). Re-ingestion of the same event is a no-op (PK conflict → skip).                                                                                                                                                                        |
| POOL_IMMUTABLE              | DB trigger rejects UPDATE/DELETE on `epoch_pool_components`. Once recorded, a pool component's algorithm, inputs, and amount cannot be changed.                                                                                                                                                                                  |
| IDENTITY_BEST_EFFORT        | Activity events carry `platform_user_id` and optional `platform_login`. Resolution to `user_id` via `user_bindings` is best-effort. Unresolved events have `user_id = NULL` and are excluded from allocation until resolved.                                                                                                     |
| ADMIN_FINALIZES_ONCE        | An admin reviews proposed allocations, optionally adjusts `final_units`, then triggers finalize. Single action closes the epoch — no per-event approval workflow.                                                                                                                                                                |
| APPROVERS_PER_SCOPE         | Each scope declares its own `approvers[]` list. Epoch finalize requires 1-of-N EIP-191 signature from the scope's approvers. V0: single scope, single approver in repo-spec. Multi-scope: each `.cogni/projects/*.yaml` carries its own list.                                                                                    |
| SIGNATURE_SCOPE_BOUND       | Signed message must include `node_id + scope_id + allocation_set_hash`. Prevents cross-scope and cross-node signature replay.                                                                                                                                                                                                    |
| EPOCH_THREE_PHASE           | Epochs progress through `open → review → finalized`. No backward transitions. `open`: ingest + curate. `review`: ingestion closed, curation still allowed. `finalized`: immutable forever.                                                                                                                                       |
| INGESTION_CLOSED_ON_REVIEW  | DB trigger rejects INSERT on `activity_events` for epochs with `status IN ('review', 'finalized')`. Raw facts locked once review begins; late arrivals rejected. Curation (inclusion, weight overrides, identity resolution) remains mutable.                                                                                    |
| WEIGHTS_INTEGER_ONLY        | All weight values are integer milli-units (e.g., 8000 for PR merged, 500 for Discord message). No floating point anywhere (ALL_MATH_BIGINT).                                                                                                                                                                                     |
| PAYOUT_DETERMINISTIC        | Given final allocations + pool components → the payout statement is byte-for-byte reproducible.                                                                                                                                                                                                                                  |
| ALL_MATH_BIGINT             | No floating point in unit or credit calculations. All math uses BIGINT with largest-remainder rounding.                                                                                                                                                                                                                          |
| EPOCH_FINALIZE_IDEMPOTENT   | Finalizing a finalized epoch returns the existing statement. No error, no mutation.                                                                                                                                                                                                                                              |
| ONE_ACTIVE_EPOCH            | Partial unique index enforces at most one epoch with `status != 'finalized'` per `(node_id, scope_id)` pair.                                                                                                                                                                                                                     |
| EPOCH_WINDOW_UNIQUE         | `UNIQUE(node_id, scope_id, period_start, period_end)` prevents duplicate epochs for the same time window per scope. Re-collection uses the existing epoch.                                                                                                                                                                       |
| CURATION_FREEZE_ON_FINALIZE | DB trigger rejects INSERT/UPDATE/DELETE on `activity_curation` when the referenced epoch has `status = 'finalized'`. Curation is mutable during `open` and `review`, immutable only after finalize.                                                                                                                              |
| CURATION_AUTO_POPULATE      | Auto-population inserts curation rows for new events and updates `user_id` only on rows where it's NULL. Never overwrites admin-set fields (`included`, `weight_override_milli`, `note`). Delta processing: skip events already curated with a resolved `user_id`.                                                               |
| NODE_SCOPED                 | All ledger tables include `node_id UUID NOT NULL`. Per node-operator-contract spec, prevents collisions in multi-node scenarios.                                                                                                                                                                                                 |
| SCOPE_SCOPED                | All epoch-level tables include `scope_id TEXT NOT NULL DEFAULT 'default'`. `scope_id` identifies the governance/payout domain (project) within a node. See [Project Scoping](#project-scoping).                                                                                                                                  |
| SCOPE_VALIDATED             | Every activity event's `scope_id` must be validated against current project manifests (`.cogni/projects/*.yaml`) or resolve to the `'default'` fallback scope. Unrecognized scope IDs are rejected at ingestion time.                                                                                                            |
| POOL_REPRODUCIBLE           | `pool_total_credits = SUM(epoch_pool_components.amount_credits)`. Each component stores algorithm version + inputs + amount.                                                                                                                                                                                                     |
| POOL_UNIQUE_PER_TYPE        | `UNIQUE(epoch_id, component_id)` — each component type appears at most once per epoch.                                                                                                                                                                                                                                           |
| POOL_REQUIRES_BASE          | At least one `base_issuance` component must exist before epoch finalize is allowed.                                                                                                                                                                                                                                              |
| WRITES_VIA_TEMPORAL         | All write operations (collect, finalize) execute in Temporal workflows via the existing `scheduler-worker` service. Next.js routes return 202 + workflow ID.                                                                                                                                                                     |
| PROVENANCE_REQUIRED         | Every activity event includes `producer`, `producer_version`, `payload_hash`, `retrieved_at`. Audit trail for reproducibility.                                                                                                                                                                                                   |
| SCOPE_GATED_QUERIES         | `DrizzleLedgerAdapter` takes `scopeId` at construction. Every epochId-based read/write calls `resolveEpochScoped(epochId)` — `WHERE id = $epochId AND scope_id = $scopeId`. Scope mismatches throw `EpochNotFoundError` (indistinguishable from missing epoch). No port signature changes; scope is an adapter-internal concern. |
| CURSOR_STATE_PERSISTED      | Source adapters use `source_cursors` table for incremental sync. Avoids full-window rescans and handles pagination/rate limits.                                                                                                                                                                                                  |
| ADAPTERS_NOT_IN_CORE        | Source adapters live in `services/scheduler-worker/` behind a port interface. `packages/ledger-core/` contains only pure domain logic (types, rules, errors).                                                                                                                                                                    |
| WEIGHT_PINNING              | Weight config is pinned at epoch creation. Subsequent collection runs on the same epoch use the existing epoch's `weight_config`, not the input-derived config. Config drift logs a warning.                                                                                                                                     |
| EPOCH_WINDOW_DETERMINISTIC  | Epoch boundaries computed by `computeEpochWindowV1()` — pure function, Monday-aligned UTC, anchored to 2026-01-05. Same `(asOf, epochLengthDays)` always yields the same window.                                                                                                                                                 |

## Project Scoping

The ledger uses two orthogonal scoping keys:

- **`node_id`** (UUID) — Deployment identity. Identifies the running instance. One node = one database, one set of infrastructure, one `docker compose up`. Never overloaded for governance semantics. See [identity-model spec](./identity-model.md).
- **`scope_id`** (TEXT) — Governance/payout domain. Identifies which **project** an epoch, its activity, and its payouts belong to. A project is a human-defined ownership boundary (e.g., "chat service", "shared infrastructure", "code review daemon") with its own DAO, weight policy, and payment rails.

**Terminology:** "Project" is the human concept. `scope_id` is the canonical database key. `scope_id` is not necessarily a filesystem path — path-based routing is one resolver strategy, but scopes can also be assigned by repository, by label, or by explicit declaration.

**V0 default:** All nodes start with a single scope: `scope_id = 'default'`. The `DEFAULT 'default'` column constraint means existing single-project nodes require zero migration. Multi-scope support activates when `.cogni/projects/*.yaml` manifests are added.

**Composite invariants:**

- `ONE_ACTIVE_EPOCH` → `UNIQUE(node_id, scope_id) WHERE status != 'finalized'`
- `EPOCH_WINDOW_UNIQUE` → `UNIQUE(node_id, scope_id, period_start, period_end)`
- Workflow IDs include scope: `ledger-collect-{scopeId}-{periodStart}-{periodEnd}`

**Scope resolution at ingestion:**

1. Activity event arrives (e.g., a merged PR touching `apps/chat/src/thread.ts`)
2. Resolver maps the event to a `scope_id` using project manifest rules (file path patterns, repository name, explicit labels)
3. If the resolved `scope_id` is not in the current manifest set, the event is **rejected** (not silently dropped, not assigned to default)
4. Events touching files in multiple scopes generate **one event per scope** (the same PR can attribute to multiple projects)

**Scope validation:** The `scope_id` on every `activity_events` row must reference a scope declared in `.cogni/projects/*.yaml` (or be `'default'`). This is enforced at the application layer during ingestion — not via FK constraint, since manifests are YAML files, not DB rows.

## Design

### System Architecture

**Next.js** handles authentication (SIWE), authorization (admin check), read queries (direct DB), and write request enqueuing (start Temporal workflow, return 202).

**Temporal worker** (`services/scheduler-worker/`) handles all write/compute actions: activity collection via source adapters, identity resolution, allocation computation, epoch finalization. All workflows are idempotent via deterministic workflow IDs. The worker imports pure domain logic from `@cogni/ledger-core` and DB operations from `@cogni/db-client`.

**`packages/ledger-core/`** contains pure domain logic shared between the app and the worker: model types, `computePayouts()`, `computeProposedAllocations()`, and error classes. `src/core/ledger/public.ts` re-exports from this package so app code uses `@/core/ledger`.

**Postgres** stores the append-only activity events with DB-trigger enforcement of immutability.

### Auth Model (V0 — Simplified)

SIWE wallet login provides `{ id, walletAddress }` in the session. Authorization is a per-scope wallet allowlist — no multi-role `ledger_issuers` table in V0.

**Approver configuration** follows the repo-spec pattern (committed to repo, no env override, same as `node_id` and `dao_contract`):

```yaml
# .cogni/repo-spec.yaml — V0 default scope
ledger:
  approvers:
    - "0xYourWalletAddress"
```

V0 has one scope (`default`), so `ledger.approvers` in repo-spec.yaml is the single source of truth. When multi-scope activates, each `.cogni/projects/*.yaml` carries its own `ledger.approvers[]` list, overriding the repo-spec default for that scope.

Loaded via `getLedgerConfig()` in `repoSpec.server.ts`, validated by Zod schema (array of EVM addresses), cached at startup.

Admin capability (wallet must be in scope's `approvers[]`) required for:

- Triggering activity collection (or let Temporal cron handle it)
- Adjusting allocation `final_units`
- Triggering epoch finalize
- Recording pool components
- Signing payout statements (EIP-191, required before finalize)

Public read routes expose closed-epoch data only (epochs list, allocations, statements). Activity events (PII fields: platformUserId, platformLogin, artifactUrl) require SIWE authentication. Open/current epoch data requires SIWE authentication.

### Activity Ingestion

Source adapters collect contribution activity from external systems and normalize it into `activity_events`. Each adapter:

1. **Connects** to one external system via official OSS client (`@octokit/graphql`, `discord.js`)
2. **Fetches** events since last cursor (or within the epoch time window)
3. **Normalizes** to `ActivityEvent` with deterministic ID, provenance fields, and platform identity
4. **Inserts** idempotently (PK conflict = skip)

Identity resolution happens after ingestion: lookup `user_bindings` (from [decentralized-identity spec](./decentralized-user-identity.md)) to map `(source, platform_user_id)` → `user_id`. Unresolved events are flagged for admin attention.

### Weight Policy

Credit allocation uses a simple per-event-type weight configuration stored as integer milli-units:

```jsonc
// Example weight_config (stored in epoch.weight_config JSONB)
{
  "github:pr_merged": 8000, // 8.000 units
  "github:review_submitted": 2000, // 2.000 units
  "github:issue_closed": 1000, // 1.000 units
  "discord:message_sent": 500, // 0.500 units
}
```

Proposed allocation per user = SUM of weights for their attributed events. The weight config is pinned per epoch (stored in the epoch row) for reproducibility. V0 derives weights from `activitySources` keys via `deriveWeightConfigV0()` — a pure, deterministic mapping (e.g., `github` → `github:pr_merged: 1000, github:review_submitted: 500, github:issue_closed: 300`). If an epoch already exists, its pinned config takes precedence over input-derived weights (WEIGHT_PINNING).

### Epoch Lifecycle

Epoch status models **governance finality**, not payment execution. Distribution state lives on `payout_statements`.

```
1. OPEN          Temporal cron (weekly) or admin triggers collection
                 → Creates epoch with status='open', period_start/period_end + weight_config
                 → Runs source adapters → activity_events (raw facts)
                 → Resolves identities → updates user_id on curation rows
                 → Computes proposed allocations → epoch_allocations
                 → Admin curates: adjust inclusion, resolve identities, record pool components

2. REVIEW        Ingestion closed — raw facts locked, human judgment still active
                 → No new activity_events (DB trigger rejects inserts for this epoch)
                 → Curation still mutable: adjust inclusion, weight overrides, identity resolution
                 → Admin reviews + tweaks proposed allocations (not blindly trusting the algo)
                 → Allocations recomputed on demand from curated events + weight_config
                 → Admin signs payout statement (1-of-N EIP-191 from scope approvers)

3. FINALIZED     Admin triggers finalize (requires signature + base_issuance)
                 → Reads epoch_allocations (final_units, falling back to proposed_units)
                 → Reads pool components → pool_total_credits
                 → computePayouts(allocations, pool_total) → payout_statement
                 → Stores statement + signature atomically → epoch immutable forever
```

**Transitions:**

- `open → review`: Auto via Temporal at `period_end + grace_period` (configurable, default 24h), **or** admin triggers early via API route. Same state, different trigger.
- `review → finalized`: Admin action. Requires 1-of-N EIP-191 signature from scope's `approvers[]` + at least one `base_issuance` pool component.
- No backward transitions. Corrections use `supersedes_statement_id` on a new statement.

### Payout Computation

Unchanged from the original design. Given finalized allocations and a total pool:

1. Collect `final_units` per user (fall back to `proposed_units` if `final_units` is NULL)
2. Compute each user's share: `user_units / total_units`
3. Distribute `pool_total_credits` proportionally using BIGINT arithmetic
4. Apply largest-remainder rounding to ensure exact sum equals pool total
5. Output: `[{ user_id, total_units, share, amount_credits }]`

The allocation set hash (SHA-256 of canonical allocation data, sorted by user_id) pins the exact input set. Combined with `pool_total_credits` and `weight_config`, the payout is fully deterministic and reproducible.

### Pool Model

Unchanged. Each epoch's credit budget is the sum of independently computed pool components:

- **`base_issuance`** — constant amount per epoch (bootstraps early-stage work)
- **`kpi_bonus_v0`** — computed from DAO-defined KPI snapshots with pinned algorithm
- **`top_up`** — explicit governance allocation with evidence link

Each component stores `algorithm_version`, `inputs_json`, `amount_credits`, and `evidence_ref`.

### Verification

`GET /api/v1/ledger/verify/epoch/:id` performs independent verification from **stored data only** (not re-fetching from GitHub/Discord, which may be private or non-deterministic):

1. Fetch all `activity_events` for the epoch
2. Recompute proposed allocations from events + stored `weight_config`
3. Read `epoch_allocations` (final_units)
4. Recompute payouts from allocations + pool components
5. Compare recomputed values against stored statement
6. Return verification report

## Schema

### `epochs` — one open epoch at a time per (node, scope)

| Column               | Type         | Notes                                                     |
| -------------------- | ------------ | --------------------------------------------------------- |
| `id`                 | BIGSERIAL PK |                                                           |
| `node_id`            | UUID         | NOT NULL — per NODE_SCOPED                                |
| `scope_id`           | TEXT         | NOT NULL DEFAULT `'default'` — per SCOPE_SCOPED (project) |
| `status`             | TEXT         | CHECK IN (`'open'`, `'review'`, `'finalized'`)            |
| `period_start`       | TIMESTAMPTZ  | Epoch coverage start (NOT NULL)                           |
| `period_end`         | TIMESTAMPTZ  | Epoch coverage end (NOT NULL)                             |
| `weight_config`      | JSONB        | Milli-unit weights used for this epoch (NOT NULL)         |
| `pool_total_credits` | BIGINT       | Sum of pool components (set at close, NULL while open)    |
| `opened_at`          | TIMESTAMPTZ  |                                                           |
| `closed_at`          | TIMESTAMPTZ  | NULL while open                                           |
| `created_at`         | TIMESTAMPTZ  |                                                           |

Constraints:

- Partial unique index `UNIQUE (node_id, scope_id) WHERE status != 'finalized'` enforces ONE_ACTIVE_EPOCH per (node, scope)
- `UNIQUE(node_id, scope_id, period_start, period_end)` enforces EPOCH_WINDOW_UNIQUE

### `activity_events` — append-only contribution records (Layer 1)

| Column             | Type        | Notes                                                             |
| ------------------ | ----------- | ----------------------------------------------------------------- |
| `node_id`          | UUID        | NOT NULL — part of composite PK (NODE_SCOPED)                     |
| `scope_id`         | TEXT        | NOT NULL DEFAULT `'default'` — per SCOPE_SCOPED (project)         |
| `id`               | TEXT        | Deterministic from source (e.g., `github:pr:org/repo:42`)         |
| `source`           | TEXT        | NOT NULL — `github`, `discord`                                    |
| `event_type`       | TEXT        | NOT NULL — `pr_merged`, `review_submitted`, etc.                  |
| `platform_user_id` | TEXT        | NOT NULL — GitHub numeric ID, Discord snowflake                   |
| `platform_login`   | TEXT        | Display name (github username, discord handle)                    |
| `artifact_url`     | TEXT        | Canonical link to the activity                                    |
| `metadata`         | JSONB       | Source-specific payload                                           |
| `payload_hash`     | TEXT        | NOT NULL — SHA-256 of canonical payload (PROVENANCE_REQUIRED)     |
| `producer`         | TEXT        | NOT NULL — Adapter name (PROVENANCE_REQUIRED)                     |
| `producer_version` | TEXT        | NOT NULL — Adapter version (PROVENANCE_REQUIRED)                  |
| `event_time`       | TIMESTAMPTZ | NOT NULL — When the activity happened                             |
| `retrieved_at`     | TIMESTAMPTZ | NOT NULL — When adapter fetched from source (PROVENANCE_REQUIRED) |
| `ingested_at`      | TIMESTAMPTZ | DB insert time                                                    |

Composite PK: `(node_id, id)`. The `scope_id` is not part of the PK — the same raw event ID is unique per node regardless of scope. Scope assignment happens at ingestion time and is immutable (ACTIVITY_APPEND_ONLY). No `epoch_id` — epoch membership assigned at curation layer. No `user_id` — identity resolution lands in `activity_curation.user_id` (truly immutable raw log).

DB trigger rejects UPDATE/DELETE (ACTIVITY_APPEND_ONLY). `scope_id` validated against manifest at ingestion (SCOPE_VALIDATED).

Indexes: `(node_id, scope_id, event_time)`, `(source, event_type)`, `(platform_user_id)`

### `activity_curation` — identity resolution + admin decisions (Layer 2)

| Column                  | Type             | Notes                                            |
| ----------------------- | ---------------- | ------------------------------------------------ |
| `id`                    | UUID PK          |                                                  |
| `node_id`               | UUID             | NOT NULL (NODE_SCOPED)                           |
| `epoch_id`              | BIGINT FK→epochs | Assigns epoch membership to an event             |
| `event_id`              | TEXT             | FK→activity_events.id                            |
| `user_id`               | TEXT FK→users    | Resolved cogni user (NULL = unresolved)          |
| `included`              | BOOLEAN          | NOT NULL DEFAULT true — admin can exclude spam   |
| `weight_override_milli` | BIGINT           | Override weight_config for this event (nullable) |
| `note`                  | TEXT             | Admin rationale                                  |
| `created_at`            | TIMESTAMPTZ      |                                                  |
| `updated_at`            | TIMESTAMPTZ      |                                                  |

Constraint: `UNIQUE(epoch_id, event_id)`

DB trigger rejects INSERT/UPDATE/DELETE when `epochs.status = 'finalized'` (CURATION_FREEZE_ON_FINALIZE). Mutable during `open` and `review`, immutable after finalize. Reviewers can adjust inclusion, weight overrides, and identity resolution during review — these are auditable human decisions, not silent edits.

**Auto-population rules (CURATION_AUTO_POPULATE):**

After each collection run, the `curateAndResolve` activity creates curation rows for newly ingested events:

1. **Delta processing**: Only events without an existing curation row (or with `user_id IS NULL`) are processed. Events already curated with a resolved `user_id` are never overwritten. This preserves admin edits to `included`, `weight_override_milli`, and `note`.
2. **Insert-or-update-userId-only**: New events get `INSERT` with resolved `user_id` (or NULL if unresolved), `included = true`. Existing rows with `user_id IS NULL` get only `user_id` updated (fills in newly-added bindings on re-run). Fields `included`, `weight_override_milli`, `note` are never touched by auto-population.
3. **Query by epochId**: The activity queries events by epoch membership (via the epoch's `period_start`/`period_end`), using `epochId` as the authoritative scope. The epoch row is loaded first; period dates serve as a guard assertion.
4. **Provider-scoped resolution**: Identity resolution queries `user_bindings` filtered by `provider` (e.g., `'github'`). No cross-provider resolution. The `platformUserId` stored in `activity_events` must match the `external_id` format in `user_bindings` (GitHub: numeric `databaseId` as string).

### `epoch_allocations` — per-user credit distribution

| Column            | Type             | Notes                                              |
| ----------------- | ---------------- | -------------------------------------------------- |
| `id`              | UUID PK          |                                                    |
| `node_id`         | UUID             | NOT NULL (NODE_SCOPED)                             |
| `epoch_id`        | BIGINT FK→epochs |                                                    |
| `user_id`         | TEXT FK→users    | NOT NULL                                           |
| `proposed_units`  | BIGINT NOT NULL  | Computed from weight policy                        |
| `final_units`     | BIGINT           | Admin-set (NULL = not yet finalized, use proposed) |
| `override_reason` | TEXT             | Why admin changed it                               |
| `activity_count`  | INT NOT NULL     | Number of events attributed to this user           |
| `created_at`      | TIMESTAMPTZ      |                                                    |
| `updated_at`      | TIMESTAMPTZ      |                                                    |

Constraint: `UNIQUE(epoch_id, user_id)`

### `source_cursors` — adapter sync state

| Column         | Type        | Notes                                                     |
| -------------- | ----------- | --------------------------------------------------------- |
| `node_id`      | UUID        | NOT NULL (NODE_SCOPED)                                    |
| `scope_id`     | TEXT        | NOT NULL DEFAULT `'default'` — per SCOPE_SCOPED (project) |
| `source`       | TEXT        | `github`, `discord`                                       |
| `stream`       | TEXT        | `pull_requests`, `reviews`, `messages`                    |
| `source_ref`   | TEXT        | `cogni-dao/cogni-template`, `guild:123456`                |
| `cursor_value` | TEXT        | Timestamp or opaque pagination token                      |
| `retrieved_at` | TIMESTAMPTZ | When this cursor was last used                            |

Primary key: `(node_id, scope_id, source, stream, source_ref)`

Note: `source_ref` is the external system's namespace (GitHub repo slug, Discord guild ID). `scope_id` is the internal project governance domain. One `scope_id` may map to multiple `source_ref` values (a project that spans multiple repos).

### `epoch_pool_components` — immutable, append-only, pinned inputs

Unchanged from original spec. See [original schema](#pool-model).

| Column              | Type             | Notes                                          |
| ------------------- | ---------------- | ---------------------------------------------- |
| `id`                | UUID PK          |                                                |
| `node_id`           | UUID             | NOT NULL (NODE_SCOPED)                         |
| `epoch_id`          | BIGINT FK→epochs |                                                |
| `component_id`      | TEXT             | e.g. `base_issuance`, `kpi_bonus_v0`, `top_up` |
| `algorithm_version` | TEXT             | Git SHA or semver of the algorithm             |
| `inputs_json`       | JSONB            | Snapshotted KPI values used for computation    |
| `amount_credits`    | BIGINT           | Computed credit amount for this component      |
| `evidence_ref`      | TEXT             | Link to KPI source or governance vote          |
| `computed_at`       | TIMESTAMPTZ      |                                                |

DB trigger rejects UPDATE/DELETE (POOL_IMMUTABLE).
Constraint: `UNIQUE(epoch_id, component_id)` (POOL_UNIQUE_PER_TYPE).

### `payout_statements` — one per closed epoch, derived artifact (Layer 3)

| Column                    | Type                      | Notes                                               |
| ------------------------- | ------------------------- | --------------------------------------------------- |
| `id`                      | UUID PK                   |                                                     |
| `node_id`                 | UUID                      | NOT NULL (NODE_SCOPED)                              |
| `epoch_id`                | BIGINT FK→epochs          | UNIQUE(node_id, epoch_id) — one statement per epoch |
| `allocation_set_hash`     | TEXT                      | SHA-256 of canonical finalized allocations          |
| `pool_total_credits`      | BIGINT                    | Must match epoch's pool_total_credits               |
| `payouts_json`            | JSONB                     | `[{user_id, total_units, share, amount_credits}]`   |
| `supersedes_statement_id` | UUID FK→payout_statements | For post-signing corrections (nullable)             |
| `created_at`              | TIMESTAMPTZ               |                                                     |

Post-signing corrections use amendment statements (`supersedes_statement_id`), never reopen-and-edit.

### `statement_signatures` — client-side EIP-191 signatures (schema only)

| Column          | Type                      | Notes                        |
| --------------- | ------------------------- | ---------------------------- |
| `id`            | UUID PK                   |                              |
| `node_id`       | UUID                      | NOT NULL (NODE_SCOPED)       |
| `statement_id`  | UUID FK→payout_statements |                              |
| `signer_wallet` | TEXT                      | NOT NULL                     |
| `signature`     | TEXT                      | NOT NULL — EIP-191 signature |
| `signed_at`     | TIMESTAMPTZ               | NOT NULL                     |

Constraint: `UNIQUE(statement_id, signer_wallet)`

Signer wallet is the `ecrecover`-derived address, not client-supplied. Signature message must include `node_id + scope_id + allocation_set_hash` (SIGNATURE_SCOPE_BOUND). See [Signing Workflow](#signing-workflow).

## Source Adapter Interface

```typescript
// Port definition (src/ports/source-adapter.port.ts)

export interface SourceAdapter {
  readonly source: string; // "github", "discord"
  readonly version: string; // bump on schema changes

  streams(): StreamDefinition[];

  /**
   * Collect activity events. Idempotent (deterministic IDs).
   * Uses cursor for incremental sync. Returns events + next cursor.
   */
  collect(params: {
    streams: string[];
    cursor: StreamCursor | null;
    window: { since: Date; until: Date };
    limit?: number;
  }): Promise<{ events: ActivityEvent[]; nextCursor: StreamCursor }>;

  /** Optional webhook handler for real-time fast-path (GitHub). */
  handleWebhook?(payload: unknown): Promise<ActivityEvent[]>;
}

export interface ActivityEvent {
  id: string; // deterministic: "github:pr:owner/repo:42"
  source: string;
  eventType: string;
  platformUserId: string; // GitHub numeric ID, Discord snowflake
  platformLogin?: string; // display name
  artifactUrl: string;
  metadata: Record<string, unknown>;
  payloadHash: string; // SHA-256 of canonical payload
  eventTime: Date;
}

export interface StreamDefinition {
  id: string; // "pull_requests", "reviews", "messages"
  name: string;
  cursorType: "timestamp" | "token";
  defaultPollInterval: number; // seconds
}

export interface StreamCursor {
  streamId: string;
  value: string;
  retrievedAt: Date;
}
```

Adapters live in `services/scheduler-worker/src/adapters/ingestion/` (ADAPTERS_NOT_IN_CORE). They use official OSS clients: `@octokit/graphql` for GitHub, `discord.js` for Discord.

## API

### Write Routes (SIWE + scope approver check → Temporal workflow → 202)

| Method | Route                                       | Purpose                                                                  |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/api/v1/ledger/epochs/collect`             | Trigger activity collection for new/existing epoch                       |
| PATCH  | `/api/v1/ledger/epochs/:id/allocations`     | Admin adjusts final_units for users (epoch must be `open` or `review`)   |
| POST   | `/api/v1/ledger/epochs/:id/pool-components` | Record a pool component for the epoch (epoch must be `open` or `review`) |
| POST   | `/api/v1/ledger/epochs/:id/close-ingestion` | Close ingestion, transition `open → review` (or auto via Temporal)       |
| POST   | `/api/v1/ledger/epochs/:id/sign`            | Submit EIP-191 signature for payout statement (epoch must be `review`)   |
| POST   | `/api/v1/ledger/epochs/:id/finalize`        | Finalize epoch → compute payouts (requires signature + base_issuance)    |

### Public Read Routes (no auth, closed-epoch data only)

| Method | Route                                          | Purpose                                     |
| ------ | ---------------------------------------------- | ------------------------------------------- |
| GET    | `/api/v1/public/ledger/epochs`                 | List closed epochs (paginated)              |
| GET    | `/api/v1/public/ledger/epochs/:id/allocations` | Allocations for a closed epoch              |
| GET    | `/api/v1/public/ledger/epochs/:id/statement`   | Payout statement (null if none, always 200) |

### Authenticated Read Routes (SIWE session required)

| Method | Route                                | Purpose                                      |
| ------ | ------------------------------------ | -------------------------------------------- |
| GET    | `/api/v1/ledger/epochs`              | List all epochs including open               |
| GET    | `/api/v1/ledger/epochs/:id/activity` | Activity events with PII + curation join     |
| GET    | `/api/v1/ledger/verify/epoch/:id`    | Recompute payouts from stored data + compare |

## Temporal Workflows

### CollectEpochWorkflow

The schedule adapter sends a `ScheduleActionPayload` wrapper; the workflow extracts `.input` immediately and treats it as `LedgerIngestRunV1`:

```typescript
interface LedgerIngestRunV1 {
  version: 1;
  scopeId: string;
  scopeKey: string;
  epochLengthDays: number;
  activitySources: Record<
    string,
    {
      creditEstimateAlgo: string;
      sourceRefs: string[]; // external namespaces (e.g., repo slugs)
      streams: string[]; // e.g., ["pull_requests", "reviews", "issues"]
    }
  >;
}
```

1. **Compute epoch window** — `computeEpochWindowV1()` (pure, deterministic) derives `periodStart`/`periodEnd` from `TemporalScheduledStartTime` + `epochLengthDays`. Monday-aligned UTC boundaries, anchored to 2026-01-05.
2. **Derive weight config** — `deriveWeightConfigV0()` maps `activitySources` keys to hardcoded V0 weights (e.g., `github:pr_merged: 1000`).
3. **Ensure epoch** — `ensureEpochForWindow` activity looks up by `(node_id, scope_id, period_start, period_end)` regardless of status via `getEpochByWindow`. If found, returns as-is with pinned `weightConfig`. If not found, creates with input-derived weights. Weight config drift (input differs from existing) logs a warning; existing epoch's config wins (WEIGHT_PINNING).
4. **Skip if not open** — If epoch status is `review` or `finalized`, workflow exits immediately.
5. **Collect per source/sourceRef/stream** — For each `activitySources` entry, for each `sourceRef`, for each `stream`:
   - Activity: load cursor from `source_cursors`
   - Activity: `adapter.collect({ streams: [stream], cursor, window })` → events + `producerVersion`
   - Activity: insert `activity_events` (idempotent by PK, uses `adapter.version` as `producer_version`)
   - Activity: save cursor to `source_cursors` (monotonic advancement)
6. **Curate and resolve identities** — `curateAndResolve` activity (CURATION_AUTO_POPULATE):
   - Load epoch by ID → get period_start/period_end (guard assertion)
   - Query events in epoch window that are uncurated (no curation row) or unresolved (curation.user_id IS NULL)
   - For each source: batch resolve `platformUserId` → `userId` via `user_bindings` (provider-scoped)
   - INSERT new curation rows (included=true, userId=resolved or NULL)
   - UPDATE existing unresolved rows: set userId only (never touch included/weight_override_milli/note)

Deterministic workflow ID: managed by Temporal Schedule (overlap=SKIP, run IDs per firing).

**Epoch window algorithm** (`computeEpochWindowV1`):

- Floor `asOf` timestamp to Monday 00:00 UTC
- Anchor: 2026-01-05 (first Monday of 2026)
- Period index = `floor((mondayMs - anchor) / epochMs)`
- `periodStart = anchor + periodIndex * epochMs`
- `periodEnd = periodStart + epochMs`

### FinalizeEpochWorkflow

1. Verify epoch exists and is `review`
2. If epoch already `finalized`, return existing statement (EPOCH_FINALIZE_IDEMPOTENT)
3. Verify at least one `base_issuance` pool component exists (POOL_REQUIRES_BASE)
4. Verify at least one valid signature exists from scope's `approvers[]` (APPROVERS_PER_SCOPE)
5. Read `epoch_allocations` — use `final_units` where set, fall back to `proposed_units`
6. Read pool components, compute `pool_total_credits = SUM(amount_credits)`
7. `computePayouts(allocations, pool_total)` — BIGINT, largest-remainder
8. Compute `allocation_set_hash`
9. Atomic transaction: set `pool_total_credits` on epoch, update status to `'finalized'`, insert payout statement
10. Return statement

Deterministic workflow ID: `ledger-finalize-{scopeId}-{epochId}`

## Signing Workflow

### Canonical Message Format

The signed message binds to node, scope, and allocation data (SIGNATURE_SCOPE_BOUND):

```
Cogni Payout Statement
Node: {node_id}
Scope: {scope_id}
Epoch: {epoch_id}
Allocation Hash: {allocation_set_hash}
Pool Total: {pool_total_credits}
```

Frontend constructs this message from epoch data, calls `walletClient.signMessage()` (EIP-191 `personal_sign`), and POSTs the signature to the sign route.

### Verification

Backend recovers the signer address via `ecrecover(message, signature)` and checks:

1. Recovered address is in the scope's `approvers[]` (from repo-spec or project manifest)
2. Message fields match the epoch's actual data (prevents signing stale/wrong data)

### Storage

Signatures stored in `statement_signatures` table (schema unchanged). The `signer_wallet` is the recovered address, not client-supplied.

### Future Path

```
V0 (now):    DB-stored EIP-191 sigs, 1-of-N from scope approvers
V1:          Multi-sig thresholds (close_epoch_threshold: 2), separate curation_admins vs payout_approvers
V1:          Post sig hash to IPFS/Arweave → content hash on-chain
V2:          On-chain attestation registry (smart contract accepts epoch_hash + sig)
V3:          DAO multisig (Safe) — N-of-M signers required
```

## V1+ Deferred Features

The following are explicitly deferred from V0 and will be designed when needed:

- **Multi-sig thresholds** (`close_epoch_threshold: N`) — V1: require N-of-M approver signatures
- **Role separation** (`curation_admins` vs `payout_approvers`) — V1: separate who curates from who signs
- **`ledger_issuers` role system** (can_issue, can_approve, can_close_epoch) — V1: multi-role authorization
- **Per-receipt wallet signing** (EIP-191, SIGNATURE_DOMAIN_BOUND) — V1: receipts as signed artifacts
- **Receipt approval lifecycle** (proposed → approved → revoked, LATEST_EVENT_WINS) — V1: per-receipt workflows
- **On-chain attestation** — V0 verifies by recomputing from stored data; V1+ adds on-chain signature registry
- **Merkle trees / inclusion proofs** — V1+
- **Payout distribution state machine** (`payout_statements.status`: draft → signed → submitted → settled/failed) — V1+
- **UI pages** — V1+
- **DID/VC alignment** — V2+
- **Automated webhook fast-path** (GitHub `handleWebhook`) — V1: real-time ingestion

## Goal

Enable transparent, verifiable credit distribution where contribution activity is automatically collected, valued via explicit weight policy, and finalized by an admin. Anyone can recompute the payout table from stored data.

## Non-Goals

- Algorithmic valuation (SourceCred-style scoring) — weights are transparent, admin adjustable
- Server-held signing keys
- Full RBAC system (V0 uses per-scope approver allowlist)
- Real-time streaming (poll-based collection sufficient for weekly epochs)

## Related

- [proj.transparent-credit-payouts](../../work/projects/proj.transparent-credit-payouts.md) — Project roadmap
- [billing-evolution](./billing-evolution.md) — Existing credit/billing system
- [billing-ingest](./billing-ingest.md) — Callback-driven billing pipeline
- [architecture](./architecture.md) — System architecture
- [sourcecred](./sourcecred.md) — SourceCred as-built (being superseded)
- [decentralized-user-identity](./decentralized-user-identity.md) — User identity bindings (`user_id` is canonical)
- [identity-model](./identity-model.md) — All identity primitives (`node_id`, `scope_id`, `user_id`, `billing_account_id`, `dao_address`)
- [ai-governance-data](./ai-governance-data.md) — Autonomous governance agents (separate concern)
