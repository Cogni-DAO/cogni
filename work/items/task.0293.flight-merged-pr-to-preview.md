---
id: task.0293
type: task
title: "Flight merged-PR digests to preview with lock-gate"
status: needs_implement
revision: 1
priority: 0
rank: 2
estimate: 3
summary: "Canary is dead. Merge-to-main has no live preview promotion lane — promote-merged-pr.yml still dispatches env=canary and promote-to-preview.sh still polls a ci.yaml canary run that no longer exists. Replace with a main→preview flighting workflow that reuses the lock-gate script, fixes its dead-lock-on-failure hole, and adopts a high-water-mark candidate-sha model."
outcome: |
  1. On merge to main, the PR's `preview-{sha}` digest flights to preview iff preview is unlocked; otherwise the SHA updates `candidate-sha` and waits. Also manually callable by SHA via `workflow_dispatch`.
  2. `candidate-sha` is always the most recent successfully built merge-to-main SHA (high-water mark), independent of lock state. `current-sha` is always what's actually deployed to preview. They diverge iff preview is locked for review.
  3. A failed preview deploy auto-unlocks preview. No deploy failure can wedge the lane.
  4. Concurrent merges cannot both dispatch: review-state uses a three-value model `unlocked | dispatching | reviewing` with a pre-dispatch lease, plus a GitHub Actions concurrency group on the flight workflow as belt-and-suspenders.
  5. Zero canary references remain in the post-merge path.
spec_refs: [ci-cd-spec]
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: feat/task-0293-flight-merged-pr-to-preview
pr_url:
created: 2026-04-05
updated: 2026-04-14
labels: [ci-cd, deploy, flight]
---

# Flight merged-PR digests to preview with lock-gate

## Prerequisite: hotfix current preview outage (do first, in parallel)

Preview is wedged right now for reasons orthogonal to the flighting logic rewrite: the preview cluster's child Argo Applications appear to be missing `syncPolicy.automated`, so overlay digest changes on `deploy/preview` since April 8 have not rolled pods. This task **cannot be used as the fix for the current outage** — it changes CI orchestration, not cluster state, and `.promote-state/` is never read by Argo.

These checkboxes run before or alongside task.0293 implementation:

- [ ] SSH readonly to preview VM (key from `docs/guides/multi-node-deploy.md` env secrets) and run:
      `kubectl -n argocd get applicationset preview-nodes -o yaml | grep -A10 syncPolicy`
      `kubectl -n argocd get application preview-operator -o yaml | grep -A5 'syncPolicy:'`
      Confirm whether `automated: {prune: true, selfHeal: true}` is present on the child Applications.
