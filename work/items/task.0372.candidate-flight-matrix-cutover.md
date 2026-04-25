---
id: task.0372
type: task
title: Per-node candidate-flight matrix + AppSet substrate
status: needs_merge
priority: 0
rank: 99
estimate: 4
summary: "Per-node lane isolation for candidate-a. candidate-a AppSet 1→4 generators; candidate-flight.yml fanned out into a per-node matrix with fail-fast:false; each cell scopes to its own deploy/candidate-a-<node> branch + its own Argo Application. Bootstrap script seeds 12 dormant per-env per-node deploy branches (preview + production branches stay dormant until task.0376). Live-validated end-to-end on PR #1033."
outcome: |
  - `infra/k8s/argocd/candidate-a-applicationset.yaml` refactored: 1 git generator → 4 per-node git generators. Each generator pins `revision: deploy/candidate-a-<node>` and `files: [infra/catalog/<node>.yaml]`. Template `targetRevision` is hardcoded to `deploy/candidate-a-{{.name}}` — the catalog `*_branch` fields from task.0320 are declarative metadata only, not consumed at runtime (convention-over-config makes the AppSet robust to in-flight pre-task.0320 PRs).
  - `goTemplate: true` on the candidate-a AppSet so `{{.name}}` substitution works; default fasttemplate didn't expose arbitrary catalog fields.
  - `infra/k8s/argocd/{preview,production}-applicationset.yaml` left at the whole-slot shape on this PR. Refactoring them in lockstep with their workflow writers (`flight-preview.yml`, `promote-and-deploy.yml`) is task.0376 — flipping the AppSet without the matching workflow cutover would silently break preview + production deploys (writers target whole-slot, AppSet would read per-node which never advances).
  - `candidate-flight.yml` fans out via `strategy.matrix` with `fail-fast: false`. Job graph: `decide → reconcile-appset → flight (matrix) → verify-candidate (matrix) → report-status`. Each cell scopes to one node's deploy branch + one Argo Application. `concurrency: flight-${{ matrix.env }}-${{ matrix.node }}` is the cross-workflow lease primitive (BRANCH_HEAD_IS_LEASE).
  - `acquire-candidate-slot.sh` + `release-candidate-slot.sh` no longer called by `candidate-flight.yml`. Files remain on disk (task.0376 cleanup).
  - `scripts/ops/bootstrap-per-node-deploy-branches.sh` is idempotent + fast-forwarding (BOOTSTRAP_FAST_FORWARDS_BEFORE_MERGE). Pushed all 12 `deploy/{candidate-a,preview,production}-{operator,poly,resy,scheduler-worker}` branches at their parent whole-slot tips. preview + production branches are dormant until task.0376 cuts those workflows over.
  - `scripts/ci/detect-affected.sh` treats `infra/catalog/**` and `scripts/ci/lib/image-tags.sh` as global build inputs (CATALOG_EDITS_ARE_GLOBAL_BUILD_INPUT) so any catalog edit triggers a full matrix.
  - `scripts/ci/wait-for-argocd.sh` uses per-invocation `$$.$RANDOM.$RANDOM` suffix on remote `/tmp/` paths so concurrent matrix cells don't race each other's cleanup.
  - `candidate-flight-infra.yml` carries a best-effort `gh run list` pre-check (GR-5) warning when an app-lever flight is in progress.
  - Out of scope (filed as task.0376): `flight-preview.yml` matrix + `aggregate-preview` job, `promote-and-deploy.yml` workflow_call + matrix + `aggregate-production`, lock/unlock-preview move into aggregator, deletion of lease scripts/state, `pr-coordinator-v0` SKILL rewrite, `docs/spec/ci-cd.md` `BRANCH_HEAD_IS_LEASE` axiom prose.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
credit:
project: proj.cicd-services-gitops
branch: feat/task.0372-matrix-cutover
pr: https://github.com/Cogni-DAO/node-template/pull/1060
reviewer:
revision: 4
deploy_verified: false
created: 2026-04-24
updated: 2026-04-25
labels: [cicd, deployment]
external_refs:
---

# task.0372 — Per-node matrix cutover

## Revision 4 (2026-04-25) — release.yml semantic regression + aggregator races + catalog drift

> **Supersedes revision 3's "aggregator updates current-sha after all-cells-green" framing for `release.yml` consumption.**
> Pre-implement design pass found four real correctness gaps in revision 3:
>
> - **R4-#3 (release.yml semantic regression).** Aggregator setting `current-sha = github.sha` after an affected-only flight stomps a SHA into the file at which only some nodes' overlays were validated. `release.yml` cuts releases that include unvalidated code. Fix: `current-sha` is computed as `git merge-base $(deploy/<env>-{operator,poly,resy,scheduler-worker} tips)` — the latest commit ancestor of all per-node tips. Every node has been preview-validated through the merge-base by definition. Lagging node holds back current-sha; that's correct, don't ship unvalidated code. `release.yml` byte-unchanged. Pinned as `CURRENT_SHA_IS_MERGE_BASE` invariant.
> - **R4-#2 (rollup map merge must preserve unaffected entries).** Aggregator MUST `read existing rollup → overwrite ONLY affected-node keys → push`. Naive "union of cells this run" stomps stale-but-valid prior entries. Pinned as `ROLLUP_MAP_PRESERVES_UNAFFECTED`.
> - **R4-#4 (aggregator races on `deploy/<env>` push).** Per-cell concurrency does not cover the aggregator. Two disjoint-node concurrent flights both push aggregate-preview → second non-fast-forward → unlock-preview-on-failure fires despite both succeeding. Fix: `concurrency: { group: aggregate-${{ matrix.env }}, cancel-in-progress: false }` on every aggregate job + rebase-retry on push. Pinned as `AGGREGATOR_CONCURRENCY_GROUP`.
> - **R4-#5 (bootstrap-to-merge race).** If a whole-slot flight runs between bootstrap and PR merge, whole-slot branches advance, per-node branches stay behind, AppSets flip on merge, Argo rolls back. Fix: bootstrap script is idempotent + fast-forwards per-node branches to whole-slot HEADs on every run; implementer re-runs it as the last action immediately pre-merge. Pinned as `BOOTSTRAP_FAST_FORWARDS_BEFORE_MERGE`.
> - **R4-#8 (catalog drift across per-node branches).** Per-cell rsync of `infra/catalog/` would land catalog edits only on the per-node branch that flighted. Two-part fix: (1) `detect-affected.sh` treats `infra/catalog/**` as a global-build-input (any catalog edit triggers `add_all_targets` → full matrix → all per-node branches get the update simultaneously). (2) Per-cell rsync is scoped to `infra/catalog/<this-node>.yaml` only, so non-catalog flights cannot stomp other nodes' catalog state. Pinned as `CATALOG_EDITS_ARE_GLOBAL_BUILD_INPUT`.
>
> Plus revision-3 invariant rename: bottom checklist reused old names (`AFFECTED_FROM_DETECT_AFFECTED_SH`, `CONCURRENCY_GROUP_KEYED_BY_ENV_AND_NODE`) that diverged from the pinned-invariants section. Bottom checklist rewritten in v4 to match pinned names verbatim and to add the missing `AGGREGATOR_OWNS_LEASE`, `SOURCE_SHA_MAP_PER_CELL`, `PROMOTED_APPS_PER_CELL`, plus the four new R4 invariants.

