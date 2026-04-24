---
id: task.0320
type: task
title: "Per-node candidate flighting (partial promotion + per-node leases)"
status: needs_implement
priority: 0
rank: 99
estimate: 2
branch: design/task-0320-per-node-flighting
summary: "Replace the single candidate-a lease with per-node leases and filter partial overlay promotion by the nodes being flighted. Lets teams fly one node's PR while another node is broken or being flighted concurrently. V0 is manually scoped (coordinator picks the node); no auto-derivation."
outcome: |
  - `candidate-flight.yml` accepts a required `nodes` CSV input (e.g. `poly` or `operator,migrator`).
  - Per-node lease files under `infra/control/` (one per node; legacy single-file `candidate-lease.json` retired or re-shaped).
  - `acquire-candidate-slot.sh` / `release-candidate-slot.sh` operate on the lease subset listed in `nodes`.
  - `promote-build-payload.sh` honors `NODES_FILTER`: overwrites digests only for the listed targets; untouched overlay digests remain at their last-good value.
  - `smoke-candidate.sh` honors `NODES_FILTER`: only the flighted subset is asserted.
  - `wait-for-argocd.sh` honors `NODES_FILTER`: only the flighted apps are awaited.
  - pr-coordinator-v0 skill updated: picks one PR AND one node per flight; confirms the node with the user alongside the PR.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-17
updated: 2026-04-24
labels: [cicd, deployment]
---

# task.0320 — Per-node candidate flighting

## Problem

`candidate-flight.yml` today acquires a single `candidate-lease.json` and promotes the entire built-image payload into `deploy/candidate-a` atomically. Two consequences:

1. A broken node (e.g. poly build failing) blocks flights that only wanted to touch resy — the whole overlay write is all-or-nothing.
2. Only one PR can hold candidate-a at a time, regardless of whether two PRs touch disjoint nodes.

As node count grows and team activity parallelizes, both constraints become artificial serialization.

## Outcome

- **Per-node leases.** Lease state lives per node under `infra/control/` (e.g. `candidate-lease-poly.json`) instead of a single global file. A flight takes only the leases for the nodes it's about to change.
- **Partial overlay promotion.** `promote-build-payload.sh` writes digests only for the listed targets; the rest of the overlay is untouched at its last-good value.
- **Per-node smoke + Argo wait.** `smoke-candidate.sh` and `wait-for-argocd.sh` only assert / block on the flighted subset, so an unrelated broken node doesn't fail this flight.
- **Manual node selection (v0).** `candidate-flight.yml` takes a required `nodes` input. The pr-coordinator-v0 skill specifies one node at a time per dispatch. No auto-derivation from the build manifest — a follow-up can add that once the manual model is proven.
- **Infra lever remains a full stop.** `candidate-flight-infra.yml` still touches the whole VM; v0 rule is "coordinator must not dispatch infra while any node lease is busy." No new lease-set acquire logic required.

## Non-goals (v0)

- **No auto-classifier** deriving `nodes` from the PR diff or build manifest. Coordinator specifies.
- **No multi-writer git-push race handling** on `deploy/candidate-a`. V0 relies on the coordinator's serialization (one dispatch at a time per node, rare enough globally that natural ordering works).
- **No change to release / production promotion.** Overlay promotion there already runs digest-by-digest.
- **No per-node candidate VMs.** Shared candidate-a VM; per-node leases only.

## Validation

- Flight PR A with `nodes=poly`: only poly digest changes in `deploy/candidate-a`; operator/resy digests are unchanged in the resulting commit diff.
- Flight PR B (broken poly, healthy resy) with `nodes=resy`: flight succeeds, resy is live on candidate-a, poly digest on overlay still points at last-good.
- Two dispatches for different nodes at roughly the same time: both acquire their own lease, both run; one `git push` may need a manual retry if they land simultaneously (acceptable in v0).
- `smoke-candidate.sh NODES_FILTER=poly`: asserts only poly endpoints.
- `wait-for-argocd.sh APPS=<subset>`: only blocks on the subset.
- pr-coordinator-v0 dispatch: prompts for PR + node, dispatches with `-f nodes=<node>`.

## Notes

