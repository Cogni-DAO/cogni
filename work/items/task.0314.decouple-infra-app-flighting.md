---
id: task.0314
type: task
title: "Decouple infra flighting from app flighting — two independent levers"
status: needs_implement
revision: 2
priority: 0
rank: 1
estimate: 5
summary: "`candidate-flight.yml` always runs `deploy-infra.sh` alongside digest promotion, coupling VM compose re-sync to every app flight. This violates ci-cd.md's `Argo owns reconciliation` axiom and caused PR #879 to fail twice because its stale compose file rsynced to the VM. Split into two levers an agent can invoke independently; same split applies to the preview/production promotion chain."
outcome: |
  Two independent, agent-dispatchable workflows:
    - `candidate-flight-app.yml`  — digest → deploy/candidate-a → Argo sync pods → verify
    - `candidate-flight-infra.yml` — rsync infra/compose/runtime → VM → compose up → verify
  Same separation applied to promote-and-deploy.yml (preview/prod).
  Merge-to-main preview promotion still triggers both where appropriate (infra iff infra/ changed, app always).
  Shell scripts own the logic; workflows are thin dispatchers. No workflow_run chaining.
  App flights no longer regress on stale infra config because infra path no longer reads from PR checkout.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
credit:
project: proj.cicd-services-gitops
supersedes: task.0281
blocks:
  - proj.cicd-services-gitops blocker #18 (PAT-dispatched workflow chain)
  - proj.cicd-services-gitops blocker #19 (deploy-infra unconditional)
branch: task/0314-decouple-infra-app-flighting
pr: https://github.com/Cogni-DAO/node-template/pull/883
created: 2026-04-16
updated: 2026-04-16
labels: [ci-cd, deployment, spec-alignment, p0]
---

# task.0314 — Decouple infra flighting from app flighting

## Problem

`candidate-flight.yml` runs **both** of these in one monolithic job:

1. **App** — resolve PR digests → promote into `deploy/candidate-a` overlay → push → reconcile Argo → Argo syncs pods
2. **Infra** — rsync `$REPO_ROOT/infra/compose/runtime/` from the PR's checkout → SSH VM → `compose up -d` → wait healthchecks

Two independent regressions result:

**R1. Every app-only flight pays the infra cost.** ~5–8 min per flight, unconditionally. Violates ci-cd.md axiom: _Argo owns reconciliation. CI writes desired state to git; Argo syncs from git._

**R2. The infra rsync source is the PR's own checkout.** App PRs branched before an infra change ship stale compose config to the VM, even though they didn't touch infra. PR #879 (poly agent API — app-only) failed twice on this: its `docker-compose.yml` predated #880's litellm GHCR fix, and deploy-infra rsynced the stale file. Resolution required rebasing #879 on main. That rebase requirement is not documented anywhere and is a silent foot-gun.

Same coupling lives in `promote-and-deploy.yml` (post-merge preview + production path) — worse blast radius, same shape.

## Target Architecture

```
┌─ APP LEVER ──────────────────────────────────────────┐
│  candidate-flight-app.yml                             │
│    ↓ inputs: pr_number                                │
│    scripts/ci/flight-app.sh                           │
│    ↓ resolve digests → promote overlay → push         │
│    deploy/candidate-a  →  Argo CD  →  pods roll       │
│    ↓ verify: wait-for-argocd + /readyz SHA check      │
└───────────────────────────────────────────────────────┘

┌─ INFRA LEVER ────────────────────────────────────────┐
│  candidate-flight-infra.yml                           │
│    ↓ inputs: ref (default: main)                      │
│    scripts/ci/flight-infra.sh                         │
│    ↓ rsync infra/compose/runtime/ @ ref → VM          │
│    ↓ SSH VM → compose up -d → healthcheck             │
└───────────────────────────────────────────────────────┘
```

Both independently invokable by an agent. Same pair exists for preview (`promote-app.yml` + `promote-infra.yml`) and production. No workflow_run chaining; every workflow is human- or agent-triggerable.

## Principles

- **Shell scripts own the logic.** Workflows are thin dispatchers: checkout, secret plumbing, invoke script, report status.
- **No workflow_run chaining.** Every workflow is directly dispatchable; composition lives in scripts or in an agent's triage loop.
- **Infra reads from `main` (or explicit ref), not from PR checkout.** Eliminates R2.
- **Locking is per-lane.** App lever locks the digest slot (existing `infra/control/candidate-lease.json`). Infra lever locks the VM (new `infra/control/infra-lease-{env}.json` or flock on VM). Locks never block each other.