- [ ] If `automated` is missing, re-apply the ArgoCD bootstrap from the current main:
      `kubectl kustomize infra/k8s/argocd/ | kubectl apply -n argocd -f -`
      (The ApplicationSet template gained `selfHeal: true` in PR #790 after the preview VM was bootstrapped.)
- [ ] Verify pods roll to the digests already on `deploy/preview` commit `defde50ca` (operator `4fe492b8…`, poly `9350b3fd…`, resy `fa560a62…`, sw `6ecc85be…`):
      `kubectl -n cogni-preview get pods -o wide`
      `curl -sk https://preview.cognidao.org/version` (or whichever endpoint exposes SHA)
- [ ] Capture whatever manual `kubectl apply` was needed into `scripts/setup/provision-test-vm.sh` so a reprovisioned preview VM reinstalls the modern ApplicationSet automatically. No one-off SSH state.
- [ ] Capture the fix in a bug work item (new ID) so the diagnosis + remediation is linked from this project scorecard.
- [ ] Only after pods on `deploy/preview` reach the April 13 digests (PR #845) does the task.0293 rewrite become implementable against a known-good baseline.

If reapplying the bootstrap does not fix it, the next-probe is Argo controller logs in the `argocd` namespace — those are currently not scraped to Loki; SSH-tail them directly. File any further findings against the same bug.

## Context

The merge-to-main flighting lane is broken and the machinery that replaced the canary lane has four known structural bugs that will wedge preview the first time they're exercised under agent-cadence merges.

Three things have shifted since task.0293 was first written:

1. `canary` is dead as a code branch and as an environment — feat/fix/chore PRs target `main` directly, and `ci-cd.md` now forbids canary semantics.
2. Pre-merge safety moved to `candidate-a` (task.0297, `candidate-flight.yml`). The PR merge itself is the authoritative CI gate.
3. `promote-merged-pr.yml` still fires on `push: main`, re-tags `pr-{N}-{sha} → preview-{sha}` in GHCR, then dispatches `promote-and-deploy` with `environment=canary` — which goes nowhere useful. `promote-to-preview.sh` still polls `gh run list --branch=canary --workflow=ci.yaml` for a CI run that no longer exists.

The structural bugs the rewrite must fix (these are all in the existing code, not newly introduced):

| #   | Bug                                                                                                                                                                                                                                             | Consequence                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `promote-to-preview.sh` writes `review-state=reviewing` **before** the dispatched `promote-and-deploy` run completes                                                                                                                            | If the deploy fails, preview is locked forever. Nobody cuts a release on a broken deploy, so the unlock-on-release path never fires. This is how the lane wedges. |
| B2  | Lock check is TOCTOU: `git show` → `git clone` → `git commit+push` with no atomic check-and-set                                                                                                                                                 | Concurrent merges race; second push fails the workflow loudly. Tolerable under single-human canary cadence, flappy under agent direct-to-main cadence.            |
| B3  | `candidate-sha` is written only when locked, and is single-slot last-writer-wins with no explicit contract                                                                                                                                      | Under the locked-queue model a hotfix can get silently dropped behind a later merge.                                                                              |
| B4  | Fallback path for direct-push-to-main dispatches `build-multi-node.yml` (`workflow_dispatch` only), which fires `promote-and-deploy workflow_run` with `head_branch=main`, which maps to `env=canary` (lines 62-65 of `promote-and-deploy.yml`) | Direct pushes land in a dead env on a dead deploy branch. Silent.                                                                                                 |

## New model

**`candidate-sha` is a high-water mark.** It is always the most recent successfully built merge-to-main SHA. It is written on **every** merge-to-main flight, regardless of lock state.

**`current-sha` is what's actually deployed to preview.** It is written **only after** a preview deploy reaches the E2E success step. Diverges from `candidate-sha` iff preview is locked.

**`review-state`** is one of `unlocked | dispatching | reviewing`. The third value is a **pre-dispatch lease** added specifically to close the race where two merges both read `unlocked` in quick succession:

- `unlocked`: no flight in progress, OK to claim the slot.
- `dispatching`: a flight has been dispatched but has not yet reached E2E success. Subsequent merges must queue, not dispatch.
- `reviewing`: the last dispatched flight reached E2E success; a human review is pending before release.

Both `dispatching` and `reviewing` are "locked" from the flight script's perspective — it updates `candidate-sha` and exits without dispatching.

Transitions:

- `unlocked → dispatching`: written atomically by `promote-to-preview.sh` in the same commit-and-push that sets `candidate-sha`, before calling `gh workflow run promote-and-deploy.yml`.
- `dispatching → reviewing`: written by a new `lock-preview-on-success` job in `promote-and-deploy.yml` after `e2e` passes. Writes `current-sha` in the same commit.
- `dispatching → unlocked`: written by a new `unlock-preview-on-failure` job in `promote-and-deploy.yml` if any of `deploy-infra`/`verify`/`e2e` fail. `current-sha` is not touched.
- `reviewing → unlocked`: written by the existing `auto-merge-release-prs.yml` step on release PR merge.

On transition to `unlocked` by the release-merge path, if `candidate-sha != current-sha`, dispatch a fresh flight with `sha=candidate-sha`. This drains the queue without waiting for an unrelated merge event.

**Concurrency guard (belt-and-suspenders):** `flight-merged-pr-to-preview.yml` uses `concurrency: { group: flight-preview, cancel-in-progress: false }` so at most one script run enters the `unlocked → dispatching` transition at a time. The three-value lease is what actually enforces correctness; the concurrency group reduces push-retry churn under bursty merges.

### State diagram

```
merge to main (build succeeded)
    │
    ▼
  [flight-preview concurrency group serializes here]
    │
    ▼
  clone deploy/preview; write candidate-sha = SHA (ALWAYS)
    │
    ▼
  re-read review-state AFTER rebase (inside push_with_retry)
    ├── reviewing    → commit candidate-sha, push_with_retry, exit
    ├── dispatching  → commit candidate-sha, push_with_retry, exit
    └── unlocked     → write review-state=dispatching (same commit as candidate-sha)
                       push_with_retry
                         │
                         ▼
                       gh workflow run promote-and-deploy env=preview source_sha=SHA
                         │
                         ▼
                       promote-k8s → deploy-infra → verify → e2e
                         │                                    │
                         │                                    │
                       failure                             success
                         │                                    │
                         ▼                                    ▼
                     unlock-preview-on-failure:       lock-preview-on-success:
                     review-state = unlocked          write current-sha = SHA
                     current-sha untouched            review-state = reviewing
                     candidate-sha retained           candidate-sha untouched

release PR merge (existing flow)
    │
    ▼
  write review-state = unlocked
    │
    ▼
  read candidate-sha, current-sha
    └── if differ → dispatch flight-merged-pr-to-preview sha=<candidate-sha>
```

## Reuse map

| Piece                                                                         | Reuse as-is | Change                                                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/ci/promote-to-preview.sh` lock-gate                                  | partial     | drop canary CI pre-check; make candidate-sha unconditional; remove reviewing-write; add push-retry loop                                                                                      |
| `promote-and-deploy.yml workflow_dispatch(environment=preview)`               | yes         | add post-E2E "lock preview" step; add on-failure "unlock preview" step                                                                                                                       |
| `promote-merged-pr.yml` re-tag logic                                          | yes         | rename workflow, add `workflow_dispatch`, swap PR-parse for `gh api commits/{sha}/pulls`, add SHA ancestor check on dispatch path, replace canary dispatch with `promote-to-preview.sh` call |
| `auto-merge-release-prs.yml` unlock step                                      | partial     | after writing `unlocked`, read `candidate-sha` and dispatch flight if it differs from `current-sha`                                                                                          |
| `create-release.sh` reading `current-sha`                                     | yes         | —                                                                                                                                                                                            |
| legacy `promote-to-preview` job in `promote-and-deploy.yml` (lines 508-530)   | no          | delete                                                                                                                                                                                       |
| legacy `main→canary` branch-mapping in `promote-and-deploy.yml` (lines 62-65) | no          | delete the `main)` arm; the `workflow_run` trigger becomes dispatch-only for preview and we stop pretending direct-push-to-main is a supported flight trigger                                |
| legacy `promote-to-preview` job in `e2e.yml` (lines 97-120)                   | no          | delete                                                                                                                                                                                       |

## Changes

### 1. `scripts/ci/promote-to-preview.sh` — rewrite logic, shrink it

Delete the entire canary CI pre-check block (current lines 25-45). The PR merge gate is now authoritative; no external CI polling.

New body (pseudocode — preserve direct-commit mechanics, bash style):

```bash
SHA, REPO, DEPLOY_BRANCH, GH_TOKEN = args

clone --depth=1 DEPLOY_BRANCH

# Always update candidate-sha (high-water mark)
write .promote-state/candidate-sha = SHA

# Read review-state AFTER writing candidate-sha but BEFORE committing, so the decision
# and the state transition go in the same commit. push_with_retry will re-read on rebase.
REVIEW_STATE = read .promote-state/review-state (default unlocked)

if REVIEW_STATE == "reviewing" or REVIEW_STATE == "dispatching":
  commit "promote-state: queue candidate ${SHA:0:8} (preview ${REVIEW_STATE})"
  push_with_retry --reread-lease  # see below
  exit 0

# unlocked path — claim the lease atomically with candidate-sha update
write .promote-state/review-state = "dispatching"
commit "promote-state: dispatch ${SHA:0:8} to preview (lease claimed)"
push_with_retry --reread-lease

gh workflow run promote-and-deploy.yml \
  --repo "$REPO" \
  --ref main \
  -f environment=preview \
  -f source_sha="$SHA"
```

Critical: **this script does NOT write `current-sha`, and it only writes `review-state=dispatching` (never `reviewing`)**. The `dispatching → reviewing` transition moves to `promote-and-deploy.yml` (Change 2). `dispatching` is the pre-dispatch lease that prevents the double-dispatch race identified in review.

`push_with_retry --reread-lease` (addresses B2 and closes the validation-case-11 race):

```bash
# After a rebase, re-read review-state from the rebased tree. If another worker
# already claimed the lease (unlocked → dispatching) while we were mid-push, we
# MUST NOT also claim it. Demote our pending commit to the queue-only path
# (candidate-sha update, no lease claim, no dispatch).
push_with_retry() {
  local max=5
  local reread_lease=0
  if [ "${1:-}" = "--reread-lease" ]; then reread_lease=1; fi

  for i in $(seq 1 $max); do
    if git push origin "HEAD:${DEPLOY_BRANCH}"; then return 0; fi
    echo "push conflict (attempt $i/$max), rebasing..."
    git fetch origin "$DEPLOY_BRANCH"

    # Soft-reset our working commit, pull the new tip, re-apply only the fields
    # we are responsible for (candidate-sha always; review-state conditionally).
    git reset --soft "origin/$DEPLOY_BRANCH"

    if [ "$reread_lease" = "1" ]; then
      local current_state
      current_state=$(cat .promote-state/review-state 2>/dev/null || echo unlocked)
      if [ "$current_state" != "unlocked" ]; then
        # Someone else claimed the lease. Drop our dispatching intent; keep
        # candidate-sha update only. Signal caller to skip the dispatch step.
        echo "$SHA" > .promote-state/candidate-sha
        git add .promote-state/candidate-sha
        git commit --amend -m "promote-state: queue candidate ${SHA:0:8} (lost lease race to $current_state)"
        export FLIGHT_LEASE_LOST=1
      else
        # Still unlocked; re-apply our lease claim on the new tip
        echo "$SHA" > .promote-state/candidate-sha
        echo "dispatching" > .promote-state/review-state
        git add .promote-state/
        git commit --amend -m "promote-state: dispatch ${SHA:0:8} to preview (lease claimed)"
      fi
    else
      # Queue-only path: just re-apply the candidate-sha update
      echo "$SHA" > .promote-state/candidate-sha
      git add .promote-state/candidate-sha
      git commit --amend -m "promote-state: queue candidate ${SHA:0:8}"
    fi
  done
  echo "❌ push_with_retry exhausted $max attempts"
  return 1
}
```

The caller must check `$FLIGHT_LEASE_LOST` after `push_with_retry` and skip the `gh workflow run promote-and-deploy.yml` dispatch if it is set. This is the real serialization guarantee: even if the GitHub Actions concurrency group leaks (restart, manual dispatch, etc.), only one worker can commit `review-state=dispatching` per git-tip generation, and losers deterministically demote to queue-only.

### 2. `.github/workflows/promote-and-deploy.yml` — promote-to-reviewing on success, unlock-on-failure, kill canary mapping

**Delete the `main)` arm of the `case "$BRANCH"` block** (current lines 62-65). The `workflow_run` trigger stays — but it no longer auto-routes anything since `build-multi-node.yml` is dispatch-only now. If the `workflow_run` path fires with an unknown branch, fail loudly.

**Delete the legacy `promote-to-preview` job** (current lines 508-530). Its canary gate is dead.

**Add a new job after `e2e`** — promotes the lease from `dispatching → reviewing` and writes `current-sha`. Runs only when `environment=preview` and e2e succeeds:

```yaml
lock-preview-on-success:
  runs-on: ubuntu-latest
  needs: [promote-k8s, e2e]
  if: |
    needs.promote-k8s.outputs.environment == 'preview' &&
    needs.e2e.result == 'success'
  steps:
    - name: Transition dispatching → reviewing and write current-sha
      env:
        GH_TOKEN: ${{ secrets.ACTIONS_AUTOMATION_BOT_PAT }}
        HEAD_SHA: ${{ needs.promote-k8s.outputs.head_sha }}
      run: bash scripts/ci/set-preview-review-state.sh reviewing "$HEAD_SHA"
