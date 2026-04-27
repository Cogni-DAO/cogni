---
id: bug.0389
type: bug
title: drizzle snapshot chain rot — `db:generate:poly` broken on main; wire `drizzle-kit check` per node
status: needs_implement
priority: 1
rank: 1
estimate: 1
branch: bug/0389-drizzle-chain-lint
summary: "On `main` today, `pnpm db:generate:poly` fails with `meta/0027_snapshot.json` self-referential `prevId` colliding with `0028_snapshot.json`. Root cause: PR #930 hand-stitched 0027 with `id == prevId` after the chain had already lost intermediate snapshots. Hand-authored RLS/trigger migrations across all three nodes have been committing `.sql` without matching snapshots. `drizzle-kit check` (upstream) detects this exact failure mode but is not wired into CI — so PR #930 merged without complaint."
outcome: "After this bug closes: (1) the poly Postgres collision is fixed in place — `meta/0027_snapshot.json` gets a fresh `id`, `meta/0028_snapshot.json.prevId` rechains to it; (2) the chain HEAD is restored — a new `meta/0032_snapshot.json` whose `tables` block reflects current schema.ts is added with `prevId → 0028.id`, unblocking `pnpm db:generate:poly` (now reports `No schema changes, nothing to migrate` against unchanged schema.ts; emits a clean 0033 against any real edit); (3) `pnpm db:check` runs `drizzle-kit check` against every node's drizzle config (operator + resy + poly Postgres + poly Doltgres) and is wired into both `check-fast` (pre-push) and `check-all` (pre-commit); (4) `docs/spec/databases.md §2.6` documents the hand-authored-migration recipe so the next RLS/trigger migration doesn't widen the gap. Intermediate snapshots 0011, 0015, 0024–0026, 0029–0031 remain absent — `drizzle-kit check` tolerates this, and only the chain head matters for `generate`."
spec_refs:
  - databases-spec
assignees: []
credit:
project: proj.database-ops
pr:
reviewer:
revision: 1
blocked_by: []
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [db, drizzle, infra, ci, multi-node]
external_refs:
---

# drizzle snapshot chain rot — wire `drizzle-kit check` per node

## Reproduction

```sh
git checkout main && pnpm install --frozen-lockfile
DATABASE_URL=postgres://x:x@localhost/x pnpm db:generate:poly
# Error: [meta/0027_snapshot.json, meta/0028_snapshot.json] are pointing to a parent
# snapshot: meta/0027_snapshot.json/snapshot.json which is a collision.

DATABASE_URL=postgres://x:x@localhost/x \
  npx drizzle-kit check --config=nodes/poly/drizzle.config.ts
# Same error — drizzle-kit's upstream `check` subcommand catches it.
```

`drizzle-kit check` on operator + resy passes today. So the gate is cheap to land and would have rejected PR #930 at PR-time.

## Evidence

| Node     | Journal entries | Snapshots present                                      | `drizzle-kit check` |
| -------- | --------------- | ------------------------------------------------------ | ------------------- |
| operator | 28              | 0000–0010, 0012–0014, 0016–0023, 0027                  | ✅ pass             |
| resy     | 28              | 0000–0010, 0012–0014, 0016–0023                        | ✅ pass             |
| poly     | 33              | 0000–0010, 0012–0014, 0016–0023, **0027 broken**, 0028 | ❌ collision        |

Pattern across all three: every missing snapshot maps to a hand-authored RLS / trigger / policy migration (`0011_triggers_and_backfill`, `0015_rls_identity_profile`, `0024_graph_runs_rls_requested_by`, `0029_poly_copy_trade_multitenant`, `0030_poly_wallet_connections`, `0031_poly_wallet_grants`, `0032_poly_wallet_trading_approvals`). Drizzle-kit can't model these in `generate`, devs hand-write the SQL, and skip the snapshot. `drizzle-kit check` tolerates missing intermediate snapshots — it only fails when the chain _head_ becomes inconsistent (as on poly).