## V0 Scope

Land the candidate-a split as one coherent PR:

1. Extract current `deploy-infra.sh` behavior into `scripts/ci/flight-infra.sh` (parameterized by `env`: `candidate-a` | `preview` | `production`, `ref`: git ref to rsync from — default `main`).
2. Extract current digest promotion behavior from `candidate-flight.yml` into `scripts/ci/flight-app.sh` (parameterized by `pr_number`, `env`).
3. Two new workflows:
   - `candidate-flight-app.yml` (replaces `candidate-flight.yml`)
   - `candidate-flight-infra.yml` (new)
4. Retire the combined `candidate-flight.yml`.
5. **Preview/prod promotion-on-merge must still work.** Options covered in design:
   - (a) `promote-and-deploy.yml` internally invokes both scripts sequentially (simple, no chaining).
   - (b) Split `promote-and-deploy.yml` into `promote-app.yml` + `promote-infra.yml`, both triggered by `push: deploy/preview`.
   - Pick (a) for v0 — single merge trigger, two sequential script calls, no workflow chaining. Split later if needed.

## Out of Scope (v0)

- Auto-detection of "infra changed → run infra lever." Agent decides for now; a skip-gate can ride later.
- Infra lever taking an arbitrary per-PR ref. v0: `main` only. **Explicit tradeoff:** infra changes become merge-then-deploy — the same discipline as database migrations. Infra PRs cannot be pre-flight-tested on candidate-a before merging to main. If this bites, v1 can add `--ref` passthrough for `candidate-a` only (gated by env).
- Sandbox-openclaw-specific mount changes (covered elsewhere).

## Consistency Model

Today's system is **pessimistically consistent**: every app flight re-syncs compose, so the VM is always aligned with the PR's view of infra. The new system is **eventually consistent** for candidate-a only: app flights trust that main's compose is already on the VM, and the infra lever must have been run after any infra-affecting merge.

**Named owner:** the agent or human that merges an `infra/compose/**` change to `main` is responsible for dispatching `candidate-flight-infra.yml` as part of the same turn. For preview/production, `promote-and-deploy.yml`'s sequential `promote-k8s → deploy-infra` jobs cover this automatically on every merge — only candidate-a has the eventual-consistency window.

**Drift guard** (deferred to v1): a VM-side `.tree-hash` + preflight warning in `candidate-flight.yml`. Not required for v0 correctness. Listed as follow-up if operators repeatedly forget the infra dispatch.

## Supersedes

- **task.0281** — written 2026-04-04 with the inverted goal ("add compose deploy to canary"). The spec (ci-cd.md, 2026-02-05, verified 2026-04-14) has since clarified that Argo, not SSH, owns reconciliation. task.0281's Phase 1 ("canary infra deploy parity") is obsolete. Close task.0281 on merge of this task's PR.

## Related

- **proj.cicd-services-gitops blocker #18** — PAT-dispatched workflow_run chain. Closed by this task's "no workflow_run chaining" principle.
- **proj.cicd-services-gitops blocker #19** — deploy-infra unconditional. Closed by this task.
- **docs/spec/ci-cd.md** — this task realigns workflows to the spec's lane model.

## Acceptance

- [ ] Agent can run `gh workflow run candidate-flight.yml -f pr_number=N` and it flies ONLY the app pod changes. No `bash scripts/ci/deploy-infra.sh` call in the logs. Completes in <2 min when GHCR digests already exist.
- [ ] Agent can run `gh workflow run candidate-flight-infra.yml` and it rsyncs+redeploys compose from `main`. No commits on `deploy/candidate-a`.
- [ ] PR #879's failure mode (app PR branched before infra change) is impossible on the new levers — app flight never touches compose files.
- [ ] Merge to main → `promote-and-deploy.yml` still deploys both app and infra to preview, with the 5-job graph + lock-gate lease behavior byte-identical to today.
- [ ] `deploy-infra.sh --dry-run` prints planned actions (rsync source, VM target, services) without SSH; exits 0.
- [ ] `deploy-infra.sh` without `--ref` continues to default to `main`.
- [ ] task.0281 closed with supersede note; proj.cicd-services-gitops blockers #18, #19 marked done.

