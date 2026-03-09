---
id: task.0027
type: task
title: "Alloy infra metrics + log noise suppression + Grafana P0 alerts"
status: done
priority: 0
estimate: 3
summary: Add cAdvisor + node exporter to Alloy (no new containers), suppress health-check log noise at pipeline level, create P0 Grafana alert rules for OOM/memory-pressure/deadman
outcome: Container + host metrics flow to Grafana Cloud Mimir with strict allowlist; health-check noise eliminated from Loki; P0 alerts fire on OOM, memory pressure, and scrape failure — all queryable via Grafana MCP for AI-driven debugging
spec_refs: observability-spec, spec.observability-requirements
assignees: derekg1729
credit:
project: proj.reliability
branch: fix/health-monitoring
pr:
reviewer:
created: 2026-02-11
updated: 2026-02-11
labels: [infra, observability, reliability, P0]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Alloy infra metrics + log noise suppression + Grafana P0 alerts

## Context

Post-incident analysis (Feb 7-8 outages) showed we are blind to container OOMs, host resource exhaustion, and have zero Grafana alerts. Meanwhile ~62% of Loki log volume (~74K lines/day across preview+production) is successful health-check and metrics-scrape noise. This task uses the existing Alloy container to add cAdvisor and node exporter capabilities, suppress log noise at the pipeline, and create the minimum viable alert set — all optimized for AI API-based debugging via Grafana MCP.

## Requirements

### 1. cAdvisor + Node Exporter in Alloy

- Enable `prometheus.exporter.cadvisor` in `alloy-config.metrics.alloy` with `store_container_labels = false` and `allowlisted_container_labels = ["com.docker.compose.service"]`
- Enable `prometheus.exporter.unix` in `alloy-config.metrics.alloy` pointing at host-mounted `/host/proc`, `/host/sys`, `/host/root`
- Add host bind mounts to `docker-compose.yml` alloy service: `/proc:/host/proc:ro`, `/sys:/host/sys:ro`, `/:/host/root:ro`
- Scrape both at 30s interval
- **Metric allowlist** (drop everything else via `prometheus.relabel` before remote_write):
  - `container_memory_working_set_bytes`
  - `container_memory_rss`
  - `container_spec_memory_limit_bytes` (needed for RSS/limit ratio alert)
  - `container_cpu_usage_seconds_total`
  - `container_oom_events_total`
  - `container_network_receive_bytes_total`
  - `container_network_transmit_bytes_total`
  - `container_network_receive_errors_total`
  - `container_network_transmit_errors_total`
  - `container_network_receive_packets_dropped_total`
  - `container_network_transmit_packets_dropped_total`
  - `container_fs_reads_bytes_total`
  - `container_fs_writes_bytes_total`
  - `node_filesystem_avail_bytes` (relabel-drop tmpfs/overlay/proc/sysfs mounts to reduce series count)
  - `node_memory_MemAvailable_bytes`
  - `node_cpu_seconds_total`
  - `node_network_receive_bytes_total`
  - `node_network_transmit_bytes_total`
  - `up` (implicit, kept for deadman)
- **Label policy** — enforce low cardinality:
  - Map `com_docker_compose_service` → `service`
  - Keep: `job`, `instance`, `service`, `env`
  - Drop: `id`, `image`, `name`, `container_label_.*`

### 2. Log Noise Suppression

- Add `loki.process` drop stages in `alloy-config.metrics.alloy` (and `alloy-config.alloy` for dev parity)
- **Drop only successful + fast** health/scrape log lines; keep failures and slow responses
  - Drop: app logs matching `/livez` or `/readyz` with HTTP 200 and duration < 1000ms
  - Drop: app logs matching `/api/metrics` with HTTP 200
  - Keep: any health check returning non-200 or taking >1s (these are real signals)
