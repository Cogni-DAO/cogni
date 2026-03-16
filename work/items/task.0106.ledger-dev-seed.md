---
id: task.0106
type: task
title: "Dev seed script for governance epoch UI visual testing"
status: needs_merge
priority: 1
rank: 99
estimate: 2
summary: "Populate the dev database with realistic, claimant-aware attribution data so the governance UI (/gov/epoch, /gov/history, /gov/holdings) and ownership reads render meaningful local state."
outcome: "Running `pnpm dev:setup` seeds realistic open and finalized epochs, linked and unlinked claimants, and claimant-aware statements so the governance UI and `/users/me/ownership` render against representative local data."
spec_refs: attribution-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch: feat/ledger-ui
pr: https://github.com/Cogni-DAO/node-template/pull/472
reviewer: derekg1729
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-24
updated: 2026-03-01
labels: [governance, dx, seed]
external_refs:
---

# Dev Seed Script for Governance Epoch UI Visual Testing

## Context

The governance UI hooks now fetch from the real attribution API (`/api/v1/attribution/epochs`, activity, claimants, statements) plus `/api/v1/users/me/ownership`. An empty dev database renders blank pages. We need seed data that exercises linked humans, unlinked GitHub identities, finalized claimant-aware statements, and an open epoch with mixed attribution states.

The existing attribution fixtures provide canonical row shapes, but the dev seed now lives in `scripts/db/seed.mts` and composes richer, claimant-aware scenarios modeled after real GitHub contribution patterns.

## Requirements

- **R1:** Seed runs via the normal local bootstrap flow (`pnpm dev:setup`)
- **R2:** Seeds at least 3 epochs covering all states:
  - 1 epoch with `status = 'open'` (current, no statement) — drives `/gov/epoch`
  - 2 epochs with `status = 'finalized'` and claimant-aware statements — drive `/gov/history` and `/gov/holdings`
- **R3:** Each epoch has realistic activity events modeled after real patterns:
  - GitHub: `pr_merged`, `review_submitted`, `commit_pushed`, `comment_created` with plausible `platformLogin`, `artifactUrl`, `eventTime` values
  - At least 3-5 contributors per epoch with varying activity counts
  - `platformLogin` values should be recognizable GitHub-style usernames (e.g., `alice-dev`, `bob-contributor`)
- **R4:** Open epoch has allocations (proposed_units) but no statement
- **R5:** Finalized epochs have:
  - Pool component (`base_issuance`) with realistic credit amounts
  - Statement items containing claimant metadata (`claimant_key`, `claimant`, `receipt_ids`)
  - A mix of linked humans and unlinked GitHub identities
- **R6:** Script is idempotent — re-running doesn't fail (deletes existing seed data or skips on conflict)
- **R7:** Seed uses the existing `AttributionStore` port and canonical schema shapes
- **R8:** Epochs use non-overlapping date windows (use `epochWindow()` helper with offsets)

## Allowed Changes

- `scripts/db/seed.mts`
- `tests/_fixtures/attribution/seed-attribution.ts`
- claimant-aware read models or contracts only where required to keep seeded data visible in UI

## Plan

- [x] Seed deterministic linked humans (`derekg1729`, `alice-vector`, `ben-rivera`) and unlinked GitHub identities (`Cogni-1729`, `mira-stone`)
- [x] Seed 2 finalized epochs with claimant-aware statement items and 1 open epoch with mixed linked/unlinked contributors
- [x] Reuse real `node-template` PR/review identifiers where practical so local UI resembles repo history
- [x] Keep the seed idempotent by skipping attribution seeding when epochs already exist
- [x] Validate visually through `pnpm dev:setup` against `/gov/epoch`, `/gov/history`, `/gov/holdings`, and `/profile`

## Data Shape Reference

### Activity Events (per epoch, 8-15 events)

| Field              | Example Value                                          |
| ------------------ | ------------------------------------------------------ |
| `id`               | `github:pr_merged:cogni-dao/cogni-template:142`        |
| `source`           | `github`                                               |
| `event_type`       | `pr_merged` / `review_submitted` / `commit_pushed`     |
| `platform_user_id` | `12345`                                                |
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

| Field                                   | Example Value                      |
| --------------------------------------- | ---------------------------------- |
| `pool_total_credits`                    | `10000n`                           |
| `statement_items_json[].user_id`        | `user-alice`                       |
| `statement_items_json[].total_units`    | `"8000"`                           |
| `statement_items_json[].share`          | `"0.400000"`                       |
| `statement_items_json[].amount_credits` | `"4000"`                           |
| `statement_items_json[].claimant_key`   | `github:12345` / `user:user-alice` |

## Validation

**Command:**

```bash
pnpm dev:setup
```

**Expected:** Setup completes without error and seeds deterministic attribution data. Running again against a fresh dev DB is safe.

**Manual verification:**

```bash
pnpm dev
# Navigate to /gov/epoch — shows open epoch with 4-5 contributors
# Navigate to /gov/history — shows 2 finalized epochs
# Navigate to /gov/holdings — shows aggregated credits across contributors
```

## Review Checklist

- [ ] **Work Item:** `task.0106` linked in PR body
- [ ] **Spec:** attribution-ledger-spec invariants upheld (ALL_MATH_BIGINT, ONE_OPEN_EPOCH, deterministic IDs)
- [ ] **Tests:** seed script is its own validation (visual + idempotent re-run)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Handoff: [handoff](../handoffs/task.0106.handoff.md)

## Attribution

-
