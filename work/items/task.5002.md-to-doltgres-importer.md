---
id: task.5002
type: task
title: "One-shot markdown → Doltgres work-item importer (operator v1)"
status: needs_implement
priority: 0
rank: 2
estimate: 2
summary: "Bulk-import all existing `work/items/*.md` items into the operator's `knowledge_operator.work_items` table. Idempotent. Run once per env (candidate-a → preview → prod) by Derek with approval gates between. Existing markdown files stay on disk; the importer only fills the table so the dashboard + future tooling can read everything from Doltgres."
outcome: "Per task.0428, `GET /api/v1/work/items/:id` reads from Doltgres only — so legacy markdown IDs currently 404 via the API. After running this importer once against a target env, `GET /api/v1/work/items/task.0001` returns the row with title/status/type/node and the source `created_at` timestamp intact, and `dolt_log` shows one commit per import run. (Dashboard LIST view still reads markdown for v0; rewire is a separate follow-up.)"
spec_refs: [knowledge-data-plane-spec, work-items-port]
assignees: []
credit:
project: proj.agentic-project-management
branch: feat/task-5002-md-to-doltgres-importer
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-29
updated: 2026-04-29
labels: [work-system, agents, doltgres, operator, importer]
external_refs:
---

# One-shot markdown → Doltgres work-item importer (operator v1)

## Requirements

- A single CLI script in the operator package that reads every `.md` file under `work/items/` (skipping `_index.md`, `_archive/`, `_templates/`) via the existing `MarkdownWorkItemAdapter` and inserts each row into `knowledge_operator.work_items`.
- **Idempotent.** Re-running the importer is a no-op for already-present IDs (`INSERT ... ON CONFLICT (id) DO NOTHING`, with a pre-flight `SELECT id` so we know the diff and can log it).
- **Preserves original IDs.** The importer must NOT use the adapter's `create()` (which auto-allocates from the `5000+` floor). It writes the markdown `id` value verbatim — markdown items keep their `0001-04XX` IDs; API-allocated items keep their `5000+` IDs. ID_RANGE_RESERVED is preserved by construction.
- **Single auto-commit per run.** All INSERT statements are issued sequentially against the connection (no explicit BEGIN/COMMIT — Doltgres accumulates them in the working set), then ONE `dolt_commit('-Am', 'import: <N> items by <authorTag>')` snapshots the batch. Per-row commits would explode `dolt_log`.
- **Timestamps preserved from source.** `bulkInsert` writes `created_at` from `WorkItem.createdAt` (frontmatter `created:`) and `updated_at` from `WorkItem.updatedAt` (frontmatter `updated:`). Without this, all 458 rows would collapse to the import-run instant and the dashboard's `ORDER BY created_at DESC` would lose months of history.
- **Path resolution anchored to repo root.** The CLI's `--root` default resolves via `git rev-parse --show-toplevel` (or walking up to `pnpm-workspace.yaml`). Aborts with a clear error if the resolved path contains zero `.md` files. Avoids the `pnpm --filter` CWD trap where a package-relative default silently finds nothing.
- **`ON CONFLICT` is verified before relied upon.** Checkpoint 1 probes `INSERT … ON CONFLICT (id) DO NOTHING` against a testcontainer Doltgres. If unsupported on Doltgres 0.56.2, fall back to a `SELECT id FROM work_items WHERE id IN (...)` preflight + set-difference + plain INSERT. Document the chosen branch.
- **Author tag derives from env.** `IMPORTER_AUTHOR=<name>` env var is required; default would silently misattribute. Falls into `dolt_log` as `import: 458 items by user:derekg1729`.
- **Defaults a missing `node`** to `"shared"` (column default — explicit at the row level so re-imports are stable).
- **Prints a summary table** at the end: `<N inserted> / <N skipped already-present> / <N failed validation>`. Failures don't abort the whole run; bad rows are logged with their ID and skipped.
- **Connection URL** read from `DOLTGRES_URL_OPERATOR` (same env var the runtime adapter uses). Derek runs the script three times locally with the env var pointed at candidate-a, then preview, then prod (port-forward / SSH tunnel).

## Out of scope

