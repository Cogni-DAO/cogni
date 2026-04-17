---
id: task.0321
type: task
title: "Parallelize pr-build.yml via per-target matrix"
status: needs_review
priority: 3
rank: 99
estimate: 2
summary: "Split pr-build.yml from a single-job CSV loop into detect → build (matrix, one leg per affected target) → manifest. Each matrix leg builds+pushes one target in parallel; manifest job merges per-leg fragments into the canonical build-manifest.json so downstream candidate-flight sees no contract change."
outcome: |
  - `.github/workflows/pr-build.yml` is three jobs: `detect`, `build` (matrix over affected targets), `manifest`.
  - `scripts/ci/detect-affected.sh` emits `targets_json` (JSON array) alongside the existing CSV output.
  - `scripts/ci/merge-build-fragments.sh` merges per-leg fragments into a canonical `build-images.json`.
  - Downstream `build-manifest.json` artifact has the same name + shape as today; candidate-flight + resolve-pr-build-images.sh unchanged.
  - Both upload-artifact steps use `overwrite: true` so "Re-run failed jobs" works (v4 otherwise errors on duplicate artifact names).
  - Verified green on a live PR with at least one multi-target build to prove parallelism.
  - `docs/guides/create-service.md` refreshed to match the new pipeline — explicit wire-up checklist (detect-affected, build/resolve scripts, Argo catalog, k8s base, wait-for-argocd), k8s-first Step 10 (probes, PDB, sync-waves), IMAGE_IMMUTABILITY + BUILD_ONCE_PROMOTE callouts in Step 6, health-probes spec link in Step 4.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-17
updated: 2026-04-17
labels: [cicd, performance]
---

# task.0321 — Parallelize pr-build.yml via per-target matrix

## Problem

`pr-build.yml` today runs one job that loops `build-and-push-images.sh` over a CSV of affected targets sequentially. On PRs that touch shared packages (all 5 targets rebuild), wall time scales linearly with the number of targets. `build-multi-node.yml` already has a per-node matrix but is `workflow_dispatch`-only (fallback path), so the PR lane has never had parallelism.

## Outcome

Three-job pipeline with parallel per-target builds:

```
detect → build (matrix: target ∈ affected) → manifest
         │                                    │
         └─ uploads build-fragment-<t>.json   └─ merges → build-manifest.json
                                                (same artifact name as before)
```

Downstream contract unchanged: `candidate-flight.yml`, `resolve-pr-build-images.sh`, and `promote-build-payload.sh` need no edits.

## Non-goals

- No per-node candidate flighting — tracked in task.0320.
- No consolidation with `build-multi-node.yml` (still needed as the fallback path).
- No Turborepo `--affected` migration — `detect-affected.sh` stays as-is.

## Validation

- Multi-target PR (e.g. touching `packages/**`): matrix spawns N parallel legs; each pushes its target; manifest job merges all fragments; final `build-manifest.json` has the same shape as today.
- Single-target PR (e.g. `nodes/poly/**` only): only one matrix leg runs; manifest merges one fragment.
- No-affected PR (docs-only): `build` job is skipped; `manifest` runs and uploads an empty-`targets` manifest (parity with today).
- One broken matrix leg (simulate via buildx failure): workflow fails overall; manifest job does not run; PR check red.
- Re-run failed jobs after a flaky build leg: does not fail on artifact name collision (v4 `overwrite: true` is set).

## Notes

- Comment in the workflow header references this task.
- `build-and-push-images.sh` still contains the CSV loop — left untouched so the script is reusable from `build-multi-node.yml` and so this PR's diff stays minimal. Follow-up can simplify if we retire the CSV form.
