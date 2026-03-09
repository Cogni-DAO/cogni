---
id: task.0136.handoff
type: handoff
work_item_id: task.0136
status: active
created: 2026-03-06
updated: 2026-03-07
branch: claude/review-github-ingestion-Kwjtl
last_commit: 0c0f73567ada4c24ec1c582e440a342c61409a83
---

# Handoff: GitHub Webhook Ingestion + External Test Suite

## Context

- The attribution ledger ingests GitHub activity (PRs, reviews, issues, pushes) via two paths: poll (Temporal schedule → GitHub GraphQL) and webhook (Next.js route → `POST /api/internal/webhooks/github`)
- Preview environment was receiving **zero activity events** — root causes: missing `GH_WEBHOOK_SECRET` env var, wrong var names in `.env.test`, webhook normalizer filtering too aggressively (only merged PRs + closed issues)
- This session widened the normalizer to capture all event types (INGEST_ALL_FILTER_LATER), propagated `GH_WEBHOOK_SECRET` across all deployment layers, added smee.io support for local dev, wrote a setup guide, and rewrote the external test suite to be self-contained
- **All changes are uncommitted** on the working tree

## Current State

- **Done:** Webhook normalizer widened (all PR actions, reviews, issues, comments, pushes). Unit tests passing (21 tests).
- **Done:** `GH_WEBHOOK_SECRET` propagated to: server-env Zod schema, `.env.local`, `.env.test`, both `.example` files, both docker-compose files, both deploy workflows, `deploy.sh` (3 places), `SETUP_DESIGN.md`
- **Done:** `pnpm dev:smee` / `pnpm test:smee` scripts, `smee-client` added as devDependency, `GH_WEBHOOK_PROXY_URL` env var
- **Done:** Setup guide at `docs/guides/github-app-webhook-setup.md`
- **Done:** `github-webhook-e2e.external.test.ts` — **PASSING**. Creates PR via `gh`, waits for webhook receipt in DB.
- **Broken:** `github-adapter.external.test.ts` — `createFixtures()` fails: `gh pr merge` returns "not mergeable" (merge commit can't be cleanly created). Multiple prior test runs have left orphan PRs on `derekg1729/test-repo`. Root cause: the test pushes a file (`.ext-test-fixture.txt`) that collides across concurrent runs, and GitHub needs time to compute mergeability after PR creation.
- **Broken:** `ledger-collection.external.test.ts` — `insertReceipts()` fails with `producer_version NOT NULL` constraint violation. The `collectFromSource` activity calls `insertReceipts({ events })` without passing `producerVersion`. Fixed in dedup test but not in this file.
- **Broken:** `webhook-poll-dedup.external.test.ts` — `expected 2 to be 1`. The webhook and poll paths produce **different** `receipt_id` values for the same PR. Webhook uses `github:pr:owner/repo:N` (canonical merged ID), but the poll adapter's collect window also picks up PRs merged by OTHER test runs, and the `node_id` differs between webhook path (`container.nodeId`) and test path (`00000000-...`). The `receipt_id` uniqueness constraint is per `receipt_id` alone, but both webhook and poll inserted successfully because they use **different `node_id`** values — so `ON CONFLICT (receipt_id)` doesn't fire. **This is the core dedup bug to investigate.**
- **Not done:** `derekg1729/test-repo` has Issues disabled — issue fixture creation silently skips
- **Not done:** `epochs_one_open_per_node` constraint violation in `handles closed epoch` test — leftover epoch from prior run

## Decisions Made

- INGEST_ALL_FILTER_LATER: normalizer captures every event type; downstream epoch evaluation decides attribution
- Bot authors filtered at ingestion (data quality)
- Merged PR IDs match poll adapter IDs (`github:pr:owner/repo:42`) for natural dedup
- Non-terminal actions get action-suffixed IDs (`github:pr:owner/repo:42:opened`)
- smee.io for local webhook dev (same pattern as cogni-git-review)
- External tests create their own fixtures — no hardcoded PR numbers or repo dependencies
- See `docs/research/webhook-ingestion-architecture.md` for webhook-in-Next.js decision

## Next Actions

- [ ] Fix merge conflict in `createFixtures()` — use unique filenames per run, or use `--auto` merge flag with a wait loop, or ensure clean repo state before push
- [ ] Fix `producer_version` null — pass `producerVersion` to every `insertReceipts()` call in `ledger-collection.external.test.ts`
- [ ] **Investigate dedup test failure** — webhook inserts with `container.nodeId`, poll inserts with test `nodeId`. If `receipt_id` conflict key doesn't include `node_id`, both rows persist. Check the actual unique constraint on `ingestion_receipts` and decide: should dedup be per `(receipt_id)` or per `(receipt_id, node_id)`?
- [ ] Enable Issues on `derekg1729/test-repo` (or skip issue tests cleanly)
- [ ] Clean up orphan PRs/branches on `derekg1729/test-repo` from failed test runs
- [ ] Run `pnpm check` to validate lint/type/format on all changes
- [ ] Commit all uncommitted changes
- [ ] Set `GH_WEBHOOK_SECRET` in preview: `gh secret set GH_WEBHOOK_SECRET --repo Cogni-DAO/cogni-template --env preview --body "$GH_WEBHOOK_SECRET"`
- [ ] Configure GitHub App webhook URL to `https://preview.cognidao.org/api/internal/webhooks/github`

## Risks / Gotchas

- `derekg1729/test-repo` is polluted with ~20 orphan test PRs/branches from this session's failed runs. Clean up before re-running tests.
- The `receipt_id` unique constraint may not enforce cross-path dedup if `node_id` is part of the key — check the migration/schema.
- The testcontainers globalSetup in `vitest.external.config.mts` overwrites `DATABASE_SERVICE_URL`. The webhook/dedup tests use `E2E_DATABASE_SERVICE_URL` to bypass this, but the ledger/adapter tests use testcontainers DB (correct for them).
- `GH_WEBHOOK_SECRET` in `.env.test` contains the real secret value (same as `.env.local`). This is fine since `.env.test` is gitignored.
- `.env.test.example` still has `test-webhook-secret` as placeholder — this is correct (example only).

## Pointers

| File / Resource                                                      | Why it matters                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/adapters/server/ingestion/github-webhook.ts`                    | Webhook normalizer — widened this session                   |
| `tests/external/ingestion/github-webhook-e2e.external.test.ts`       | Webhook e2e — **PASSING**                                   |
| `tests/external/ingestion/webhook-poll-dedup.external.test.ts`       | Cross-path dedup test — **FAILING** (count=2, expected 1)   |
| `tests/external/ingestion/_github-fixture-helper.ts`                 | Shared fixture helper — merge bug here                      |
| `tests/external/ingestion/github-adapter.external.test.ts`           | Adapter test — **FAILING** (merge not possible)             |
| `tests/external/ingestion/ledger-collection.external.test.ts`        | Ledger pipeline test — **FAILING** (producer_version null)  |
| `docs/guides/github-app-webhook-setup.md`                            | New setup guide for dev/preview webhook config              |
| `platform/ci/scripts/deploy.sh`                                      | `GH_WEBHOOK_SECRET` added in 3 places                       |
| `src/features/ingestion/services/webhook-receiver.ts`                | Feature service: verify → normalize → insert                |
| `packages/db-client/src/adapters/drizzle-attribution.adapter.ts:831` | `insertIngestionReceipts` — the ON CONFLICT DO NOTHING path |
| `services/scheduler-worker/src/activities/ledger.ts:458`             | `insertReceipts` activity — needs `producerVersion`         |