- **Defensive parsing** — drop stages must be fail-safe:
  - Parse JSON first (`stage.json`); if parse fails → **keep the line** (don't drop unparseable logs)
  - Only drop when JSON parse succeeds AND the required fields exist (route/url, status, duration) AND `status == 200` AND `duration < 1000`
  - If any required field is missing after parse → **keep the line**
  - Use `stage.match` with selector that requires parsed fields before reaching drop logic

### 3. Grafana P0 Alert Rules

Create via Grafana API (or MCP tools). All alerts fire for `env=~"preview|production"`:

| Alert                      | Expression                                                                                                   | Severity | For |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- | --- |
| `container_oom`            | `increase(container_oom_events_total[10m]) > 0`                                                              | critical | 0m  |
| `container_rss_near_limit` | `(container_memory_rss / container_spec_memory_limit_bytes) > 0.9 and container_spec_memory_limit_bytes > 0` | warning  | 5m  |
| `deadman_cadvisor`         | `max_over_time(up{job="cadvisor"}[2m]) == 0`                                                                 | critical | 0m  |
| `deadman_node`             | `max_over_time(up{job="node"}[2m]) == 0`                                                                     | critical | 0m  |
| `deadman_app_metrics`      | `max_over_time(up{job="app_metrics"}[2m]) == 0`                                                              | critical | 0m  |

- `container_rss_near_limit`: the `and container_spec_memory_limit_bytes > 0` clause excludes containers with no memory limit (where limit==0), preventing divide-by-zero and false positives
- Use `max_over_time(up[2m]) == 0` for deadman (not fragile `absent()`)
- Each deadman is explicit per scrape source (cadvisor, node, app_metrics)
- **No `log_silence_app` alert** — after intentionally dropping most health-check logs, a log-silence alert would be meaningless. Deadman alerts on scrape targets are the correct liveness signal. Consider an error-rate alert (e.g., `rate({service="app"} | json | level="error" [5m]) > threshold`) as a future P1 addition once the log schema is verified

## Allowed Changes

- `platform/infra/services/runtime/configs/alloy-config.metrics.alloy` — add exporters, scrapes, relabel, log drop stages
- `platform/infra/services/runtime/configs/alloy-config.alloy` — add log drop stages (dev parity)
- `platform/infra/services/runtime/docker-compose.yml` — add host bind mounts to alloy service
- `platform/infra/services/runtime/docker-compose.dev.yml` — add host bind mounts to alloy service (dev parity)
- Grafana Cloud — create alert rules + folder via MCP/API

## Plan

- [x] Add host bind mounts to alloy service in `docker-compose.yml` (`/proc:/host/proc:ro`, `/sys:/host/sys:ro`, `/:/host/root:ro`)
- [x] Add same mounts to `docker-compose.dev.yml` for dev parity
- [x] Add `prometheus.exporter.cadvisor` block in `alloy-config.metrics.alloy`
  - `docker_host = "unix:///var/run/docker.sock"`
  - `store_container_labels = false`
  - `allowlisted_container_labels = ["com.docker.compose.service"]`
  - `storage_duration = "2m"` (low memory footprint)
- [x] Add `prometheus.exporter.unix` block in `alloy-config.metrics.alloy`
  - `procfs_path = "/host/proc"`, `sysfs_path = "/host/sys"`, `rootfs_path = "/host/root"`
- [x] Add `prometheus.scrape` for cadvisor and node exporters (30s interval)
- [x] Add `prometheus.relabel` pipeline with metric name allowlist (keep regex) + label drops
  - Map `com_docker_compose_service` → `service`
  - Drop `id`, `image`, `name`, `container_label_.*`
- [x] Wire cadvisor + node scrapes through relabel → existing `prometheus.remote_write.grafana_cloud`
- [x] Add `prometheus.relabel` rule to drop `node_filesystem_avail_bytes` for tmpfs/overlay/proc/sysfs fstype mounts (reduce series)
- [x] Add log noise drop stages to `alloy-config.metrics.alloy`:
  - `stage.json` to parse log lines (fail-safe: unparseable lines pass through)
  - `stage.template` gated on parsed fields existing before reaching drop logic
  - Drop only when: JSON parsed OK AND route/status/duration fields present AND status==200 AND (duration<1000 or metrics endpoint)
  - Keep failures (non-200), slow responses (>1s), and lines with missing fields
- [x] Add same log drop stages to `alloy-config.alloy` (dev parity)
- [ ] Create Grafana Cloud alert folder + alert rules — see task.0028 (human, post-deploy)

## Validation

**Alloy config syntax:**

```bash
# Validate Alloy config parses (requires alloy binary or container)
docker run --rm -v $(pwd)/platform/infra/services/runtime/configs:/configs grafana/alloy:v1.9.2 fmt /configs/alloy-config.metrics.alloy
```

**After deploy — metrics flowing:**

```bash
# Via Grafana MCP or Explore UI:
# cAdvisor metrics present
up{job="cadvisor"} == 1
container_memory_rss{service="app"}

# Node metrics present
up{job="node"} == 1
node_memory_MemAvailable_bytes

# App metrics still flowing
up{job="app_metrics"} == 1
```

**After deploy — log noise reduced:**

```logql
# Should return zero results (successful health probes dropped):
{service="app"} |= "/livez" | json | status=`200`

# Should still show failures:
{service="app"} |= "/livez" | json | status!=`200`
```

**Alert rules exist:**

```bash
# Via Grafana MCP list_alert_rules — should return 5 rules
```

**P0 Definition of Done:**

1. Mimir: `up{job="cadvisor"}==1` and `up{job="node"}==1` in both preview+prod, and key container metrics exist for `service="app"`
2. Loki: successful fast `/livez`, `/readyz`, `/api/metrics` lines disappear; failures/slow remain
3. Grafana: 5 alert rules exist and can be tested (force OOM / memory pressure / stop Alloy scrape)

**CI gate:**

```bash
pnpm check
```

## Review Checklist

- [ ] **Work Item:** `task.0027` linked in PR body
- [ ] **Spec:** BELOW_APP_ATTRIBUTION (cAdvisor provides cgroup-level OOM detection), PRE_CRASH_CURVE (RSS + working set visible before OOM), HEARTBEAT_LIVENESS (deadman alerts per source), CONTAINER_RESTART_DETECTION (OOM events alerted)
- [ ] **Cardinality:** No high-cardinality labels leaked to Mimir (id, image, name, container*label*\* all dropped)
- [ ] **Log filtering:** Only successful+fast probes dropped; failures and slow responses preserved
- [ ] **Alerts:** All 5 rules created with correct expressions, `for` durations, and severity labels
- [ ] **Reviewer:** assigned and approved

## PR / Links

- [proj.reliability](../projects/proj.reliability.md) — P1 deliverables: Grafana alerts for container metrics
- [observability-requirements.md](../../docs/spec/observability-requirements.md) — BELOW_APP_ATTRIBUTION, PRE_CRASH_CURVE, HEARTBEAT_LIVENESS, CONTAINER_RESTART_DETECTION
- [observability.md](../../docs/spec/observability.md) — logging contract, metrics pipeline
- Handoff: [handoff](../handoffs/task.0027.handoff.md)

## Attribution

-
