---
id: task.0027.handoff
type: handoff
work_item_id: task.0027
status: active
created: 2026-02-11
updated: 2026-02-11
branch: fix/health-monitoring
last_commit: d3846042
---

# Handoff: Alloy infra metrics + log noise suppression + Grafana P0 alerts

## Context

- Feb 7-8, 2026: two multi-hour outages with zero alerting. We were blind to container OOMs, host resource exhaustion, and had zero Grafana alert rules.
- ~62% of Loki log volume (~74K lines/day across preview+production) is successful health-check and metrics-scrape noise.
- This task adds cAdvisor + node exporter to the existing Alloy container (no new containers), suppresses health-check log noise at the pipeline level, and creates P0 Grafana alert rules.
- The goal is AI API-based observability: all data queryable via Grafana MCP for debugging.

## Current State

- **Done:** Alloy config changes committed — cAdvisor + node exporter, metric allowlist (18 metrics), label policy, log drop stages (fail-safe template logic).
- **Done:** Docker compose host mounts (`/proc`, `/sys`, `/` read-only) added to both prod and dev compose files.
- **Done:** Log noise drop stages added to both `alloy-config.alloy` and `alloy-config.metrics.alloy` with dev parity.
- **Not done:** Grafana alert rules (5 rules) — deferred to post-deploy when metrics are flowing and expressions can be verified against real data.
- **Not done:** Config consolidation — dev uses `alloy-config.alloy` (logs-only), prod uses `alloy-config.metrics.alloy` (logs + metrics). These should be merged into one config to eliminate duplication and enable local metrics testing.
- **Known issue:** Log drop `status_code` comparison uses string `"200"` — Alloy `stage.json` extracts JSON numbers as strings, so this should work, but needs smoke-test verification after deploy.

## Decisions Made

- Use Alloy's built-in `prometheus.exporter.cadvisor` + `prometheus.exporter.unix` instead of separate containers — see [task.0027](../items/task.0027.alloy-infra-metrics-alerts.md)
- No `log_silence_app` alert — after intentionally dropping health-check logs, log-silence would be meaningless. Deadman alerts per scrape source replace it.
- `container_rss_near_limit` PromQL: `(container_memory_rss / container_spec_memory_limit_bytes) > 0.9 and container_spec_memory_limit_bytes > 0` — guards against divide-by-zero.
- Deadman alerts use `max_over_time(up{job="..."}[2m]) == 0` (not `absent()`) for reliability.
- Metric label policy: keep `job`, `instance`, `service`, `env`; drop `id`, `image`, `name`, `container_label_.*`.

## Next Actions

- [ ] Consolidate `alloy-config.alloy` and `alloy-config.metrics.alloy` into a single config (dev compose mounts metrics config; empty `PROMETHEUS_REMOTE_WRITE_URL` means remote_write silently no-ops)
- [ ] Deploy to preview and verify: `up{job="cadvisor"}==1`, `up{job="node"}==1`, `container_memory_rss{service="app"}` returns data
- [ ] Verify log drops: check Alloy `/metrics` for `loki_process_dropped_lines_total` by `drop_counter_reason`; confirm successful readyz/metrics probes disappear from Loki while failures remain
- [ ] Smoke-test string comparison: verify `status_code` extracted as `"200"` (not `200`) by checking drop counters increment
- [ ] Create 5 Grafana alert rules via API: `container_oom`, `container_rss_near_limit`, `deadman_cadvisor`, `deadman_node`, `deadman_app_metrics` (expressions in work item)
- [ ] Amend commit or add fixup if config consolidation changes file structure

## Risks / Gotchas

- **Dev stack mounts logs-only config:** `docker-compose.dev.yml` mounts `alloy-config.alloy` which has NO exporters/scrapes. Metrics can't be tested locally until configs are consolidated.
- **HCL syntax:** Alloy uses HCL, not YAML. Map entries need commas (already fixed in `d3846042`). Template strings use `\"` for inner quotes.
- **Sprig `int` on floats:** `int "4.567"` truncates to `4`. Duration < 1000ms check works but be aware of rounding.
- **`/livez` not wrapped:** The `/livez` endpoint has no `wrapRouteHandlerWithLogging` — it produces no Pino JSON, so there's no app-level log noise to drop for livez. The routeIds that matter are `meta.readyz` and `meta.metrics`.

## Pointers

| File / Resource                                      | Why it matters                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `infra/compose/configs/alloy-config.metrics.alloy`   | Main config: exporters, scrapes, relabel, log drops                              |
| `infra/compose/configs/alloy-config.alloy`           | Dev config: log drops only (should be consolidated)                              |
| `infra/compose/docker-compose.yml`                   | Prod compose: alloy host mounts                                                  |
| `infra/compose/docker-compose.dev.yml`               | Dev compose: alloy host mounts                                                   |
| `work/items/task.0027.alloy-infra-metrics-alerts.md` | Full requirements, alert expressions, acceptance criteria                        |
| `docs/spec/observability-requirements.md`            | Governing invariants: BELOW_APP_ATTRIBUTION, PRE_CRASH_CURVE, HEARTBEAT_LIVENESS |
| `docs/spec/observability.md`                         | Observability architecture, logging contract, label cardinality rules            |
| `src/bootstrap/http/wrapRouteHandlerWithLogging.ts`  | Where `route`, `status`, `durationMs` JSON fields originate                      |
| `http://127.0.0.1:12345/metrics`                     | Alloy self-metrics (drop counters, scrape status)                                |