```

**Add a second new job** — unwinds the lease on any failure. Runs only when `environment=preview` and any deploy/verify/e2e job failed:

```yaml
unlock-preview-on-failure:
  runs-on: ubuntu-latest
  needs: [promote-k8s, deploy-infra, verify, e2e]
  if: |
    always() &&
    needs.promote-k8s.outputs.environment == 'preview' &&
    (needs.deploy-infra.result == 'failure' ||
     needs.verify.result == 'failure' ||
     needs.e2e.result == 'failure')
  steps:
    - name: Unlock preview after failure
      env:
        GH_TOKEN: ${{ secrets.ACTIONS_AUTOMATION_BOT_PAT }}
      run: bash scripts/ci/set-preview-review-state.sh unlocked ""
```

Introduce a tiny new shared helper `scripts/ci/set-preview-review-state.sh` that takes `<target-state> [sha]` and encapsulates clone + write + push_with_retry so the same retry logic runs everywhere. Valid target states: `dispatching`, `reviewing`, `unlocked`. Writes `current-sha` only on `reviewing`. Less than 80 lines.

**Guard against stuck `dispatching`:** if the helper is asked to transition to `reviewing` or `unlocked` and finds the current review-state is already the target, it is a no-op (idempotent). If it finds an unexpected state (e.g., `reviewing` when it expected to transition from `dispatching`), it logs the mismatch but still writes the target state — the caller's causal context (the CI job that ran to completion) is more authoritative than whatever state the file holds.

### 3. Rename `promote-merged-pr.yml` → `flight-merged-pr-to-preview.yml`

```yaml
name: Flight Merged PR to Preview
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      sha:
        description: "Merged commit SHA (must be reachable from main)"
        required: true
        type: string

