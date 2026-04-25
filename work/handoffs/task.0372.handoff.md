---
id: task.0372.handoff
type: handoff
work_item_id: task.0372
status: archived
created: 2026-04-25
updated: 2026-04-25
branch: feat/task.0372-matrix-cutover
last_commit: 315874bfc
---

# Handoff: Per-node matrix cutover (3 envs, atomic)

## Context

- Today, every flight workflow (`candidate-flight.yml`, `flight-preview.yml`, `promote-and-deploy.yml`) treats all 4 image targets as one all-or-nothing payload. A broken poly verify can fail an operator-only PR's flight. Single-slot lease, single deploy branch, single Argo wait per env.
- **Per-node lane isolation** = each `(env, node)` pair gets its own deploy branch (`deploy/<env>-<node>`), its own Argo Application generator, its own GHA matrix cell with `fail-fast:false`. Branch ref = lease (Kargo Stage primitive on existing infra). A failed verify on one node cannot block another node's lane.
- **Scope is symmetric across all 3 envs in one atomic PR** (candidate-a + preview + production). Symmetric architecture is the discipline; per-env divergence would be a tax forever.
- `release.yml` reads exactly one thing from `deploy/preview`: `.promote-state/current-sha` (a single SHA file, see `scripts/ci/create-release.sh:22`). An aggregator job in `flight-preview.yml` keeps that file updated after all-cells-green — `release.yml` itself is unchanged.
- Substrate already in place: task.0320 declared per-env catalog branch fields; task.0374 shipped catalog-as-SSoT (axiom 16 `CATALOG_IS_SSOT`) so this task's enumeration logic reads `infra/catalog/*.yaml` natively. task.0373 already shipped snapshot/restore around the PR-branch rsync — keep it in matrix cells (cheap insurance on single-target trees).

## Current State (2026-04-25, post-foundation, mid-implement)

**Foundation shipped (5 commits on branch, check:fast green):**

