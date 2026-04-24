---
id: task.0371
type: task
title: candidate-flight matrix cutover — Turbo-affected fan-out + delete whole-slot lease
status: needs_implement
priority: 0
rank: 99
estimate: 2
summary: "Second half of the task.0320 decoupling — after the per-node AppSet + deploy branches land via task.0320 PR 1, cut candidate-flight.yml over to a strategy.matrix fan-out with fail-fast:false, compute affected nodes via Turbo, delete whole-slot lease + acquire/release scripts, and rewrite pr-coordinator-v0 accordingly."
outcome: |
  - `candidate-flight.yml` runs a `detect-affected` job computing nodes from `turbo ls --affected --filter=...[origin/main]` and fans out promote/verify/smoke over a matrix with `fail-fast: false`.
  - Each matrix cell targets its per-node `deploy/candidate-a-<node>` branch and waits on only its own Argo Application (structural lane isolation).
  - `concurrency: { group: flight-${{ matrix.node }}, cancel-in-progress: false }` prevents same-node parallel pushes (GR-3).
  - `infra/control/candidate-lease.json`, `scripts/ci/acquire-candidate-slot.sh`, `scripts/ci/release-candidate-slot.sh` deleted if no remaining callers.
  - `candidate-flight-infra.yml` gains a pre-check querying `gh run list --workflow=candidate-flight.yml --status=in_progress` (v0 best-effort per GR-5).
  - `.claude/skills/pr-coordinator-v0/SKILL.md` rewritten: drops lease-acquire steps, confirms Turbo-affected nodes, reads per-node branch heads.
  - `docs/spec/ci-cd.md` updated with per-node-branch model + Kargo-alignment note.
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
updated: 2026-04-24
labels: [cicd, deployment]
external_refs:
---

# task.0371 — candidate-flight matrix cutover

## Context

Split from task.0320 to keep that task at one-PR scope. Task.0320 lands the substrate (per-node branches + 4-generator AppSet + catalog fields); this task lands the workflow cutover.

Full design + design-review history live in `task.0320.per-node-candidate-flighting.md`. This task inherits those invariants and guardrails verbatim:

- Design: task.0320 `## Design` section (branch-head-as-lease, matrix-with-fail-fast, Turbo-affected, no new services/CRDs/controllers).
- Guardrails: GR-2 (dogfood ordering), GR-3 (concurrency group), GR-4 (land PR #1041 first), GR-5 (best-effort infra pre-check → follow-up).

## Requirements

See task.0320 `### Files` + `### Implementation Order` → PR 2.

## Dependencies

- **Hard-blocked on**: task.0320 merged + the 4 per-node deploy branches pushed (otherwise the matrix cells have nothing to push to).
- **Soft-blocked on**: PR #1041 merged (GR-4 — cleaner cutover validation).

## Dogfood Ordering (GR-2)

This PR **must** ship under the pre-cutover whole-slot candidate-flight model:

1. task.0320 merges (whole-slot flight model unchanged).
2. 4 per-node branches pushed post-merge.
3. THIS PR flights via the **existing whole-slot workflow** to validate its own diff.
4. Merge THIS PR.
5. The first PR merged _after_ this one is the first flight of the new lane model.

Do not create a bootstrap workflow to try to flight this PR on its own new model.

## Validation

Per task.0320 `### Files` test cases (a–d):

- (a) Flight a PR touching only poly → only `deploy/candidate-a-poly` head advances; operator/resy/scheduler-worker branches unchanged.
- (b) Flight a PR with an intentionally broken resy → resy matrix cell red, other cells green, their per-node branches advance.
- (c) Concurrent flights on disjoint nodes → both complete, no cross-interference.
- (d) Concurrent flights on the same node → second gets non-fast-forward push OR waits on concurrency group (GR-3), eventually succeeds or fails cleanly.

## Follow-ups Out of Scope for This Task

- **GR-5**: Harden `candidate-flight-infra.yml` pre-check from best-effort `gh run list` to a proper lease before adding a 5th node. File as a new task when the 5th node is on the horizon.