# Serialize entry to the unlocked → dispatching transition. Two merges landing
# within seconds will run back-to-back, not in parallel. The three-value lease
# in the script is the correctness guarantee; this concurrency group just
# reduces push-retry churn.
concurrency:
  group: flight-preview
  cancel-in-progress: false
```

Replace the PR-number parse (addresses C1):

```bash
if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
  HEAD_SHA="${{ inputs.sha }}"
  # C2: reject SHAs not on main
  git fetch origin main
  if ! git merge-base --is-ancestor "$HEAD_SHA" origin/main; then
    echo "❌ SHA $HEAD_SHA is not reachable from main — refusing to flight"
    exit 1
  fi
  PR_NUMBER=$(gh api "repos/${{ github.repository }}/commits/${HEAD_SHA}/pulls" --jq '.[0].number // empty')
else
  HEAD_SHA="${{ github.sha }}"
  PR_NUMBER=$(gh api "repos/${{ github.repository }}/commits/${HEAD_SHA}/pulls" --jq '.[0].number // empty')
fi

if [ -z "$PR_NUMBER" ]; then
  echo "No PR associated with $HEAD_SHA — direct push to main is not a supported flight trigger"
  exit 0
fi
```

**Kill the `build-multi-node` fallback entirely.** Direct pushes to main are not a supported flight trigger (addresses B4). Documented in the echo message above.

Replace the `gh workflow run promote-and-deploy.yml -f environment=canary` block with:

```yaml
- name: Flight to preview (lock-gate aware)
  env:
    GH_TOKEN: ${{ secrets.ACTIONS_AUTOMATION_BOT_PAT }}
  run: |
    scripts/ci/promote-to-preview.sh \
      "${{ steps.pr.outputs.head_sha }}" \
      "${{ github.repository }}" \
      "deploy/preview" \
      "$GH_TOKEN"