## Design

### Outcome

An agent (or human) can flight an app-only PR to candidate-a in <2 min without touching the VM, and separately reconcile infra compose on the VM without touching any PR digests. Preview/prod promotion-on-merge still redeploys both. Eliminates the class of failure where an app PR ships stale compose config.

### Approach — minimum delta

The monolith lives in **one YAML step** (`Deploy Compose infra to candidate-a VM`), not in missing scripts. Existing `scripts/ci/*.sh` are already well-factored and compose 1:1 with the workflow steps. So the surgery is far smaller than first drafted:

1. **Modify `scripts/ci/deploy-infra.sh`** — add `--ref` (default `main`) + `--dry-run` flags; replace `REPO_ROOT="$(git rev-parse --show-toplevel)"` rsync source with a clean `git worktree add <tmp> <ref>` checkout. No rename.
2. **Modify `candidate-flight.yml`** — delete exactly one step: `Deploy Compose infra to candidate-a VM`. Everything else (SSH setup, AppSet reconcile, smoke, lease) stays. The workflow becomes the app lever by subtraction. No rename, no new umbrella script.
3. **Create `candidate-flight-infra.yml`** — thin dispatcher (~30 lines) that invokes `deploy-infra.sh --env candidate-a --ref ${ref || main}`.
4. **Modify `promote-and-deploy.yml`** — on the existing `deploy-infra` job, change `Checkout app source` from `ref: head_sha` to `ref: main`. That single line + letting `deploy-infra.sh`'s new default kick in is the entire rewire. 5-job graph, `needs:`, `if:`, lock-gate jobs all untouched.

**One new file. Three modified files. Zero deletions. Zero renames.**

**Rejected**: (1) Creating `flight-app.sh`/`flight-infra.sh` umbrella scripts — the workflows already compose existing scripts; adding another indirection layer is bloat. (2) Renaming `candidate-flight.yml` → `candidate-flight-app.yml` — breaks every existing caller (the pr-coordinator skill, dashboards, muscle memory) for zero semantic gain; "app lever" is clear from what it does, not its filename. (3) Reusable `workflow_call` workflows — violates "shell owns logic, not GHA." (4) Deleting `deploy-infra.sh` — zero reason once we're not renaming; breaks everything that references it. (5) TypeScript/Dagger rewrite — massive scope, orthogonal to this task.

### Architecture

```
┌─ APP LEVER ─────────────────────────────────────────┐
│  candidate-flight.yml (unchanged name, -1 step)     │
│    dispatch: pr_number                              │
│    steps: resolve digests → overlay commit → push   │
│           → reconcile AppSet → wait-for-argocd      │
│           → smoke → release slot                    │
│    DOES NOT call deploy-infra.sh anymore.           │
└─────────────────────────────────────────────────────┘

┌─ INFRA LEVER ───────────────────────────────────────┐
│  candidate-flight-infra.yml (new, ~30 lines)        │
│    dispatch: ref (default: main)                    │
│    steps: checkout main → invoke deploy-infra.sh    │
│                                                     │
│  deploy-infra.sh (modified, same filename):         │
│    args: --env <env> --ref <git-ref> [--dry-run]    │
│    source: git worktree add <tmp> <ref>             │
│            rsync <tmp>/infra/compose/runtime/ → VM  │
│            (was: rsync $REPO_ROOT — stale-PR risk)  │
└─────────────────────────────────────────────────────┘

┌─ PREVIEW / PROD (promote-and-deploy.yml) ───────────┐
│  5-job graph UNCHANGED.                             │
│  Single diff: deploy-infra job's Checkout step      │
│  changes `ref: head_sha` → `ref: main`.             │
│  deploy-infra.sh default `--ref main` picks up.     │
└─────────────────────────────────────────────────────┘
```

Dispatch surface for an agent:

```bash
# Fly an app PR to candidate-a (no VM SSH)
gh workflow run candidate-flight.yml -f pr_number=879

# Reconcile VM compose to tip of main
gh workflow run candidate-flight-infra.yml

# Reconcile VM compose to a specific ref (v0: main only; v1 could relax)
gh workflow run candidate-flight-infra.yml -f ref=main
```

### How preview/prod promotion-on-merge still runs both

