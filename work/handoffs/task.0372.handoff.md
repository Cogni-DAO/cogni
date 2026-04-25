---
id: task.0372.handoff
type: handoff
work_item_id: task.0372
status: active
created: 2026-04-25
updated: 2026-04-25
branch: feat/task.0372-matrix-cutover
last_commit: 5726591d8
---

# Handoff: Per-node matrix cutover (3 envs, atomic)

## Context

- Today, every flight workflow (`candidate-flight.yml`, `flight-preview.yml`, `promote-and-deploy.yml`) treats all 4 image targets as one all-or-nothing payload. A broken poly verify can fail an operator-only PR's flight. Single-slot lease, single deploy branch, single Argo wait per env.
- **Per-node lane isolation** = each `(env, node)` pair gets its own deploy branch (`deploy/<env>-<node>`), its own Argo Application generator, its own GHA matrix cell with `fail-fast:false`. Branch ref = lease (Kargo Stage primitive on existing infra). A failed verify on one node cannot block another node's lane.
- **Scope is symmetric across all 3 envs in one atomic PR** (candidate-a + preview + production). Symmetric architecture is the discipline; per-env divergence would be a tax forever.
- `release.yml` reads exactly one thing from `deploy/preview`: `.promote-state/current-sha` (a single SHA file, see `scripts/ci/create-release.sh:22`). An aggregator job in `flight-preview.yml` keeps that file updated after all-cells-green — `release.yml` itself is unchanged.
- Substrate already in place: task.0320 declared per-env catalog branch fields; task.0374 shipped catalog-as-SSoT (axiom 16 `CATALOG_IS_SSOT`) so this task's enumeration logic reads `infra/catalog/*.yaml` natively. task.0373 already shipped snapshot/restore around the PR-branch rsync — keep it in matrix cells (cheap insurance on single-target trees).

## Current State

