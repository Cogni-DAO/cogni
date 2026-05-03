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

Do not expose Postgres to the public internet for this. Grafana Cloud should reach Postgres through a private network path such as Grafana Cloud Private Data Source Connect (PDC), or the datasource should run inside the same private runtime network.

The control boundary is Postgres, not Grafana: `db-provision` creates `app_readonly` with `SELECT` on per-node DB tables and no write grants. The role has `BYPASSRLS` for v0 support/debugging across tenants; vNext should replace this with actor-scoped access.

## Human Unblock: Candidate-A PDC

Current state: the Grafana service-account token can create datasources. Candidate-a is only missing the PDC values that let Grafana Cloud reach private `postgres:5432` without opening Postgres to the internet.

This is a **Docker Compose runtime** setup, not a k8s setup. Candidate-a Postgres runs in the VM Compose stack, and the PDC agent runs in that same Compose project/network next to Postgres. Grafana Cloud reaches the Docker-internal host `postgres:5432` through PDC. K8s only consumes Postgres through existing EndpointSlice bridges; do not deploy the PDC agent in k8s for this path.

Human does this once through `setup-secrets`. Grafana only generates **one secret** here: the PDC signing token. The deploy/provision scripts derive the hosted Grafana ID, cluster, and network ID from that token, so the human does not need to copy those fields separately.

Run:

```bash
pnpm setup:secrets --env candidate-a --only GRAFANA_PDC_SIGNING_TOKEN --all
```

When the prompt asks for `GRAFANA_PDC_SIGNING_TOKEN`:

1. Open Grafana PDC: <https://derekg1729.grafana.net/connections/private-data-source-connections>
2. Select the candidate-a Docker/Compose runtime PDC network, or create one named `cogni-candidate-a`.
3. Open **Configuration Details** and click **Generate token**.
4. Paste the generated token into the `setup-secrets` prompt.

```bash
GRAFANA_PDC_SIGNING_TOKEN=<GCLOUD_PDC_SIGNING_TOKEN from Grafana>
```

Do not store this token in `.env.cogni`. It is a deploy secret and belongs in the GitHub `candidate-a` environment. `setup-secrets` writes it there.

Then tell the agent:

```text
GRAFANA_PDC_SIGNING_TOKEN is set in the candidate-a GitHub environment. Finish candidate-a Grafana Postgres.
```

Agent verifies the secret exists, then runs this from the PR branch:

```bash
gh secret list --repo Cogni-DAO/node-template --env candidate-a | rg '^GRAFANA_PDC_SIGNING_TOKEN[[:space:]]'
gh workflow run candidate-flight-infra.yml \
  --repo Cogni-DAO/node-template \
  --ref codex/grafana-postgres-readonly
```

After that run finishes, the agent validates:

```bash
env_file=/Users/derek/dev/cogni-template/.env.cogni
export GRAFANA_URL="$(rg -m1 '^GRAFANA_URL=' "$env_file" | sed 's/^GRAFANA_URL=//' | awk '{print $1}')"
export GRAFANA_SERVICE_ACCOUNT_TOKEN="$(rg -m1 '^GRAFANA_SERVICE_ACCOUNT_TOKEN=' "$env_file" | sed 's/^GRAFANA_SERVICE_ACCOUNT_TOKEN=//' | awk '{print $1}')"

scripts/grafana-postgres-query.sh \
  'select current_user, count(*)::int as fills from poly_copy_trade_fills' \
  cogni-candidate-a-poly-postgres | jq .
```

Expected:

```text
current_user = app_readonly
fills > 0
```

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

`deploy-infra.sh` also starts the Grafana PDC agent when these environment secrets are present:

```bash
GRAFANA_PDC_SIGNING_TOKEN=<token from PDC Configuration Details>
```

`GRAFANA_PDC_HOSTED_GRAFANA_ID`, `GRAFANA_PDC_CLUSTER`, and `GRAFANA_PDC_NETWORK_ID` may be set explicitly, but normally they are derived from `GRAFANA_PDC_SIGNING_TOKEN`.

## Grafana Datasource

The candidate-a / preview / production workflows run `scripts/ci/provision-grafana-postgres-datasources.sh` after infra deploy. The script derives the readonly password from `POSTGRES_ROOT_PASSWORD`, creates one datasource per `COGNI_NODE_DBS` entry, and validates each datasource with `select current_user`.

For Grafana Cloud, the datasource host must be `postgres:5432` through PDC. The CI provisioning script refuses to create public Postgres datasources unless `GRAFANA_POSTGRES_ALLOW_NON_INTERNAL_HOST=1` is deliberately set.

Use a Grafana stack service-account token for `GRAFANA_SERVICE_ACCOUNT_TOKEN`, usually prefixed `glsa_`. Grafana Cloud access-policy tokens prefixed `glc_` are for the Cloud API and telemetry services, not the Grafana instance HTTP API that creates datasources.

```bash
export GRAFANA_URL=https://<org>.grafana.net
export GRAFANA_SERVICE_ACCOUNT_TOKEN=glsa_...
export GRAFANA_PDC_NETWORK_ID=<pdc-network-id>
DEPLOY_ENVIRONMENT=candidate-a \
POSTGRES_ROOT_PASSWORD=<root-secret> \
COGNI_NODE_DBS=cogni_operator,cogni_poly,cogni_resy \
scripts/ci/provision-grafana-postgres-datasources.sh
```

For local experiments only, `scripts/grafana-postgres-datasource.sh` can still create a single datasource when explicitly supplied `GRAFANA_POSTGRES_PASSWORD`.

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
- no public inbound Postgres; use PDC/private network connectivity for Grafana Cloud
- Grafana service-account tokens scoped to datasource read/query for normal use
- datasource-write token used only for setup/rotation
- quarterly access review of Grafana service accounts and datasource permissions
