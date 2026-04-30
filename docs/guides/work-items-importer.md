---
id: work-items-importer-guide
type: guide
title: Work-Items Importer — One-Shot Bootstrap
status: draft
trust: draft
summary: "How to bootstrap a Cogni Doltgres `work_items` table from the legacy `work/items/*.md` corpus. Two paths: direct-DB (preserves source IDs — prod bootstrap) and HTTP API (drifts IDs to 5000+ — exploratory)."
read_when: "Bootstrapping a new env's knowledge_operator Doltgres, debugging the importer, or deciding which import strategy fits a given env."
owner: derekg1729
created: 2026-04-30
verified: 2026-04-30
tags: [work-system, doltgres, importer, operator, bootstrap]
---

# Work-Items Importer — One-Shot Bootstrap

> Two import strategies, one end goal: every legacy `work/items/*.md` row lives in `knowledge_operator.work_items` so the markdown corpus can be deleted.

## End goal

After a successful prod bootstrap:

- All ~458 markdown work items live in `cognidao.org` (prod) Doltgres `work_items` table.
- **Source IDs are preserved.** `bug.0153` in markdown → `bug.0153` in Doltgres. No drift.
- `dolt_log` shows ONE bootstrap commit (e.g., `task.5002: import 458 items by user:derekg1729`).
- The `work/items/*.md` corpus can be deleted from git.

## Two strategies

|                     | **Direct-DB (canonical for prod)**                                                                                         | **HTTP API (exploratory)**                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Tool**            | `nodes/operator/app/scripts/import-markdown-work-items.ts`                                                                 | `nodes/operator/app/scripts/import-work-items-via-api.ts`                                         |
| **Path**            | `bulkInsert()` on `DoltgresOperatorWorkItemAdapter` → SELECT-existing-IDs preflight + multi-row INSERT + one `dolt_commit` | Loops over markdown items, `POST /api/v1/work/items` per row + `PATCH` to hydrate status/priority |
| **Source IDs**      | ✅ **Preserved** (writes `WorkItem.id` verbatim)                                                                           | ❌ **Drift** (server allocates `5000+` IDs; legacy ID stashed in sidecar JSON)                    |
| **Idempotent**      | ✅ Yes (re-run = 0 inserts, 0 commits)                                                                                     | ❌ No (re-run = 458 dupes)                                                                        |
| **Required access** | DB credentials (`DOLTGRES_URL`) — kubectl port-forward in cluster envs                                                     | Just an apiKey + internet                                                                         |
| **dolt_log**        | One commit per run                                                                                                         | One commit per row (478 spam)                                                                     |
| **Use for**         | **Prod, preview, candidate-a clean bootstraps**                                                                            | Demoing the path on candidate-a before cluster access is wired                                    |

**Both paths exist in this PR.** The HTTP path was the exploratory prototype used to validate the loop on candidate-a without kubectl access. The direct-DB path is the canonical tool for prod bootstrap.

## Prod bootstrap procedure (canonical)

### Pre-flight

