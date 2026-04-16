---
id: task.0314
type: task
title: "Decouple infra flighting from app flighting — two independent levers"
status: needs_implement
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

**R1. Every app-only flight pays the infra cost.** ~5–8 min per flight, unconditionally. Violates ci-cd.md axiom: *Argo owns reconciliation. CI writes desired state to git; Argo syncs from git.*

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

Today's system is **pessimistically consistent**: every app flight re-syncs compose, so the VM is always aligned with the PR's view of infra. The new system is **eventually consistent**: app flights trust that main's compose is already on the VM, and `flight-infra.sh` must have been run after any infra-affecting merge.

**Named owner:** the agent or workflow that merges an `infra/compose/**` change to main is responsible for running `flight-infra.sh --env candidate-a` as part of the same turn. For preview/production, `promote-and-deploy.yml` already invokes both jobs sequentially on every merge, so no human owner is needed there — only candidate-a has the eventual-consistency window.

**Drift guard:** `flight-app.sh` preflight computes `git ls-tree origin/main -- infra/compose/runtime | sha256sum` locally and reads the equivalent digest from the VM (stored in `/opt/cogni-template-runtime/.tree-hash` by `flight-infra.sh` on each run). On mismatch, print a loud warning naming the drift; do NOT hard-fail (that would re-couple the levers). Agent/operator decides whether to run `flight-infra.sh` first or proceed.

## Supersedes

- **task.0281** — written 2026-04-04 with the inverted goal ("add compose deploy to canary"). The spec (ci-cd.md, 2026-02-05, verified 2026-04-14) has since clarified that Argo, not SSH, owns reconciliation. task.0281's Phase 1 ("canary infra deploy parity") is obsolete. Close task.0281 on merge of this task's PR.

## Related

- **proj.cicd-services-gitops blocker #18** — PAT-dispatched workflow_run chain. Closed by this task's "no workflow_run chaining" principle.
- **proj.cicd-services-gitops blocker #19** — deploy-infra unconditional. Closed by this task.
- **docs/spec/ci-cd.md** — this task realigns workflows to the spec's lane model.

## Acceptance

- [ ] Agent can run `gh workflow run candidate-flight-app.yml -f pr_number=N` and it flies ONLY the app pod changes. No VM SSH. Completes in <2 min when digests already exist in GHCR.
- [ ] Agent can run `gh workflow run candidate-flight-infra.yml` and it rsyncs+redeploys compose from `main`. No app promotion.
- [ ] PR #879's failure mode (app PR branched before infra change) is impossible on the new levers — app flight never touches compose files.
- [ ] Merge to main → `promote-and-deploy.yml` still deploys both app and infra to preview, with the 5-job graph + lock-gate lease behavior byte-identical to today.
- [ ] `flight-infra.sh --dry-run` prints planned actions (rsync source, VM target, services) without SSH; exits 0.
- [ ] `flight-app.sh` drift guard: when VM `.tree-hash` ≠ main's `infra/compose/runtime/` hash, prints a loud warning naming the drift but does not hard-fail.
- [ ] `docs/spec/ci-cd.md` updated if it enumerates workflow filenames.
- [ ] task.0281 closed with supersede note.
- [ ] All references to `deploy-infra.sh` and `candidate-flight.yml` updated (callers audit complete).

## Design

### Outcome

An agent (or human) can flight an app-only PR to candidate-a in <2 min without touching the VM, and separately reconcile infra compose on the VM without touching any PR digests. Preview/prod promotion-on-merge still redeploys both. Eliminates the class of failure where an app PR ships stale compose config.

### Approach

**Leverage what already exists.** The monolith isn't actually monolithic — `candidate-flight.yml` already composes discrete scripts under `scripts/ci/` (`acquire-candidate-slot.sh`, `promote-k8s-image.sh`, `deploy-infra.sh`, `wait-for-argocd.sh`, `smoke-candidate.sh`, `release-candidate-slot.sh`). The only real refactor is (a) moving workflow-level step sequencing into two umbrella scripts, (b) making `deploy-infra.sh`'s rsync source parameterizable, (c) splitting the workflow file into two. **No new logic, no new OSS.**

**Rejected**: (1) Moving to reusable workflows with `workflow_call` — adds GHA chaining coupling, fights the "shell owns logic" principle. (2) Rewriting in TypeScript/Dagger — massive scope, blocked on task.0260 project decisions. (3) Keeping one workflow with conditional steps — leaves the "app flight pays infra cost" regression intact and still requires PR-checkout rsync.

