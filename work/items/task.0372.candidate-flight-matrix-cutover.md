---
id: task.0372
type: task
title: Per-node cutover — refactor 3 AppSets + matrix fan-out across all flight workflows
status: needs_implement
priority: 0
rank: 99
estimate: 4
summary: "Atomic cutover PR. Refactors candidate-a/preview/production ApplicationSets from 1 git generator → 4 per-node git generators each, AND cuts candidate-flight.yml, flight-preview.yml, and promote-and-deploy.yml over to a strategy.matrix fan-out with fail-fast:false. AppSet-read and workflow-write flip to per-node branches in the same merge — no window where AppSets read deploy/<env>-<node> while workflows still write deploy/<env>. Absorbs the AppSet work originally planned for task.0320 after review revision 1 flagged the read/write split risk."
outcome: |
  - All 3 ApplicationSets refactored: `infra/k8s/argocd/{candidate-a,preview,production}-applicationset.yaml` each goes from 1 git generator → 4 per-node git generators reading `deploy/<env>-<node>` and `files: [infra/catalog/<node>.yaml]`. `source.targetRevision` templates from `{{<env>_branch}}` (fields declared in task.0320).
  - `candidate-flight.yml` / `flight-preview.yml` / `promote-and-deploy.yml` all fan out via `strategy.matrix` with `fail-fast: false` — one job per affected node, each scoped to its own per-env branch + per-node Argo Application.
  - Affected-node list comes from `turbo ls --affected --filter=...[$BASE]` (candidate-a: vs origin/main; preview/prod: vs the previous promoted SHA per env).
  - Each matrix cell pushes to `deploy/<env>-<node>` and waits on `<env>-<node>` Argo Application only. Sibling node failure cannot fail this cell.
  - `concurrency: { group: flight-${{ matrix.env }}-${{ matrix.node }}, cancel-in-progress: false }` prevents same-branch racing across workflow types.
  - `infra/control/candidate-lease.json`, `scripts/ci/acquire-candidate-slot.sh`, `scripts/ci/release-candidate-slot.sh` deleted if no remaining callers.
  - `candidate-flight-infra.yml` gains a best-effort pre-check querying in-progress flight runs (v0 per GR-5).
  - `.claude/skills/pr-coordinator-v0/SKILL.md` rewritten: drops lease-acquire steps, confirms Turbo-affected nodes, reads per-node branch heads in the Live Build Matrix.
  - `docs/spec/ci-cd.md` updated with per-node-branch model + Kargo-alignment note (task.0320 already added the two-part prose; task.0372 tightens it once the cutover is live).
  - Preserves invariants from task.0320 design review GR-1..GR-6. Adds preserveResourcesOnDeletion: true to all 3 AppSets as transition belt-and-suspenders.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0320
deploy_verified: false
created: 2026-04-24
updated: 2026-04-25
labels: [cicd, deployment]
external_refs:
---

# task.0372 — Per-node matrix cutover

## Context

Split from task.0320 to keep that task at one-PR scope. Task.0320 lands the substrate (per-node branches + per-env AppSet refactor + catalog fields) uniformly across candidate-a / preview / production. This task lands the workflow cutover — also uniformly across all three.

Full design + design-review history live in `task.0320.per-node-candidate-flighting.md`. This task inherits those invariants and guardrails verbatim:

- Design: task.0320 `## Design` section (branch-head-as-lease, matrix-with-fail-fast, Turbo-affected, no new services/CRDs/controllers).
- Guardrails: GR-2 (dogfood ordering), GR-3 (concurrency group), GR-4 (PR #1043 deletion tail landed first — eliminates hook failure class), GR-5 (best-effort infra pre-check → follow-up).

## Requirements

See task.0320 `### Files` + `### Implementation Order` → PR 2 (unified 3-env variant).

## Dependencies

- **Hard-blocked on**: task.0320 merged + the 12 per-env per-node deploy branches pushed (otherwise the matrix cells have nothing to push to).
- **Soft-blocked on**: PR #1043 merged (task.0371 step 1 — kills Argo PreSync hook Jobs globally, removes the stuck-hook failure class at the source).

## Workflows Affected

| Workflow                     | Fan-out shape                                                         |
| ---------------------------- | --------------------------------------------------------------------- |
| `candidate-flight.yml`       | Matrix over Turbo-affected nodes vs `origin/main`                     |
| `flight-preview.yml`         | Matrix over Turbo-affected nodes vs previous preview SHA              |
| `promote-and-deploy.yml`     | Matrix over Turbo-affected nodes vs previous production SHA           |
| `candidate-flight-infra.yml` | Unchanged (still whole-slot); gains pre-check for in-progress flights |

Each matrix cell pushes to the matching `deploy/<env>-<node>` branch and waits on the matching Argo Application.

## Dogfood Ordering (GR-2)

This PR **must** ship under the pre-cutover whole-slot model:

1. task.0320 merges (whole-slot flight model unchanged — substrate only).
2. 12 per-env per-node branches pushed post-merge (automation script or manual).
3. THIS PR flights via the **existing whole-slot workflow** to validate its own diff.
4. Merge THIS PR.
5. The first PR merged _after_ this one is the first flight of the new lane model.

Do not create a bootstrap workflow to flight this PR on its own new model.

## Validation

- (a) Flight a PR touching only poly on candidate-a → only `deploy/candidate-a-poly` advances; sibling branches unchanged.
- (b) Flight a PR with an intentionally broken resy on candidate-a → resy matrix cell red, operator/poly/scheduler-worker cells green; their per-node candidate-a branches advance.
- (c) Merge to main triggering preview promotion with one affected node → only that node's preview matrix cell runs; other nodes' preview branches untouched.
- (d) Production promotion for one node via dispatch → matrix cell runs for that node only.
- (e) Concurrent flights on disjoint nodes → both complete, no cross-interference.
- (f) Concurrent flights on the same node → second gets non-fast-forward push OR waits on concurrency group (GR-3), eventually succeeds or fails cleanly.

## Follow-ups Out of Scope

- **GR-5**: Harden `candidate-flight-infra.yml` pre-check from best-effort `gh run list` to a proper lease before adding a 5th node.
- **Catalog-as-SSOT**: Separate task (see proj.cicd-services-gitops "Pareto Path Step 3") — make `infra/catalog/*.yaml` the single declaration that drives build scripts, wait-for-argocd APPS, compose, so adding a node collapses from 10 steps to 3.