1. **Approval gate.** Verify on candidate-a: same dataset works through the importer end-to-end. ([candidate-a results](#candidate-a-results)).
2. **Capture pre-import HEAD** for rollback:
   ```bash
   psql "$DOLTGRES_URL" -tAc "SELECT dolt_hashof('HEAD')"
   # save the hash somewhere accessible
   ```
3. **Confirm the table is empty** (or expected-state):
   ```bash
   psql "$DOLTGRES_URL" -tAc "SELECT COUNT(*), MIN(id), MAX(id) FROM work_items"
   ```

### Run

```bash
# From a host with kubectl access to the prod cluster
kubectl port-forward -n cogni svc/<doltgres-svc> 5432:5432 &

# Set env
export DOLTGRES_URL='postgres://root:<root-pw>@127.0.0.1:5432/knowledge_operator'
export IMPORTER_AUTHOR='user:derekg1729'

# Dry-run first — shows count, no writes
pnpm --filter operator import:work-items --dry-run

# If counts match (~458), run for real
pnpm --filter operator import:work-items
```

The script prints:

- `[importer] pre-import HEAD=<sha>` — capture this
- Progress lines per 25 items
- Final summary: `inserted=N skipped=N failed=N`
- Final dolt_commit hash + suggested rollback command

### Post-run validation

```bash
# 1. Sample a known legacy ID round-trips with original ID
curl https://cognidao.org/api/v1/work/items/bug.0002 \
  -H "authorization: Bearer $COGNI_KEY" | jq '{id, status, priority}'
# → id: "bug.0002" (NOT bug.5xxx), status + priority preserved from markdown

# 2. Confirm one dolt_commit on this run
psql "$DOLTGRES_URL" -c "SELECT message, date FROM dolt_log() ORDER BY date DESC LIMIT 5"
# → first row should be `task.5002: import 458 items by user:derekg1729`

# 3. Counts reconcile
psql "$DOLTGRES_URL" -tAc "SELECT type, COUNT(*) FROM work_items GROUP BY type"
# → task: ~278, bug: ~160, story: ~16, spike: ~24
```

### Rollback

If anything is wrong:

```bash
psql "$DOLTGRES_URL" -c "CALL dolt_reset('--hard', '<pre-import-sha>')"
```

The importer is idempotent against an unchanged source corpus, so a clean re-run after a reset produces the same result.

## How the direct-DB importer works

`nodes/operator/app/scripts/import-markdown-work-items.ts`:

1. Reads every `.md` under `work/items/` via `MarkdownWorkItemAdapter.list({})` — already handles the legacy frontmatter quirks.
2. Calls `DoltgresOperatorWorkItemAdapter.bulkInsert(items, authorTag)`:
   - SELECT existing IDs from `work_items WHERE id IN (...)` — for idempotency.
   - Filter out already-present IDs.
   - Build a single `INSERT INTO work_items (...) VALUES (row1), (row2), ...` for the diff.
   - One `SELECT dolt_commit('-Am', 'task.5002: import N items by <authorTag>')` — only if `inserted > 0`.
3. Prints summary table: inserted / skipped / failed + dolt_commit hash.

**ID preservation.** The bulk INSERT writes the `WorkItem.id` field verbatim (`bug.0002` → row id `bug.0002`). It does NOT call `create()` (which auto-allocates from the `5000+` floor). Because it skips the floor logic, legacy `0XXX` IDs and API-allocated `5000+` IDs coexist without conflict.

**Field coverage.** Every column in the `work_items` schema is mapped:
`id, type, title, status, node, project_id, parent_id, priority, rank, estimate, summary, outcome, branch, pr, reviewer, revision, blocked_by, deploy_verified, claimed_by_run, claimed_at, last_command, assignees, external_refs, labels, spec_refs, created_at, updated_at`

`created_at` / `updated_at` are taken from frontmatter `created:` / `updated:` — historical timestamps preserved (so the dashboard's `ORDER BY created_at DESC` keeps months of history).

## How the HTTP importer works (exploratory only)

`nodes/operator/app/scripts/import-work-items-via-api.ts`:

1. Reads markdown items as above.
2. POSTs each to `/api/v1/work/items`. Server allocates a new `5000+` ID.
3. PATCHes the new row with status/priority/rank/estimate/branch/pr/reviewer (the create endpoint doesn't accept these).
4. Writes a `task5002-import-mapping-<env>-<sha8>.json` sidecar at the repo root mapping each `legacyId` → `allocatedId` + the github blob URL of the source markdown (immutable HEAD sha pin).

**Use it when:** you have an apiKey but no DB access and want to prove the loop end-to-end against a deployed env.

**Don't use it for prod.** ID drift breaks every existing reference (`bug.0153` becomes `bug.5xxx`); fixing later requires manual remap.

## Candidate-a results

The HTTP path was used to validate the loop against `https://test.cognidao.org`:

- 478 items posted (462 fresh + 16 prior smoke-test rows)
- 61 `proj.*` rows correctly rejected by the API (projects aren't a `WorkItemType` — separate v1 work)
- All 461 hydratable rows successfully PATCHed for status/priority/rank/estimate/branch
- Sidecar at `task5002-import-mapping-test-1668a58c.json` (gitignored)

## Open follow-ups

- **task.5003** — Schema-level `externalRefs` support so a future bulk-PATCH can attach proper FK ref links (github blob URLs) instead of a sidecar JSON. After this lands, candidate-a's drifted rows can be cleaned by PATCHing externalRefs from the sidecar.
- **Project import** — `proj.*` rows weren't imported because `type: project` isn't allowed. Either add to `WorkItemType` or build a `/api/v1/work/projects` surface.
- **Markdown corpus deletion** — once prod has all ~458 items at their original IDs and validation passes, `git rm work/items/*.md` is safe.

## File map

| File                                                                       | Purpose                                                                     |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `nodes/operator/app/scripts/import-markdown-work-items.ts`                 | **Canonical**. Direct-DB importer. Preserves IDs. Run for prod.             |
| `nodes/operator/app/scripts/import-work-items-via-api.ts`                  | Exploratory. HTTP-only. ID drifts. Used for candidate-a validation.         |
| `nodes/operator/app/scripts/patch-from-sidecar.ts`                         | Companion to HTTP importer. Hydrates status/priority/etc. on existing rows. |
| `nodes/operator/app/src/adapters/server/db/doltgres/work-items-adapter.ts` | Hosts `bulkInsert(items, authorTag)`.                                       |