- Dashboard rewire to read list-view from Doltgres (separate follow-up — current list facade still reads markdown for v0).
- Two-way sync (markdown → Doltgres → markdown export). Importer is one-shot per env.
- **Updates to already-imported items.** `ON CONFLICT (id) DO NOTHING` means: if a markdown file is edited after first import, the importer does NOT propagate the edit. Use `PATCH /api/v1/work/items/:id` for post-import edits. The importer is bootstrap, not sync.
- A k8s CronJob or scheduled re-import. One-shot CLI only; rerun manually if a backfill is needed.
- A new HTTP endpoint (`POST /api/v1/work/items/_import`). Adds an attack surface for a one-shot operation; CLI + bearer-token-gated SSH is simpler.
- Migrating `_index.md` regeneration to derive from Doltgres. Future task; not blocking.
- Importing items from other nodes' `work/` dirs (none exist today; if they appear, run the importer with a different `--root` flag — covered as a CLI argument below).

## Allowed Changes

- `nodes/operator/app/src/adapters/server/db/doltgres/work-items-adapter.ts` — add a `bulkInsert(rows: WorkItem[], authorTag: string): Promise<{inserted: number; skipped: number}>` method. Distinct from `create()` because it preserves IDs, batches in one transaction, and emits one `dolt_commit` for the whole run.
- `nodes/operator/app/src/adapters/server/db/doltgres/__tests__/work-items-adapter-bulk.component.test.ts` — testcontainer Doltgres test for `bulkInsert`: covers (a) inserts new rows, (b) skips existing IDs by `id`, (c) emits exactly one `dolt_commit`, (d) preserves IDs in the `0001-04XX` range without conflict against the `5000+` floor.
- `nodes/operator/app/scripts/import-markdown-work-items.ts` — NEW CLI entrypoint. Args: `--root <dir>` (default `work/items`), `--dry-run`, `--limit N`. Wires `MarkdownWorkItemAdapter` (read) → `DoltgresOperatorWorkItemAdapter.bulkInsert` (write).
- `nodes/operator/app/package.json` — add `"import:work-items": "tsx scripts/import-markdown-work-items.ts"` script.
- `docs/spec/work-items-port.md` — short note: "v1 bulk-import path uses `bulkInsert(rows, authorTag)` which preserves source IDs and bypasses the `5000+` floor; intended for one-shot backfills only."
- `work/items/_index.md` — add the task.5002 row.
- `work/projects/proj.agentic-project-management.md` — flip the v1 importer row to `In Progress` (Sprint section).

**Deployment impact:** none. No new k8s manifest, no new env-var secret, no Dockerfile change. The script runs locally on Derek's box against each env's Doltgres URL.

## Design

### Outcome

After Derek runs `pnpm --filter @cogni/operator-app import:work-items` against candidate-a (then preview, then prod), all 458 markdown work items live in `knowledge_operator.work_items`. `GET /api/v1/work/items/task.0001` returns the row. `dolt_log` shows exactly one import commit per run.

### Approach

**Solution:** Add one method (`bulkInsert`) to the existing operator-local Doltgres adapter, plus one ~80-line CLI script that wires the existing markdown adapter (read side) to the new bulk method (write side). Run three times by Derek — one env per approval cycle.

**Reuses:**

- `MarkdownWorkItemAdapter.list({})` — already reads + parses every markdown work item into a `WorkItem` (handles all the legacy frontmatter quirks: snake/camel mapping, assignee shape compat, ID parsing, etc.).
- `DoltgresOperatorWorkItemAdapter` — existing adapter with `escapeValue()`, `sql.unsafe()`, `dolt_commit` plumbing all working. We add ONE method.
- `DOLTGRES_URL_OPERATOR` env var — already wired into the runtime container; dev box just needs `kubectl port-forward` or an SSH tunnel.
- `IMPORTER_AUTHOR` follows the same `<kind>:<id>` pattern the existing `authorTag` code already uses for create/patch.

**Rejected:**

