---
id: task.0308
type: task
title: "Deployment observability scorecard — build/log correlation + git manager health matrix"
status: needs_design
priority: 1
rank: 2
estimate: 3
created: 2026-04-09
updated: 2026-04-09
summary: "Give git manager (and humans) a single-query deployment health scorecard: container limits, memory/CPU actuals, pod restart count, readyz/livez status, and feature-validation log signals — all correlated to the PR SHA that was flighted."
outcome: "Git manager can call one tool and get a pass/fail scorecard for any candidate-a deployment. Humans can see build SHA in Grafana logs without grepping kubectl."
spec_refs:
  - docs/spec/observability.md
  - work/projects/proj.observability-hardening.md
assignees: []
credit:
project: proj.cicd-services-gitops
initiative: ini.cicd-trunk-based
branch:
---

# task.0308 — Deployment Observability Scorecard

## Problem

During PR #845 candidate flight, the operator OOM (bug.0307) was caught 8 minutes in — but:

- **No build SHA in pod logs**: Grafana shows namespace/pod labels only. No way to confirm which PR/SHA is running without reading the deploy branch.
- **No memory limit visibility**: `container_spec_memory_limit_bytes` exists in the allowlist but no dashboard surfaces it. We discovered 512Mi vs 1Gi from `kubectl describe`, not Grafana.
- **No git manager scorecard**: Agent must manually correlate Argo sync state + kubectl top + readyz polling — no single query returns a structured pass/fail.
- **No feature-validation log signal**: There's no structured log event for "candidate flight smoke check passed." CI posts a GitHub status but nothing queryable in Loki.

## What This Task Adds

### 1. Build SHA in Pod Logs (startup emission)

On operator/poly/resy/scheduler-worker startup, emit a structured log line:

```json
{
  "level": "info",
  "msg": "startup",
  "sha": "<HEAD_SHA>",
  "imageTag": "pr-845-1185d6b6...",
  "nodeId": "...",
  "env": "candidate-a"
}
```

This makes `{namespace="cogni-candidate-a"} | json | msg="startup"` return the deployed SHA — correlating Grafana logs to GitHub PR/build without any extra tooling.

### 2. Grafana Dashboard: Candidate Deployment Health

A provisioned dashboard (or MCP-queryable panels) scoped to `namespace=~"cogni-candidate-a|cogni-canary"` with:

| Panel                 | Query                                                                    | Source                |
| --------------------- | ------------------------------------------------------------------------ | --------------------- | ---------------------------- | ------- | ---- |
| Memory usage vs limit | `container_memory_working_set_bytes / container_spec_memory_limit_bytes` | Prometheus (cAdvisor) |
| Memory limit (raw)    | `container_spec_memory_limit_bytes`                                      | Prometheus            |
| CPU usage             | `container_cpu_usage_seconds_total`                                      | Prometheus            |
| Pod restart count     | `kube_pod_container_status_restarts_total`                               | Prometheus            |
| OOM kill events       | `container_oom_events_total`                                             | Prometheus            |
| readyz / livez        | Loki: `                                                                  | json                  | msg=~"readyz                 | livez"` | Loki |
| Deployed SHA          | Loki: `                                                                  | json                  | msg="startup"`               | Loki    |
| Smoke check result    | Loki: `                                                                  | json                  | msg="candidate-smoke-check"` | Loki    |

### 3. Structured Smoke Check Log Event

Add `candidate-smoke-check` log event at end of `smoke-candidate.sh`:

```json
{
  "level": "info",
  "msg": "candidate-smoke-check",
  "pr_number": "845",
  "sha": "1185d6b6...",
  "checks": ["readyz-operator", "readyz-poly", "readyz-resy", "livez-operator"],
  "result": "pass",
  "env": "candidate-a"
}
```

This gives Loki a queryable terminal signal for "did the smoke check pass for this SHA?" — enabling git manager to correlate flight result to Loki without reading GitHub API.

### 4. Git Manager `getCandidateHealth()` Tool (pointer only)

Extend `task.0297` (VCS flight tool) with a `getCandidateHealth(slot)` method that:

1. Queries Loki for startup log → extracts deployed SHA
2. Queries Prometheus for memory usage % and restart count
3. Queries Loki for latest smoke-check result
4. Returns structured scorecard:

```typescript
{
  slot: "candidate-a",
  deployedSha: "1185d6b6",
  memory: { usageMi: 480, limitMi: 512, pct: 93.7 },
  restarts: 1,
  oomKills: 1,
  smokeCheck: "pass" | "fail" | "unknown",
  readyz: { operator: true, poly: true, resy: true }
}
```

## Key Pointers

### Existing infrastructure (read before writing)

- `infra/compose/configs/alloy-config.metrics.alloy` — Prometheus scrape + metric allowlist (add kube metrics if missing)
- `docs/spec/observability.md` — label schema, metric names, JSON logging contract
- `work/projects/proj.observability-hardening.md` — P1: `container_oom_events_total`, cAdvisor, heartbeat; all Not Started
- `scripts/ci/smoke-candidate.sh` — add structured log at end
- `task.0297` — VCS tool plane; `getCandidateHealth()` goes here
- `.claude/skills/grafana-dashboards/SKILL.md` — dashboard JSON pattern + provisioning

### Metrics already in allowlist (from observability.md)

```
container_memory_working_set_bytes
container_memory_rss
container_spec_memory_limit_bytes
container_cpu_usage_seconds_total
container_oom_events_total
```

### Gap: kube_pod_container_status_restarts_total

This metric comes from `kube-state-metrics`, not cAdvisor. Verify it's scraped in the k3s cluster and add to Alloy allowlist if missing.

## Hard Boundaries

- No new cardinality: SHA goes in the log JSON body, NOT as a Loki label
- No second state plane: scorecard reads from Loki + Prometheus only — no new DB
- Dashboard provisioning via git (JSON in `infra/grafana/dashboards/`) — not hand-clicked in UI
- `getCandidateHealth()` is read-only — no side effects

## Validation

- `{namespace="cogni-candidate-a"} | json | msg="startup"` returns current deployed SHA in Loki
- Memory usage panel shows 512Mi limit vs actual usage for operator pod
- `getCandidateHealth("candidate-a")` returns structured scorecard without SSH or kubectl
- Smoke check log queryable: `{namespace="cogni-candidate-a"} | json | msg="candidate-smoke-check"`

## References

- bug.0307 — OOM that motivated this task (512Mi limit invisible until crash)
- task.0297 — VCS flight tool (extend with getCandidateHealth)
- PR #845 flight run: https://github.com/Cogni-DAO/node-template/actions/runs/24216446099
