---
id: bug.0381
type: bug
title: "wait-for-in-cluster-services.sh ignores PROMOTED_APPS — every matrix cell waits for every Deployment"
status: needs_implement
priority: 1
rank: 30
estimate: 1
summary: "task.0376's per-node matrix calls `wait-for-in-cluster-services.sh` once per cell with `PROMOTED_APPS=${{ matrix.node }}`, but the script hardcodes `SERVICES=(operator-node-app poly-node-app resy-node-app scheduler-worker)` and ignores the env var. Each cell loops over all four Deployments, so a 4-cell matrix runs 16 `kubectl rollout status` calls instead of 4. Worse: every cell blocks on every rollout, so a single slow Deployment fails every cell in lockstep. First surfaced on the #1033 preview promote (run 24967038834): all 4 verify-deploy cells failed simultaneously after ~8min when one rollout exceeded its 300s timeout, even though only poly had a real diff. Pre-matrix the cost was hidden — script ran once per flight."
outcome: |
  - `wait-for-in-cluster-services.sh` requires `PROMOTED_APPS` (CSV) and iterates only the Deployments owned by those nodes. Mirrors the pattern in `wait-for-argocd.sh` (PROMOTED_APPS as required env, no hardcoded default — `97f5532d3`).
  - Mapping `node → Deployment name`: `operator|poly|resy → ${node}-node-app`; `scheduler-worker → scheduler-worker`. Inline `case` statement; promotion to a `k8s_deployment` catalog field is a separate follow-up if a fifth node lands.
  - Per-cell wall time drops from ~8min (4× sequential rollouts) to ~30–60s (1 rollout). Lockstep-failure mode disappears: a slow rollout on node X fails only its own cell, not all four.
  - `wait-for-in-cluster-services.sh` header comment naming SERVICES becomes obsolete and is replaced with the PROMOTED_APPS contract documentation.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-26
updated: 2026-04-26
labels: [cicd, performance, task.0376-followup, lane-isolation]
external_refs:
  - work/items/task.0376.preview-production-matrix-cutover.md
  - scripts/ci/wait-for-in-cluster-services.sh
  - .github/workflows/promote-and-deploy.yml
---

# bug.0381 — wait-for-in-cluster-services.sh ignores PROMOTED_APPS

## Problem

After task.0376's per-node matrix landed on main, `verify-deploy` runs as N parallel cells (one per node). Each cell sets `PROMOTED_APPS: ${{ matrix.node }}` and calls `bash app-src/scripts/ci/wait-for-in-cluster-services.sh`. The script header documents that env var as the contract, and `wait-for-argocd.sh` (the sibling) honors it. But `wait-for-in-cluster-services.sh:57` hardcodes the iteration target:

```bash
SERVICES=(operator-node-app poly-node-app resy-node-app scheduler-worker)
```

`PROMOTED_APPS` is unread. Every cell loops over every Deployment.

Concrete failure shape on preview promote run `24967038834` (#1033, 2026-04-26):

```
verify-deploy (poly):     21:08:34 → 21:14:52   (8min 18s)
verify-deploy (resy):     21:06:37 → 21:14:49   (8min 12s)
verify-deploy (operator): 21:06:25 → 21:14:50   (8min 25s)
verify-deploy (scheduler-worker): 21:06:32 → 21:14:56  (8min 24s)

All four: failure
```

Each cell's log shows the same SERVICES loop:

```
⏳ kubectl rollout status deployment/operator-node-app -n cogni-preview (timeout 300s)
⏳ kubectl rollout status deployment/poly-node-app     -n cogni-preview (timeout 300s)
⏳ kubectl rollout status deployment/resy-node-app     -n cogni-preview (timeout 300s)
⏳ kubectl rollout status deployment/scheduler-worker  -n cogni-preview (timeout 300s)
```

Lane isolation (`LANE_ISOLATION`, axiom 18) is violated at this step: a slow `scheduler-worker` rollout fails the `poly` cell. The task.0376 cutover claim that "sibling-node failure cannot fail this cell" is true at the GHA-job level (separate jobs, `fail-fast: false`) but false at the script level — every cell runs every rollout.

## Why this only surfaced now

- Pre-matrix (one whole-slot `verify-deploy` job): the script ran once per flight, four rollouts in series — this was the right cost.
- First post-matrix run after task.0376 merged (#1062's own promote, run `24966815553`): no real digest diffs across nodes, every `kubectl rollout status` returned immediately on already-Ready deployments.
- First real-diff matrix promote (#1033, run `24967038834`): #1033 only changes `nodes/poly/`, but the matrix promotes all four nodes anyway because `flight-preview.yml`'s caller doesn't pass an affected-nodes filter at the matrix-fanout layer (separate question — see _Out of scope_). All four cells then race each other on the same four rollouts.

## Fix

`wait-for-in-cluster-services.sh`:

1. Require `PROMOTED_APPS` as env (no default), matching `wait-for-argocd.sh`'s contract.
2. Replace the hardcoded `SERVICES` array with a `node → Deployment name` mapping derived from `PROMOTED_APPS`:

   ```bash
   IFS=',' read -ra _NODES <<< "${PROMOTED_APPS:?PROMOTED_APPS required (CSV of node names)}"
   SERVICES=()
   for node in "${_NODES[@]}"; do
     case "$node" in
       operator|poly|resy) SERVICES+=("${node}-node-app") ;;
       scheduler-worker)   SERVICES+=("scheduler-worker") ;;
       *) echo "::error::wait-for-in-cluster-services: unknown node '$node'"; exit 1 ;;
     esac
   done
   ```

3. Update the header comment: `Adds: edit the case statement below when a new in-cluster deployment needs gating` (and a TODO referencing task.0374's `CATALOG_IS_SSOT` for promotion to a catalog field).

No workflow YAML changes — `promote-and-deploy.yml` already passes `PROMOTED_APPS: ${{ matrix.node }}` per cell.

## Out of scope

- **Whole-matrix-promotes-every-node behavior.** `flight-preview.yml` dispatches `promote-and-deploy.yml` with `nodes` either empty (full matrix) or the affected list from `detect-affected.sh`. On main, post-merge auto-flight currently runs the full matrix. Scoping the fanout to actually-affected nodes is a separate optimization (would also help here, but the lockstep-failure bug must be fixed regardless because production promotes are full-matrix by design).
- **Catalog-driven Deployment name field.** Inline `case` is acceptable for v0; a `k8s_deployment` field in `infra/catalog/*.yaml` is the right home if/when a fifth node lands. File a follow-up if it does.

## Validation

- exercise: dispatch `promote-and-deploy.yml --ref main -f environment=preview -f nodes=poly` against a SHA with a real poly diff. The single `verify-deploy (poly)` cell should run only `kubectl rollout status deployment/poly-node-app` — confirmed by reading the GHA job log.
- observability: cell wall-clock drops below 90s under steady-state. `aggregate-decide-outcome.sh` reports `outcome=dispatched` and `deploy/preview/.promote-state/current-sha` advances.
