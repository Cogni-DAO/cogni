---
id: bug.0316
type: bug
title: "candidate-flight reports green while node-app pods still serve old image — /readyz is served by any running pod, no rollout verification"
status: needs_merge
priority: 1
rank: 1
estimate: 1
created: 2026-04-18
updated: 2026-04-18
summary: "candidate-flight.yml gates readiness on wait-for-candidate-ready.sh (HTTPS /readyz against operator/poly/resy) and wait-for-in-cluster-services.sh (kubectl rollout status, only scheduler-worker). /readyz is answered by ANY running pod in the service — old ReplicaSet pods still serving during a rolling update pass the probe. Result: a flight can report green before Argo has actually rolled node-apps to the new digests."
outcome: "wait-for-in-cluster-services.sh asserts rollout status on all four k8s Deployments (operator-node-app, poly-node-app, resy-node-app, scheduler-worker). A green candidate-flight run now implies every deployment in the candidate-a overlay has reached its new ReplicaSet, eliminating the false-green pr-coordinator observed after PR #900's re-flight."
spec_refs:
  - docs/spec/ci-cd.md
  - docs/spec/services-architecture.md
assignees: [derekg1729]
credit:
project: proj.cicd-services-gitops
initiative:
branch: fix/rollout-gate-all-deployments
pr:
related:
  - bug.0315
  - PR #913
  - PR #900
---

# bug.0316 — candidate-flight false-green on node-app rollout

## Evidence

Observed 2026-04-18 by pr-coordinator-v0 during post-#913 re-flight of PR #900:

- `candidate-flight.yml` reported success
- `scheduler-worker` pod was on the new PR #900 image digest
- `operator-node-app` / `poly-node-app` / `resy-node-app` pods were still on a previous image digest
- No workflow step had caught the disparity

## Root cause

`candidate-flight.yml` uses two readiness gates today:

1. `scripts/ci/wait-for-candidate-ready.sh` — HTTPS `GET /readyz` against operator/poly/resy via Ingress.
2. `scripts/ci/wait-for-in-cluster-services.sh` — `kubectl rollout status deployment/scheduler-worker`.

`/readyz` is a Service-level probe, answered by whichever ReplicaSet's pod the Service happens to route the request to. During a rolling update, the old ReplicaSet's pods are still Ready and still serving. 200 OK from `/readyz` therefore does **not** imply "the new image is running" — only "some pod for this Service is alive."

The rollout-status gate was introduced in bug.0315 / PR #913 but scoped only to `scheduler-worker` (the in-cluster service with no Ingress). Node-apps were assumed to be covered by the HTTPS probe, which is insufficient.

## Fix

Extend `SERVICES` in `scripts/ci/wait-for-in-cluster-services.sh`:

```
SERVICES=(operator-node-app poly-node-app resy-node-app scheduler-worker)
```

`kubectl rollout status` on an unchanged Deployment returns immediately (no rollout in progress), so adding node-apps to the list does not lengthen no-op flights. For flights that promote new digests, the step blocks until each Deployment's `readyReplicas` matches the new ReplicaSet's target.

No change to `promote-and-deploy.yml` needed — it already calls the same script post-deploy-infra.

Also updates the script's header comment to correct the "no-Ingress services" framing (the real contract is "every Deployment reaches its new ReplicaSet", independent of Ingress status).

## Validation

- [ ] Merge
- [ ] Flight any PR that touches `packages/*` (triggers all-targets rebuild). Verify flight blocks until all four deployments are rolled.
- [ ] Flight a PR that only touches one node's source (e.g. `nodes/poly/*`). Verify only poly rolls; other three return immediately; flight still green.

## Follow-ups

- Scope the gate dynamically from `promoted_apps` instead of a hardcoded list. Today `scripts/ci/promote-build-payload.sh` doesn't emit a `promoted_apps` output the way `promote-and-deploy.yml`'s `promote-k8s` step does; adding that would let the gate target only the deployments that actually changed. Deferred until a new service is added and the hardcoded list becomes painful.
- `wait-for-argocd.sh` is not wired into `candidate-flight.yml`. If Argo stalls on the candidate-a AppSet, the rollout gate would eventually time out (default 300s) — but the root cause would be hidden. Consider adding wait-for-argocd to candidate-flight for symmetry with promote-and-deploy.
