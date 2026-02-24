---
id: task.0106
type: task
title: "Dev seed script for governance epoch UI visual testing"
status: needs_implement
priority: 1
rank: 99
estimate: 2
summary: "Create a dev seed script that populates the ledger database with realistic, multi-state epoch data so the governance UI (/gov/epoch, /gov/history, /gov/holdings) renders meaningful content during local development."
outcome: "Running `pnpm dev:seed:ledger` populates the dev DB with realistic epoch data across all 3 states. All governance UI pages render correctly against this data."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-ui
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-24
updated: 2026-02-24
labels: [governance, dx, seed]
external_refs:
---

# Dev Seed Script for Governance Epoch UI Visual Testing

## Context

The governance UI hooks now fetch from the real ledger API (`/api/v1/ledger/epochs`, allocations, activity, statements). An empty dev database renders blank pages. We need a seed script that populates realistic data so developers can visually verify all 3 governance pages.

The existing test fixture (`tests/_fixtures/ledger/seed-ledger.ts`) provides factory functions and a `seedClosedEpoch()` composite — this seed script should reuse those building blocks but compose richer, more realistic scenarios modeled after real GitHub/Discord contribution patterns.

## Requirements

- **R1:** Script is runnable via `pnpm dev:seed:ledger` (package.json script entry)
- **R2:** Seeds at least 3 epochs covering all states:
  - 1 epoch with `status = 'open'` (current, no statement) — drives `/gov/epoch`
  - 1 epoch with `status = 'finalized'` with payout statement — drives `/gov/history`
  - 1 epoch with `status = 'finalized'` with payout statement (different contributors) — drives `/gov/holdings` aggregation
- **R3:** Each epoch has realistic activity events modeled after real patterns:
  - GitHub: `pr_merged`, `review_submitted`, `commit_pushed`, `comment_created` with plausible `platformLogin`, `artifactUrl`, `eventTime` values
  - At least 3-5 contributors per epoch with varying activity counts
  - `platformLogin` values should be recognizable GitHub-style usernames (e.g., `alice-dev`, `bob-contributor`)
- **R4:** Open epoch has allocations (proposed_units) but no statement
- **R5:** Finalized epochs have:
  - Pool component (`base_issuance`) with realistic credit amounts
  - Payout statement with `payouts_json` containing per-user share/credits
  - Activity curation rows linking events to resolved user IDs
- **R6:** Script is idempotent — re-running doesn't fail (deletes existing seed data or skips on conflict)
- **R7:** Script uses the existing `ActivityLedgerStore` port + factories from `tests/_fixtures/ledger/seed-ledger.ts`
- **R8:** Epochs use non-overlapping date windows (use `epochWindow()` helper with offsets)

## Allowed Changes

- `scripts/dev-seed-ledger.ts` — new seed script
- `package.json` — add `dev:seed:ledger` script entry
- `tests/_fixtures/ledger/seed-ledger.ts` — extend with new factories if needed (e.g., `seedOpenEpoch()`)

## Plan

- [ ] **Step 1: Create seed script** at `scripts/dev-seed-ledger.ts`
  - Import store factory from bootstrap/DI container (same pattern as migration scripts)
  - Import fixture factories from `tests/_fixtures/ledger/seed-ledger.ts`
  - Define seed data constants:
    - 4-5 contributor user IDs with GitHub-style platformLogins
    - 2-3 epoch windows (offset 0 = open, offset -1/-2 = finalized)
    - Varied activity event counts per contributor (2-8 events each)
    - Weight config matching `TEST_WEIGHT_CONFIG`

- [ ] **Step 2: Implement epoch seeding functions**
  - `seedOpenEpoch(store)` — creates epoch + activity events + curations + allocations (no close/finalize)
  - Reuse existing `seedClosedEpoch(store)` for finalized epochs, or extend it for richer data
  - Each function generates deterministic event IDs (so re-runs are idempotent via `ON CONFLICT DO NOTHING`)

- [ ] **Step 3: Compose the full seed**
  - Seed 2 finalized epochs (different contributor mixes, different credit pools)
  - Seed 1 open epoch (current week, in-progress activity)
  - Log progress to stdout

- [ ] **Step 4: Add package.json script**
  - `"dev:seed:ledger": "pnpm dotenv -e .env.development -- tsx scripts/dev-seed-ledger.ts"`

- [ ] **Step 5: Verify visually**
  - Run `pnpm dev:seed:ledger` against running dev DB
  - Navigate to `/gov/epoch` — current epoch with contributors renders
  - Navigate to `/gov/history` — 2 finalized epochs with expandable details render
  - Navigate to `/gov/holdings` — aggregated holdings across both finalized epochs render

## Data Shape Reference

### Activity Events (per epoch, 8-15 events)

| Field              | Example Value                                          |
| ------------------ | ------------------------------------------------------ |
| `id`               | `github:pr_merged:cogni-dao/cogni-template:142`        |
| `source`           | `github`                                               |
| `event_type`       | `pr_merged` / `review_submitted` / `commit_pushed`     |
| `platform_user_id` | `gh-12345`                                             |
| `platform_login`   | `alice-dev`                                            |
| `artifact_url`     | `https://github.com/cogni-dao/cogni-template/pull/142` |
| `event_time`       | Within epoch window                                    |

### Allocations (per contributor per epoch)

| Field            | Example Value    |
| ---------------- | ---------------- |
| `user_id`        | `user-alice`     |
| `proposed_units` | `8000n` (BigInt) |
| `activity_count` | `4`              |

### Payout Statement (finalized epochs only)

| Field                           | Example Value |
| ------------------------------- | ------------- |
| `pool_total_credits`            | `10000n`      |
| `payouts_json[].user_id`        | `user-alice`  |
| `payouts_json[].total_units`    | `"8000"`      |
| `payouts_json[].share`          | `"0.400000"`  |
| `payouts_json[].amount_credits` | `"4000"`      |

## Validation

**Command:**

```bash
pnpm dev:seed:ledger
```

**Expected:** Script completes without error, logs seeded epoch IDs. Running twice is safe (idempotent).

**Manual verification:**

```bash
pnpm dev
# Navigate to /gov/epoch — shows open epoch with 4-5 contributors
# Navigate to /gov/history — shows 2 finalized epochs
# Navigate to /gov/holdings — shows aggregated credits across contributors
```

## Review Checklist

- [ ] **Work Item:** `task.0106` linked in PR body
- [ ] **Spec:** epoch-ledger-spec invariants upheld (ALL_MATH_BIGINT, ONE_OPEN_EPOCH, deterministic IDs)
- [ ] **Tests:** seed script is its own validation (visual + idempotent re-run)
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
