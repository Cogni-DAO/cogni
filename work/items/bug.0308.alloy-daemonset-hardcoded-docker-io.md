---
id: bug.0308
type: bug
title: "Alloy DaemonSet hardcodes docker.io image — brittle under mirror failure, blocks ghcr.io-only clusters"
status: needs_implement
priority: 1
rank: 2
estimate: 1
created: 2026-04-13
updated: 2026-04-13
summary: "PR #864 (feat/k8s-alloy-observability) pins the alloy DaemonSet image to docker.io/grafana/alloy:v1.9.2. Candidate-a currently pulls this only because PR #866 added a docker.io registry mirror to the k3s cluster bootstrap. The hardcoded docker.io reference couples the observability pipeline to a separate infra workaround, and will break any ghcr.io-only cluster. Long-term fix: re-mirror alloy to ghcr.io/cogni-dao/* and reference the mirror image directly in the DaemonSet."
outcome: "Alloy DaemonSet references a cogni-controlled ghcr.io mirror image. No dependency on docker.io availability or on cluster-level registry mirror rules."
spec_refs:
  - docs/spec/observability.md
assignees: []
credit:
project: proj.cicd-services-gitops
initiative: ini.cicd-trunk-based
branch:
related:
  - task.0308
  - PR #864
  - PR #866
---

# bug.0308 — Alloy DaemonSet hardcoded docker.io image

## Evidence

PR #864 (`feat/k8s-alloy-observability`) ships an alloy DaemonSet with the image pinned to:

```yaml
image: docker.io/grafana/alloy:v1.9.2
```

During the candidate-a flight, alloy failed to pull until PR #866 (`fix/k3s-docker-mirror`) landed — which added a docker.io registry mirror to `cherry/base/bootstrap.yaml` and `cherry/k3s/bootstrap-k3s.yaml`. Cluster state and git state are now in sync (bootstrap yamls match the VM `/etc/rancher/k3s/registries.yaml`), but the observability pipeline now depends on two separate coupled concerns:

1. The DaemonSet points at `docker.io`.
2. The cluster must have a docker.io mirror configured at bootstrap time.

Break either side and alloy pods will fail to pull.

## Root Cause

The DaemonSet manifest was authored against the upstream Grafana alloy image path without considering Cogni's ghcr.io-mirror-first image policy. This is consistent with the anti-pattern the user is currently flagging: **silent hardcoded third-party references** in deploy manifests that don't go through the cogni-controlled registry.

## Fix

1. Add a GHA job (or one-shot script) that mirrors `grafana/alloy:v1.9.2` → `ghcr.io/cogni-dao/alloy:v1.9.2` with a pinned digest.
2. Update `infra/k8s/base/alloy/daemonset.yaml` (and any overlay that references it) to use the ghcr.io mirror image.
3. Once the DaemonSet is on ghcr.io only, the docker.io mirror in the cluster bootstrap becomes load-bearing only for other images (if any) — evaluate whether it can be removed or kept as a defensive fallback.

## Acceptance

- [ ] `kubectl -n cogni-candidate-a get ds alloy -o jsonpath='{..image}'` shows `ghcr.io/...`
- [ ] Deleting the `mirrors:` block for `docker.io` from the cluster's `registries.yaml` does not break alloy pod pulls.
- [ ] PR #866 cluster bootstrap can be re-evaluated independently.

## Validation

- Apply the fix to candidate-a overlay, trigger a candidate flight, confirm alloy pod pulls from ghcr.io (not docker.io) via `kubectl describe pod`.
- Confirm Loki is still receiving `app started` logs from the nodes after the alloy image swap — the PR #865 acceptance test query (`{namespace="cogni-candidate-a"} |= "app started"`) remains the end-to-end signal.

## Notes

- Related: task.0308 (deployment observability scorecard — alloy is the log shipper backing the `app started` / buildSha queries).
- Related: PR #865 (fix/build-sha-observability — narrow build-SHA plumbing subset of task.0308; its Loki-side acceptance test depends on alloy staying up).
- The user explicitly called out this pattern: _"stop these hardcodings"_. Any new DaemonSet / Deployment / CronJob added to `infra/k8s/` must reference ghcr.io mirror images unless a written exception is on file.
