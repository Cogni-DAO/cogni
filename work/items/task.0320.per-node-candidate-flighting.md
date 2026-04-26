---
id: task.0320
type: task
title: "Per-node flighting substrate — per-env deploy branches + per-node AppSets (candidate-a + preview + production)"
status: needs_closeout
priority: 0
rank: 99
estimate: 2
revision: 1
branch: design/task-0320-per-node-flighting
pr: https://github.com/Cogni-DAO/node-template/pull/1044
summary: "Substrate for lane isolation across all three environments. Each node gets its own deploy branch per env (deploy/<env>-<node>), each env AppSet is refactored into N per-node git generators, each catalog file declares its per-env branches. Branch head = Kargo Stage promotion lease. PR #1043 (task.0371 step 1) lands the PreSync hook deletion in parallel, eliminating the hook failure class at the source. Matrix cutover of the 3 flight workflows is task.0372."
outcome: |
  - Each of the 4 catalog files (`operator/poly/resy/scheduler-worker`) declares three per-env branch fields: `candidate_a_branch`, `preview_branch`, `production_branch`. Fields are DORMANT — no AppSet or workflow reads them until task.0372.
  - 12 new deploy branches pushed post-merge: `deploy/{candidate-a,preview,production}-{operator,poly,resy,scheduler-worker}` off each env's current HEAD. Branches are DORMANT — no AppSet currently tracks them.
  - ApplicationSet YAMLs unchanged in this PR. AppSet refactor (single-generator → 4-per-node generators) + flight workflow cutover ship atomically in task.0372.
  - Zero behavioral change at merge; zero pipeline-freeze window. Substrate is truly passive.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-17
updated: 2026-04-25
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

