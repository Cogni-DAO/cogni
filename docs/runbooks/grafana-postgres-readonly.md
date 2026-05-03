---
id: grafana-postgres-readonly
type: runbook
title: Grafana Postgres Read-Only Access
status: active
summary: Provision and use a read-only Postgres role through Grafana Cloud for agent debugging and support.
---

# Grafana Postgres Read-Only Access

## Purpose

Give on-call humans and agents a fast read path for per-node Postgres state without SSH or `kubectl exec`.

The control boundary is Postgres, not Grafana: `db-provision` creates `app_readonly` with `SELECT` on per-node DB tables and no write grants. The role has `BYPASSRLS` for v0 support/debugging across tenants; vNext should replace this with actor-scoped access.

## Provision

Deploy or re-run infra bootstrap so `infra/compose/runtime/postgres-init/provision.sh` runs:

```bash
docker compose --project-name cogni-runtime --profile bootstrap up db-provision
```

The role defaults are:

```bash
APP_DB_READONLY_USER=app_readonly
APP_DB_READONLY_PASSWORD=<derived from POSTGRES_ROOT_PASSWORD>
```

`scripts/ci/deploy-infra.sh` writes those into the runtime `.env`. To override rotation, set both values in the deployment environment.

## Grafana Datasource

Use a Grafana service account token with datasource write permission once to create or update a datasource:

```bash
export GRAFANA_URL=https://<org>.grafana.net
export GRAFANA_SERVICE_ACCOUNT_TOKEN=glsa_...
export GRAFANA_POSTGRES_HOST=<env>.vm.cognidao.org:5432
export GRAFANA_POSTGRES_PASSWORD=<APP_DB_READONLY_PASSWORD>
COGNI_ENV=candidate-a COGNI_NODE=poly scripts/grafana-postgres-datasource.sh
```

The helper also auto-sources `COGNI_ENV_FILE`, `.env.cogni`, `.env.canary`, or `.env.local` when `GRAFANA_URL` / `GRAFANA_SERVICE_ACCOUNT_TOKEN` are not already exported.

Datasource UID convention:

```text
cogni-<env>-<node>-postgres
```

Examples: `cogni-candidate-a-poly-postgres`, `cogni-preview-operator-postgres`.

## Query

Use a Grafana service account token with datasource query permission:

```bash
scripts/grafana-postgres-query.sh \
  'select count(*) from poly_copy_trade_fills' \
  cogni-candidate-a-poly-postgres | jq .
```

The helper refuses obvious non-read SQL locally. Postgres permissions are still the authoritative write-denial control.

## Validation

Run these through Grafana:

```sql
select current_user;
select count(*) from poly_copy_trade_fills;
```

Then verify write denial:

```sql
create table grafana_write_probe(id int);
```

Expected: the first two queries succeed as `app_readonly`; the write probe fails with permission/read-only errors.

## SOC 2 Notes

This is a v0 operational support role. Keep the compensating controls explicit:

- dedicated role, separate from app and service roles
- no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE`, `ALTER`, or `DROP` grants
- Grafana service-account tokens scoped to datasource read/query for normal use
- datasource-write token used only for setup/rotation
- quarterly access review of Grafana service accounts and datasource permissions
