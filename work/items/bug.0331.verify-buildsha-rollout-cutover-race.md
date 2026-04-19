---
id: bug.0331
type: bug
title: verify-buildsha races with rolling-update endpoint cutover, false-fails on freshly-rolled deployments
status: needs_review
priority: 1
rank: 30
estimate: 1
summary: After `wait-for-in-cluster-services.sh` returns success (kubectl rollout status), the new pod is Available but the old pod can stay in Service endpoints during its `terminationGracePeriodSeconds` (default 30s). `verify-buildsha.sh` makes a single curl through Ingress and can land on the old pod, reporting a stale `/readyz.version` and failing the flight even though the deployment is actually correct. Observed on PR #910 candidate-flight (run 24641133148) — overlay digest, k8s deployment, and crane-config of the GHCR image all agreed on `0091eb14a3bb`, but verify-buildsha read `469d5ee3d4df` (the previous deploy's SHA) at T+12s after rollout-status returned. Pod inspected ~12 minutes later was correctly serving `0091eb14a3bb`.
outcome: verify-buildsha tolerates the brief endpoint-cutover window by retrying per-node with bounded backoff (default 6×5s = 30s, configurable). A genuine digest miss still fails after the retry budget; a transient cutover race resolves cleanly without flight failure.
spec_refs:
  - ci-cd
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: fix/verify-buildsha-rollout-race
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-19
updated: 2026-04-19
labels: [cicd, flight, k8s, race-condition]
external_refs:
---

# verify-buildsha races with rolling-update endpoint cutover

## Evidence — PR #910 candidate-flight (run [24641133148](https://github.com/Cogni-DAO/node-template/actions/runs/24641133148))

Timeline (UTC, all on 2026-04-19):

| Time     | Step                                                                               | Outcome   |
| -------- | ---------------------------------------------------------------------------------- | --------- |
| 22:54:46 | `promote-build-payload.sh` writes overlay → digest `sha256:c70eb9bf…` for operator | ✓ correct |
| 22:55:11 | `wait-for-argocd.sh` starts (target deploy-branch SHA `aa7d13cd`)                  |           |
| 22:57:19 | wait-for-argocd: "✅ All ArgoCD apps reconciled and healthy"                       |           |
| 22:57:21 | `wait-for-in-cluster-services.sh` starts (kubectl rollout status × 4 deployments)  |           |
| 22:57:28 | wait-for-in-cluster: "✅ all in-cluster services Ready"                            |           |
| 22:57:29 | smoke-candidate: `operator livez: {"status":"alive",…}`                            | ✓         |
| 22:57:36 | smoke-candidate: poly chat/completions returned id                                 | ✓         |
| 22:57:40 | `verify-buildsha.sh` starts                                                        |           |
| 22:57:41 | **`❌ operator: version=469d5ee3d4df != expected 0091eb14a3bb`**                   | ✗         |
| 22:57:42 | poly + resy same mismatch, exit 1                                                  |           |

What the cluster actually had at T+12 minutes:

```bash
$ kubectl -n cogni-candidate-a get deploy operator-node-app \
    -o jsonpath='{.spec.template.spec.containers[0].image}'
ghcr.io/cogni-dao/cogni-template@sha256:c70eb9bfdd43233fdb84312c9e8557aad2bed5166644aaa4d21ef56e45cf7670

$ kubectl -n cogni-candidate-a exec operator-node-app-856cd55f84-h8t8p -- printenv APP_BUILD_SHA
0091eb14a3bbf207c52e2a7579108cb102632b2c
```

The new pod (`856cd55f84-h8t8p`, age 13m at inspection time) carries the correct digest and SHA. `crane config` on the GHCR image confirms the digest's image config has `Env: APP_BUILD_SHA=0091eb14a3bb…`. **The deploy succeeded; verify-buildsha just hit the old pod.**

## Root cause

Deployment uses `RollingUpdate` with `maxSurge: 1, maxUnavailable: 0`. During rollout, both old and new pods are Ready and routable for a brief window. `kubectl rollout status` returns when `availableReplicas == desired` — it does NOT wait for the old pod to be removed from `EndpointSlice`. The old pod's endpoint is removed only after the Endpoints controller observes the pod transitioning to `Terminating` (Service can keep routing to a Terminating pod for `terminationGracePeriodSeconds`, default 30s).

`verify-buildsha.sh` does a single `curl` per node through Ingress with no retry. If that curl lands on the still-in-endpoints old pod, the version mismatch is reported and the flight fails — even though the desired state is correctly rolled out.

bug.0316's fix (gating on `kubectl rollout status` for all four deployments) closed the false-green case but not this race window. bug.0326 (wait-for-argocd-vacuous-green) is a different upstream gap (digest-promotion silent failure) and unrelated to this one.

## Fix shipped in this PR

`scripts/ci/verify-buildsha.sh`: per-node curl loop with bounded retry. Defaults 6 attempts × 5s sleep = 30s window, covering the default `terminationGracePeriodSeconds`. Knobs:

- `VERIFY_BUILDSHA_ATTEMPTS` (default 6)
- `VERIFY_BUILDSHA_SLEEP` (default 5)

Logs `⏳ <node> attempt N/M: version=<x> != expected <y> — retrying in 5s` per intermediate attempt so a real digest mismatch is still visible (won't quietly succeed on the last try).

## Why retry, not "fix the upstream wait"

A more rigorous fix is to extend `wait-for-in-cluster-services.sh` to poll EndpointSlice until the old pod is gone. Three reasons retry is preferable here:

1. **Every Service has the same race** — even if rollout is "complete" in Deployment terms, the Endpoints reconciliation lag is universal. Adding endpoint-poll logic to one script doesn't help operators or infra Services that route through the same Ingress with similar races.
2. **verify-buildsha is the contract probe** — it's the one place that has both `expected SHA` and `actual served SHA` — natural place to absorb the race.
3. **Cheap and local** — no SSH, no kubectl, no new dependency on EndpointSlice fields.

## Acceptance

- [x] Patch `scripts/ci/verify-buildsha.sh` with bounded-retry per node.
- [x] Defaults give a 30s window matching default `terminationGracePeriodSeconds`.
- [ ] Re-fly a candidate-flight; verify either zero retries needed (typical) or `⏳` lines logged followed by ✅ (race window observed and absorbed).
- [ ] If a real digest miss occurs, confirm exit code 1 with `❌ … after 6 attempts` log line.

## Validation

- Run a candidate-flight against an open PR (e.g. PR #932) on the patched main; expect verify-buildsha to either pass first-try (no race) or pass after 1–3 retries (race window absorbed). No flight failures from cutover race.
- Set `VERIFY_BUILDSHA_ATTEMPTS=1` locally and re-run against a live rollout to reproduce the original race.
- bench: 6×5s = 30s extra wall time per node only when racing; happy path is unchanged (single attempt, `break` on first match).
