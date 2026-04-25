---
id: task.0376
type: task
title: Preview + production matrix cutover — flight-preview.yml + promote-and-deploy.yml + cleanup
status: needs_implement
priority: 0
rank: 99
estimate: 3
summary: "Follow-up to task.0372. Cuts the preview + production deploy paths over to the same per-node matrix primitive proven on candidate-a. Refactors flight-preview.yml + promote-and-deploy.yml, adds aggregator jobs (CURRENT_SHA_IS_MERGE_BASE / ROLLUP_MAP_PRESERVES_UNAFFECTED / AGGREGATOR_CONCURRENCY_GROUP), retires the lease scripts + state file, rewrites the pr-coordinator-v0 SKILL prose, and tightens docs/spec/ci-cd.md."
outcome: |
  - `infra/k8s/argocd/{preview,production}-applicationset.yaml` refactored 1→4 per-node generators (mirror of candidate-a from task.0372). `goTemplate: true`; `targetRevision: deploy/<env>-{{.name}}`. Shipped together with the workflow writers below so AppSets flip and writers target per-node branches in the same PR.
  - `flight-preview.yml` matrix-fans across affected nodes; ends in an `aggregate-preview` job with `concurrency: aggregate-preview` + rebase-retry. Aggregator computes `current-sha = git merge-base $(deploy/preview-{operator,poly,resy,scheduler-worker} tips)` and merges per-node `source-sha-by-app.json` entries into the rollup, preserving unaffected entries. Owns lock-preview-on-success / unlock-preview-on-failure semantics (AGGREGATOR_OWNS_LEASE).
  - `promote-and-deploy.yml` adds `on: workflow_call:` parallel to `workflow_dispatch:` with `inputs.nodes` (CSV). Job graph: `decide → reconcile-appset → promote-k8s (matrix) → [deploy-infra | verify-deploy (matrix) | verify (matrix)] → e2e → aggregate-production`. `aggregate-production` job updates `deploy/production/.promote-state/current-sha` via merge-base + rollup map merge.
  - `lock-preview-on-success` and `unlock-preview-on-failure` jobs deleted from `promote-and-deploy.yml`; semantics live in `flight-preview.yml`'s aggregator.
  - `infra/control/candidate-lease.json`, `scripts/ci/acquire-candidate-slot.sh`, `scripts/ci/release-candidate-slot.sh` deleted (task.0372 already stopped calling them).
  - `scripts/ci/check-catalog-ssot.sh` (or extension thereof) asserts each AppSet's generator list matches `ALL_TARGETS` — catches "added a 5th node, forgot one of three AppSets" drift.
  - `scripts/ci/AGENTS.md` updated to drop acquire/release-slot from the script catalog.
  - `.claude/skills/pr-coordinator-v0/SKILL.md` rewritten: drop lease-acquire prose; describe matrix output + Live Build Matrix reading per-node deploy branch heads.
  - `docs/spec/ci-cd.md` gains `BRANCH_HEAD_IS_LEASE` + `LANE_ISOLATION` axioms and a Kargo-alignment note.
  - Validation cases (c) preview-promote-one-node, (d) production-promote-one-node, (e) concurrent-disjoint-nodes, (f) concurrent-same-node — exercised against real PRs post-merge.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-25
updated: 2026-04-25
labels: [cicd, deployment, task.0372-followup]
external_refs:
  - work/items/task.0372.candidate-flight-matrix-cutover.md
---

# task.0376 — Preview + production matrix cutover

## Context

task.0372 shipped the per-node primitive end-to-end on candidate-a (live-validated on PR #1033, run 24937132752). This task takes the proven primitive and applies it symmetrically to the preview + production paths.

The matrix shape is already designed (see task.0372 enumerated design + the work item body). All structural decisions are inherited:

- `goTemplate: true` AppSet template with hardcoded `targetRevision: deploy/<env>-{{.name}}` (convention-over-config; live-discovered fix from task.0372).
- Per-cell `concurrency: flight-${{ matrix.env }}-${{ matrix.node }}`.
- Aggregator pattern (gap-2/3/4 fix): `concurrency: aggregate-${{ matrix.env }}` + rebase-retry on push.
- `wait-for-argocd.sh` per-invocation `/tmp/` paths (already shipped in task.0372).

## Pinned invariants (inherited from task.0372 v4)

- **AGGREGATOR_OWNS_LEASE** — lock/unlock-preview semantics live ONLY in `flight-preview.yml`'s `aggregate-preview` job. Per-cell jobs MUST NOT push `.promote-state/lease.json`.
- **AGGREGATOR_CONCURRENCY_GROUP** — every aggregator carries `concurrency: aggregate-${{ matrix.env }}` + rebase-retry.
- **CURRENT_SHA_IS_MERGE_BASE** — `deploy/<env>/.promote-state/current-sha` is computed as `git merge-base` over the 4 per-node tips. `release.yml` byte-unchanged.
- **ROLLUP_MAP_PRESERVES_UNAFFECTED** — aggregator merges by `read existing rollup → overwrite ONLY affected-node keys → push`.
- **SOURCE_SHA_MAP_PER_CELL** — each cell writes a single-entry map on its per-node branch.
- **PROMOTED_APPS_PER_CELL** — `wait-for-argocd PROMOTED_APPS=${{ matrix.node }}`.

## Implementation order

1. `flight-preview.yml` matrix + `aggregate-preview` (the aggregator pattern proves itself before the bigger workflow).
2. `promote-and-deploy.yml` `workflow_call` + matrix + `aggregate-production` (largest; depends on 1).
3. Cleanup: delete lease scripts/state, AGENTS.md edits, SKILL rewrite, ci-cd.md axioms.
4. AppSet generator-drift lint (`scripts/ci/check-catalog-ssot.sh` extension).

Each step is its own commit cycle with workflow_dispatch dry-run between.

## Risks

- **promote-and-deploy.yml is 932 lines.** Highest implementation risk. Recommend splitting B3 into smaller commits if the diff balloons.
- **`workflow_call` semantics.** Caller-cell concurrency applies to the cell job, not to inner jobs of the called workflow; test that disjoint-node parallel cells don't deadlock on inner promote-k8s concurrency.
- **Aggregator rebase-retry depth.** With many concurrent flights, the aggregator may hit retry exhaustion. Set retry count generously (≥5) and surface failures loudly.

## Validation

- (c) Merge to main triggering preview promotion with one affected node → only that node's preview matrix cell runs; sibling per-node preview branches untouched; `aggregate-preview` updates `deploy/preview/.promote-state/current-sha` to `git merge-base` of the 4 per-node tips.
- (d) Production promotion for one node via dispatch → matrix cell runs for that node only; `aggregate-production` updates `deploy/production/.promote-state/current-sha` symmetrically.
- (e) Concurrent flights on disjoint nodes → both complete, no cross-interference; aggregator job rebase-retries on `deploy/<env>` push contention.
- (f) Concurrent flights on the same node → second waits on `concurrency: flight-${{ matrix.env }}-${{ matrix.node }}` group, eventually succeeds or fails cleanly.
- Lease semantics confirmed: `aggregate-preview` is the SOLE writer of `lock-preview-on-success` / `unlock-preview-on-failure`; per-cell jobs cannot push `.promote-state/lease.json` (AGGREGATOR_OWNS_LEASE).
- `release.yml` byte-unchanged; `create-release.sh:22` still reads `current-sha` from `deploy/preview/.promote-state/`.
