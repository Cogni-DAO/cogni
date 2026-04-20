---
id: task.0341
type: task
title: "verify-buildsha polling: close the pod-cutover race"
status: needs_closeout
priority: 1
rank: 1
estimate: 1
summary: "scripts/ci/verify-buildsha.sh does a single curl per node. When Argo's rollout cutover from old ReplicaSet → new pods takes >30s (common), the ingress routes the check to an old pod and the job fails. Add polling retry until cutover completes or timeout."
outcome: "verify-buildsha.sh polls /readyz up to 120s per node, passes on first SHA match. No more false-negative verify failures from cutover race. pr-coordinator no longer needs the 'known CI hotfix, ignoring' band-aid."
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
credit:
project: proj.observability-hardening
branch: fix/task-0341-verify-buildsha-polling
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-20
updated: 2026-04-20
labels: [ci-cd, incident-followup]
external_refs:
---

# verify-buildsha Polling — Close the Pod-Cutover Race

## Root Cause (verified 2026-04-20)

`scripts/ci/verify-buildsha.sh` lines 118–144 curl each node's `/readyz` **exactly once** and compares `.version` to the expected SHA. No retry. No polling.

The Argo rollout cutover from old ReplicaSet → new pods takes seconds to minutes. During that window:

- `wait-for-argocd.sh` has reported Healthy (Argo thinks it's done).
- `wait-for-candidate-ready.sh` has passed (any 200 on `/readyz` qualifies, including from old pods).
- The ingress Service endpoints still route some fraction of requests to the old pod.
- verify-buildsha's single curl hits the old pod and fails.

Observed on run `24688848719` (PR #934, 2026-04-20T20:35:47Z):

```
operator: ✅ 089142bbe601
poly:     ❌ 2af4cabbd798 (OLD)  — expected 089142bbe601
resy:     ✅ 089142bbe601
```

18 minutes later the same URL served the correct SHA. Not a bug in the overlay, promote, or Argo — a bug in the **test**.

## Why earlier fixes didn't catch this

- #917 (bug.0321) — added the source-SHA map. Solved "silent green", didn't add polling.
- #937 (bug.0331) — "wait for endpoint cutover after rollout". Landed in `wait-for-candidate-ready.sh` which only checks for 200. Didn't add SHA polling.
- #942 — "strict equality + id collision". Cosmetic.

## Design

### Contract

Add `CUTOVER_TIMEOUT` (default **90s** — covers normal pod startup + ingress endpoint propagation; anything longer is a real deploy issue, not a cutover race, and SHOULD fail loudly) and `CUTOVER_SLEEP` (default 5s) env vars. Per-node check becomes:

```bash
check_node() {
  local node="$1" expected="$2" url="$3"
  local deadline=$(( SECONDS + CUTOVER_TIMEOUT ))  # default 90s — NOT blindly polling for rollouts; real pathologies fail fast
  local actual=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    body=$(curl -sk --max-time 10 "$url" || echo "")
    actual=$(echo "$body" | python3 -c 'import json,sys;print(json.loads(sys.stdin.read()).get("version",""))' 2>/dev/null || echo "")
    actual=$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')
    if [ "$actual" = "$expected" ]; then
      echo "  ✅ ${node}: version=${actual:0:12} matches expected ${expected:0:12}"
      return 0
    fi
    sleep "$CUTOVER_SLEEP"
  done
  echo "  ❌ ${node}: last version=${actual:0:12} != expected ${expected:0:12} after ${CUTOVER_TIMEOUT}s"
  return 1
}
```

### Invariants

- `VERIFY_BUILDSHA_POLLING`: verify-buildsha.sh MUST retry until `/readyz.version == expected` OR CUTOVER_TIMEOUT elapsed. Never a single-shot failure.
- `BACKWARDS_COMPAT_READYZ_VERSION`: Continue reading `.version` field (task.0337 will add `.buildSha` alongside). Do not change the field name in this task.
- `TIMEOUT_IS_BOUNDED`: CUTOVER_TIMEOUT must have a sensible default (120s) so CI doesn't hang forever on an actually-broken deploy.

## Plan

- [ ] **Checkpoint 1** — polling loop
  - Milestone: verify-buildsha.sh retries per-node until SHA match or timeout.
  - Invariants: VERIFY_BUILDSHA_POLLING, TIMEOUT_IS_BOUNDED, BACKWARDS_COMPAT_READYZ_VERSION
  - Todos:
    - [ ] Add `CUTOVER_TIMEOUT` / `CUTOVER_SLEEP` env vars to header docs in `scripts/ci/verify-buildsha.sh`
    - [ ] Extract per-node check into `check_node()` function with polling loop
    - [ ] Replace the existing one-shot per-node block (lines 118-144) with calls to `check_node`
  - Validation/Testing:
    - [ ] unit: `bash scripts/ci/tests/verify-buildsha.test.sh` — new shell test with stubbed curl (fails first 2 attempts, returns expected on 3rd — must pass)
    - [ ] unit: same test with curl always returning wrong SHA — must fail after TIMEOUT
    - [ ] `pnpm check`

## Validation

- exercise:
  - `bash scripts/ci/tests/verify-buildsha.test.sh`
  - Flight a PR to candidate-a (post-merge); verify-candidate passes without manual lease reset.
- acceptance:
  - Test covers both "retries succeed" and "timeout fails" paths.
  - Next flight after merge: verify-candidate goes green; coordinator no longer needs to manually reset the lease.

## Non-Goals

- Renaming `.version` → `.buildSha` on readyz contract — task.0337.
- Changing flight workflow YAML — task.0339.
- Pr-coordinator skill updates — task.0340.
- Argo sync flakiness investigation — deferred; earlier "OutOfSync false negatives" were a different symptom of the same rollout-in-progress window and should disappear with this fix; if they persist, file a follow-up.