- `426cecda1` — Revision 4 design (R4-#2/3/4/5/8 + bottom checklist rewrite + handoff spike #6/#7)
- `1be4af209` — `scripts/ops/bootstrap-per-node-deploy-branches.sh` (idempotent + fast-forwarding; DRY_RUN=1 verified, prints 12 ref-update plan)
- `eda61fae3` — `detect-affected.sh` treats `infra/catalog/**` + `lib/image-tags.sh` as global-build-input (CATALOG_EDITS_ARE_GLOBAL_BUILD_INPUT)
- `885bf4ccb` — All 3 ApplicationSets refactored 1 → 4 git generators with per-node `revision` + `{{<env>_branch}}` template + `preserveResourcesOnDeletion: true`
- `315874bfc` — `candidate-flight-infra.yml` GR-5 best-effort pre-check

**Verification spike status:**

- ✅ #1 release.yml read surface: confirmed `create-release.sh:22` is the only `deploy/preview` read; `release.yml` has no other reads. `release.yml` byte-unchanged works under CURRENT_SHA_IS_MERGE_BASE.
- ✅ #3 verify-buildsha.sh per-cell: confirmed `NODES ∩ map` mode (lines 109-134) accepts a single-app `SOURCE_SHA_MAP` with `NODES=<that-node>`. Per-cell semantics work.
- ⏳ #2 AppSet 1→4 dry-render: AppSets refactored but not yet rendered against a candidate cluster. Run `argocd appset render` (or `kubectl kustomize` + `argocd app diff`) after the bootstrap branches are pushed.
- ⏳ #4 production rollout scale: defer until first matrix flight; observe k3s headroom under 4 parallel rollouts.
- ⏳ #6 per-cell push permission: needs the per-node branches pushed first; then dispatch a no-op test workflow.
- ⏳ #7 AppSet 4-generator render distinctness: same dependency as #2.

**Original Current State (pre-foundation):**

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
- [ ] **Per-cell push permission (R4 spike #6).** Per-cell push permission ≠ bootstrap permission. Dispatch a no-op test workflow (or use an ad-hoc workflow_dispatch) that pushes from a matrix-cell context to one of the per-node deploy branches using `${{ secrets.GITHUB_TOKEN }}`. If branch-protection on `deploy/*` blocks the per-cell write, address before opening the PR (org-rule update or `pull_request_target` permission).
- [ ] **AppSet 4-generator render distinctness (R4 spike #7).** Render each refactored AppSet (`argocd appset render` or equivalent) and confirm the 4-git-generators-with-1-file-each pattern produces 4 distinct Applications named `<env>-<node>`, not 4 duplicates or 1 with merged-revisions. If `argocd app diff` is available against a candidate cluster, capture diffs proving `source.targetRevision` is the only spec change per Application.

If all six pass, proceed to /implement. If any fails, update the design before writing code.

## Next Actions (foundation in; workflows + cleanup remain)

**Foundation done in this branch:** revision 4 design, bootstrap script, detect-affected catalog-as-global, 3 AppSet refactors, GR-5 pre-check. **What remains:**

- [ ] **Pre-PR ops: run `scripts/ops/bootstrap-per-node-deploy-branches.sh`** against the live remote. DRY_RUN=1 already verified the 12 ref-update plan. Push for real, then verify `git ls-remote origin 'refs/heads/deploy/*-*'` shows 12 rows. Branches dormant until AppSet flip at merge. Will need to be **re-run as the last action immediately before merging** (BOOTSTRAP_FAST_FORWARDS_BEFORE_MERGE — fast-forwards per-node branches to whole-slot tips so AppSet flip is a no-op).
- [ ] **Refactor `candidate-flight.yml` to matrix shape.** 562 lines today. Add `decide` job (catalog-driven via `detect-affected.sh`); convert `flight` + `verify-candidate` + `release-slot` into matrix-fanned cells with `matrix.env: [candidate-a]` + `matrix.node: ${{ fromJson(needs.decide.outputs.targets_json) }}` + `fail-fast: false`. Concurrency `flight-${{ matrix.env }}-${{ matrix.node }}`. Per-cell scope: clone `deploy/candidate-a-${{ matrix.node }}`; rsync `infra/k8s/overlays/candidate-a/${{ matrix.node }}/ + base/ + infra/catalog/${{ matrix.node }}.yaml` only (CATALOG_EDITS_ARE_GLOBAL_BUILD_INPUT); `promote-k8s-image.sh` for one app; push; `wait-for-argocd.sh PROMOTED_APPS=${{ matrix.node }} EXPECTED_SHA=<branch tip>`; `verify-buildsha.sh` single-app map mode; smoke. **Delete** `acquire-candidate-slot` / `release-candidate-slot` / `report-no-acquire-failure` jobs. Add a final `report-status` job (single PR-head commit-status check; do NOT fan out per-cell).
- [ ] **Refactor `flight-preview.yml` (277 lines) + add `aggregate-preview`.** Replace single `flight-preview.sh` dispatch with a matrix that calls `promote-and-deploy.yml` (workflow_call) per affected node with `inputs.nodes=${{ matrix.node }}` and `inputs.env=preview`. Then add the aggregator job per the design body (Layer 3-B reference YAML in the work item). The aggregator: `concurrency: { group: aggregate-preview, cancel-in-progress: false }` + rebase-retry on push + CURRENT_SHA_IS_MERGE_BASE compute + ROLLUP_MAP_PRESERVES_UNAFFECTED merge + lock/unlock-preview-in-aggregator-only + `preview-flight-outcome` artifact (single-source for `promote-preview-digest-seed.yml`).
- [ ] **Refactor `promote-and-deploy.yml` (932 lines) — matrix for env ∈ {preview, production}.** Add `workflow_call.inputs.nodes` (CSV) alongside dispatch inputs. Add a top `decide` job. Matrix-fan `promote-k8s` / `verify-deploy` / `verify` / `e2e` over `nodes`. **Delete** `lock-preview-on-success` / `unlock-preview-on-failure` (moved to flight-preview's aggregator — AGGREGATOR_OWNS_LEASE). Add `aggregate-production` job (CURRENT_SHA_IS_MERGE_BASE over `deploy/production-<node>` tips + ROLLUP_MAP_PRESERVES_UNAFFECTED + `concurrency: aggregate-production` + rebase-retry).
- [ ] **Cleanup:** delete `infra/control/candidate-lease.json`, `scripts/ci/acquire-candidate-slot.sh`, `scripts/ci/release-candidate-slot.sh`. Update `scripts/ci/AGENTS.md`. Rewrite `.claude/skills/pr-coordinator-v0/SKILL.md` (drop lease-acquire prose; describe matrix output reading per-node branches).
- [ ] **Docs:** tighten `docs/spec/ci-cd.md` per-node-branch + Kargo prose (replace whole-slot lease prose with `BRANCH_HEAD_IS_LEASE` + `LANE_ISOLATION` axioms).
- [ ] **Validation:** dogfood-flight this PR via the **existing whole-slot** workflows in main (GR-2). Then merge. Then validate cases (a)–(f) on the next PR (the first matrix flight) — **all 6 cases stay in scope** (symmetric envs).

**Implementation order (per work item Risks): candidate-flight (smallest) → flight-preview (aggregator lives here) → promote-and-deploy (largest). Test each stage with workflow_dispatch on a no-op PR before committing the next.** Each is its own commit; do not batch.

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