**The 5-job graph of `promote-and-deploy.yml` does not change.** Jobs, `needs:`, `if:` conditionals, outputs, and the three-value lock-gate lease (task.0293) are all untouched. The only edit is on the `deploy-infra` job's first step:

```yaml
# promote-and-deploy.yml — deploy-infra job only
deploy-infra:
  needs: promote-k8s
  if: needs.promote-k8s.result == 'success'
  steps:
    - name: Checkout app source
      uses: actions/checkout@v4
      with:
        ref: main # ← was: ${{ steps.env.outputs.head_sha }}
        # Everything else stays.
    - name: Deploy Compose infra
      run: bash scripts/ci/deploy-infra.sh # now defaults to --ref main; no args change
```

Why this is enough: the job previously rsynced from its own checkout (= merge commit SHA). Since `deploy-infra.sh` still calls `$REPO_ROOT` internally, checking out `main` means it rsyncs from main. Even simpler than passing `--ref` explicitly — the script's new default wins.

Downstream `verify`, `lock-preview-on-success`, `unlock-preview-on-failure` jobs remain byte-identical. The merge → preview → release chain is unchanged from the caller's POV.

### Locking model

Two independent locks, by design:

| Lever                       | Lock           | Mechanism                                                                                  | Why                                                   |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `flight-app.sh candidate-a` | digest slot    | existing `infra/control/candidate-lease.json` on `deploy/candidate-a` (atomic commit push) | one PR owns the slot's deployed digest at a time      |
| `flight-infra.sh *`         | VM compose dir | GHA `concurrency: group: infra-${env}` (cancel-in-progress: false)                         | prevents overlapping rsync/compose up; VM-level state |
| `promote-and-deploy.yml`    | env-level      | existing `concurrency: group: promote-deploy-${env}`                                       | unchanged from today                                  |

Locks are orthogonal. A running app flight does NOT block an infra reconcile on the same env, and vice versa — they touch different state (git deploy branch vs VM compose dir). If an agent wants both to run atomically it dispatches app first, waits, then infra.

### Script boundaries — I/O contract

**`scripts/ci/flight-app.sh`**:

- Inputs (env vars from workflow secrets layer): `GITHUB_TOKEN`, `IMAGE_NAME`, `GHCR_DEPLOY_TOKEN`, `GHCR_USERNAME`, SSH key for `reconcile-argocd-appset`, `VM_HOST`.
- Inputs (flags): `--pr N` OR `--source-sha SHA`, `--env {candidate-a|preview|production}`.
- Outputs: exit 0 on success, non-zero on failure. Writes `$GITHUB_OUTPUT` with `deploy_branch_sha`, `head_sha`, `image_tag` if `$GITHUB_OUTPUT` is set.
- Side effects: commits to `deploy/{env}`, reconciles AppSet, waits for Argo.

**`scripts/ci/flight-infra.sh`**:

- Inputs (env vars): all the runtime secrets currently passed through the SSH heredoc in `deploy-infra.sh:944`.
- Inputs (flags): `--env {candidate-a|preview|production}`, `--ref <git-ref>` (default: `main`).
- Outputs: exit 0/non-zero.
- Side effects: `git archive` or `git checkout --worktree` from `--ref` into a temp dir, rsync that temp dir to VM, ssh → `deploy-infra-remote.sh`.

The **only logic change** inside today's `deploy-infra.sh` is replacing `REPO_ROOT="$(git rev-parse --show-toplevel)"` with a parameterized source that resolves to a clean checkout of `--ref`. That single change eliminates R2 (stale PR compose files).

### Migration plan

**Implementation order** (one PR, staged commits for reviewability):

1. **Modify `deploy-infra.sh`** — add `--ref` (default `main`) + `--dry-run` flags; replace `REPO_ROOT="$(git rev-parse --show-toplevel)"` with `git worktree add <tmp> <ref>` against a clean checkout. Preserve all existing behavior and secret passthrough. No rename.
2. **Modify `candidate-flight.yml`** — delete the `Deploy Compose infra to candidate-a VM` step. Everything else stays.
3. **Create `candidate-flight-infra.yml`** — thin dispatcher that calls `deploy-infra.sh --env candidate-a --ref ${ref || main}`. Independent GHA concurrency group `infra-candidate-a`.
4. **Modify `promote-and-deploy.yml`** — in the `deploy-infra` job, change `Checkout app source`'s `ref` from `head_sha` to `main`. Nothing else.
5. **Docs + skill pass** — surgical updates per "Documentation & Guides to Update" above.

