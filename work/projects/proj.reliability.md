---
id: proj.reliability
type: project
primary_charter:
title: Reliability & Uptime
state: Active
priority: 0
estimate: 3
summary: Maximum cogni uptime — watchdog, external monitoring, OTel fix, backup strategy
outcome: Auto-recovery from hangs within 2 min, external alerting on downtime, no silent outages
assignees: derekg1729
created: 2026-02-08
updated: 2026-02-11
labels: [infra, reliability]
related: [proj.observability-hardening]
---

# Reliability & Uptime

## Goal

Cogni never goes down silently again. If the app hangs, it auto-recovers. If it's down, we know within 60 seconds.

## Context

Feb 7–8, 2026: Two multi-hour outages across production and preview with zero alerting. The app was "healthy but hung" — Docker health checks passed, but the event loop was blocked by OTel `spawnSync` calls to AWS EC2 metadata (169.254.169.254). No watchdog, no external monitor, no alerts. See [postmortem](../../docs/postmortems/2026-02-07-production-vm-loss.md).

## Roadmap

### P0 — Stop the Bleeding

| Deliverable                                                                                                      | Status           | Est |
| ---------------------------------------------------------------------------------------------------------------- | ---------------- | --- |
| Deploy disk cleanup: prune before pulls, dual gate (15GB free / 70% used), remove keep-last tag                  | Done (bug.0015)  | 2   |
| Deploy targeted pulls + SSH keepalive: pull only per-deploy images, pin busybox, prevent SSH timeout             | Done (bug.0038)  | 2   |
| VM watchdog: HEALTHCHECK on `/livez` + autoheal sidecar auto-restarts unhealthy app container (~60-90s recovery) | Todo (task.0014) | 2   |
| OTel fix: set `OTEL_NODE_RESOURCE_DETECTORS=none` in production env                                              | Not Started      | 1   |
| OTel fix: add `resourceDetectors: []` to `NodeSDK` constructor in `src/instrumentation.ts`                       | Not Started      | 1   |
| External uptime monitor (UptimeRobot/Checkly) on `https://cognidao.org/api/meta/readyz`, alerts to Slack/email   | Not Started      | 1   |

### P1 — Don't Lose Data Again

| Deliverable                                                                           | Status                                 | Est |
| ------------------------------------------------------------------------------------- | -------------------------------------- | --- |
| Automated Postgres backups: `pg_dump` to object storage (S3/R2) on cron               | Not Started                            | 2   |
| Grafana alert: app log silence >5 min (dead-man's switch)                             | Replaced by deadman alerts (task.0027) | 1   |
| Grafana alert: container restart count delta >0 / unhealthy >60s / RSS >85% mem_limit | Backlog (task.0028, post-deploy)       | 1   |
| Grafana alert: stderr volume spike                                                    | Not Started                            | 1   |
| Session invalidation on DB reset (prevent stale-session FK errors)                    | Not Started                            | 1   |
| Deploy config reconciliation: hash-based restart/reload for bind-mounted configs      | Backlog (task.0024)                    | 2   |

### P2 — Harden the Platform

| Deliverable                                                                                | Status      | Est |
| ------------------------------------------------------------------------------------------ | ----------- | --- |
| Upgrade VM from 2GB shared to 4GB+ dedicated                                               | Not Started | 1   |
| Healthcheck + autoheal for all services (alloy, temporal-ui, caddy, loki, grafana missing) | Not Started | 2   |
| Container memory limits (`mem_limit`) on all services                                      | Not Started | 1   |
| Deploy-to-healthy gate: poll `/readyz` after deploy, fail CI if unhealthy                  | Not Started | 1   |
| Custom watchdog script hitting /readyz, /pagez if autoheal+livez proves insufficient       | Not Started | 2   |

## Constraints

- VM is CherryServers 2GB shared — watchdog sidecar must be lightweight (~5MB autoheal container)
- OTel SDK is only used for trace ID generation (no exporter) — disabling detectors has zero cost

## Dependencies

- [ ] SSH access to production VM (for watchdog install)
- [ ] Grafana Cloud account (for alert rules)

## As-Built Specs

- [vm-watchdog.md](../../docs/spec/vm-watchdog.md) — HEALTHCHECK + autoheal sidecar design, invariants
- [observability.md](../../docs/spec/observability.md) — structured logging, tracing
- [observability-requirements.md](../../docs/spec/observability-requirements.md) — silent death detection invariants

## Design Notes

Extracted from [postmortem](../../docs/postmortems/2026-02-07-production-vm-loss.md) Feb 7–8. Complements [proj.observability-hardening](proj.observability-hardening.md) — observability = seeing problems, reliability = surviving them.

## Related

- [proj.observability-hardening](proj.observability-hardening.md)
- [Postmortem: Feb 7–8 outages](../../docs/postmortems/2026-02-07-production-vm-loss.md)
- [Postmortem: Feb 10 disk exhaustion](../../docs/postmortems/pm.preview-disk-exhaustion.2026-02-10.md)
