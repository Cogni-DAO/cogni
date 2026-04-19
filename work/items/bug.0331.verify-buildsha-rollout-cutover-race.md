---
id: bug.0331
type: bug
title: candidate-flight false-fails on rolling-update endpoint cutover race
status: needs_review
priority: 1
rank: 30
estimate: 1
summary: After `wait-for-in-cluster-services.sh` returns success (kubectl rollout status), the new pod is Available but the old pod can stay in the Service's EndpointSlice during its `terminationGracePeriodSeconds` (default 30s). Downstream HTTPS probes (`verify-buildsha`, `wait-for-candidate-ready`) can land on the still-routable old pod via Ingress and read stale `/readyz.version`, false-failing the flight even though the deploy is correct. Observed on PR #910 candidate-flight (run 24641133148) — overlay digest, k8s deployment image, and crane-config of the GHCR image all agreed on `0091eb14a3bb`, but verify-buildsha read `469d5ee3d4df` (previous deploy's SHA) at T+12s after rollout-status returned. Pod inspected ~12 minutes later was correctly serving `0091eb14a3bb`.
outcome: wait-for-in-cluster-services.sh does not return success until each Service's endpoint count has dropped back to deployment desired replicas, eliminating the cutover window from downstream probes. The race is fixed at the gate layer (rollout completeness) rather than masked at the probe layer (per-probe retry).
spec_refs:
  - ci-cd
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: fix/wait-for-endpoint-cutover
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

# candidate-flight false-fails on rolling-update endpoint cutover race

## Evidence — PR #910 candidate-flight ([run 24641133148](https://github.com/Cogni-DAO/node-template/actions/runs/24641133148))

Timeline (UTC, 2026-04-19):

| Time     | Step                                                                          | Outcome   |
| -------- | ----------------------------------------------------------------------------- | --------- |
| 22:54:46 | promote-build-payload writes overlay → digest `sha256:c70eb9bf…` for operator | ✓ correct |
| 22:55:11 | wait-for-argocd starts (target deploy-branch SHA `aa7d13cd`)                  |           |
| 22:57:19 | wait-for-argocd: "✅ All ArgoCD apps reconciled and healthy"                  |           |
| 22:57:21 | wait-for-in-cluster-services starts (kubectl rollout status × 4 deployments)  |           |
| 22:57:28 | wait-for-in-cluster: "✅ all in-cluster services Ready"                       |           |
| 22:57:29 | smoke-candidate: `operator livez: {"status":"alive",…}`                       | ✓         |
| 22:57:36 | smoke-candidate: poly chat/completions returned id                            | ✓         |
| 22:57:40 | verify-buildsha starts                                                        |           |
| 22:57:41 | **`❌ operator: version=469d5ee3d4df != expected 0091eb14a3bb`**              | ✗         |
| 22:57:42 | poly + resy same mismatch, exit 1                                             |           |

What the cluster actually had (T+12 minutes, after manual SSH inspection):

```bash
$ kubectl -n cogni-candidate-a get deploy operator-node-app \
    -o jsonpath='{.spec.template.spec.containers[0].image}'
ghcr.io/cogni-dao/cogni-template@sha256:c70eb9bfdd43233fdb84312c9e8557aad2bed5166644aaa4d21ef56e45cf7670

$ kubectl -n cogni-candidate-a exec operator-node-app-856cd55f84-h8t8p -- printenv APP_BUILD_SHA
0091eb14a3bbf207c52e2a7579108cb102632b2c
```

`crane config` on the GHCR digest confirms `Env.APP_BUILD_SHA=0091eb14a3bb…`. **The deploy succeeded; verify-buildsha just hit the old pod during the cutover window.**

Independent confirmation: PR #932's flight 13 minutes after #910 ([run 24641397141](https://github.com/Cogni-DAO/node-template/actions/runs/24641397141)) passed verify-buildsha cleanly because its `wait-for-argocd` step took 4min vs #910's 2min — the longer wait gave the old pod time to fully drain. The intermittency pattern (slow deploy passes, fast deploy false-fails) is the signature of a cutover race.

## Root cause

Deployment uses `RollingUpdate` with `maxSurge=1, maxUnavailable=0`. During rollout, both old and new pods are Ready and in the Service's `EndpointSlice`. `kubectl rollout status` returns when `availableReplicas == desired` — it does NOT wait for the old pod to be removed from EndpointSlice. The old pod's endpoint is removed only after the EndpointSlice controller observes the pod transitioning to `Terminating` (typically <1s after rollout-status returns, but bounded by `terminationGracePeriodSeconds`, default 30s).

Single-shot HTTPS probes through Ingress (`verify-buildsha`, `wait-for-candidate-ready`'s readyz check) lose a coin flip during this window.

bug.0316 closed the false-green case by gating on `kubectl rollout status` for all four deployments, but did not address EndpointSlice cutover. bug.0326 (wait-for-argocd-vacuous-green) is a different upstream gap (digest-promotion silent failure) and unrelated to this one.

## Fix shipped in this PR

`scripts/ci/wait-for-in-cluster-services.sh`: per-service two-gate sequence. Gate 1 (`kubectl rollout status`) is unchanged. Gate 2 (`wait_for_endpoint_cutover`) polls Service endpoints until the address count drops to ≤ deployment desired replicas, with a bounded 60s timeout (configurable via `ENDPOINT_CUTOVER_TIMEOUT`).

The address counter is jq-free (`jsonpath` emits one `.` per Ready address; `tr -cd '.' | wc -c` counts) since the candidate VM does not have jq installed.

## Why fix the gate, not the probes

An earlier draft (PR #936, closed) added retry-with-backoff to `verify-buildsha` itself. That approach was rejected as wrong-layer:

1. **Every Ingress probe shares the race.** verify-buildsha, wait-for-candidate-ready, smoke-candidate's livez, and any future HTTPS probe must each carry their own retry to be safe. Fixing the gate fixes all of them at once.
2. **Probes should report what they see.** Adding "if the answer is wrong, ask again" hides the race window from operators — `⏳ retry` lines disappear and there's no signal that the cluster was in an inconsistent state.
3. **Magic constant disappears.** Retry budgets need to track `terminationGracePeriodSeconds`; the gate just polls real state.

## Acceptance

- [x] Patch `wait-for-in-cluster-services.sh` with post-rollout endpoint cutover wait.
- [x] Counter is jq-free (verified `jq` not on candidate-a VM).
- [ ] Re-fly a candidate-flight; expect `✓ <svc>: endpoints=N <= desired=N (rollout cutover complete)` per service in the wait-for-in-cluster-services step. verify-buildsha runs cleanly first-try (no race window remains).
- [ ] If the cutover ever hangs (terminationGracePeriod > 60s, finalizer stuck), confirm `✗ <svc>: endpoint cutover timed out` and exit 1 — surfaces the issue rather than masking it.

## Validation

- Live verification of the dot-counter against candidate-a:
  ```bash
  $ kubectl -n cogni-candidate-a get deploy operator-node-app -o jsonpath='{.spec.replicas}'
  1
  $ kubectl -n cogni-candidate-a get endpoints operator-node-app \
      -o jsonpath='{range .subsets[*].addresses[*]}.{end}' | tr -cd '.' | wc -c | tr -d ' '
  1
  ```
  Steady-state count == desired ✓.
- Loop test: `VERIFY_BUILDSHA_ATTEMPTS=1` is no longer needed — verify-buildsha can stay single-shot once this gate is in place.
- `pnpm check` passes.
