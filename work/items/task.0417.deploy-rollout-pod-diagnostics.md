---
id: task.0417
type: task
title: "Surface pod-startup diagnostics on rollout failure + fix /logs anti-pattern"
status: needs_merge
priority: 0
rank: 1
estimate: 1
summary: "Two procedural blindspots cost hours of investigation on the prod webhook outage (TAVILY_API_KEY env-validation crash-loop): (1) `wait-for-argocd.sh` reports `stale ReplicaSet still present` on rollout failure but never dumps the actual cause (CrashLoopBackOff reason / pod stderr / namespace events), forcing investigators to SSH the prod VM to run `kubectl describe pod`. (2) The `/logs` skill's first-query example filters by symptom keyword, which returns silence when the pod is dead — misleading the investigator away from pod-startup logs that hold the root cause."
outcome: '(1) `wait-for-argocd.sh` calls a new `dump_pod_diagnostics()` on both rollout-failure return paths. The function uses the same `kubectl` context already established by the script and prints: container statuses (waiting reason, last-termination reason, restart count), the last 20 namespace events sorted by lastTimestamp, and the last 30 lines each of `migrate` + `app` from the newest non-Ready pod. Same kubectl context, no new perms, ~35 lines. (2) `/logs` skill gains an explicit anti-pattern callout ("don''t filter by symptom keyword first"), a top-down 3-step query order (pod alive? → SHA serving? → only then symptom-specific), and a deploy/rollout-failure recipe that names the exact Loki query that catches `EnvValidationError`. Closes the gap that turned a 30-second log read into a multi-hour SSH dependency.'
spec_refs:
assignees: [derekg1729]
project:
branch: fix/deploy-observability-gaps
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [observability, ci-cd, deploy, blameless-postmortem]
---

# Surface pod-startup diagnostics on rollout failure

## Problem

Production operator was silently broken for ~14 hours. Webhook deliveries from GitHub returned 401 (`webhook verification failed`) and no PR reviews posted. The actual root cause was a pod that never reached Ready: `EnvValidationError: invalid: ['TAVILY_API_KEY']`. The new pod crash-looped, the old pod (from before PR #1094 added the validation) kept serving stale code, and the rolling deploy never completed.

The `wait-for-argocd.sh` script noticed the symptom — `kubectl rollout status` timed out, ReplicaSet stale — but its CI failure log only said `Healthy but stale ReplicaSet still present`. The actual cause was one `kubectl describe pod` away, and the script already had kubectl context. It just didn't run the command.

Compounding the problem: when investigating from Loki, the natural first query was `{env="production"} |~ "webhook"` — which returned reams of `webhook verification failed` lines but never surfaced the upstream `EnvValidationError` because the wrong pod was being queried (no one looked at app-startup logs). The `/logs` skill's example queries filter by domain symptom and reinforce this anti-pattern.

## Allowed Changes

- `scripts/ci/wait-for-argocd.sh` — add `dump_pod_diagnostics()` function, call it from both rollout-failure return paths
- `.claude/commands/logs.md` — add anti-pattern callout, top-down query order, deploy-failure recipe

## Validation

```yaml
exercise: |
  # Pre-merge:
  bash -n scripts/ci/wait-for-argocd.sh
  pnpm check:fast

  # Post-merge: next prod deploy that fails (or a forced one with intentionally
  # bad env var) should show pod statuses + events + container logs in CI output
  # without anyone running kubectl manually.
observability: |
  # No runtime metric to query — this fix changes CI log content. Validate via:
  # next failed `wait-for-argocd.sh` run shows new "── pod diagnostics ──" block
  # with container statuses + recent events + tail of newest pod's stderr.
```

## Out of scope (file as separate work)

- **Install kube-state-metrics on each VM and scrape to Grafana Cloud Prom** — would let dashboards/alerts on `kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"}`. Tracked separately as bigger infra work.
- **Switch cAdvisor scrape to k8s-aware** (kubelet `/metrics/cadvisor`) so per-pod resource attribution lands in Prom. Same scope as kube-state-metrics.
- **Loki alert on `EnvValidationError`** — quick win, file as separate task.
- **Continuous "deployed buildSha matches expected" alert** comparing `app started` log buildSha vs source-sha-by-app.json — needs a Loki rule, separate task.

## Pointers

- [`scripts/ci/wait-for-argocd.sh`](../../scripts/ci/wait-for-argocd.sh) — primary edit target
- [`.claude/commands/logs.md`](../../.claude/commands/logs.md) — secondary edit
- The original outage thread + investigation lives in chat history; the smoking-gun Loki line was `Invalid server env: {"code":"INVALID_ENV","missing":[],"invalid":["TAVILY_API_KEY"]}` from pod `operator-node-app-66cbc5f576-qmtdw` at 2026-04-28T09:37:33Z
- Triggering PR (added the validation): `cc328b478 chore(secrets): wire TAVILY_API_KEY end-to-end (#1094)`
