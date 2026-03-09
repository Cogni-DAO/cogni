---
id: task.0028
type: task
title: "Create Grafana Cloud P0 alert rules (post-deploy, human)"
status: needs_triage
priority: 0
estimate: 1
summary: After task.0027 is deployed, verify metrics flow to Mimir, create alert folder + 5 P0 alert rules in Grafana Cloud, and verify they evaluate correctly.
outcome: 5 Grafana alert rules firing correctly for OOM, memory pressure, and scrape failures across preview+production environments.
spec_refs: observability-spec, spec.observability-requirements
assignees: derekg1729
credit:
project: proj.reliability
branch:
pr:
reviewer:
created: 2026-02-12
updated: 2026-02-12
labels: [infra, observability, reliability, P0, human]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 22
---

# Create Grafana Cloud P0 alert rules (post-deploy, human)

## Context

task.0027 added cAdvisor + node exporter + app_metrics env labels to Alloy config, but alert rules require deployed metrics to create and verify. The Grafana MCP integration lacks `folders:create` permission, so folder creation must be done via the Grafana Cloud UI. Alert rules can then be created via MCP or UI.

## Requirements

### Prerequisites (from task.0027 deploy)

- [ ] task.0027 branch deployed to preview and/or production
- [ ] Verify metrics flow in Grafana Explore:
  - `up{job="cadvisor"} == 1` — cAdvisor scrape alive
  - `up{job="node"} == 1` — node exporter scrape alive
  - `up{job="app_metrics"} == 1` — app metrics scrape alive
- [ ] Verify label correctness:
  - `env` label present on all three jobs (set to `preview` or `production`)
  - `service` label present on container metrics (mapped from `container_label_com_docker_compose_service`)
  - Known Alloy issues with `allowlisted_container_labels`: [#1302](https://github.com/grafana/alloy/issues/1302), [#830](https://github.com/grafana/alloy/issues/830) — if `service` label is missing, check cAdvisor config

### Alert Folder

- [ ] Create folder "Cogni Alerts" in Grafana Cloud (UI → Alerting → Alert rules → New folder)

### Alert Rules

All alerts scoped to `env=~"preview|production"`. Use `noDataState: NoData` (not Alerting) to avoid false positives.

| #   | Alert Name                 | PromQL Expression                                                                                                                                                                                | Severity | For | Notes                                           |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --- | ----------------------------------------------- |
| 1   | `container_oom`            | `increase(container_oom_events_total{env=~"preview\|production"}[10m]) > 0`                                                                                                                      | critical | 0m  | Any OOM event fires immediately                 |
| 2   | `container_rss_near_limit` | `(container_memory_rss{env=~"preview\|production"} / container_spec_memory_limit_bytes{env=~"preview\|production"}) > 0.9 and container_spec_memory_limit_bytes{env=~"preview\|production"} > 0` | warning  | 5m  | Excludes containers with no mem limit (limit=0) |
| 3   | `deadman_cadvisor`         | `max_over_time(up{job="cadvisor",env=~"preview\|production"}[2m]) == 0`                                                                                                                          | critical | 0m  | cAdvisor scrape stopped                         |
| 4   | `deadman_node`             | `max_over_time(up{job="node",env=~"preview\|production"}[2m]) == 0`                                                                                                                              | critical | 0m  | Node exporter scrape stopped                    |
| 5   | `deadman_app_metrics`      | `max_over_time(up{job="app_metrics",env=~"preview\|production"}[2m]) == 0`                                                                                                                       | critical | 0m  | App metrics scrape stopped                      |

### Configuration for each rule

- **Folder**: "Cogni Alerts"
- **Rule group**: "P0 Infrastructure"
- **Evaluation interval**: 1m
- **No data state**: NoData
- **Execution error state**: Alerting
- **Labels**: `severity: critical` or `severity: warning` (per table above)

## Allowed Changes

- Grafana Cloud only (alert folder, alert rules, notification policies)
- No code changes

## Plan

1. [ ] Deploy task.0027 branch
2. [ ] Verify all 3 `up` metrics exist with correct labels in Grafana Explore
3. [ ] Create "Cogni Alerts" folder in Grafana Cloud UI
4. [ ] Create 5 alert rules (UI or MCP `create_alert_rule` if folder permission is granted)
5. [ ] Verify all rules evaluate correctly (not stuck in NoData after metrics flow)
6. [ ] Optionally: configure notification contact point (Slack/email) for critical alerts

## Validation

```promql
# All 5 rules should appear
# Via MCP: list_alert_rules — expect 5 rules in "Cogni Alerts" folder

# Verify each deadman is in "Normal" state (up == 1, so max_over_time != 0)
# Verify container_oom is in "Normal" state (no OOM events)
# Verify container_rss_near_limit is in "Normal" state (RSS < 90% limit)
```

## Review Checklist

- [ ] **Work Item:** `task.0028` linked in PR body
- [ ] **Spec:** HEARTBEAT_LIVENESS (deadman per source), BELOW_APP_ATTRIBUTION (OOM alert), PRE_CRASH_CURVE (RSS near limit)
- [ ] **Alerts:** All 5 rules exist with correct expressions, `for` durations, severity labels
- [ ] **Reviewer:** verified in Grafana UI

## PR / Links

- Depends on: [task.0027](task.0027.alloy-infra-metrics-alerts.md) (Alloy config must be deployed first)
- [proj.reliability](../projects/proj.reliability.md)
- [observability-requirements.md](../../docs/spec/observability-requirements.md)

## Attribution

-