```

### 4. `auto-merge-release-prs.yml` — drain the queue on unlock (addresses C3)

After the existing "Unlock preview for next candidate" step writes `review-state=unlocked`, add:

```yaml
- name: Drain candidate-sha if it differs from current-sha
  if: steps.merge.outcome == 'success'
  env:
    GH_TOKEN: ${{ secrets.ACTIONS_AUTOMATION_BOT_PAT }}
  run: |
    DEPLOY_BRANCH="deploy/preview"
    CURRENT=$(git show "origin/${DEPLOY_BRANCH}:.promote-state/current-sha" 2>/dev/null || echo "")
    CANDIDATE=$(git show "origin/${DEPLOY_BRANCH}:.promote-state/candidate-sha" 2>/dev/null || echo "")
    if [ -n "$CANDIDATE" ] && [ "$CANDIDATE" != "$CURRENT" ]; then
      echo "Draining queued candidate ${CANDIDATE:0:8}"
      gh workflow run flight-merged-pr-to-preview.yml \
        --repo "${{ github.repository }}" \
        --ref main \
        -f sha="$CANDIDATE"
    else
      echo "No drain needed (candidate == current or empty)"
    fi
```

### 5. Delete legacy `promote-to-preview` job in `e2e.yml`

`.github/workflows/e2e.yml` — remove the `promote-to-preview` job (lines 97-120) and narrow the `workflow_run.branches` filter. If that leaves the file with only dead paths, delete the file entirely — E2E already runs inline in `promote-and-deploy.yml`.

### 6. `docs/spec/ci-cd.md` — document the Preview Review Lock (addresses C4)

Add a short section under "Environment Model" describing:

- `current-sha` / `candidate-sha` / `review-state` contract
- lock-on-deploy-success, unlock-on-deploy-failure, unlock-on-release-merge
- "latest-wins" policy: `candidate-sha` is a high-water mark, not a FIFO queue
- direct-push-to-main is not a supported flight trigger

Four short paragraphs. No new invariants beyond what this task establishes.

## Validation

| #   | Scenario                                                                                                                                                                                                                                                                                                                                                                                           | Expected                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Merge PR to main, preview unlocked                                                                                                                                                                                                                                                                                                                                                                 | re-tag → `candidate-sha=SHA` → dispatch promote-and-deploy → verify + e2e pass → `current-sha=SHA`, `review-state=reviewing`, pods rolling new digest                                                                                                                       |
| 2   | Merge PR to main, preview locked (`reviewing` or `dispatching`)                                                                                                                                                                                                                                                                                                                                    | `candidate-sha=SHA`, no dispatch, `current-sha` unchanged                                                                                                                                                                                                                   |
| 3   | Merge 3 PRs back-to-back while locked                                                                                                                                                                                                                                                                                                                                                              | `candidate-sha` equals the 3rd SHA (latest-wins)                                                                                                                                                                                                                            |
| 4   | Release PR merges while a different SHA is queued                                                                                                                                                                                                                                                                                                                                                  | `review-state=unlocked` then drain step fires → flight dispatched for `candidate-sha` → lease claimed → e2e success → `current-sha` = drained value, `review-state=reviewing`                                                                                               |
| 5   | Release PR merges with `candidate-sha == current-sha`                                                                                                                                                                                                                                                                                                                                              | unlock only, no drain dispatch                                                                                                                                                                                                                                              |
| 6   | `promote-and-deploy env=preview` fails at `verify`                                                                                                                                                                                                                                                                                                                                                 | unlock-on-failure fires → `review-state: dispatching → unlocked`, `current-sha` unchanged, `candidate-sha` retained — next merge or manual dispatch retries cleanly                                                                                                         |
| 7   | `promote-and-deploy env=preview` fails at `e2e`                                                                                                                                                                                                                                                                                                                                                    | same as 6                                                                                                                                                                                                                                                                   |
| 8   | Manual dispatch: `gh workflow run flight-merged-pr-to-preview.yml -f sha=<main-sha>`                                                                                                                                                                                                                                                                                                               | behaves identically to case 1 or 2 depending on lock                                                                                                                                                                                                                        |
| 9   | Manual dispatch with a SHA not on main                                                                                                                                                                                                                                                                                                                                                             | workflow fails at ancestor check with clear message                                                                                                                                                                                                                         |
| 10  | Manual dispatch with a SHA that has no associated PR                                                                                                                                                                                                                                                                                                                                               | skip with `exit 0`, no candidate-sha update                                                                                                                                                                                                                                 |
| 11  | **Two PRs merge within 2 seconds, both hit unlocked.** GH concurrency group serializes them so worker A runs first and commits `candidate-sha=A, review-state=dispatching`, dispatches promote-and-deploy. Worker B then runs, reads `dispatching`, writes `candidate-sha=B` only, does not dispatch.                                                                                              | Exactly one flight dispatched (for A). B is queued. `current-sha` will become A after e2e success; B drains on next unlock.                                                                                                                                                 |
| 12  | **Concurrency group leak (e.g., force-dispatched twice).** Two workers enter the script in parallel, both read `unlocked`, both build a commit setting `review-state=dispatching`. Worker A pushes first. Worker B's push is rejected; its `push_with_retry --reread-lease` rebases, sees `dispatching` already set, demotes its commit to queue-only, sets `FLIGHT_LEASE_LOST=1`, skips dispatch. | Still exactly one flight dispatched. The three-value lease guarantees safety even if the GH concurrency group is bypassed.                                                                                                                                                  |
| 13  | Workflow cancelled mid-`dispatching` (e.g., run cancelled before `lock-preview-on-success` or `unlock-preview-on-failure` runs)                                                                                                                                                                                                                                                                    | Preview is stuck in `dispatching`. Recovery: manual edit of `.promote-state/review-state` on `deploy/preview`, OR the next merge-to-main will still correctly queue (it reads `dispatching` as locked). A human must unlock eventually. Flagged as a known follow-up below. |

## Review Feedback (revision 1 — 2026-04-14)

### Blocking

- [ ] **`unlock-preview-on-failure` misses `promote-k8s` failure** (`.github/workflows/promote-and-deploy.yml:536-544`).
      If the `promote-k8s` job fails (overlay push, digest resolution, rsync, etc.), `deploy-infra` / `verify` / `e2e` all evaluate to `skipped`, not `failure`. Under the current `if`, the unlock job does not fire. Preview is left in `dispatching`. This is the exact dead-lock failure mode B1 was chartered to eliminate, just at a different step.
      Fix: add `needs.promote-k8s.result == 'failure'` to the guard:
      `yaml
  if: |
    always() &&
    needs.promote-k8s.outputs.environment == 'preview' &&
    (needs.promote-k8s.result == 'failure' ||
     needs.deploy-infra.result == 'failure' ||
     needs.verify.result == 'failure' ||
     needs.e2e.result == 'failure')
  `
      Note: if `promote-k8s` fails before the `Determine environment` step emits outputs, the guard's `needs.promote-k8s.outputs.environment == 'preview'` is empty and the job still skips. That's a narrower catastrophic case; acceptable for v0 but document in the spec as "manual unlock required" if it happens.
- [ ] **Update `docs/spec/ci-cd.md:156`** to match: the transition row "`dispatching → unlocked`" must list `promote-k8s` alongside `deploy-infra`, `verify`, `e2e`.

### Non-blocking (optional — decide in this pass)

- [ ] **Purge remaining canary references from `promote-and-deploy.yml`** to satisfy outcome #5:
  - `L18` description text mentions canary
  - `L20` `default: canary` → `default: preview`
  - `L22` `options: [canary, preview, production]` → `[preview, production]` (or keep canary with description noting it's a manual-only safety valve)
  - `L44` `|| 'canary'` fallback in concurrency group key
  - `L70` `canary) OVERLAY=canary; DEPLOY_BRANCH=deploy/canary ;;` arm of the case statement
  - `L10-14` `on.workflow_run.workflows: ["Build Multi-Node"]` — nothing dispatches build-multi-node anymore; trigger is dead
- [ ] **Transitional checkout bug in `auto-merge-release-prs.yml`** — the unlock + drain steps rely on `scripts/ci/set-preview-review-state.sh` existing at the PR head. Release PRs cut from `deploy/preview` before task.0293 merges won't have that script. Pin the unlock+drain steps to `main`:
      `yaml
  - name: Checkout main (for scripts)
    if: steps.merge.outcome == 'success'
    uses: actions/checkout@v4
    with:
    ref: main
    path: main-src
    `  Then run`bash main-src/scripts/ci/set-preview-review-state.sh ...`.
- [ ] **`flight-merged-pr-to-preview.yml` fetch-depth** — `fetch-depth: 0` at L46 is full-history, used only for the dispatch ancestor check. Change to `fetch-depth: 1` and rely on the inline `git fetch origin main --depth=100` at L61.
- [ ] **`promote-to-preview.sh` L54-55** — unused `REVIEW_STATE` read; remove or repurpose.
- [ ] **`set-preview-review-state.sh` L64, L66** — use `::warning::` annotation instead of plain echo for unexpected-transition warnings so they surface on the job summary.
- [ ] **Drain on unlock-on-failure (symmetry)** — `unlock-preview-on-failure` could drain a queued `candidate-sha` the same way `auto-merge-release-prs.yml` does. Current asymmetry leaves queued SHAs stranded until a human or another merge intervenes. Low severity; could be a follow-up.

## Known follow-ups not in this task

- **Preview ApplicationSet staleness on the live cluster** — promoted out of this list and into the "Prerequisite: hotfix current preview outage" section at the top of this task. It must be fixed before or alongside implementation, not after.
- **Dispatching-state TTL / stuck-lease recovery** — if a workflow is cancelled between `dispatching` and either terminal state, preview stays locked. V0 remediation is manual: edit `.promote-state/review-state` on `deploy/preview` back to `unlocked`. A better fix is a small "stale-lease janitor" workflow on a cron schedule that reads the `dispatching`-written commit timestamp and auto-unlocks after N minutes. File as a follow-up bug once we observe it happening.
- **Manual unlock workflow** — same story as the janitor; if direct-edit-on-branch proves painful, add a `workflow_dispatch` unlock action. Not now.
- **candidate-sha FIFO** — if "latest-wins" drops too many hotfixes in practice, revisit to append + dedup. Not now.