- `feat/task.0372-matrix-cutover` branched from `5dde7b1a7` (catalog-SSoT merge). Worktree at `/private/tmp/wt-task-0372`. `pnpm check:fast` green.
- task.0374 merged: `image-tags.sh` is a catalog-backed shim; `detect-affected.sh` reads catalog `path_prefix:`; `wait-for-argocd.sh` requires explicit `PROMOTED_APPS`; `pr-build.yml` validates schema on catalog-touching PRs.
- task.0320 substrate in `infra/catalog/*.yaml`: `candidate_a_branch` / `preview_branch` / `production_branch` declared but per-node deploy branches **NOT pushed** (`git ls-remote origin 'refs/heads/deploy/*-*'` → 0 rows today).
- The 3 AppSets (`infra/k8s/argocd/{candidate-a,preview,production}-applicationset.yaml`) each have 1 git generator reading from the whole-slot deploy branch. Argo Applications named `<env>-<node>`.
- Work item revision 3 (this handoff's matching design) addresses the gap-2/gap-3/gap-4 footguns inline. **Read it before writing YAML.**

## Decisions Made

- [task.0372 work item, revision 3](../items/task.0372.candidate-flight-matrix-cutover.md) — symmetric 3-env scope, aggregator pattern (gap-2/gap-3/gap-4 inline), pinned invariants (concurrency format, source-sha-map per cell, AGGREGATOR_OWNS_LEASE, AFFECTED_FROM_TURBO destination preserved with detect-affected.sh as v0 implementation).
- [task.0320 design + GR-1..GR-6](../items/task.0320.per-node-candidate-flighting.md) — substrate + guardrails. AppSet shape is **4 git generators in one ApplicationSet** (Argo doesn't template `revision` per file). Dogfood ordering: this PR ships under the existing whole-slot workflows.
- [task.0374 PR #1053](https://github.com/Cogni-DAO/node-template/pull/1053) — catalog SSoT + decide-job pattern in `candidate-flight.yml` (the worked example to mirror). Files: `scripts/ci/lib/image-tags.sh`, `scripts/ci/detect-affected.sh`, `infra/catalog/*.yaml`, axiom 16 in `docs/spec/ci-cd.md`.
- [task.0373 PR #1047](https://github.com/Cogni-DAO/node-template/pull/1047) — snapshot/restore around rsync. Keep in matrix cells.
- `release.yml` only reads `deploy/preview/.promote-state/current-sha` (verified: `scripts/ci/create-release.sh:22`). Aggregator-updates-this-file is a ~5-line solution; release.yml unchanged.

## Pre-implement verification spike (~1–2 hours, do this first)

Before writing any matrix YAML, validate four assumptions. Land these notes inline in the work item if any answer changes the design:

- [ ] **release.yml read surface.** Re-read `scripts/ci/create-release.sh` end-to-end. Confirm the only `deploy/preview` read is `.promote-state/current-sha`. Confirm nothing reads from `deploy/preview:.promote-state/source-sha-by-app.json` or `deploy/preview:infra/k8s/overlays/preview/...`. If anything else is read, document and adjust the aggregator scope.
- [ ] **AppSet 1→4 dry-run for all 3 envs.** Render each AppSet variant locally; confirm Application names are byte-identical pre/post (`<env>-<node>` for each `node ∈ ALL_TARGETS`). If `argocd app diff` is available against a candidate cluster, capture diffs.
- [ ] **`verify-buildsha.sh` per-cell semantics.** Confirm task.0349 v3's `NODES ∩ map` behavior accepts a single-app `SOURCE_SHA_MAP` (one entry, one node). Test by passing `NODES=poly` with a one-line map → must verify only poly. (Probably already works; confirm.)
- [ ] **Production rollout scale.** Count concurrent Argo syncs + rolling pod replacements that 4 parallel matrix cells produce. Today's whole-slot has implicit serialization; matrix runs them parallel. Verify cluster headroom (worst case: 4 nodes × 2 replicas mid-rollout). If tight, document trade-off; don't silently regress.

If all four pass, proceed to /implement. If any fails, update the design before writing code.

## Next Actions (post-verification)

- [ ] Read [task.0372 work item](../items/task.0372.candidate-flight-matrix-cutover.md) end-to-end (Revision 3 section + Layered design + pinned invariants). Then [task.0320 § Design + GR-1..GR-6](../items/task.0320.per-node-candidate-flighting.md).
- [ ] **Pre-PR ops: write + run `scripts/ops/bootstrap-per-node-deploy-branches.sh`.** Idempotent. Iterates `infra/catalog/*.yaml`. For each `env ∈ {candidate-a, preview, production}`, push `deploy/<env>-<node>` from each `deploy/<env>` HEAD. Verify via `git ls-remote origin 'refs/heads/deploy/*-*'` → expect **12 rows**. All 12 are dormant until AppSets read them at PR merge.
- [ ] Refactor all 3 AppSets (`infra/k8s/argocd/{candidate-a,preview,production}-applicationset.yaml`): 1 git generator → 4 per-node generators. Application names unchanged so Argo reconciles in place. Add `preserveResourcesOnDeletion: true`.
- [ ] Refactor `candidate-flight.yml` to matrix shape. Concurrency `flight-${{ matrix.env }}-${{ matrix.node }}` (use `matrix.env: [candidate-a]`). Snapshot/restore (task.0373) collapses to single-target per cell — keep it.
- [ ] Refactor `flight-preview.yml` matrix + add the **`aggregate-preview` job** (gap-2/3/4 fix): updates `deploy/preview/.promote-state/current-sha` + merged `source-sha-by-app.json`, owns lock/unlock-preview semantics, writes the single `preview-flight-outcome` artifact `promote-preview-digest-seed.yml` consumes.
- [ ] Refactor `promote-and-deploy.yml` matrix for env ∈ {preview, production}. Lock/unlock-preview jobs **deleted** (move into `flight-preview.yml`'s aggregator). Add `aggregate-production` job that updates `deploy/production/.promote-state/current-sha` after all cells green.
- [ ] Update `candidate-flight-infra.yml` with GR-5 best-effort pre-check. Pin the workflow-name match.
- [ ] Delete `infra/control/candidate-lease.json`, `scripts/ci/acquire-candidate-slot.sh`, `scripts/ci/release-candidate-slot.sh`. Update `scripts/ci/AGENTS.md`. Rewrite `.claude/skills/pr-coordinator-v0/SKILL.md` (drop lease-acquire prose).
- [ ] Tighten `docs/spec/ci-cd.md` per-node-branch + Kargo prose. task.0320 stubbed it; this task makes it operative.
- [ ] Validate per task body cases (a)–(f) — including (d) production-promote-one-node. **All 6 cases stay in scope** (symmetric envs).

## Risks / Gotchas

- **Pinned invariants are not suggestions.** `CONCURRENCY_GROUP_FORMAT` (`flight-${{ matrix.env }}-${{ matrix.node }}`), `AGGREGATOR_OWNS_LEASE` (no per-cell lock/unlock), `SOURCE_SHA_MAP_PER_CELL` (one entry per branch), `PROMOTED_APPS_PER_CELL` (single app passed to wait-for-argocd). Each catches a specific class of bug; review will check them.
- **Argo 1→4 generator transition.** Application names stay byte-identical (`<env>-<node>`) → Argo reconciles in place. `preserveResourcesOnDeletion: true` is belt-and-suspenders. Run the dry-render verification spike before merge. Rollback = `git revert` of the AppSet diff (deploy branches stay).
- **Dogfood ordering (GR-2).** This PR's own diff flights via the **existing whole-slot** workflows in main, not its own diff. Don't create a bootstrap workflow. The first PR merged AFTER this one is the first matrix flight, across all 3 envs simultaneously.
- **promote-and-deploy.yml is 930 lines.** Highest implementation risk. Recommended order: candidate-flight (smallest, ~560 lines, no aggregator) → flight-preview (277 lines, the aggregator lives here) → promote-and-deploy (largest, matrix for two envs). Test each before moving on.
- **AFFECTED_FROM_TURBO is the destination.** `detect-affected.sh` is the v0 path-prefix workaround that reads catalog `path_prefix:` (post-task.0374). task.0260 will deliver real turbo affected-detection later. Don't retroactively redefine the invariant; document the workaround.

## Pointers

| File / Resource                                                                                                                        | Why it matters                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`work/items/task.0372.candidate-flight-matrix-cutover.md`](../items/task.0372.candidate-flight-matrix-cutover.md)                     | Primary briefing — Revision 3 section + pinned invariants + Layered design + validation (a)–(f) |
| [`work/items/task.0320.per-node-candidate-flighting.md`](../items/task.0320.per-node-candidate-flighting.md)                           | Substrate + GR-1..GR-6 design guardrails                                                        |
| [`scripts/ci/create-release.sh`](../../scripts/ci/create-release.sh)                                                                   | Confirms `release.yml`'s only deploy/preview read is `.promote-state/current-sha` (line 22)     |
| [`docs/spec/ci-cd.md`](../../docs/spec/ci-cd.md)                                                                                       | Axiom 16 (`CATALOG_IS_SSOT`); per-node-branch + Kargo prose to tighten                          |
| [`infra/catalog/*.yaml`](../../infra/catalog/)                                                                                         | SSoT — read `name`, `path_prefix`, `*_branch` fields                                            |
| [`infra/k8s/argocd/{candidate-a,preview,production}-applicationset.yaml`](../../infra/k8s/argocd/)                                     | The 1→4 generator refactor surface, all 3 envs                                                  |
| [`.github/workflows/candidate-flight.yml`](../../.github/workflows/candidate-flight.yml)                                               | Smallest workflow; start here                                                                   |
| [`.github/workflows/flight-preview.yml`](../../.github/workflows/flight-preview.yml)                                                   | Aggregator job lives here (gap-2/3/4)                                                           |
| [`.github/workflows/promote-and-deploy.yml`](../../.github/workflows/promote-and-deploy.yml)                                           | 930 lines; matrix for env ∈ {preview, production}; biggest                                      |
| [`.github/workflows/pr-build.yml`](../../.github/workflows/pr-build.yml)                                                               | task.0374 worked example for `decide` → `targets_json` matrix                                   |
| [`scripts/ci/lib/image-tags.sh`](../../scripts/ci/lib/image-tags.sh)                                                                   | Catalog-backed shim — source it; no edits needed                                                |
| [`scripts/ci/wait-for-argocd.sh`](../../scripts/ci/wait-for-argocd.sh)                                                                 | Requires `PROMOTED_APPS` per cell. Ancestry check on main via PR #1054.                         |
| Argo CD ApplicationSet [files generator docs](https://argo-cd.readthedocs.io/en/stable/operator-manual/applicationset/Generators-Git/) | Confirm "1 generator → 4 generators" pattern (GR-1)                                             |