**Pre-merge validation** (required before the PR merges — addresses the chicken-and-egg of refactoring CI/CD with itself):

- Dispatch from the PR branch via `gh workflow run candidate-flight.yml --ref task/0314-decouple-infra-app-flighting -f pr_number=<throwaway-test-PR>`. Confirm: no SSH occurs during the flight, `/readyz` reports the test PR's SHA.
- Dispatch `gh workflow run candidate-flight-infra.yml --ref task/0314-...`. Confirm: no commits on `deploy/candidate-a`, VM compose matches `main`'s compose tree.
- Dispatch `gh workflow run promote-and-deploy.yml --ref task/0314-... -f environment=preview -f source_sha=<recent-preview-SHA>`. Confirm: full 5-job graph fires, lock-gate transitions fire, preview `/readyz` at the expected SHA.
- Regression scenario: dispatch the new app-lever `candidate-flight.yml` against any app-only PR branched before `fb8bd2232` (the #880 litellm-GHCR fix) with NO rebase. It must succeed. This is the exact failure that motivated the task.
- **Merge gate:** PR description must show those four runs green before merge approval.

**Post-merge cleanup:**

- Close `task.0281` with supersede note + link to this PR.
- Mark `proj.cicd-services-gitops` blockers #18 + #19 ✅ DONE.

No backwards-compat work — nothing is renamed or deleted, so existing callers continue to work.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **ARGO_OWNS_RECONCILIATION** — app lever writes deploy-branch state; Argo reconciles the pods. No `deploy-infra.sh` call in the app lever workflow. (spec: ci-cd.md §axioms)
- [ ] **NO_WORKFLOW_RUN_CHAINING** — every new/modified workflow is directly `workflow_dispatch`-triggerable. No `on: workflow_run`. (spec: ci-cd.md §workflow-design-targets)
- [ ] **SCRIPT_OWNS_LOGIC** — non-trivial step sequencing lives in `scripts/ci/*.sh`. New workflow (`candidate-flight-infra.yml`) is a thin dispatcher that invokes one script.
- [ ] **INFRA_REF_IS_EXPLICIT** — `deploy-infra.sh` rsyncs from a `git worktree add <ref>` checkout (default `main`), NEVER from `$REPO_ROOT` of the caller workflow. Eliminates R2.
- [ ] **LEVERS_ARE_INDEPENDENT** — app lever MUST work on a VM where infra lever has never run today; infra lever MUST work with no app promotion in the current lease.
- [ ] **MERGE_TO_MAIN_UNCHANGED** — `promote-and-deploy.yml`'s external contract (inputs, job graph, outputs, lease semantics, lock-gate) is byte-identical before and after; only one checkout `ref` changes. (spec: ci-cd.md §preview-review-lock, task.0293)
- [ ] **NO_RENAMES_NO_DELETES** — `candidate-flight.yml` and `deploy-infra.sh` keep their names. Zero callers-audit blast radius.
- [ ] **SIMPLE_SOLUTION** — no new OSS, no new runtimes, no umbrella scripts. One new YAML + three small edits.
- [ ] **ARCHITECTURE_ALIGNMENT** — spec-aligns to ci-cd.md's already-written lane model.

### Desired End State

**Dispatch surface:**

| Workflow                                         | Purpose                                                | Touches VM? | Touches Argo? |
| ------------------------------------------------ | ------------------------------------------------------ | ----------- | ------------- |
| `candidate-flight.yml` (existing, -1 step)       | Fly a PR's app digests to candidate-a                  | No          | Yes           |
| `candidate-flight-infra.yml` (new)               | Reconcile candidate-a VM compose from a git ref        | Yes         | No            |
| `promote-and-deploy.yml` (existing, 1-line diff) | Merge-triggered preview/prod promotion                 | Yes         | Yes           |
| `flight-preview.yml` (existing, untouched)       | Merge-to-main → dispatch promote-and-deploy with lease | No directly | No directly   |

**Behaviors guaranteed:**

- App flights never SSH a VM for compose. Infra flights never commit to a `deploy/*` branch. Orthogonal levers.
- Infra rsync source is a named git ref (default `main`), never a PR checkout. Eliminates R2.
- Preview/prod merge-on-main behavior is byte-identical: same 5-job graph, same lease, same lock-gate transitions.
- An app PR branched before an infra change on main can be flown to candidate-a without rebasing — its stale compose file is never touched.
- App flight duration: <2 min when GHCR digests exist. Infra flight: ~5 min.

### Files

**Create (1):**

- `.github/workflows/candidate-flight-infra.yml` — thin dispatcher, ~30 lines, single script call.

**Modify (3):**

- `scripts/ci/deploy-infra.sh` — add `--ref` (default `main`) + `--dry-run` flags; replace `REPO_ROOT` rsync source with a `git worktree add <tmp> <ref>` checkout. Otherwise preserved byte-for-byte, including secret passthrough.
- `.github/workflows/candidate-flight.yml` — delete exactly the `Deploy Compose infra to candidate-a VM` step. Concurrency, secrets, job graph unchanged.
- `.github/workflows/promote-and-deploy.yml` — change the `deploy-infra` job's `Checkout app source` step `ref` from `head_sha` to `main`. Nothing else.

**Delete (0):** none. No renames, no removals.

**Work items:**

- `work/items/task.0281-canary-cicd-parity-staging-promotion.md` — set `status: done`, add supersede note → task.0314.
- `work/projects/proj.cicd-services-gitops.md` — mark blockers **#18** (PAT-dispatched workflow chain) and **#19** (deploy-infra unconditional) ✅ DONE; note task.0314 as the closer.
- `work/items/_index.md` — regen.

### Documentation & Guides to Update

Because nothing is renamed or deleted, the doc update surface is small.

**Specs:**

- `docs/spec/ci-cd.md` — add a short subsection under Workflow Design Targets enumerating the two-lever topology and naming `candidate-flight-infra.yml` as the new dispatcher. No existing lines need to change — both `candidate-flight.yml` and `deploy-infra.sh` references stay valid.

**Scorecards:**

- `work/projects/proj.cicd-services-gitops.md` — tick blockers **#18** and **#19** ✅ DONE with `→ task.0314` pointer. Leave the Pipeline Health ascii box alone (the names are still accurate).

**Agent skills:**

- `.claude/skills/pr-coordinator-v0/SKILL.md` — one meaningful rewrite:
  - Line 219 (Manual Deploy Escape Hatch): the "infra-only PR can't ride candidate-flight" gap is closed by `candidate-flight-infra.yml`. Rewrite this subsection to describe the infra lever as the canonical escape hatch. v0 caveat: infra lever reconciles from `main` only, so infra PRs still merge-then-deploy.
  - Lines 77, 113, 245 — no change needed (filenames unchanged).

**AGENTS.md siblings:**

- `scripts/ci/AGENTS.md` — one-line addition: `deploy-infra.sh now accepts --ref and --dry-run; rsync source is a clean worktree of the given ref (default: main).`
- `.github/workflows/AGENTS.md` (if present) — add `candidate-flight-infra.yml` to the inventory list.

**Callers audit (smaller because no renames):**

```bash
rg -l "deploy-infra\.sh|candidate-flight\.yml" \
  --glob '!work/items/_index.md' \
  --glob '!.claude/worktrees/**'
```

Purpose: verify no doc or runbook advertises behavior that no longer matches (e.g., "candidate-flight deploys the VM compose"). Edit text only where it misleads.

**Test coverage:** manual dispatch matrix (see Validation section) is the authoritative proof. No new unit/integration tests — the system under test is the workflow graph itself.

## Validation

**Pre-merge** (dispatched from the PR branch via `--ref task/0314-decouple-infra-app-flighting`; all four must be green before the PR merges):

1. **App lever isolation** — `candidate-flight.yml` against an app-only test PR completes in <2 min with zero `bash scripts/ci/deploy-infra.sh` in logs. `/readyz` on the affected node returns the PR head SHA.
2. **Infra lever isolation** — `candidate-flight-infra.yml` completes without touching `deploy/candidate-a` (no new commits on that branch); the VM's `/opt/cogni-template-runtime/docker-compose.yml` matches `main`'s compose tree.
3. **Preview merge parity** — `promote-and-deploy.yml -f environment=preview -f source_sha=<recent-preview-SHA>` fires the full 5-job graph (`promote-k8s` → `deploy-infra` → `verify` → `lock-preview-on-success`), lock-gate transitions fire correctly, preview `/readyz` returns the expected SHA.
4. **Regression proof** — replay PR #879's exact failure: take an app-only PR branched before `fb8bd2232` (pre-#880), do NOT rebase, dispatch the app-lever `candidate-flight.yml` against it — it must succeed. Pre-refactor this would hard-fail at `deploy-infra`.

**Post-merge** (sanity check with real merge flow):

5. Merge any small PR to main; confirm the merge→preview chain fires end-to-end identically to today's behavior (no new failure modes, lock-gate writes correct SHAs).

## Review Feedback

### Revision 2 (2026-04-16) — REQUEST CHANGES

**Blocking:**

- **B1'** — `candidate-flight-infra.yml` declares `VM_HOST` at step level only. GHA evaluates step `if:` conditions against workflow+job env, NOT the step's own `env:`. So `if: env.VM_HOST != ''` on the Deploy step at L66 always evaluates false, and the Deploy step is **always skipped** even when VM_HOST is set. Workflow reports green vacuously — silent no-op. **Fix:** hoist `VM_HOST` (and preferably all secrets) to a job-level `env:` block, mirroring `promote-and-deploy.yml:280–307`. Remove the duplicated per-step env.

**Nice-to-have:**

- **S5** — `deploy-infra.sh --ref`: edge cases `--ref ""` and `--ref=value` fall through unhelpfully. Minor.
- **S6** — Capture `git fetch` stderr so the L356 `log_fatal` on unresolvable ref is self-explanatory.

### Revision 1 (2026-04-16) — addressed

All five items addressed in commit following this note. Summary:

- **B1** — `candidate-flight-infra.yml` now has a `Setup SSH` step identical in shape to `promote-and-deploy.yml`'s (writes `~/.ssh/deploy_key`, `ssh-keyscan`, connection probe, `VM_HOST` empty-check → `exit 0`). Deploy-Compose step gated on `env.VM_HOST != ''`.
- **S1** — `promote-and-deploy.yml` deploy-infra job checkout reverted to `ref: head_sha` (source-SHA invariant preserved for AppSet reconcile + wait-for-argocd). The script gets `--ref main` explicitly at the call site.
- **S2** — `deploy-infra.sh` `--ref` parsing now rejects `--ref` with no value or with another flag as value; clear error message, exits 2.
- **S3** — `promote-and-deploy.yml:430` now invokes `scripts/ci/deploy-infra.sh --ref main` explicitly instead of relying on the script's default.
- **S4** — Dropped the placeholder `REPO_ROOT="$CALLER_REPO"` assignment; `REPO_ROOT` is now only set from the detached worktree, so any accidental pre-worktree read would hit `set -u` and fail loudly.

Local dry-run confirmed still working end-to-end post-changes.

### Revision 1 (2026-04-16) — REQUEST CHANGES (original)

**Blocking:**

- **B1 — `candidate-flight-infra.yml` has no `Setup SSH` step.** The workflow passes `SSH_DEPLOY_KEY` as env but `deploy-infra.sh:193` reads the key from `$HOME/.ssh/deploy_key`. Without a step writing the key to disk + `ssh-keyscan` populating `known_hosts`, every SSH/rsync/scp in `deploy-infra.sh` fails. Copy the Setup SSH step verbatim from `promote-and-deploy.yml:364–385`, including the `VM_HOST` empty-check → `exit 0` guard.

**Strongly suggested:**

- **S1 — Preserve source-SHA invariant in `promote-and-deploy.yml deploy-infra` job.** Revert the job's checkout `ref: main` back to `ref: head_sha`. Pass `--ref main` to the script explicitly at L430 instead. Avoids an inter-merge race where the AppSet reconcile step + wait-for-argocd read files from a different SHA than `promote-k8s` pushed digests for.

**Nice-to-have:**

- **S2 — `--ref` flag value validation in `deploy-infra.sh`.** Guard against `--ref` as final arg or followed by another `--flag`.
- **S3 — Explicit `--ref main` at `promote-and-deploy.yml:430`.** Self-documenting; removes reliance on script default.
- **S4 — Drop placeholder `REPO_ROOT="$CALLER_REPO"` at `deploy-infra.sh:71`.** Let `set -u` catch accidental early use.

## Attribution

- Surfaced by PR #879 flight failure loop on 2026-04-16.