- `promote-build-payload.sh` already reads the payload JSON — a filter pass there is the core diff.
- Lease acquire/release scripts already exist (`acquire-candidate-slot.sh`, `release-candidate-slot.sh`); extend them to a `LEASE_NAME` param or equivalent.
- Multi-node / shared-package PRs use `nodes=operator,poly,resy` to take multiple leases in one flight. Still explicit, not auto.
- Follow-up (not this task): auto-derive `nodes` from `build-manifest.json`; rebase-retry loop for concurrent push safety; lease-set acquire for the infra lever.

## Design

### Outcome

A PR that only touches poly flights poly to candidate-a without needing resy or operator to be green. Run 24910378351 (resy's stuck Argo migrate-hook failing the whole slot) becomes structurally impossible: each node has its own deploy branch, its own Argo Application, and its own verify run. Failure in one lane cannot fail another lane — not because a script filters it out, but because they never share a job boundary.

### Architectural Frame — Kargo Primitives, GHA Substrate

[Kargo](https://kargo.akuity.io) is the Argo team's answer to exactly this problem. We adopt its primitives in-name so a future migration is free, not a rewrite — but implement them on existing infrastructure (GHA + ApplicationSet + deploy branches). **No new CRDs. No new controllers. No long-running service.**

| Kargo concept | Our v0 realization                                                                 |
| ------------- | ---------------------------------------------------------------------------------- |
| **Warehouse** | Per-node image digest set in GHCR (`pr-<N>-<sha>-<node>` + its per-node migrator). |
| **Freight**   | A `{app-digest, migrator-digest, source-sha}` tuple for a single node.             |
| **Stage**     | A per-node Argo Application (`candidate-a-<node>`) tracking its own deploy branch. |
| **Promotion** | `git push deploy/candidate-a-<node>` with the new digest. Ref update is atomic.    |
| **Lease**     | The git ref itself — non-fast-forward push fails; rebase-retry resolves.           |
| **Verify**    | One matrix job per promoted node; each waits on its own Application only.          |

**The branch head is the lease.** No `candidate-lease-*.json` files, no bespoke coordinator — git already solves "one writer at a time per ref" and has done so for 20 years. The original v0 outcome (per-node JSON lease files + `NODES_FILTER` env threading) is replaced by this branch-per-node model as the simpler primitive.

### Key Discoveries from the Spike

1. **`wait-for-argocd.sh` and `smoke-candidate.sh` already honor `PROMOTED_APPS`.** Zero script changes needed for per-node filtering. But we're abandoning filter-in-a-shared-script in favor of job-level isolation — PROMOTED_APPS shrinks to one app per matrix cell, so the "filtering" becomes a side-effect of the matrix shape.
2. **`promote-build-payload.sh` hardcodes four promote targets** (lines 157–160). With the matrix shape, this script no longer needs a NODES_FILTER — it runs once per matrix cell, scoped to a single app, writing only that app's digest to that app's branch.
3. **ApplicationSet templates from `infra/catalog/*.yaml`**. Adding one `candidate_a_branch: deploy/candidate-a-<name>` field per catalog file + one `targetRevision: "{{candidate_a_branch}}"` templating change = per-node branches are live. Argo already supports this natively.
4. **Turborepo is already installed** (`turbo.json` present). `turbo ls --affected --filter=...[$BASE_SHA]` is the canonical way to compute which nodes a PR touches. No hand-rolled path-diff script.

### Approach

**Solution**: Fan out `candidate-flight.yml` across a matrix of affected nodes (computed by Turbo). Each matrix cell is an independent lane: acquire-by-push → verify → smoke, targeting its own deploy branch and its own Argo Application.

1. **Per-node deploy branches.** Create `deploy/candidate-a-operator`, `deploy/candidate-a-poly`, `deploy/candidate-a-resy`, `deploy/candidate-a-scheduler-worker` from current `deploy/candidate-a`. Retire `deploy/candidate-a` after cutover.
2. **AppSet templating.** Add `candidate_a_branch` field to each `infra/catalog/*.yaml`. Template `source.targetRevision` and the generator's `revision` from that field. One existing ApplicationSet continues to produce four Applications, but each now tracks its own per-node branch.
3. **Turbo-computed matrix.** `candidate-flight.yml`'s first job runs `turbo ls --affected --filter=...[origin/main]` and emits a matrix `include:` list of affected nodes. Downstream jobs fan out over that matrix. Dispatcher may override with an optional `nodes` input for manual force-flight (rare; primary path is turbo-computed).
4. **Matrix-isolated verify.** Each matrix cell runs `promote-build-payload.sh` for its one node, pushes to its one branch, runs `wait-for-argocd.sh` with `PROMOTED_APPS=<that-node>`, and runs `smoke-candidate.sh` with the same. A sibling cell's failure cannot fail this cell — they're parallel GHA jobs, not shared `for` loops. `wait-for-argocd.sh` gains nothing; the isolation is structural.
5. **Infra lever unchanged in scope.** `candidate-flight-infra.yml` still touches the whole VM. No new coordination mechanism — humans/coordinator don't dispatch infra while any flight run is active. Document, don't enforce (v0).

**Reuses**:

- ApplicationSet + catalog templating (extending one existing field).
- `promote-k8s-image.sh` per-app overlay write (unchanged).
- `wait-for-argocd.sh` + `smoke-candidate.sh` `PROMOTED_APPS` gate (unchanged; just called with scope=1).
- Turborepo's affected-graph computation (replaces any hand-rolled node-from-diff code).
- GHA `strategy.matrix` with `fail-fast: false` for lane isolation.

**Rejected**:

- **Per-node lease JSON files + `NODES_FILTER` env var.** Original task outcome. Rejected: reinvents `git push --force-with-lease`. Branch head is the atomic lease.
- **New lock/coordinator service.** Explicit non-goal. No long-running service.
- **Hand-rolled path→node mapping.** Rejected in favor of `turbo --filter=...[$BASE_SHA]`. Turbo already knows the workspace dep graph; we'd only be recreating a worse copy.
- **New CRDs / Kargo install this quarter.** Out of scope. We mirror Kargo's primitives in directory/branch names so adoption later is a rename + install, not a rewrite.
- **Per-node matrix of single-script `promote-build-payload.sh` calls with a filter flag.** Redundant once the matrix shape gives structural isolation. Delete the `promote_target` for-loop; the matrix is the loop.
- **Retaining whole-slot `candidate-lease.json`.** Delete it. The infra lever's "no flight active" check reads GHA run state (`gh run list --workflow=candidate-flight.yml --status=in_progress`), not a file.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] NO_NEW_CONTROLLERS: No new CRDs, no new in-cluster controllers, no new long-running services. If this design introduces any, it's wrong.
- [ ] NO_BESPOKE_LOCK: The git ref is the lease. No `candidate-lease-*.json` files. Concurrency is resolved by `git push` non-fast-forward + rebase-retry.
- [ ] AFFECTED_FROM_TURBO: The matrix include list is computed by `turbo ls --affected --filter=...[$BASE_SHA]`. No hand-rolled path-diff script.
- [ ] LANE_ISOLATION: Each promoted node runs in its own GHA matrix job with `fail-fast: false`. One node's red does not short-circuit another node's lane — verified by running the workflow on a PR where one node is intentionally broken.
- [ ] KARGO_ALIGNMENT: Directory / branch names mirror Kargo primitives (branch-per-stage-per-node = `deploy/<stage>-<node>`). A future Kargo install reuses these names, not renames them.
- [ ] ONE_APPSET_SOURCE_OF_TRUTH: Still one `candidate-a-applicationset.yaml`. Per-node routing happens via catalog-file `candidate_a_branch` templating — not by splitting the AppSet into four.
- [ ] BUILD_ONCE_PROMOTE (spec: ci-cd): pr-build still builds `pr-<N>-<sha>-*` once; per-node branches only rewrite overlay digests for their one node.
- [ ] IMAGE_IMMUTABILITY (spec: ci-cd): Digest references only; no `:latest`.
- [ ] SIMPLE_SOLUTION: Net new code is ~1 catalog field, ~5 lines of AppSet templating, ~30 lines of GHA matrix plumbing, plus a branch-creation one-shot. No new scripts. No new packages.
- [ ] ARCHITECTURE_ALIGNMENT: Rides existing ApplicationSet + deploy branches + GHA (spec: architecture).

### Files

<!-- High-level scope -->

- Create (one-shot): four branches off current `deploy/candidate-a` — `deploy/candidate-a-operator`, `-poly`, `-resy`, `-scheduler-worker`. Done via `git push` at implement time, not in a workflow.
- Modify: `infra/catalog/operator.yaml`, `poly.yaml`, `resy.yaml`, `scheduler-worker.yaml` — add `candidate_a_branch: deploy/candidate-a-<name>` field. ~4 lines total.
- Modify: `infra/k8s/argocd/candidate-a-applicationset.yaml` — template `generator.git.revision` and `source.targetRevision` from `{{candidate_a_branch}}`. If the single-generator shape can't vary `revision` per file, split the git generator into four `files:` entries — still one AppSet resource. ~10 lines.
- Modify: `.github/workflows/candidate-flight.yml` — add a `detect-affected` job running Turbo; fan out promote/verify/smoke via `strategy.matrix` over the affected-nodes list with `fail-fast: false`; each matrix cell targets `deploy/candidate-a-<node>`. Optional manual `nodes` input overrides Turbo output. ~50 lines touched.
- Modify: `scripts/ci/promote-build-payload.sh` — accept single-target mode (called once per matrix cell) or delete entirely and inline the one-app promote-k8s-image call. Defer decision to implement; whichever is shorter wins.
- Modify: `.github/workflows/candidate-flight-infra.yml` — pre-check queries `gh run list --workflow=candidate-flight.yml --status=in_progress`; refuses dispatch if any active run exists. ~10 lines, v0 is best-effort.
- Modify: `.claude/skills/pr-coordinator-v0/SKILL.md` — drop "acquire lease" and "check lease file" steps; replace with "confirm Turbo-affected nodes and dispatch". Live build matrix section reads per-node-branch heads instead of one `deploy/candidate-a`. Significant skill rewrite (~40 lines); the mental model simplifies overall.
- Modify: `docs/spec/ci-cd.md` — replace the candidate-a lever paragraph with the per-node-branch model. Add a "Kargo alignment" note. ~15 lines.
- Delete: `infra/control/candidate-lease.json`. Delete `scripts/ci/acquire-candidate-slot.sh` and `release-candidate-slot.sh` **if** no other caller remains (grep first; if only used by `candidate-flight.yml` and its retired whole-slot mode, delete).
- Retire: `deploy/candidate-a` branch after cutover validates. Keep for one week then delete.
- Test: (a) flight a PR touching only poly — observe only `deploy/candidate-a-poly` head advanced, operator/resy/scheduler-worker branches unchanged; (b) flight a PR with an intentionally broken resy — observe resy matrix cell red, other cells green, `deploy/candidate-a-<other>` advanced for each; (c) concurrent flights on disjoint nodes — both complete, no cross-interference; (d) concurrent flights on the same node — second gets non-fast-forward push, rebase-retries, eventually succeeds or fails cleanly.

### Implementation Order

Two PRs, each independently validatable on candidate-a.

**PR 1 — Substrate (branches + AppSet + verify the plumbing):**

1. Create four `deploy/candidate-a-<node>` branches off current `deploy/candidate-a`.
2. Add `candidate_a_branch` to catalog files.
3. Template AppSet `revision` / `targetRevision` from catalog.
4. Observe Argo creates four Applications, each tracking its own branch at the same digest set (no flight yet; state is identical).

**PR 2 — Workflow cutover (matrix fan-out + lane isolation):** 5. Add `detect-affected` job running Turbo. 6. Matrix fan-out in `candidate-flight.yml`; each cell targets its per-node branch. 7. Delete whole-slot promote loop + lease acquire/release. 8. Update `candidate-flight-infra.yml` pre-check. 9. Update `pr-coordinator-v0` skill. 10. Retire `deploy/candidate-a` branch + `candidate-lease.json` + acquire/release scripts if unreferenced. 11. Update `docs/spec/ci-cd.md`.

Validation on PR 2 via the four test cases above. First two PRs to use the new lane model are flights of PR 2 itself (dogfood). Estimate bumps to 2 units; PR 1 is ~0.5, PR 2 is ~1.5.