## Revision 3 (2026-04-25) — symmetric per-env, in one atomic PR

> **Supersedes revision 2's "scope-reduce-to-candidate-a-plus-preview" framing.**
> A pre-implement design pass found that per-node preview cells were going to be "fake isolation" (cells push to `deploy/preview-<node>` but AppSet still reads `deploy/preview`, so Argo never sees the per-node pushes). The fix is a small aggregator job, not a scope cut. Symmetric architecture across all 3 envs is the discipline; per-env divergence is a tax forever.

### Scope

All 3 ApplicationSets refactor (1 git generator → 4 per-node generators). All 3 fan-out workflows go matrix. **No env stays on the whole-slot model.** Production cuts over symmetrically with candidate-a and preview in this PR.

### Architecture

```
deploy/<env>-<node>     ← 12 branches; AppSet generators read these per-node.
                          THIS is the reconciliation source of truth.

deploy/<env>            ← 3 branches; metadata-only post-cutover.
                          Aggregator job updates .promote-state/current-sha
                          and .promote-state/source-sha-by-app.json after
                          all matrix cells go green. release.yml reads
                          .promote-state/current-sha unchanged.
```

`release.yml` → `scripts/ci/create-release.sh:22` reads `git show origin/${DEPLOY_BRANCH}:.promote-state/current-sha`. **Single SHA file, ~5 lines of consumer code.** Trivial to keep updated by an aggregator step. No release.yml changes needed.

### Aggregator pattern (the gap-2/gap-3 fix)

Each fan-out workflow gains one final job at the end of its matrix:

```yaml
aggregate-<env>:
  needs: [matrix-cells, ...]
  if: always()
  runs-on: ubuntu-latest
  steps:
    - if: <all matrix cells green>
      # (1) Update deploy/<env>/.promote-state/current-sha + source-sha-by-app.json
      # (2) lock-<env>-on-success (preview only — preserves task.0349 lease semantics)
      # (3) Write preview-flight-outcome=dispatched artifact (preview only — task.0349 contract)
    - if: <any matrix cell red>
      # (1) unlock-<env>-on-failure (preview only)
      # (2) Write preview-flight-outcome=failed
```

This replaces the current per-job `lock-preview-on-success` / `unlock-preview-on-failure`. **Lock/unlock MUST NOT fan out into matrix cells** — racing on the same `.promote-state/lease.json` ref is the same class of bug we're trying to delete.

### Pinned invariants — read these before writing YAML