### Architecture

```
┌─ scripts/ci/flight-app.sh ─────────────────────────┐
│  args: --pr N --env candidate-a|preview|production │
│  reads:  GHCR pr-N-SHA-* digests                   │
│  writes: deploy/{env} overlay commit               │
│  emits:  deploy_branch_sha, head_sha               │
│  calls:  acquire-candidate-slot (env==candidate-*) │
│          resolve-pr-build-images                   │
│          promote-k8s-image                         │
│          push to deploy/{env}                      │
│          reconcile-argocd-appset (via ssh)         │
│          wait-for-argocd                           │
│          verify-deployment (readyz SHA match)      │
│          release-candidate-slot (env==candidate-*) │
└────────────────────────────────────────────────────┘

┌─ scripts/ci/flight-infra.sh ───────────────────────┐
│  args: --env candidate-a|preview|production        │
│        --ref <git-ref> (default: main)             │
│        --dry-run (optional: print actions, no ssh) │
│  reads:  infra/compose/runtime/ @ ref              │
│  writes: VM:/opt/cogni-template-runtime/           │
│          VM:/opt/cogni-template-runtime/.tree-hash │
│  emits:  (none — compose healthchecks gate return) │
│  calls:  git worktree add <tmp> <ref>              │
│          rsync <tmp>/infra/compose/runtime/ → VM   │
│          write .tree-hash on VM (for drift guard)  │
│          scp + ssh deploy-infra-remote.sh          │
│          compose up + existing compose healthchecks│
└────────────────────────────────────────────────────┘
```

Both scripts are **independently runnable locally** (with the right secrets) and in GHA. Workflows are thin:

```yaml
# candidate-flight-app.yml        (replaces candidate-flight.yml)
on: workflow_dispatch: { inputs: { pr_number } }
steps:
  - checkout
  - secrets → env
  - bash scripts/ci/flight-app.sh --pr "${{ inputs.pr_number }}" --env candidate-a

# candidate-flight-infra.yml      (new)
on: workflow_dispatch: { inputs: { ref: { default: main } } }
steps:
  - checkout (ref: main, to get the script itself)
  - secrets → env
  - bash scripts/ci/flight-infra.sh --env candidate-a --ref "${{ inputs.ref || 'main' }}"
```

### How preview/prod promotion-on-merge still runs both

**Keep `promote-and-deploy.yml`'s 5-job graph intact.** The existing `promote-k8s` → `deploy-infra` → `verify` → `lock-preview-on-success` / `unlock-preview-on-failure` jobs use `needs:` + `if:` conditions over prior job status to drive the three-value lock-gate lease (task.0293). Collapsing these into one job would break per-job retry, per-job logs, and — critically — the `if: ${{ needs.promote-k8s.result == 'success' && ... }}` conditional structure that makes `lock-preview-on-success` fire only when both promote and deploy pass.

**What actually changes:** only the *contents* of the two existing jobs swap from inline step-blocks to single script calls. No job boundaries move. No outputs contract changes.

```yaml
# promote-and-deploy.yml (diff shape — job graph identical)
jobs:
  promote-k8s:          # unchanged structure
    outputs: { deploy_branch_sha, head_sha }   # unchanged
    steps:
      - checkout (ref: head_sha)
      - login GHCR
      - bash scripts/ci/flight-app.sh --phase promote-only --source-sha $SHA --env $ENV
        # ↑ replaces the inline digest-resolve + promote-k8s-image.sh + commit-push block

  deploy-infra:         # unchanged structure
    needs: promote-k8s  # unchanged
    if:   needs.promote-k8s.result == 'success'   # unchanged
    steps:
      - checkout (ref: main)   # ← was head_sha; now always main
      - bash scripts/ci/flight-infra.sh --env $ENV --ref main
        # ↑ replaces the inline rsync + SSH + deploy-infra-remote.sh block

  verify:                        # unchanged
  lock-preview-on-success:       # unchanged
  unlock-preview-on-failure:     # unchanged
```

`flight-app.sh --phase promote-only` omits the Argo wait + verify steps because `promote-and-deploy.yml` already has `verify` as a dedicated downstream job. The candidate-a workflow, by contrast, runs `flight-app.sh` without `--phase` and gets the full pipeline including its own verify.

This preserves the existing lease + lock-gate behavior from task.0293 completely. The merge→preview→release chain is byte-identical from the caller's POV.

### Locking model

Two independent locks, by design:

