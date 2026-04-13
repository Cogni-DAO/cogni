---
id: bug.0307
type: bug
title: "Operator OOM on candidate-a — memory limit too low, manual canary bump never landed in overlay"
status: needs_implement
priority: 0
rank: 1
estimate: 1
created: 2026-04-09
updated: 2026-04-09
summary: "Operator pod hits JavaScript heap OOM after ~8 min on candidate-a. Root cause: candidate-a overlay inherited 512Mi limit; a manual 1Gi bump was applied directly to deploy/canary but never reflected in the overlay template in main."
outcome: "Operator runs stably on candidate-a under normal load without OOM restarts."
spec_refs:
assignees: []
credit:
project: proj.cicd-services-gitops
initiative:
branch:
---

# bug.0307 — Operator OOM on candidate-a

## Evidence

Observed during first candidate flight of PR #845 (feat/agent-first API):

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
GC: Mark-Compact 251MB → mu=0.004 (GC frozen)
Exit code: 139 (SIGABRT)
Restarts: 1 after ~8 min
```

## Root Cause

The canary deploy branch had a manual memory limit bump applied:

```
853a5bf76 ops: bump canary operator memory limit 512Mi → 1Gi
```

This was a direct commit to `deploy/canary` — it never landed in `infra/k8s/overlays/candidate-a/operator/kustomization.yaml` on `main`.

When candidate-a was seeded from deploy/canary, the overlay files were copied but the memory patch in the kustomization was already the old `512Mi` value (the bump was applied inline, not via the overlay template).

Every candidate flight re-syncs overlays from `main` → restoring the 512Mi limit on each flight.

## Fix

In `infra/k8s/overlays/candidate-a/operator/kustomization.yaml`, add or update the memory patch:

```yaml
- target:
    kind: Deployment
    name: node-app
  patch: |
    - op: replace
      path: /spec/template/spec/containers/0/resources/requests/memory
      value: "512Mi"
    - op: replace
      path: /spec/template/spec/containers/0/resources/limits/memory
      value: "1Gi"
```

Also verify the same for poly, resy, and scheduler-worker overlays.

## Validation

- Operator pod runs for >30 min on candidate-a without OOM restart
- `kubectl -n cogni-candidate-a top pods` shows memory below 800Mi under load

## References

- PR #845 flight run: https://github.com/Cogni-DAO/node-template/actions/runs/24216446099
- PR #845 comment: https://github.com/Cogni-DAO/node-template/pull/845#issuecomment-4218161922
- `deploy/canary` commit `853a5bf76 ops: bump canary operator memory limit 512Mi → 1Gi`