- **CONCURRENCY_GROUP_FORMAT**: `flight-${{ matrix.env }}-${{ matrix.node }}` everywhere. Same-(env, node) cross-workflow serialization only works if all 3 workflows compute byte-identical group strings. Use `matrix.env` as a literal even when there's only one env per workflow (e.g., candidate-flight sets `matrix.env: candidate-a`).
- **PROMOTED_APPS_PER_CELL**: each matrix cell calls `wait-for-argocd.sh` with `PROMOTED_APPS=${{ matrix.node }}` (single app), `EXPECTED_SHA=<deploy/<env>-<node> tip>`, against Argo Application `<env>-<node>`.
- **SOURCE_SHA_MAP_PER_CELL**: each cell writes `deploy/<env>-<node>:.promote-state/source-sha-by-app.json` with **exactly one entry** (its own node's source_sha). `verify-buildsha.sh` already supports the single-app map mode (task.0349 v3 `NODES ∩ map`); use it. The aggregator job MERGES per-node maps into the rollup `deploy/<env>:.promote-state/source-sha-by-app.json`.
- **AGGREGATOR_OWNS_LEASE**: lock/unlock-preview semantics live in the aggregate job, never in per-cell jobs. Per-cell push of `.promote-state/lease.json` is forbidden.
- **AFFECTED_FROM_TURBO** (task.0320 invariant, preserved): the destination is `turbo ls --affected --filter=...[$BASE]`. `scripts/ci/detect-affected.sh` is the v0 implementation that reads catalog `path_prefix:` (post-task.0374). task.0260 delivers the turbo migration; task.0372 keeps the existing detect-affected.sh callers. **Don't retroactively redefine the invariant; document the workaround.**
- **CURRENT_SHA_IS_MERGE_BASE** (R4-#3): `deploy/<env>/.promote-state/current-sha` is computed by the aggregator as `git merge-base <tip-of-each-deploy/<env>-<node>>`. The merge-base is the latest commit ancestor of all 4 per-node tips — every node has been preview-validated through it by definition. `release.yml` reads this file unchanged. A node that hasn't flighted in a long time drags current-sha backward; that is correct ("don't ship unvalidated code") and the safety valve is a periodic full-matrix re-validation flight, not a heuristic-bump.
- **ROLLUP_MAP_PRESERVES_UNAFFECTED** (R4-#2): the aggregator merges per-node `source-sha-by-app.json` into `deploy/<env>:.promote-state/source-sha-by-app.json` by `read existing rollup → overwrite ONLY affected-node keys → push`. Naive "union of cells this run" stomps stale-but-valid prior entries on affected-only flights. Verify-buildsha relies on the rollup being complete across all nodes.
- **AGGREGATOR_CONCURRENCY_GROUP** (R4-#4): every aggregator job carries `concurrency: { group: aggregate-${{ matrix.env }}, cancel-in-progress: false }`. Aggregator step also performs rebase-retry on push (loop with `git fetch && git rebase && git push` up to N attempts) so legitimate disjoint-node flights never lose a lease to a non-fast-forward race.
- **BOOTSTRAP_FAST_FORWARDS_BEFORE_MERGE** (R4-#5): `scripts/ops/bootstrap-per-node-deploy-branches.sh` is idempotent. On every run it computes each whole-slot tip and **fast-forwards** every per-node branch to that tip (creates if missing; fast-forwards if behind; no-ops if already at or ahead). Implementer re-runs it as the last action immediately before merging this PR, so per-node branches cannot be behind whole-slot at the moment AppSets flip.
- **CATALOG_EDITS_ARE_GLOBAL_BUILD_INPUT** (R4-#8): `scripts/ci/detect-affected.sh` treats `infra/catalog/**` as a global-build-input → any catalog edit triggers `add_all_targets` → full matrix → all per-node branches receive the catalog change in lockstep. Per-cell rsync is scoped to `infra/catalog/<this-node>.yaml` only (not the whole `infra/catalog/`), so a non-catalog-edit flight cannot stomp other nodes' catalog state on its per-node deploy branch.

### Open gaps (carried forward — concrete resolution required during implementation)

- **`detect-affected` BASE selection per env.** candidate-flight uses `origin/main`. flight-preview's BASE = previous preview rollup SHA (read from `deploy/preview/.promote-state/current-sha`). promote-and-deploy's BASE for production = previous prod SHA (`deploy/production/.promote-state/current-sha`). Existing `detect-affected.sh` honors `TURBO_SCM_BASE`; callers set it. **Mitigation: log effective BASE/HEAD per workflow; fail loud on empty matrix unless explicitly opted-in.**
- **Production rollout scale.** Today's whole-slot prod has implicit-serial rollouts; matrix runs them parallel. Verify cluster capacity (4 simultaneous Argo syncs + 4 rolling pod replacements) before merge. If a problem, document trade-off; don't silently regress.
- **GR-5 infra-lever pre-check.** `gh run list --workflow="Candidate Flight"` filter must match the workflow's `name:` exactly. Easy to drift when adding the matrix decide-job. Pin via test.

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

1. task.0320 + task.0374 merged (substrates in place — both done as of 2026-04-25).
2. **All 12 per-env per-node deploy branches pushed pre-PR** (one-shot bootstrap script, dormant until AppSets read them at merge).
3. THIS PR flights via the **existing whole-slot workflow** to validate its own diff.
4. Merge THIS PR.
5. The first PR merged _after_ this one is the first flight of the new lane model — across **all 3 envs**.

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

## Design

### Outcome

A PR touching only one node promotes that node to candidate-a / preview / production without needing siblings to be green. Each `(env × node)` pair has its own deploy branch, its own Argo Application (still rendered by one ApplicationSet), and its own matrix cell. Failure isolation is structural — separate GHA jobs, not script-level filtering. The handoff's `task.0320` Kargo-primitives frame becomes operationally live.

### Approach

**Cutover is one PR, three concentric layers, all atomic at merge.**

#### Layer 1 — Push the 12 per-node deploy branches (pre-PR ops)

Read the SHA of each whole-slot deploy branch and push 4 sibling branches at the same SHA. Behaviour-equivalent at the moment of creation.

```
deploy/candidate-a-{operator,poly,resy,scheduler-worker}     ← deploy/candidate-a tip
deploy/preview-{operator,poly,resy,scheduler-worker}         ← deploy/preview tip
deploy/production-{operator,poly,resy,scheduler-worker}      ← deploy/production tip
```

One-shot script `scripts/ops/bootstrap-per-node-deploy-branches.sh` (idempotent + fast-forwarding per BOOTSTRAP_FAST_FORWARDS_BEFORE_MERGE). On every run: create per-node branches if missing, fast-forward to whole-slot tip if behind, no-op if already at-or-ahead. Run pre-PR to seed; **re-run as the last action immediately before merge** so per-node branches cannot lag whole-slot at the moment AppSets flip. Verified via `git ls-remote origin 'refs/heads/deploy/*-*'` (12 rows).

#### Layer 2 — Refactor the 3 ApplicationSets (1 generator → 4 generators each)

Per GR-1: Argo's git generator does **not** template `revision` from a per-file field. Each AppSet keeps **one** `cogni-<env>` resource but expands its `generators:` list from one entry to four:

```yaml
spec:
  generators:
    - git: { repoURL: …, revision: deploy/candidate-a-operator,         files: [{ path: infra/catalog/operator.yaml }] }
    - git: { repoURL: …, revision: deploy/candidate-a-poly,             files: [{ path: infra/catalog/poly.yaml }] }
    - git: { repoURL: …, revision: deploy/candidate-a-resy,             files: [{ path: infra/catalog/resy.yaml }] }
    - git: { repoURL: …, revision: deploy/candidate-a-scheduler-worker, files: [{ path: infra/catalog/scheduler-worker.yaml }] }
  template:
    metadata: { name: "candidate-a-{{name}}", … }
    spec:
      source:
        repoURL: …
        targetRevision: "{{candidate_a_branch}}"   # comes from catalog file
        path: "infra/k8s/overlays/candidate-a/{{name}}"
      …
```

Identical refactor for `preview-applicationset.yaml` and `production-applicationset.yaml` (using `preview_branch` / `production_branch` catalog fields). The `*-{{name}}` Application names stay the same → Argo reconciles in place; no Application teardown. `preserveResourcesOnDeletion: true` added as belt-and-suspenders.

#### Layer 3 — Refactor the 3 flight workflows to matrix shape

Each workflow gains a small `decide` job that emits a `targets_json` array of affected nodes; the existing job(s) become matrix-fanned-out cells.

**A. `candidate-flight.yml`** (560 lines → ~620 with matrix; ~80 lines deleted from lease handling)

```yaml
jobs:
  decide:
    runs-on: ubuntu-latest
    outputs:
      targets_json: ${{ steps.detect.outputs.targets_json }}
      has_targets: ${{ steps.detect.outputs.has_targets }}
    steps:
      - uses: actions/checkout@…
      - id: detect
        env:
          TURBO_SCM_BASE: origin/main
          TURBO_SCM_HEAD: ${{ inputs.head_sha }}
        run: bash scripts/ci/detect-affected.sh

  flight:
    needs: decide
    if: needs.decide.outputs.has_targets == 'true'
    strategy:
      fail-fast: false
      matrix:
        env: [candidate-a]
        node: ${{ fromJson(needs.decide.outputs.targets_json) }}
    concurrency:
      group: flight-${{ matrix.env }}-${{ matrix.node }} # CONCURRENCY_GROUP_FORMAT
      cancel-in-progress: false
    runs-on: ubuntu-latest
    environment: candidate-a
    steps:
      # … existing flight steps, scoped to matrix.node:
      # - clone deploy/candidate-a-${{ matrix.node }} as deploy-branch
      # - rsync only infra/k8s/overlays/candidate-a/${{ matrix.node }}/ + base/ + infra/catalog/${{ matrix.node }}.yaml
      #   (CATALOG_EDITS_ARE_GLOBAL_BUILD_INPUT: per-cell rsync touches ONLY this node's catalog file;
      #    catalog edits trigger full matrix via detect-affected.sh so all per-node branches update in lockstep)
      # - resolve PR digest for ONLY this target
      # - promote-k8s-image.sh --no-commit --env candidate-a --app ${{ matrix.node }}
      # - snapshot/restore (task.0373) — KEEP, cheap on single-target trees
      # - push to deploy/candidate-a-${{ matrix.node }}
      # - wait-for-argocd.sh PROMOTED_APPS=${{ matrix.node }} EXPECTED_SHA=<branch-tip>
      # - smoke + verify-buildsha for ${{ matrix.node }} only (single-app SOURCE_SHA_MAP)
```

`acquire-candidate-slot` / `release-candidate-slot` / `report-no-acquire-failure` jobs **deleted**. Branch ref is the lease; `concurrency` group is the belt.

candidate-flight has no `aggregate` job (no `deploy/candidate-a/.promote-state/current-sha` consumer; release.yml only reads preview's). But it MAY want a final `report-status` job that emits the single PR commit-status check (don't fan out per-cell to avoid same-head-SHA races).

**B. `flight-preview.yml`** (277 lines → ~320)

The retag loop (lines 190-203) already iterates `ALL_TARGETS` and skips non-`RESOLVED_TARGETS`. Below it, replace the single `Flight to preview` dispatch with:

1. `decide` job at the head (catalog-driven, per task.0374 worked example).
2. Matrix-fanned `flight-preview-cell` job — each dispatches `promote-and-deploy.yml` (workflow_call) with `inputs.nodes=${{ matrix.node }}` and `inputs.env=preview`. Concurrency `flight-${{ matrix.env }}-${{ matrix.node }}`.
3. **`aggregate-preview` job** — `needs: [flight-preview-cell]`, `if: always()`. Implements gap-2 lease + gap-3 rollup + gap-4 outcome artifact (single source for `promote-preview-digest-seed.yml`):

```yaml
aggregate-preview:
  needs: [flight-preview-cell]
  if: always()
  runs-on: ubuntu-latest
  concurrency:
    group: aggregate-preview # AGGREGATOR_CONCURRENCY_GROUP
    cancel-in-progress: false
  steps:
    - id: outcome
      run: |
        # success only when ALL cells succeeded; any failure → unlock+failed
        if [ "${{ needs.flight-preview-cell.result }}" = "success" ]; then
          echo "outcome=dispatched" >> "$GITHUB_OUTPUT"
        else
          echo "outcome=failed" >> "$GITHUB_OUTPUT"
        fi
    - if: steps.outcome.outputs.outcome == 'dispatched'
      name: Update deploy/preview rollup + lock (rebase-retry)
      run: |
        # Loop git fetch / rebase / push up to N=5 times (AGGREGATOR_CONCURRENCY_GROUP rebase-retry):
        # 1. CURRENT_SHA_IS_MERGE_BASE: compute current-sha
        #      op=$(git rev-parse origin/deploy/preview-operator)
        #      poly=$(git rev-parse origin/deploy/preview-poly)
        #      resy=$(git rev-parse origin/deploy/preview-resy)
        #      sw=$(git rev-parse origin/deploy/preview-scheduler-worker)
        #      merge_base=$(git merge-base "$op" "$poly" "$resy" "$sw")
        #      echo "$merge_base" > .promote-state/current-sha
        # 2. ROLLUP_MAP_PRESERVES_UNAFFECTED:
        #      jq -s '.[0] * .[1]' deploy/preview/.promote-state/source-sha-by-app.json \
        #         <(merge of affected-node entries from deploy/preview-<node>/.promote-state/...)
        #      Result: prior entries preserved; only affected nodes' keys overwritten.
        # 3. lock-preview-on-success (existing logic; single call from this aggregator only)
    - if: steps.outcome.outputs.outcome == 'failed'
      name: Unlock preview on failure
      run: |
        # Run unlock-preview-on-failure (existing logic, single call)
    - name: Upload preview-flight-outcome artifact
      run: printf '%s' "${{ steps.outcome.outputs.outcome }}" > preview-flight-outcome.txt
    - uses: actions/upload-artifact@…
      with:
        name: preview-flight-outcome
        path: preview-flight-outcome.txt
```

**Per-cell jobs MUST NOT push to `deploy/preview` and MUST NOT call `lock-preview-*` / `unlock-preview-*`.** That's the AGGREGATOR_OWNS_LEASE invariant.

**C. `promote-and-deploy.yml`** (930 lines → ~1000) — the big one

Adds `workflow_call.inputs.nodes` (CSV) alongside existing `workflow_dispatch.inputs`. Adds a top `decide` job. **All** existing `promote-k8s` / `verify-deploy` / `verify` / `e2e` jobs become matrix-fanned-out over `nodes`. Concurrency `flight-${{ matrix.env }}-${{ matrix.node }}` per cell where `matrix.env: [${{ inputs.env }}]`.

`lock-preview-on-success` / `unlock-preview-on-failure` jobs are **deleted from this workflow**. Their semantics move into `flight-preview.yml`'s `aggregate-preview` job (per gap-2 / `AGGREGATOR_OWNS_LEASE`). The matrix path applies for `inputs.env in {preview, production}` — both are now per-node-laned. There is no whole-slot path post-cutover.

For production: `aggregate-production` job in `promote-and-deploy.yml` itself updates `deploy/production/.promote-state/current-sha` (CURRENT_SHA_IS_MERGE_BASE over `deploy/production-<node>` tips) and merges the rollup map (ROLLUP_MAP_PRESERVES_UNAFFECTED). Carries `concurrency: { group: aggregate-production, cancel-in-progress: false }` + rebase-retry. No `release.yml` change needed (production isn't read by release.yml today; only preview is). The production current-sha is consumed as the BASE for the next production matrix flight (see "Open gaps" — detect-affected BASE selection).

**D. `candidate-flight-infra.yml`** (156 lines → ~170; GR-5 best-effort)

New first step queries in-progress candidate-flight runs:

```yaml
- name: Pre-check no candidate-flight in progress (best-effort, GR-5)
  env: { GH_TOKEN: ${{ github.token }} }
  run: |
    in_progress=$(gh run list --workflow="Candidate Flight" --status=in_progress --json databaseId --jq 'length')
    if [ "$in_progress" != "0" ]; then
      echo "::warning::${in_progress} candidate-flight run(s) in progress — infra changes may interleave with app promotions"
    fi
```

Best-effort warning, not a hard gate — explicitly per GR-5 deferred to follow-up.

#### Layer 4 — Cleanup

- Delete `infra/control/candidate-lease.json` (no remaining readers post-cutover).
- Delete `scripts/ci/acquire-candidate-slot.sh` + `scripts/ci/release-candidate-slot.sh`.
- Update `scripts/ci/AGENTS.md` to remove their entries.
- `.claude/skills/pr-coordinator-v0/SKILL.md` rewrite — drop lease-acquire prose; describe matrix output ("Live Build Matrix" reads `deploy/<env>-<node>` heads).
- `docs/spec/ci-cd.md` — replace whole-slot lease prose with `BRANCH_HEAD_IS_LEASE` axiom + Kargo-alignment note (task.0320 added the prose stub; tighten now that cutover is live).
- Old `deploy/candidate-a` / `deploy/preview` / `deploy/production` whole-slot branches — **leave in place, mark stale**. Don't delete in this PR. Once a few weeks pass with no consumers, a follow-up sweep deletes them. Argo's prior-known-good rev is still on these branches if we need to rollback.

### Reuses

- `scripts/ci/detect-affected.sh` (existing — emits `targets_json` matrix-ready).
- ApplicationSet's generator-list mechanism (extending one to four; already supported by Argo).
- GHA `strategy.matrix` + `fail-fast: false` + `concurrency` primitives.
- `wait-for-argocd.sh` `APPS=` filter (already supports per-app scope).
- `smoke-candidate.sh` `NODES_FILTER` (already supports per-app scope).
- `promote-k8s-image.sh --no-commit` (single-target writer; runs once per matrix cell).
- task.0373's snapshot/restore step — keep in candidate-flight matrix cells, no-op on single-target trees but cheap insurance for cold-start.

### Rejected

- **Templating `generator.git.revision` from `{{candidate_a_branch}}`** (GR-1). Argo applies one `revision` per generator across all `files:` matched. Cannot template revision per-file. Four-generator pattern is the only working shape.
- **Splitting each AppSet into 4 separate ApplicationSet resources** — violates `ONE_APPSET_SOURCE_OF_TRUTH` (task.0320). Per-env routing belongs inside one AppSet.
- **Templating `targetRevision` from a workflow-injected param instead of catalog field** — couples AppSet definition to a workflow rendering step. Catalog field is the simpler frame and already declared by task.0320.
- **Bootstrap workflow to flight task.0372 on its own new model** (GR-2 chicken-and-egg). This PR flights on the existing whole-slot model. The first post-merge PR is the first matrix-flight.
- **Per-node lease JSON files** — task.0320 already rejected. Branch ref + GHA concurrency group is the lease.
- **Hand-rolling affected-detection** — `detect-affected.sh` already exists and is CI-tested.
- **Dropping snapshot/restore from candidate-flight matrix cells** — single-target trees make it a near-no-op, but at no cost. Keep for cold-start invariance and to preserve task.0373's invariants verbatim.
- **Atomic deletion of old whole-slot deploy branches in this PR** — leave for a follow-up sweep; preserves rollback path for a few weeks.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] LANE_ISOLATION: Each affected node runs in its own GHA matrix job with `fail-fast: false`. A red sibling cell does not short-circuit other cells. Verified via Validation case (b). (spec: ci-cd)
- [ ] BRANCH_HEAD_IS_LEASE: No `infra/control/candidate-lease.json`, no acquire/release scripts. Same-node concurrency resolved by GHA `concurrency` group + `git push` non-fast-forward. (spec: ci-cd)
- [ ] CONCURRENCY_GROUP_FORMAT: Every matrix-fanned cell carries `concurrency: { group: flight-${{ matrix.env }}-${{ matrix.node }}, cancel-in-progress: false }`. `matrix.env` is a literal singleton list even when there's one env per workflow, so all 3 workflows render byte-identical group strings for the same `(env, node)` pair. (spec: ci-cd)
- [ ] AGGREGATOR_OWNS_LEASE: lock/unlock-preview semantics live in `flight-preview.yml`'s `aggregate-preview` job ONLY. Per-cell jobs MUST NOT push `.promote-state/lease.json` and MUST NOT call lock/unlock scripts. (spec: ci-cd)
- [ ] AGGREGATOR_CONCURRENCY_GROUP (R4-#4): every aggregator job carries `concurrency: { group: aggregate-${{ matrix.env }}, cancel-in-progress: false }` and performs rebase-retry on push. Disjoint-node concurrent flights cannot lose a lease to a non-fast-forward race. (spec: ci-cd)
- [ ] CURRENT_SHA_IS_MERGE_BASE (R4-#3): `deploy/<env>/.promote-state/current-sha` is computed by aggregator as `git merge-base` over the 4 per-node tips. `release.yml` reads it unchanged and only ships code that all nodes have validated. (spec: ci-cd)
- [ ] ROLLUP_MAP_PRESERVES_UNAFFECTED (R4-#2): aggregator merges `source-sha-by-app.json` by `read existing rollup → overwrite ONLY affected-node keys → push`. Stale-but-valid prior entries for unaffected nodes are preserved. (spec: ci-cd)
- [ ] SOURCE_SHA_MAP_PER_CELL: each cell writes `deploy/<env>-<node>:.promote-state/source-sha-by-app.json` with EXACTLY one entry (its own node). `verify-buildsha.sh` runs in single-app `NODES ∩ map` mode per cell. (spec: ci-cd)
- [ ] PROMOTED_APPS_PER_CELL: each cell calls `wait-for-argocd.sh` with `PROMOTED_APPS=${{ matrix.node }}` (single app) + `EXPECTED_SHA=<deploy/<env>-<node> tip>`. (spec: ci-cd)
- [ ] AFFECTED_FROM_TURBO: matrix include list is computed by `scripts/ci/detect-affected.sh` (v0 implementation reading catalog `path_prefix:`); destination is `turbo ls --affected --filter=...[$BASE]` per task.0260. No hand-rolled path-diff in any of the workflows. (spec: ci-cd)
- [ ] CATALOG_EDITS_ARE_GLOBAL_BUILD_INPUT (R4-#8): `detect-affected.sh` treats `infra/catalog/**` as a global-build-input → catalog edits trigger full matrix. Per-cell rsync scope is `infra/catalog/<this-node>.yaml` only, never the whole `infra/catalog/`. (spec: ci-cd)
- [ ] BOOTSTRAP_FAST_FORWARDS_BEFORE_MERGE (R4-#5): `bootstrap-per-node-deploy-branches.sh` is idempotent + fast-forwards per-node branches to whole-slot tips on every run. Implementer re-runs it as the last pre-merge action so per-node branches cannot lag whole-slot at AppSet flip. (spec: ci-cd)
- [ ] ONE_APPSET_PER_ENV: each AppSet remains **one** ApplicationSet resource; per-node routing via 4 git-generators inside it. (spec: architecture)
- [ ] APPSET_PRESERVE_ON_TRANSITION: All 3 AppSets carry `spec.preserveResourcesOnDeletion: true` post-cutover. (spec: ci-cd)
- [ ] APPLICATION_NAMES_UNCHANGED: Pre- and post-cutover Argo Application names are byte-identical (`<env>-<node>`). Argo reconciles in place; no Application teardown. (spec: ci-cd)
- [ ] DOGFOOD_ORDERING: This PR flights via the **existing** whole-slot `candidate-flight.yml`. First post-merge PR is the first matrix flight. (spec: ci-cd)
- [ ] PER_NODE_BRANCH_PUSH_BEFORE_MERGE: All 12 `deploy/<env>-<node>` branches exist on origin before merge. Verified via `git ls-remote`. (spec: ci-cd)
- [ ] NO_NEW_CONTROLLERS: No new CRDs, no new in-cluster controllers, no new long-running services. (spec: architecture)
- [ ] BUILD_ONCE_PROMOTE: pr-build still builds `pr-{N}-{sha}-*` once. Per-node matrix cells only rewrite their one node's overlay digest. (spec: ci-cd)
- [ ] SIMPLE_SOLUTION: Reuses existing detect-affected.sh, AppSet generators, `strategy.matrix`, `concurrency`, `wait-for-argocd.sh`, `smoke-candidate.sh`, `promote-k8s-image.sh`. Net new code is workflow plumbing + bootstrap script + aggregator jobs. No new packages, no new long-running services.
- [ ] ARCHITECTURE_ALIGNMENT: Branch-head-as-lease + matrix-with-fail-fast = Kargo primitives on existing GHA + Argo substrate. Future Kargo install is rename + install, not rewrite. (spec: ci-cd)

### Files

<!-- High-level scope -->

**Create**

- `scripts/ops/bootstrap-per-node-deploy-branches.sh` — one-shot, idempotent. For each `(env, node)` pair, push `deploy/<env>-<node>` from `deploy/<env>` HEAD if not already present. Run **before** opening this PR.

**Modify (AppSets — 3 files)**

- `infra/k8s/argocd/candidate-a-applicationset.yaml` — 1 git generator → 4. `targetRevision: "{{candidate_a_branch}}"`. Add `preserveResourcesOnDeletion: true`.
- `infra/k8s/argocd/preview-applicationset.yaml` — same pattern with `preview_branch`.
- `infra/k8s/argocd/production-applicationset.yaml` — same pattern with `production_branch`.

**Modify (workflows — 4 files)**

- `.github/workflows/candidate-flight.yml` — add `decide` job; convert `flight` + `verify-candidate` + `release-slot` into matrix-fanned cells (most of the existing flight job collapses into the matrix cell since per-cell scope = one node). Delete acquire/release-slot job logic. Concurrency group `flight-candidate-a-${{ matrix.node }}`. Net: ~80 lines deleted from lease handling, ~140 added for matrix shape.
- `.github/workflows/flight-preview.yml` — add `decide` job that re-uses the existing `RESOLVED_TARGETS` output (already affected-only at retag); fan out `Flight to preview` step into matrix cells; per-cell artifact upload keyed by node.
- `.github/workflows/promote-and-deploy.yml` — add `decide` job; matrix-fan all post-decide jobs over `nodes`; per-cell `targetRevision: deploy/${OVERLAY_ENV}-${{ matrix.node }}`; per-cell `wait-for-argocd APPS=${OVERLAY_ENV}-${{ matrix.node }}`. ~70 lines added per fan-out point; multiple sub-jobs touched.
- `.github/workflows/candidate-flight-infra.yml` — add GR-5 best-effort pre-check step.

**Modify (scripts — 1 file)**

- `scripts/ci/detect-affected.sh` — `is_global_build_input()` matches `infra/catalog/**` (CATALOG_EDITS_ARE_GLOBAL_BUILD_INPUT). Plus log effective `TURBO_SCM_BASE` / `TURBO_SCM_HEAD` per call; fail loud on empty matrix unless `ALLOW_EMPTY_MATRIX=1` is explicitly set by a caller (open-gap "BASE selection per env" mitigation).

**Delete**

- `infra/control/candidate-lease.json` — no readers post-cutover.
- `scripts/ci/acquire-candidate-slot.sh` — no callers.
- `scripts/ci/release-candidate-slot.sh` — no callers.

**Modify (docs / skills)**

- `docs/spec/ci-cd.md` — replace whole-slot prose with `BRANCH_HEAD_IS_LEASE` axiom + `LANE_ISOLATION` axiom. Tighten the Kargo-alignment note that task.0320 stubbed.
- `scripts/ci/AGENTS.md` — remove acquire/release-slot from the script list.
- `.claude/skills/pr-coordinator-v0/SKILL.md` — drop lease prose, describe matrix output, document Live Build Matrix reading per-node branches.

**Test**

- Validation cases (a)–(f) from the original task body — no automated test harness; validated against live PRs per the validation block.

### Bootstrapping (PR mechanics)

1. **Before opening PR.** Run `scripts/ops/bootstrap-per-node-deploy-branches.sh` against the live remote. Verify all 12 branches exist (`git ls-remote origin 'refs/heads/deploy/*-*'` — expect 12 lines). Branches are dormant: no AppSet reads them yet, no workflow writes them yet.
2. **Open the PR** on `feat/task.0372-per-node-matrix`. CI runs on the existing whole-slot model (the workflows being refactored only matter at merge time when the AppSets flip).
3. **Flight via existing whole-slot `candidate-flight.yml`.** GR-2: this PR's own diff is validated through the lever it's about to retire. The whole-slot flight will write to `deploy/candidate-a` once more — that's expected and harmless; the new branches are still ahead of nothing yet.
4. **Merge.** AppSets re-render; Argo sees the same 4 Applications per env, now pointing at per-node branches. Initially each per-node branch SHA matches its parent whole-slot branch SHA, so reconcile is a no-op.
5. **First post-merge PR is the first real matrix flight.**

### Risks (priced in)

- **Argo reconcile glitch on AppSet 1→4 generator transition.** Application names stay identical, so in theory Argo updates each Application's `source.targetRevision` in place. `preserveResourcesOnDeletion: true` prevents accidental k8s teardown if Argo decides to recreate. Watch for stuck-syncing Applications post-merge; rollback is `git revert` of the AppSet diff (deploy branches stay).
- **promote-and-deploy.yml is 930 lines.** Highest implementation risk. Recommend implementing in this order: candidate-flight (smallest) → flight-preview (retag already affected-only) → promote-and-deploy (largest). Test each stage with a dry-run-equivalent (workflow_dispatch on a no-op PR) before committing the next.
- **Branch-protection rules on `deploy/*`.** If `deploy/*` glob is protected against new branches by an org rule, bootstrap step will fail. Pre-PR check: try pushing one branch (`deploy/candidate-a-operator`) first; if it fails, address the rule before continuing.
- **`detect-affected.sh` BASE selection for preview/prod**. candidate-flight uses `origin/main` as base. flight-preview's base should be the previous preview SHA (read from `deploy/preview/.promote-state/current-sha`). promote-and-deploy's base for preview-forward is the previous preview SHA; for production it's the previous production SHA. The decide job sets `TURBO_SCM_BASE` per workflow; existing `detect-affected.sh` honors it without modification.
- **Old whole-slot `deploy/candidate-a` etc. continue to receive writes from any in-flight runs that started pre-merge.** Acceptable: those runs complete on the old paths; the next dispatch picks up the new matrix workflow.

## Review Feedback (2026-04-25, /review-implementation on PR #1060)

**Verdict: REQUEST CHANGES → fixed in same iteration.** One blocking issue + one cross-PR race noted for follow-up. `pnpm check` PASS. Revision NOT bumped (mechanical fix, not design loop).

### Blocking — fixed in commit `3bfe9338b`

- **Preview + production AppSets refactored without matching workflow writers.** `preview-applicationset.yaml` + `production-applicationset.yaml` flipped to per-node generators (`deploy/<env>-<node>`), but `flight-preview.yml` + `promote-and-deploy.yml` still target whole-slot `deploy/<env>` (verified at `promote-and-deploy.yml:148-149`, `flight-preview.yml:225`). Post-merge: writers advance whole-slot tip; AppSet reads per-node which never advances; `wait-for-argocd.sh EXPECTED_SHA=<whole-slot tip>` times out. Reverted both AppSets to whole-slot shape; refactor moves to task.0376 atomic with workflow cutover.

### Cross-PR race (noted for reviewer's bug.0378 commit)

- `flight` cell concurrency `flight-<env>-<node>` and `verify-candidate` cell concurrency `verify-candidate-<env>-<node>` are **distinct groups** (`candidate-flight.yml:168` vs L325). Two consecutive same-node flights across PRs can interleave: flight-1 push → flight-2 push → verify-1 starts with stale `EXPECTED_SHA` from flight-1's artifact while Argo reports flight-2's tip → wait-for-argocd timeout. Reviewer's bug.0378 commit (planned, on top of this PR) is expected to address.

### Non-blocking observations

- Snapshot/restore loop in `flight` cell (`candidate-flight.yml:246-273`) is structurally a no-op on per-node trees — sibling-node overlay subdirs are never touched by rsync, so "restore" has nothing to restore. Cleanup candidate for task.0376.
- `reconcile-appset` runs `kubectl apply` of the AppSet on every dispatch even when unchanged. Could short-circuit with a content compare. Defer to 0376.
- `git fetch origin <head_sha> --depth=100 || true` (L83) silently masks fetch failures; if PR head is unreachable, matrix degrades to empty silently. Pre-existing pattern.

## Review Feedback (2026-04-25, foundation review)

5 blocking issues + 4 suggestions on the 6-commit foundation (revision 4 design + bootstrap script + detect-affected + 3 AppSets + GR-5 pre-check). `pnpm check` PASS. Design stands; these are mechanical implementation fixes, not design issues — revision NOT bumped.

### Blocking (fix before resuming workflow refactors)

1. **`scripts/ops/bootstrap-per-node-deploy-branches.sh:27`** — make the deploy/_ fetch explicit: `git fetch origin '+refs/heads/deploy/_:refs/remotes/origin/deploy/\*' --prune --quiet`. Default refspec is unreliable on single-branch / custom-refspec worktrees.
2. **`scripts/ops/bootstrap-per-node-deploy-branches.sh:50-56`** — divergence detection: distinguish "ahead" (whole-slot-is-ancestor-of-per-node) vs "diverged" (no ancestry); fail-loud on divergence pre-cutover. Currently masks state corruption.
3. **`scripts/ops/bootstrap-per-node-deploy-branches.sh:78`** — add `--atomic` to `git push origin "${push_args[@]}"`. Branch-protection rejection on one ref shouldn't leave bootstrap in a half state.
4. **AppSet generator-drift lint** — add to Layer-4 cleanup: extend `scripts/ci/check-catalog-ssot.sh` (or new `check-appset-generators.sh`) to assert each AppSet's `generators[].git.revision` set covers every node in `ALL_TARGETS`. Without this, adding a 5th node + forgetting one of three AppSets ships broken Argo state.
5. **`.github/workflows/candidate-flight-infra.yml:114`** — comment claims "CI will catch drift via grep test in pr-build" but no such test was added. Either add a one-line `grep -q '^name: Candidate Flight$' .github/workflows/candidate-flight.yml` check to `ci.yaml`, or delete the claim.

### Suggestions (non-blocking)

- Bootstrap: trim whitespace on `IFS=',' read` of `ENVS`; echo the remote URL before pushing so the operator sees what they authorize.
- `candidate-flight-infra.yml:121`: surface `gh run list` failures as `::warning::` instead of silently treating as 0 in-progress runs.
- AppSet comment harmonization — `# APPSET_PRESERVE_ON_TRANSITION (R4 belt-and-suspenders)` on candidate-a only; preview/production drop the parenthetical. Pick one.
- File for follow-up: extract `repoURL: https://github.com/cogni-dao/cogni-template.git` from AppSet generators (12 repetitions per env post-cutover). Needs Helm wrapper or kustomize replacement; not in scope of task.0372.

### Positive findings (preserve across iteration)

- AppSet 1→4 refactor is faithful to GR-1 + ONE_APPSET_PER_ENV + APPLICATION_NAMES_UNCHANGED + APPSET_PRESERVE_ON_TRANSITION. Names byte-identical.
- Bootstrap SHA-equality short-circuit before ancestry check — right ordering.
- `infra/catalog/*` in bash `case` correctly catches future subdirs (case glob `*` matches `/`).
- Verification spike #1 + #3 confirmed via reads of `create-release.sh:22` and `verify-buildsha.sh:109-134`.

## PR / Links

- Handoff: [handoff](../handoffs/task.0372.handoff.md)
- Substrate: [task.0320](task.0320.per-node-candidate-flighting.md), [task.0374 PR #1053](https://github.com/Cogni-DAO/node-template/pull/1053)
- Reuses: [task.0373 PR #1047](https://github.com/Cogni-DAO/node-template/pull/1047) snapshot/restore