| Lever | Lock | Mechanism | Why |
|---|---|---|---|
| `flight-app.sh candidate-a` | digest slot | existing `infra/control/candidate-lease.json` on `deploy/candidate-a` (atomic commit push) | one PR owns the slot's deployed digest at a time |
| `flight-infra.sh *` | VM compose dir | GHA `concurrency: group: infra-${env}` (cancel-in-progress: false) | prevents overlapping rsync/compose up; VM-level state |
| `promote-and-deploy.yml` | env-level | existing `concurrency: group: promote-deploy-${env}` | unchanged from today |

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

**Callers audit (run first):** grep the repo for every reference to the files being renamed/deleted before starting. Known tree to check: `scripts/ci/deploy-infra.sh` is referenced by `scripts/ci/AGENTS.md`, `infra/compose/runtime/AGENTS.md`, multiple runbooks under `docs/runbooks/`, and both `candidate-flight.yml` + `promote-and-deploy.yml`. `candidate-flight.yml` is referenced by this skill (`.claude/skills/pr-coordinator-v0/`), `proj.cicd-services-gitops.md`, and several work items. Full grep needs to land in the PR description.

**Implementation order** (one PR, one merge, staged commits for reviewability):

1. **Extract `flight-infra.sh`** — take today's `deploy-infra.sh` as-is, rename, add `--ref` and `--dry-run` flags, replace `REPO_ROOT="$(git rev-parse --show-toplevel)"` with `git worktree add <tmp> <ref>` against a clean checkout. Preserve all current secret passthrough byte-for-byte. Write `.tree-hash` to VM after rsync. Delete `deploy-infra.sh`.
2. **Extract `flight-app.sh`** — new script that inlines the steps currently in `candidate-flight.yml` between "Resolve PR image digests" and "Release candidate slot after success" (~12 steps, most already scripts). Support `--phase promote-only` for the `promote-and-deploy.yml` caller. Implement drift guard preflight.
3. **Create `candidate-flight-app.yml` and `candidate-flight-infra.yml`** — both thin dispatchers.
4. **Rewire `promote-and-deploy.yml`** — swap only the step-contents of the existing `promote-k8s` + `deploy-infra` jobs. Job graph, `needs:`, `if:` conditions, outputs, and the lock-gate jobs all untouched.
5. **Delete `candidate-flight.yml`** (same commit as #3 to keep the branch dispatchable).
6. **Update every reference** found in the callers audit (AGENTS.md files, runbooks, skill metaprompt, project doc).

**Pre-merge validation** (required before the PR merges — addresses the chicken-and-egg of refactoring CI/CD with itself):

- Dispatch from the PR branch via `gh workflow run candidate-flight-app.yml --ref task/0314-decouple-infra-app-flighting -f pr_number=<throwaway-test-PR>`. Confirm: no SSH occurs, `/readyz` reports the test PR's SHA.
- Dispatch `gh workflow run candidate-flight-infra.yml --ref task/0314-...`. Confirm: no commits on `deploy/candidate-a`, VM compose matches `main`'s compose tree-hash.
- Dispatch `gh workflow run promote-and-deploy.yml --ref task/0314-... -f environment=preview -f source_sha=<recent-preview-SHA>`. Confirm: full 5-job graph fires, lock-gate transitions fire, preview `/readyz` at the expected SHA.
- Regression scenario: take any existing app-only PR branched before `fb8bd2232` (the #880 litellm-GHCR fix), rebase NOTHING, dispatch the new `candidate-flight-app.yml` against it — it must succeed. This is the exact failure that motivated the task.
- **Merge gate:** PR description must show those four runs green before merge approval.

**Post-merge cleanup:**

- Close `task.0281` with supersede note + link to this PR.
- Mark `proj.cicd-services-gitops` blockers #18 + #19 ✅ DONE.
- Update `docs/spec/ci-cd.md` if it enumerates workflow filenames (to verify: grep ci-cd.md for `candidate-flight.yml`).

No backwards-compat path — `candidate-flight.yml` is agent-triggered, not user-facing, and the only active caller (this skill) updates in the same branch.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **ARGO_OWNS_RECONCILIATION** — app flight writes deploy-branch state; Argo reconciles the pods. No SSH in the app lever. (spec: ci-cd.md §axioms)
- [ ] **NO_WORKFLOW_RUN_CHAINING** — every new/rewired workflow is directly `workflow_dispatch`-triggerable. No `on: workflow_run`. (spec: ci-cd.md §workflow-design-targets)
- [ ] **SCRIPT_OWNS_LOGIC** — non-trivial step sequencing lives in `scripts/ci/*.sh`. Workflows are secret-plumbing + single script invocation.
- [ ] **INFRA_REF_IS_EXPLICIT** — `flight-infra.sh` rsyncs from a specified git ref (default `main`), NEVER from the workflow's PR checkout. Eliminates R2.
- [ ] **LEVERS_ARE_INDEPENDENT** — app flight MUST work on a VM where `flight-infra.sh` has never run today; infra flight MUST work with no app promotion in the current lease.
- [ ] **MERGE_TO_MAIN_UNCHANGED** — `promote-and-deploy.yml`'s external contract (inputs, lease semantics, lock-gate) is byte-identical before and after; only internal step wiring changes. (spec: ci-cd.md §preview-review-lock, task.0293)
- [ ] **SIMPLE_SOLUTION** — no new OSS, no new runtimes. All existing scripts reused.
- [ ] **ARCHITECTURE_ALIGNMENT** — spec-aligns to ci-cd.md's already-written lane model.

### Desired End State

**Workflows an agent or human can dispatch:**

| Workflow | Purpose | Dispatches | Touches VM? | Touches Argo? |
|---|---|---|---|---|
| `candidate-flight-app.yml` | Fly a PR's app digests to candidate-a | `workflow_dispatch { pr_number }` | No | Yes |
| `candidate-flight-infra.yml` | Reconcile candidate-a VM compose from a git ref | `workflow_dispatch { ref (default: main) }` | Yes | No |
| `promote-and-deploy.yml` | Merge-triggered preview/prod promotion (unchanged 5-job graph) | `flight-preview.yml` → `workflow_dispatch` | Yes | Yes |
| `flight-preview.yml` | Merge-to-main → dispatch promote-and-deploy with lease | `push: main` | No directly | No directly |

**Scripts owning all non-trivial logic:**

| Script | Purpose | Callers |
|---|---|---|
| `scripts/ci/flight-app.sh` | Resolve digests → overlay commit → Argo reconcile → verify | `candidate-flight-app.yml`, `promote-and-deploy.yml` (via `--phase promote-only`) |
| `scripts/ci/flight-infra.sh` | `git worktree add <ref>` → rsync → SSH → compose up → tree-hash stamp | `candidate-flight-infra.yml`, `promote-and-deploy.yml` |

**Behaviors guaranteed:**

- App flights never SSH a VM. Infra flights never commit to a `deploy/*` branch. They are composable; they are never coupled.
- Infra rsync source is a named git ref (default `main`), never a PR checkout.
- Preview/prod merge-on-main behavior is byte-identical: same 5-job graph, same lease, same lock-gate transitions.
- An app PR branched before an infra change on main can be flown to candidate-a without rebasing — its stale compose file is never touched.
- Flight duration: app lever <2 min when GHCR digests exist; infra lever ~5 min.

### Files

**Create (new code):**

- `scripts/ci/flight-app.sh` — umbrella script for app lever, ~60 lines, composes existing scripts. Supports `--phase promote-only`.
- `scripts/ci/flight-infra.sh` — successor to `deploy-infra.sh` with `--ref` + `--dry-run` + `.tree-hash` stamp.
- `.github/workflows/candidate-flight-app.yml` — thin dispatcher for app lever.
- `.github/workflows/candidate-flight-infra.yml` — thin dispatcher for infra lever.

**Modify (rewire internals, preserve contracts):**

- `.github/workflows/promote-and-deploy.yml` — swap `promote-k8s` and `deploy-infra` job step-contents for script calls. Job graph, outputs, `needs:`, `if:`, lock-gate untouched.

**Delete:**

- `.github/workflows/candidate-flight.yml` — replaced by the two new candidate workflows.
- `scripts/ci/deploy-infra.sh` — replaced by `flight-infra.sh` (git history preserves).

**Work items:**

- `work/items/task.0281-canary-cicd-parity-staging-promotion.md` — set `status: done`, add supersede note → task.0314.
- `work/projects/proj.cicd-services-gitops.md` — mark blockers **#18** (PAT-dispatched workflow chain) and **#19** (deploy-infra unconditional) ✅ DONE; add a row in the completed-tasks section for task.0314.
- `work/items/_index.md` — regen.

### Documentation & Guides to Update

**Specs (contracts and invariants):**

- `docs/spec/ci-cd.md` — three surgical updates:
  1. Line ~82 (Minimum Authoritative Validation): `candidate-flight` → `candidate-flight-app` (clarify the app lever is the merge gate; infra lever is orthogonal).
  2. Line ~156 (Preview Review Lock transitions table): the `unlock-preview-on-failure` row cites `promote-k8s`, `deploy-infra`, `verify`, `e2e` — still accurate since job names don't change; re-verify after implementation.
  3. Workflow inventory (if one exists after this refactor — add if missing): enumerate the four workflows + two umbrella scripts + deletion list so future readers see the lane topology at a glance.

**Scorecards and planning:**

- `work/projects/proj.cicd-services-gitops.md` — Pipeline Health box (line ~26) currently says `build → promote → deploy-infra → verify → e2e → preview → release → production`. Update to reflect two-lever topology: `build → app-flight + infra-flight (independent) → verify → preview → release → production`. Move blockers #18 and #19 out of Active Blockers into a completed/supersedes reference.

**Agent skills (operational runbooks):**

- `.claude/skills/pr-coordinator-v0/SKILL.md` — four call-sites need updating:
  1. Line 77 (Dashboard authoritative sources): commit message format `candidate-flight: pr-<N> <sha>` — verify the new `flight-app.sh` preserves this commit subject, update if it changes.
  2. Line 113 (Flight step): `gh workflow run candidate-flight.yml` → `candidate-flight-app.yml`.
  3. Line 219 (Manual Deploy Escape Hatch): the "infra-only PR can't ride candidate-flight" gap is CLOSED by `candidate-flight-infra.yml`. Rewrite this subsection: "Infra-only PRs (no built images) now ride the infra lever directly — `gh workflow run candidate-flight-infra.yml -f ref=<PR branch>` once v1 adds per-ref support. For v0 (main-only), merge first and then dispatch infra lever from main." Remove the "manual cherry-pick to candidate-a" workaround.
  4. Line 245 (VM-state discipline references): `scripts/ci/deploy-infra.sh` → `scripts/ci/flight-infra.sh`.

**AGENTS.md files (sibling docs):**

- `scripts/ci/AGENTS.md` — rename references, add the two umbrella scripts and their composition pattern.
- `infra/compose/runtime/AGENTS.md` — update any pointer to `deploy-infra.sh` → `flight-infra.sh`.
- `.github/workflows/AGENTS.md` (if present) — update workflow inventory.

**Runbooks (grep pass required):**

- `docs/runbooks/*.md` — grep for `candidate-flight.yml`, `deploy-infra.sh`, `deploy-infra`; fix every hit.

**Callers audit** (runs as step 1 of Migration Plan above) — full grep:

```bash
rg -l "candidate-flight\.yml|deploy-infra\.sh|scripts/ci/deploy-infra" \
  --glob '!work/items/_index.md' \
  --glob '!.claude/worktrees/**'
```

Every file in that list must be handled in the same PR.

**Test coverage:** manual dispatch matrix (see Validation section) is the authoritative proof. No new unit/integration tests — the system under test is the workflow graph itself.

## Validation

**Pre-merge** (dispatched from the PR branch via `--ref task/0314-decouple-infra-app-flighting`; all four must be green before the PR merges):

1. **App lever isolation** — `candidate-flight-app.yml` against an app-only test PR completes in <2 min with zero SSH/compose activity in logs. `/readyz` on the affected node returns the PR head SHA.
2. **Infra lever isolation** — `candidate-flight-infra.yml` completes without touching `deploy/candidate-a` (no new commits on that branch); the VM's `/opt/cogni-template-runtime/docker-compose.yml` matches `main`'s tree-hash.
3. **Preview merge parity** — `promote-and-deploy.yml -f environment=preview -f source_sha=<recent-preview-SHA>` fires the full 5-job graph (`promote-k8s` → `deploy-infra` → `verify` → `lock-preview-on-success`), lock-gate transitions fire correctly.
4. **Regression proof** — replay PR #879's exact failure: take an app-only PR branched before `fb8bd2232` (pre-#880), do NOT rebase, dispatch the new `candidate-flight-app.yml` — it must succeed. Pre-refactor this would hard-fail at `deploy-infra`.

**Post-merge** (sanity check with real merge flow):

5. Merge any small PR to main; confirm the merge→preview chain fires end-to-end identically to today's behavior (no new failure modes, lock-gate writes correct SHAs).

## Attribution

- Surfaced by PR #879 flight failure loop on 2026-04-16.
