# grafana · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Grafana Cloud observability resources managed from git. This directory owns dashboard JSON synced by Grafana Git Sync and alerting resources provisioned as code.

## Pointers

- [README.md](README.md): Layout, ownership, and Git Sync setup notes
- [dashboards/](dashboards/): Dashboard JSON files synced to Grafana Cloud
- [alerts/](alerts/): Grafana-managed alerting resources; not supported by Git Sync yet
- [Observability spec](../../docs/spec/observability.md): Logging, metrics, labels, and query contracts

## Boundaries

```json
{
  "layer": "infra",
  "may_import": [],
  "must_not_import": ["*"]
}
```

## Public Surface

- **Exports:** none (declarative resources only)
- **Routes (if any):** none
- **Env/Config keys:** none — datasource secrets and Grafana API tokens live in CI/runtime env, not in this directory.
- **Files considered API:** `dashboards/**/*.json` (Grafana Git Sync target), `alerts/**` (Grafana-managed alerting resources)

## Responsibilities

- This directory **does**: Define Grafana dashboards, alert rule source files, and alert routing/contact-point code.
- This directory **does not**: Define app metrics, event names, or datasource secrets.

## Standards

- Dashboards live under `dashboards/` and must be valid Grafana dashboard JSON.
- Dashboard JSON should use datasource UIDs, not environment-specific URLs or credentials.
- Shared/operator dashboards stay under `dashboards/operator/`; node-specific dashboards stay under `dashboards/nodes/<node>/`.
- Alerting code stays under `alerts/` because Grafana Git Sync currently supports dashboards and folders only.
- Keep query labels aligned with `docs/spec/observability.md`: `app`, `env`, `service`, and Prometheus `node_id`.

## Change Protocol

- Update `README.md` when adding a new synced path, alerting provisioning method, or dashboard ownership rule.
- Test dashboard JSON locally with the dev Grafana stack before promoting to Grafana Cloud.

## Notes

- Scaffolding only at present — `dashboards/{operator,nodes}/` are placeholder dirs. The first real dashboards land in a follow-up.
- Grafana Git Sync does not yet support alerting resources; `alerts/README.md` documents the manual provisioning path until upstream support exists.