Introduced by `1a27f7564` — _feat(poly): sync-truth ledger cache + release-surface cleanup (task.0328) (#930)_. That PR shipped `meta/0027_snapshot.json` with `id == prevId` (a manual stitch attempt to bypass a "no parent found" error caused by missing 0024–0026 snapshots).

## Why this matters

- Today: any poly schema change requires hand-authored SQL (task.0388 already doing this). The "drizzle-kit is the source of truth" intent of the codebase is silently broken for this node.
- Tomorrow: as `proj.database-ops` brings in new nodes (canary `ai-only`, etc.) and as more RLS work lands, the rot will repeat unless CI catches it.
- This is **not** the long-term fix tracked by [task.0325 — Atlas + GitOps migrations](task.0325.atlas-gitops-migrations.md). Atlas replaces drizzle-kit when scale warrants. This bug closes the integrity gap in the meantime.

## Scope (this PR)

### Phase 1 — Fix the collision + wire the gate

Goal: turn `pnpm db:check` green across all four chains and gate every future PR on it.

1. **Fix `meta/0027_snapshot.json` collision.** Root cause was a duplicate `id`: PR #930 copied 0023's snapshot and kept its `id` (`16cb3cc3-…`), then set `prevId` to the same value. So 0023 and 0027 shared an `id`, and 0028's `prevId` (`16cb3cc3-…`) was ambiguous between them. Fix:
   - `0027_snapshot.json.id` → fresh UUID (`6dae8ba3-e339-427f-a4fa-0711d1a37f8d`).
   - `0027_snapshot.json.prevId` → unchanged at `16cb3cc3-…` (= 0023.id, the legitimate prior present snapshot; intermediate 0024–0026 snapshots remain absent — `drizzle-kit check` tolerates missing intermediate snapshots).
   - `0028_snapshot.json.prevId` → updated to the new 0027.id so the chain `0023 → 0027 → 0028` is unambiguous.
   - Two-file edit, no DDL change, runtime impact zero.
2. **`package.json` scripts** — mirror the existing `db:generate:*` shape:
   ```jsonc
   "db:check:operator":     "dotenv -e .env.local -- tsx node_modules/drizzle-kit/bin.cjs check --config=nodes/operator/drizzle.config.ts",
   "db:check:resy":         "dotenv -e .env.local -- bash -c 'DATABASE_URL=$DATABASE_URL_RESY tsx node_modules/drizzle-kit/bin.cjs check --config=nodes/resy/drizzle.config.ts'",
   "db:check:poly":         "dotenv -e .env.local -- bash -c 'DATABASE_URL=$DATABASE_URL_POLY tsx node_modules/drizzle-kit/bin.cjs check --config=nodes/poly/drizzle.config.ts'",
   "db:check:poly:doltgres":"dotenv -e .env.local -- bash -c 'DATABASE_URL=$DOLTGRES_URL_POLY tsx node_modules/drizzle-kit/bin.cjs check --config=nodes/poly/drizzle.doltgres.config.ts'",
   "db:check": "pnpm db:check:operator && pnpm db:check:resy && pnpm db:check:poly && pnpm db:check:poly:doltgres",
   ```
   `drizzle-kit check` does not connect to the DB — `DATABASE_URL` only has to satisfy the config's required-env assertion. The dotenv prefix matches the equivalent `db:generate:*` scripts so a fresh `.env.local` is enough.
3. **CI wiring** — `scripts/check-all.sh` and `scripts/check-fast.sh` get a peer of `check:docs` that invokes the umbrella `pnpm db:check`. All four chains gated; no exclusions.
4. **Local proof** — `pnpm db:check` exits 0 across all four chains.

### Phase 2 — Spec guidance

Goal: make the right thing the easy thing for the next RLS/trigger migration.

4. **`docs/spec/databases.md` § "Hand-authored migrations"** — short recipe:
   - When to hand-author: drizzle-kit can't model RLS policies, triggers, `ALTER POLICY`, ARRAY DEFAULTs, custom functions, etc.
   - How to keep the snapshot chain whole: copy `meta/(N-1)_snapshot.json` to `meta/NNNN_snapshot.json`, regenerate `id` (any new UUID), set `prevId` to the prior snapshot's `id`, edit the `tables` block to reflect the DDL deltas your `.sql` applies, commit both files in the same commit.
   - Hard rule: never edit a _previously committed_ snapshot's `prevId` to "fix" a broken chain. That's how PR #930 happened. If `drizzle-kit check` fails, file a chain-restoration bug — don't paper over it.
   - One-line: `pnpm db:check` is the gate; if it goes red, fix the chain, not the script.

## Out of scope (separate followup)

- **operator + resy chain hygiene.** Both nodes have the same intermediate-snapshot-gap pattern (0011, 0015 et al.) but pass `drizzle-kit check` and `db:generate` cleanly because their chain heads are aligned with their schema.ts. No urgency.
- **`nodes/node-template/` baseline flattening.** Carries 27 journal entries from the pre-task.0324 lineage; future forks (canary `ai-only`) inherit all of it. Squashing to a fresh 0000 baseline is defensible _for a fork-template_, but needs a deploy-impact check first (CI uses `cogni_template_test`). File separately under `proj.database-ops`.
- **`databases.md` ai-only bringup checklist.** When the canary node lands, its setup should wire `db:check:ai-only` and `db:generate:ai-only` _before_ the first hand-authored RLS migration. Capture in a node-bringup guide rather than this bug.

## Validation

```yaml
exercise: |
  cd <fresh worktree off this branch>
  pnpm install --frozen-lockfile
  pnpm db:check                    # all four chains pass (was: poly Postgres collision on main)
  pnpm db:generate:poly            # "No schema changes, nothing to migrate" on unchanged schema.ts
                                   # (was: malformed combined-deltas diff against stale 0028 head)
observability: none — pure CI/static check, no runtime emission
```

## Notes for the next agent

- After merge, `pnpm db:check` is GREEN across all four chains and `pnpm db:generate:poly` reports clean. The pre-push hook gates new chain rot before it can land.
- The new `meta/0032_snapshot.json` was produced by trimming the journal to idx≤28, running `drizzle-kit generate` through its rename prompts via `expect` (auto-selecting "create column" for every prompt — irrelevant since the SQL was discarded; only the snapshot's `tables` block is kept), restoring the journal, then renaming `meta/0029_snapshot.json` → `meta/0032_snapshot.json`. The snapshot reflects schema.ts state at the commit's HEAD; if a future schema.ts edit ships in the same PR, regenerate.
- The 0027 fix is a renumber + rewire only — the `tables` block is whatever PR #930 captured. Not validated against deployed-DB ground truth, but unused by `generate` (only the head matters) and tolerated by `check`.