A PR touching only poly promotes poly to **any** of candidate-a / preview / production without needing resy or operator to be green. Run 24910378351 (resy's stuck Argo migrate-hook failing the whole candidate-a slot) becomes structurally impossible on all three environments simultaneously: each (env × node) has its own deploy branch, its own Argo Application, and its own verify lane. Failure in one lane cannot fail another — not because a script filters it out, but because they never share a job boundary.

Scoped uniformly to candidate-a + preview + production. No per-env asymmetry: same failure-isolation primitive applied three times.

### Architectural Frame — Kargo Primitives, GHA Substrate

[Kargo](https://kargo.akuity.io) is the Argo team's answer to exactly this problem. We adopt its primitives in-name so a future migration is free, not a rewrite — but implement them on existing infrastructure (GHA + ApplicationSet + deploy branches). **No new CRDs. No new controllers. No long-running service.**

| Kargo concept | Our v0 realization                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Warehouse** | One image per node in GHCR (`pr-<N>-<sha>-<node>`). PR #1043 retires separate migrator images — one image, period. |
| **Freight**   | An `{app-digest, source-sha}` tuple for a single (env, node) pair.                                                 |
| **Stage**     | A per-(env, node) Argo Application (`<env>-<node>`) tracking `deploy/<env>-<node>`. 12 Applications total.         |
| **Promotion** | `git push deploy/<env>-<node>` with the new digest. Ref update is atomic.                                          |
| **Lease**     | The git ref itself — non-fast-forward push fails; rebase-retry resolves.                                           |
| **Verify**    | One matrix job per (env, affected-node); each waits on its own Application only (delivered in task.0372).          |

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

### Files (task.0320 scope — dormant substrate; Option A per review revision 1)

<!-- Revision 1 fix path: AppSet refactor dropped after blocker analysis showed a post-PR `deploy/<env>` → `deploy/<env>-<node>` read/write split would freeze the promotion pipeline across all 3 envs until task.0372 ships. Scope here is catalog fields + branch creation + prose updates only. AppSet refactor + workflow cutover ship atomically in task.0372 — no ref-read/ref-write split window. -->

- Modify: `infra/catalog/{operator,poly,resy,scheduler-worker}.yaml` — each gains three fields: `candidate_a_branch`, `preview_branch`, `production_branch`. ~12 lines total. Fields are DECLARED but have no consumer until task.0372 refactors the AppSets.
- Create (post-merge git push, serialized after PR #1043's candidate-a validation clears): 12 branches off each env's current HEAD:
  - `deploy/candidate-a-{operator,poly,resy,scheduler-worker}` off `deploy/candidate-a`
  - `deploy/preview-{operator,poly,resy,scheduler-worker}` off `deploy/preview`
  - `deploy/production-{operator,poly,resy,scheduler-worker}` off `deploy/production`
    Additive — no mutation of existing refs. Branches are DORMANT until task.0372 flips the AppSets to track them.
- Modify: `docs/spec/ci-cd.md` — describe the two-part rollout (dormant substrate here + cutover in task.0372). Matches code.
- Modify: `infra/AGENTS.md` — relax "catalog stays thin" boundary to name the three `*_branch` fields. Done.
- Modify: `work/projects/proj.cicd-services-gitops.md` — frame task.0320 + task.0372 as two halves of one decoupling.

**Out of scope for task.0320** — all moved to task.0372:

- ApplicationSet refactor (all 3 AppSets, 1-generator → 4-per-node-generator).
- Workflow cutover: `candidate-flight.yml`, `flight-preview.yml`, `promote-and-deploy.yml` matrix fan-out.
- Deletion of `candidate-lease.json`, `acquire-candidate-slot.sh`, `release-candidate-slot.sh`.
- `pr-coordinator-v0` skill rewrite.
- Retirement of `deploy/{candidate-a,preview,production}` whole-slot branches.

task.0320 substrate is a **pure declaration**. Nothing in the running system reads the catalog `*_branch` fields or the 12 new deploy branches until task.0372. Safe to merge independently of PR #1043; safe to merge regardless of operational state of candidate-a/preview/production.

### Implementation Order

One PR — entirely declarative.

1. Add `{candidate_a,preview,production}_branch` fields to all 4 catalog files. (Code.)
2. Merge.
3. Post-merge ops: push the 12 per-(env, node) deploy branches off each env's current HEAD (scripted one-shot). No Argo reconcile consequence — AppSets don't read these refs yet.
4. Done. task.0372 consumes the substrate later in its own PR with its own flight validation.

## Design Review (2026-04-24)

**Verdict: APPROVED.** Deletes more than it adds; branch-head-as-lease is the right primitive; matrix + `fail-fast: false` is the right isolation; Turbo-affected is the right source; no new services. Behaviorally reversible — repoint AppSet at `deploy/candidate-a` to roll back.

Net impact: ~100 LOC, mostly deletions (lease JSON, acquire/release scripts, whole-slot promote loop). PR 1 is a behavioral no-op (four branches at identical SHAs → Argo reconciles to same state), so the substrate is validatable in prod before any workflow change.

### Implementer Guardrails

Address these in PR 1 and PR 2 respectively. Each is a code-review checkbox:

- [ ] **GR-1 (PR 1): AppSet generator shape — expect 4 git generators, not 1 templated.** Argo's git generator applies one `revision` to all matched `files:`. Templating `{{candidate_a_branch}}` into `revision` from a catalog field will not work. Instead: split the single git generator into **four `generators.git` entries under the same ApplicationSet**, each with `revision: deploy/candidate-a-<node>` and `files: [infra/catalog/<node>.yaml]`. Still one AppSet resource — four generators inside it. The original design's "~10 lines" estimate is low; budget ~40 lines for the AppSet.
- [ ] **GR-2 (PR 2): Dogfood ordering — PR 2 ships on the whole-slot model.** PR 2 can't flight itself on the new lane model because the new model doesn't exist until PR 2 merges. Order: `PR 1` merges (whole-slot, no-op) → flight `PR 2` via the **existing whole-slot workflow** → merge `PR 2` → the first PR _after_ PR 2 is the first flight of the new lane model. Do not introduce a chicken-and-egg bootstrap workflow.
- [ ] **GR-3 (PR 2): GHA `concurrency` group keyed by matrix node.** Add `concurrency: { group: flight-${{ matrix.node }}, cancel-in-progress: false }` to the matrix job. Prevents parallel same-node runs from racing on `git push deploy/candidate-a-<node>` without the coordinator having to serialize. Belt for the suspenders of non-fast-forward-push rebase-retry.
- [ ] **GR-4 (landing order, external): PR #1041 merged + PR #1043 pending.** PR #1041 (runtime migrator scripts) landed 2026-04-25 but was partial — PreSync hook Job manifests + migrator image build target were NOT deleted. PR #1043 (task.0371 step 1) finishes the tail: deletes the hook Job manifests, retires `cogni-template-migrate` GHCR target, simplifies `wait-for-argocd.sh`. Ideal merge order: `#1043` → `task.0320 PR 1` → `task.0372 PR 1`. Soft dep only — task.0320 substrate is a behavioral no-op and does not touch migration machinery, so ordering with #1043 is preference not requirement.
- [ ] **GR-5 (follow-up): Harden the infra-lever pre-check before the fifth node.** `gh run list --status=in_progress` is best-effort for v0. File a follow-up task to convert to a proper lease (e.g. one global infra-lease file, or a GHA environment-based concurrency gate) before adding the 5th node. Don't let "v0 best-effort" drift into "our concurrency story forever."
- [ ] **GR-6 (uniform across envs): Apply the primitive to candidate-a + preview + production in one PR.** Asymmetric rollout (candidate-a only) leaves preview + prod with identical all-or-nothing failure mode — a broken node still blocks the others in the env that matters most (production). The primitive is simple enough that applying it 3x in one diff is smaller than two separate rollouts + the asymmetry reasoning in between. **Added after review of PR #1043 showed uniform-across-envs cleanup is achievable with the same diff shape.**

### Rejected During Review (Recorded for Posterity)

- Templating `generator.git.revision` from a single catalog field (GR-1 — Argo doesn't support it; four generators is the real shape).
- Flighting PR 2 on its own new model (GR-2 — chicken-and-egg; whole-slot flights PR 2).
- Relying solely on rebase-retry for same-node concurrency (GR-3 — free GHA primitive exists, use it).

## Plan (PR 1 — Substrate across 3 envs; workflow cutover is task.0372)

Revised 2026-04-25 after readiness scorecard showed preview + production have identical all-or-nothing AppSet shape. Prior candidate-a-only scope left asymmetric failure mode on the env that matters most (prod). Uniform 3-env rollout now; workflow cutover (matrix fan-out) remains task.0372.

- [x] **Checkpoint 1 — Catalog branch fields (candidate-a)** ✅
  - Milestone: Each of the 4 catalog files declares `candidate_a_branch`.
  - Validation: `pnpm check:docs` clean. Done in commit 10af2bb84.
- [x] **Checkpoint 1b — Catalog branch fields (preview + production)** ✅
  - Milestone: Each of the 4 catalog files additionally declares `preview_branch` and `production_branch`.
  - Invariants: GR-6 (uniform across envs); catalog stays the single declaration of per-node wiring.
  - Todos:
    - [ ] Add `preview_branch: deploy/preview-<name>` + `production_branch: deploy/production-<name>` to each of 4 catalog files.
  - Validation: `pnpm check:docs` clean.
- [x] **Checkpoint 2 (REMOVED per review revision 1)** — AppSet refactor moved to task.0372 after blocker analysis showed the post-PR `deploy/<env>` → `deploy/<env>-<node>` read/write split would freeze the promotion pipeline across all 3 envs until task.0372 ships. Reverted in commit following review.
- [x] **Checkpoint 2b (REMOVED per review revision 1)** — See Checkpoint 2. preview + production AppSets reverted to main's single-generator shape. All AppSet work ships atomically in task.0372.
- [x] **Checkpoint 3 — Deployment impact documented (12 branches, one scripted push; safe because no consumer reads them yet)** ✅
  - Milestone: PR body carries the exact branch-push script, including the 8 new branches on top of the original 4.
  - Todos:
    - [ ] Update PR body's Deployment Impact section with: `for env in candidate-a preview production; do for node in operator poly resy scheduler-worker; do git push origin refs/remotes/origin/deploy/$env:refs/heads/deploy/$env-$node; done; done`
    - [ ] Call out that branches must be pushed **before** the AppSet change reaches Argo, otherwise the regenerated Applications fail with "revision not found."
- [x] **Checkpoint 4 — Cutover task renumbered** ✅ (prior task.0371 renamed to task.0372 — task.0371 is taken by PR #1043 step-1 deletion work)
  - Todos:
    - [x] File renamed: `task.0371.candidate-flight-matrix-cutover.md` → `task.0372.candidate-flight-matrix-cutover.md`
    - [x] Scope expanded to cover all 3 flight workflows (candidate-flight / flight-preview / promote-and-deploy), not just candidate-flight.yml
    - [x] `_index.md` updated.

## Validation Plan (revision 1 — Option A, no candidate-a flight needed)

Because task.0320 substrate is pure declaration — no AppSet or workflow reads the new catalog fields or per-node branches — validation is static + offline. **Intentionally does not run `candidate-flight.yml`:** PR #1043 is using that slot today (via `--ref fix/task.0370-step1-init-container-cleanup`) to validate the migration-hook deletion. Sharing the lease would collide. Two PRs, two days of green distance, one slot at a time.

### Pre-merge (runs locally in the worktree — already clean on commit `c62bb375b`)

- [x] `pnpm check:docs` clean — catalog files pass header + metadata validators; work-item index parses.
- [x] `pnpm format` applied — no prettier drift.
- [x] AppSet YAMLs reverted to `main` state — verified by `git diff origin/main -- infra/k8s/argocd/`. No Argo-facing change in this PR.
- [x] `git grep candidate_a_branch preview_branch production_branch` confirms only the 4 catalog files reference the new fields. Nothing else reads them — true dormancy.
- [x] Each catalog YAML parses with `python3 -c "import yaml; yaml.safe_load(open('infra/catalog/<node>.yaml'))"` — all 4 succeed.

### Post-merge branch push (run only after PR #1043's candidate-a validation clears)

```bash
# Serialize after PR #1043's validation:
#   1. gh run list --workflow=candidate-flight.yml --repo Cogni-DAO/node-template --limit 3
#      → confirm the #1043 --ref flight is 'completed' (success or failure, either closes the lease window)
#   2. gh api repos/Cogni-DAO/node-template/contents/infra/control/candidate-lease.json
#      → confirm lease.state != 'leased'

git fetch origin deploy/candidate-a deploy/preview deploy/production --quiet
for env in candidate-a preview production; do
  for node in operator poly resy scheduler-worker; do
    git push origin refs/remotes/origin/deploy/$env:refs/heads/deploy/$env-$node
  done
done
```

- [ ] All 12 branches reported as `[new branch]` by `git push` (0 errors).
- [ ] `gh api repos/Cogni-DAO/node-template/branches | jq -r '.[].name' | grep -E "^deploy/(candidate-a|preview|production)-" | wc -l` returns `12`.

### Post-merge Argo no-op check (passive observation — nothing should change)

- [ ] `kubectl -n argocd get applications -o name` returns the same 12 Application names as pre-merge (unchanged; AppSets untouched in this PR).
- [ ] `kubectl -n argocd get applications -o json | jq '.items[].spec.source.targetRevision'` returns `deploy/candidate-a` / `deploy/preview` / `deploy/production` — whole-slot refs, NOT per-node. (AppSets still read the whole-slot branches because this PR reverted that refactor.)
- [ ] `kubectl -n cogni-candidate-a get pods -o jsonpath='{.items[*].spec.containers[*].image}'` image digests match pre-merge — zero pod churn expected.

### Green-distance discipline vs PR #1043

PR #1043's validation flight via `gh workflow run candidate-flight.yml --ref fix/task.0370-step1-init-container-cleanup -f pr_number=1043 -f head_sha=c4ab9f08bd39f7ff4b528bdd5abd4d80226ead29` is actively exercising:

- `wait-for-argocd.sh` (-94 lines, hook-babysitting removal)
- `infra/k8s/base/node-app/deployment.yaml` (initContainer addition)
- all 12 overlay `kustomization.yaml` files (Job → Deployment patch retarget)
- `scripts/ci/lib/image-tags.sh` (migrator target retirement)

task.0320 touches **none of the above**. Merge-time conflict risk: zero (different files). Runtime conflict risk: zero (task.0320 produces nothing that runs). The one shared resource is the candidate-a lease, which this task does not need.

**Recommended merge order**: PR #1043 → validate on candidate-a via `--ref` flight → merge #1043 → then task.0320 (#1044) → 12 branches pushed post-merge. That way task.0320 merges into a main where the initContainer world is the state of nature — simpler to reason about, though functionally independent.

## Review Feedback (revision 1 — 2026-04-25)

Verdict: **REQUEST CHANGES**. PR #1044 open; do not merge until the blockers below are resolved.

### Blockers

- **BLOCKER 2 (primary) — Substrate is not behaviorally inert across time.** Design claims "no-op at merge" but ignores T+1 behavior. Promote workflows (`candidate-flight.yml:181`, `flight-preview.yml:225`, `promote-and-deploy.yml:148–149`) write to `deploy/<env>` (whole-slot). Post-PR, ApplicationSets read from `deploy/<env>-<node>` (per-node). At merge: SHAs identical → fine. At next promotion: whole-slot branch moves, per-node branches don't, **Argo sees stale digests → promotion pipeline freezes across all 3 envs until task.0372 ships.**

  **Fix — Option A (recommended):** Drop the three `infra/k8s/argocd/*-applicationset.yaml` changes from this PR. Keep only:
  - `infra/catalog/*.yaml` (the 3 per-env branch fields) — additive, unreferenced until task.0372.
  - Post-merge branch creation (12 refs pushed off current `deploy/<env>` HEADs) — additive, unreferenced.
  - Spec + project + AGENTS.md prose updates (reword to "fields declared; AppSet consumes them in task.0372").

  The AppSet refactor moves into task.0372 where it ships atomically with the workflow cutover — per-node branches become the promotion target in the same merge that flips AppSet reads. Zero pipeline-freeze window.

  Alternative fix B (more code): add a post-promote "branch fan-out" step to the three promote workflows so writes to `deploy/<env>` also fast-forward all 4 `deploy/<env>-<node>` branches. Task.0372 would then remove the fan-out. More surface area across 3 workflows; not preferred.

- **BLOCKER 1 (secondary, resolved once Option A is taken) — AppSet ordering misdocumented in PR body.** "Required post-merge ops action" is unsafe: AppSet controller reconciles immediately on YAML merge. If per-node branches don't exist when generators resolve, risk of Application pruning (AppSet `applicationsSync` default is `create-update-delete`; templates lack `preserveResourcesOnDeletion: true`). Under Option A this blocker disappears (no AppSet change in this PR). Under any fix path that keeps the AppSet change here, push the 12 branches **before** merging, not after, and add `preserveResourcesOnDeletion: true` to each AppSet as belt-and-suspenders.

### Non-blocking follow-ups

- Spec text in `docs/spec/ci-cd.md` must match the chosen fix (Option A → text describes fields-only substrate; Option B → describe fan-out mechanism).
- `task.0372` frontmatter claims "hard-blocked on task.0320 merged + 12 branches pushed"; under Option A it additionally needs the AppSet refactor. Update task.0372 scope when this revision lands.
- `docs/guides/create-service.md` still shows the pre-task.0320 catalog shape. Add the 3 branch fields to the "Add `infra/catalog/<name>.yaml`" step so future node additions don't drift.
- `sandbox-openclaw` has overlays in all 3 envs but no catalog entry — its Application won't be generated by the per-node AppSet shape post-task.0372. Decide in task.0372: catalog entry or separate generator.

### Positive findings (preserve across revision)

- Catalog field additions are clean; header comments clearly explain why the fields exist and who consumes them.
- `infra/AGENTS.md` "catalog stays thin" relaxation is precise — names the exact fields and the reason.
- Project doc correctly frames task.0320 + task.0372 as two halves of one decoupling; links the motivating incident by run ID.
- Kargo alignment and GR-1 (4-generator shape not 1-templated) are architecturally correct for when the AppSet refactor eventually lands.