- **HTTP endpoint (`POST /api/v1/work/items/_import`)** — opens an internet-facing bulk-write surface for a one-shot. CLI + SSH tunnel reuses existing trust boundary (operator API key + cluster access). Reject.
- **Per-row `INSERT` + `dolt_commit`** — would write 458+ commits to `dolt_log`. The whole point of switching to Doltgres for work items was clean audit, not commit spam. One commit per import run.
- **TRUNCATE + bulk insert (non-idempotent)** — destroys any rows API-created via task.0428's surface (the `5000+` items) when re-running. Idempotent `ON CONFLICT DO NOTHING` is one extra clause and infinitely safer.
- **Bake the markdown into the operator image and run via k8s Job** — needs a Dockerfile change, a Job manifest per overlay, and per-env GitOps. CLI is one file and three Derek-runs. Image route comes back if/when we need scheduled re-imports.
- **Reuse `adapter.create()` and rewrite the ID after the fact** — fights the `5000+` floor for every row. Two methods (one auto-allocating, one ID-preserving) is clearer than overloading `create` with a flag.
- **Move bulk-insert into `packages/work-items/`** — same OPERATOR_LOCAL_ADAPTER_V0 reasoning task.0428 used. Promote when a 2nd consumer materializes; v1 doesn't have one.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] ID_PRESERVED_FROM_SOURCE: `bulkInsert` writes the `WorkItem.id` field verbatim — no auto-allocation, no remap. Markdown items keep `0001-04XX` IDs; round-tripping through this method is stable (spec: work-items-port)
- [ ] SINGLE_COMMIT_PER_RUN: Importer issues exactly one `dolt_commit('-Am', 'import: <N> items by <authorTag>')` after the batch INSERT, not per row (spec: knowledge-data-plane-spec AUTO_COMMIT_ON_WRITE)
- [ ] IDEMPOTENT: Re-running the importer against the same env is a no-op (no new rows inserted, ZERO new `dolt_commit` if `inserted == 0`). Implemented via `ON CONFLICT (id) DO NOTHING` + skip the commit when the diff is empty (spec: knowledge-data-plane-spec)
- [ ] AUTHOR_REQUIRED: `IMPORTER_AUTHOR` env var must be set; the importer aborts with a clear error if missing — silent misattribution in `dolt_log` is worse than a hard-fail (spec: knowledge-data-plane-spec AUTHOR_ATTRIBUTED)
- [ ] ID_FLOOR_RESPECTED: The importer does NOT call `adapter.create()`. The `5000+` floor in `create()` remains untouched and continues to govern API-allocated IDs (spec: work-items-port ID_RANGE_RESERVED)
- [ ] OPERATOR_LOCAL_ADAPTER_V0: The new `bulkInsert` method lives on `DoltgresOperatorWorkItemAdapter` in `nodes/operator/app/src/adapters/server/db/doltgres/`. Not in `packages/work-items/` (spec: packages-architecture)
- [ ] FAILURES_DONT_ABORT: A single bad row (validation error, type mismatch) gets logged + skipped; the rest of the batch continues. Summary table reports `failed: N` with the offending IDs (spec: feature-development-guide)
- [ ] CONTRACTS_ARE_TRUTH: The CLI does not invent new HTTP shapes; it imports `WorkItem` from `@cogni/work-items` directly (no contract change needed — there's no HTTP surface) (spec: architecture)
- [ ] SIMPLE_SOLUTION: Reuses `MarkdownWorkItemAdapter` for read + extends `DoltgresOperatorWorkItemAdapter` with one new method. Total new code ≤ 300 lines including the CLI and tests (realistic budget — `WorkItem` has 20+ columns to map)
- [ ] TIMESTAMPS_PRESERVED_FROM_SOURCE: `bulkInsert` writes the source-frontmatter `createdAt`/`updatedAt` into the row, not `defaultNow()`. Component test asserts a row's `created_at` matches its source within ms (spec: knowledge-data-plane-spec)
- [ ] PATH_ANCHORED_TO_REPO_ROOT: CLI resolves `--root` default against the git toplevel (or pnpm-workspace.yaml), not `process.cwd()`. Aborts with a clear error if the resolved path has zero `.md` files
- [ ] ARCHITECTURE_ALIGNMENT: One-shot CLI invoked locally — no new k8s Job, no new HTTP endpoint, no new env-var secret to deploy

### Files

- Modify: `nodes/operator/app/src/adapters/server/db/doltgres/work-items-adapter.ts` — add `bulkInsert(items, authorTag)` (~40 lines)
- Create: `nodes/operator/app/src/adapters/server/db/doltgres/__tests__/work-items-adapter-bulk.component.test.ts` — testcontainer coverage of the four invariants
- Create: `nodes/operator/app/scripts/import-markdown-work-items.ts` — CLI entrypoint (~80 lines)
- Modify: `nodes/operator/app/package.json` — add `import:work-items` script
- Modify: `docs/spec/work-items-port.md` — one paragraph on the bulk-import path
- Modify: `work/items/_index.md` — add task.5002 row
- Modify: `work/projects/proj.agentic-project-management.md` — flip the v1 importer row to `In Progress`

## Plan

### Checkpoint 1 — `bulkInsert` adapter method + component test

- Milestone: `DoltgresOperatorWorkItemAdapter.bulkInsert` lands; testcontainer test covers ID preservation, idempotency, single-commit, mixed `0001-04XX` + `5000+` coexistence, timestamp preservation
- Invariants: ID_PRESERVED_FROM_SOURCE, SINGLE_COMMIT_PER_RUN, IDEMPOTENT, ID_FLOOR_RESPECTED, TIMESTAMPS_PRESERVED_FROM_SOURCE
- Todos:
  - **Probe first.** Run a tiny smoke test against a testcontainer Doltgres: `INSERT INTO t VALUES (...) ON CONFLICT (id) DO NOTHING`. If supported, proceed. If not, switch to SELECT-existing-IDs preflight + plain INSERT.
  - Implement `bulkInsert(items, authorTag)` — accumulated working set + one `dolt_commit`, returns `{inserted, skipped, doltCommitHash}`
  - Skip the `dolt_commit` call when `inserted === 0` (preserves IDEMPOTENT — re-runs produce zero new commits)
  - Map every `WorkItem` column including `created_at`/`updated_at`/`revision`/`deployVerified`/`externalRefs`/`branch`/`pr`/`reviewer`/`blockedBy`/`claimedByRun`/`claimedAt`/`lastCommand`
  - Component test in `__tests__/work-items-adapter-bulk.component.test.ts` — must include a case asserting `created_at` round-trips from a source `WorkItem`
- Validation/Testing:
  - [ ] component: `pnpm test:component nodes/operator/app/src/adapters/server/db/doltgres/`

### Checkpoint 2 — CLI script + local dry-run

- Milestone: `pnpm --filter @cogni/operator-app import:work-items --dry-run` enumerates all 458 markdown items and reports counts without writing
- Invariants: AUTHOR_REQUIRED, FAILURES_DONT_ABORT, PATH_ANCHORED_TO_REPO_ROOT
- Todos:
  - `scripts/import-markdown-work-items.ts` — wire MarkdownWorkItemAdapter → bulkInsert
  - Args: `--root <dir>` (default = `<repoToplevel>/work/items` via `git rev-parse --show-toplevel`), `--dry-run`, `--limit N`
  - Abort with clear error if `--root` resolves to a path with zero `.md` files
  - Hard-fail if `IMPORTER_AUTHOR` is unset (env-var-only auth path is unique to this CLI; documented asymmetry vs the HTTP `getSessionUser`-derived path)
  - Per-row try/catch with `failed` counter; final summary table includes the `dolt_commit` hash printed by Doltgres
- Validation/Testing:
  - [ ] manual: `IMPORTER_AUTHOR=user:derekg1729 pnpm --filter @cogni/operator-app import:work-items --dry-run` prints `would insert: 458, would skip: 0, failed: 0`

### Checkpoint 3 — Candidate-a wet run + Derek approval gate

- Milestone: importer runs successfully against candidate-a's `knowledge_operator`; Derek validates a sampled GET, approves preview run
- Invariants: ALL
- Todos:
  - Derek: `kubectl port-forward` or SSH tunnel to candidate-a doltgres
  - `IMPORTER_AUTHOR=user:derekg1729 DOLTGRES_URL_OPERATOR=postgres://... pnpm --filter @cogni/operator-app import:work-items`
  - Spot-check: `curl https://test.cognidao.org/api/v1/work/items/task.0001 -H "Authorization: Bearer <key>"` → returns the row
  - `dolt_log` shows one `import: 458 items by user:derekg1729` commit
  - Re-run the importer → `inserted: 0, skipped: 458, failed: 0`, NO new commit (idempotency proof)
  - **Stop and ask Derek for approval before preview run.**

### Checkpoint 4 — Preview wet run + Derek approval gate

- Milestone: importer runs successfully against preview; Derek validates + approves prod
- Todos:
  - Same as Checkpoint 3 but pointed at preview's doltgres
  - **Stop and ask Derek for approval before prod run.**

### Checkpoint 5 — Prod bootstrap + close out

- Milestone: prod `knowledge_operator.work_items` contains all markdown items; PR merged; `deploy_verified: true`
- Todos:
  - Same as Checkpoint 3 but pointed at prod's doltgres
  - Validate sampled GET against prod
  - Flip `deploy_verified: true`

## Rollback

If a wet run produces unexpected state on candidate-a / preview / prod:

1. **Capture the pre-import HEAD before each run:** `psql "$DOLTGRES_URL_OPERATOR" -tAc "SELECT dolt_hashof('HEAD')" > /tmp/pre-import-<env>.sha` (the importer also prints this on stdout as its first line).
2. **Reset on failure:** `psql "$DOLTGRES_URL_OPERATOR" -c "CALL dolt_reset('--hard', '<captured-sha>')"`.
3. The importer is idempotent against an unchanged source corpus, so a clean re-run after a reset will produce identical inserted/skipped counts modulo author tag.

## Validation

```yaml
exercise:
  - kind: cli+api
    description: "Import all 458 markdown work items into a target env's Doltgres, then read one back via the operator API"
    actor: "derekg1729 running the CLI locally with port-forward to the target env"
    steps:
      - "kubectl port-forward to <env> doltgres pod"
      - "IMPORTER_AUTHOR=user:derekg1729 DOLTGRES_URL_OPERATOR=postgres://... pnpm --filter @cogni/operator-app import:work-items"
      - "Importer prints summary: inserted=458 skipped=0 failed=0 (first run) OR inserted=0 skipped=458 failed=0 (re-run)"
      - 'curl https://<env>.cognidao.org/api/v1/work/items/task.0001 -H "Authorization: Bearer <key>" → 200, body matches the markdown source'
      - 'curl https://<env>.cognidao.org/api/v1/work/items/task.5002 -H "Authorization: Bearer <key>" → 200 (this very item, post-import)'
      - "Re-run the importer immediately → inserted=0, skipped=458, NO new dolt_commit"
  pass_criteria:
    - "First run inserts 458 rows in one transaction with exactly one dolt_commit"
    - "Re-run is a no-op (zero new rows, zero new commits)"
    - "GET on a sampled markdown ID (task.0001, bug.0002, story.0117) returns the row with title/status/type intact"
    - "Pre-existing 5000+ API-allocated items are untouched"
observability:
  - "Importer prints structured JSON line with {env, inserted, skipped, failed, dolt_commit_hash} on stdout — caught by Loki via the agent's local terminal capture, not a runtime metric"
  - "Operator pino logs show route_id=work.items.get for each post-import GET (sanity that the route is hit)"
```

## Review Checklist

- [ ] **Work Item:** `task.5002` linked in PR body
- [ ] **Adapter:** `bulkInsert` is the only new public method; `create`/`patch` unchanged
- [ ] **No new HTTP surface:** zero changes under `nodes/operator/app/src/app/api/`
- [ ] **No new infra:** zero changes under `infra/`, `deploy/`, `scripts/ci/`
- [ ] **Idempotency proven:** re-run yields `inserted=0` and zero new commits — covered by component test AND by Derek's wet runs
- [ ] **Approval gates honored:** PR description records the three approval points (candidate-a → preview → prod)
- [ ] **deploy_verified:** flipped after the prod wet run + spot-check GET succeed

## PR / Links

- Project: proj.agentic-project-management
- Predecessors: task.0428 (Doltgres write-path API shipped — provides the table + adapter we extend)
- Follow-up: dashboard list-view rewire to read from Doltgres; `_index.md` regeneration from Doltgres; markdown→Doltgres two-way sync (or kill the markdown side once dashboard is rewired)
