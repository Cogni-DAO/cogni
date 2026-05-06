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

## Operating Model

This mirrors the log-access model in `.claude/commands/logs.md`:

- agents use the Grafana stack service-account token for reads
- Grafana brokers access to the data source
- the backing system enforces least privilege (`app_readonly` for Postgres)
- no agent needs SSH, `kubectl exec`, or public inbound Postgres

The PDC signing token is not an agent read credential. It is a deploy-time tunnel credential used by the PDC agent to get an SSH certificate from Grafana Cloud. Agents should normally only need `GRAFANA_URL` + `GRAFANA_SERVICE_ACCOUNT_TOKEN` to query an already-provisioned datasource.

## Bootstrap: PDC for a New Environment

Bootstrapping Grafana Cloud Postgres read access for an environment (`candidate-a`, `preview`, `production`) is a **three-stage** flow. Skipping any stage produces a connected agent that Grafana cannot route to. The error you see when stage 3 is missing is `socks connect ... ->postgres:5432: unknown error network unreachable`.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Stage 1: Mint a PDC signing token                       (Grafana UI)  │
│ Stage 2: Drop secrets into env + run infra deploy       (CLI + CI)    │
│ Stage 3: Bind each datasource to the PDC network        (Grafana UI)  │
└──────────────────────────────────────────────────────────────────────┘
```

### Stable concepts

These don't change between environments and don't need to be re-derived:

- **PDC network** — one per Grafana org by default. For this org: `pdc-derekg1729-default`. Multiple environments can share one network; they are distinguished by separate signing tokens, not separate networks.
- **`GRAFANA_PDC_HOSTED_GRAFANA_ID`** — stable per Grafana org. Copy from the Docker snippet on the **Configuration Details** tab of the PDC network.
- **`GRAFANA_PDC_CLUSTER`** — stable per Grafana org region (e.g. `prod-ap-southeast-1`). Copy from the same Docker snippet.

These vary per environment:

- **`GRAFANA_PDC_SIGNING_TOKEN`** — generate one fresh `glc_…` per environment so tokens can be revoked independently.
- The runtime `pdc-agent` container — runs in each env's Compose stack, on the `internal` network alongside `postgres`.

### Footguns proven in the field

- The token JWT payload's `.n` field is the **token name**, not the network identifier. Do not feed it to anything as a network id.
- `GRAFANA_PDC_HOSTED_GRAFANA_ID` cannot be derived from the token payload — it does not appear there. Always copy it from the Docker snippet.
- `secureSocksProxyUsername` set on a datasource via the API is **not sufficient**. Grafana Cloud routes by the datasource ↔ PDC binding established through the Connection > **Private data source connect** dropdown on the datasource page (Stage 3 below). Without that, the agent connects, the SOCKS gateway is reachable, and queries still fail with `network unreachable`.

### Stage 1 — Mint a signing token

UI:

1. Open **Connections → Private data source connections**: <https://derekg1729.grafana.net/connections/private-data-source-connections>
2. Open the org PDC network (`pdc-derekg1729-default`).
3. **Configuration Details** tab → **Use a PDC signing token** → **Create a new token**.
4. Token name: `<env>-postgres-YYYYMMDD` (descriptive only; routing does not use this name).
5. Expiration: `No expiry` is acceptable for v0; rotate on a calendar otherwise.
6. **Create token**, then immediately copy three things from the generated Docker snippet — Grafana shows the token value once:

   - `glc_…` value (after `-token`) — store as `GRAFANA_PDC_SIGNING_TOKEN`
   - integer (after `-gcloud-hosted-grafana-id`) — store as `GRAFANA_PDC_HOSTED_GRAFANA_ID`
   - region string (after `-cluster`) — store as `GRAFANA_PDC_CLUSTER`

### Stage 2 — Drop secrets into the env and deploy

```bash
pnpm setup:secrets --env <env> --only GRAFANA_PDC --all
```

This writes both the GitHub `<env>` environment secrets and the local `.env.<env>` file. Do not store the signing token in `.env.cogni`; that file is for agent-read credentials only.

Preflight the token before triggering CI (catches a bad token in 2 seconds rather than 5 minutes):

```bash
COGNI_ENV_FILE=.env.<env> bash scripts/grafana-pdc-token-preflight.sh
```

Expected: `[grafana-pdc-preflight] signer preflight passed: HTTP 200`. HTTP 401 means the signing token + hosted-grafana-id pair is wrong; redo Stage 1.

Then run the env's infra deploy (for `candidate-a`, `gh workflow run candidate-flight-infra.yml --ref <branch>`; for `preview`/`production`, the standard promote/deploy path). The deploy:

- starts the `pdc-agent` Compose service alongside the existing infra,
- prints the agent's first ~40 log lines into the workflow output (look for `Authenticated to private-datasource-connect…` and `This is Grafana Private Datasource Connect!`),
- runs `scripts/ci/provision-grafana-postgres-datasources.sh` to create one datasource per node DB.

After this stage, two of three signals are green:

| Signal | Where | Expected |
| --- | --- | --- |
| Tunnel up | workflow output | `connected` / `Authenticated` lines |
| Datasource exists | `GET /api/datasources/uid/cogni-<env>-<node>-postgres` | HTTP 200 |
| Datasource ↔ PDC bound | UI dropdown on datasource page | **not yet** |

The provision script's `select current_user` validation will **fail with `network unreachable`** until Stage 3 is done. That is expected — proceed.

### Stage 3 — Bind each datasource to the PDC network (Grafana UI)

For each datasource the provision script created:

1. Open the datasource edit page:
   `<grafana-url>/connections/datasources/edit/cogni-<env>-<node>-postgres`
2. Scroll to the **Connection** section.
3. Set the **Private data source connect** dropdown to **`pdc-derekg1729-default`**.
4. Click **Save & test**. Expect: green `Database Connection OK`. The datasource will now appear under "Data sources using this network" on the PDC network's Overview tab.

This step is currently manual because Grafana Cloud writes additional internal state when the dropdown is set that the public API does not (yet) accept on a JSON `PUT`. Until that is captured and reproduced in `provision-grafana-postgres-datasources.sh`, the bootstrap is two-clicks-per-datasource at the end.

### Verify end-to-end (agent-side, no SSH)

```bash
COGNI_ENV_FILE=/path/to/.env.cogni \
  scripts/grafana-postgres-query.sh \
    'select current_user, count(*)::int as fills from poly_copy_trade_fills' \
    cogni-<env>-poly-postgres | jq .
```

Expected: `current_user = app_readonly`, `fills` is an integer.

### Recovery: `key signing request failed: invalid credentials`

This is a stale or wrong-paired signing token. Mint a fresh one (Stage 1), preflight, re-run Stage 2 only — Stage 3 bindings persist across token rotations because they bind to the network, not the token.

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

`GRAFANA_PDC_CLUSTER` and `GRAFANA_PDC_HOSTED_GRAFANA_ID` come from Grafana's generated PDC agent Docker command (Configuration Details tab). They are stable per Grafana org and do not need to be re-copied per environment. `GRAFANA_PDC_NETWORK_ID` is intentionally not used by the runtime path — `secureSocksProxyUsername` in the datasource config does not establish PDC routing on Grafana Cloud; the UI dropdown does (Stage 3). The legacy `GRAFANA_PDC_NETWORK_ID` env var remains read in places only as historical baggage.

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

This is the intended agent-facing prototype command, analogous to `scripts/loki-query.sh`:

```bash
scripts/grafana-postgres-query.sh \
  'select id, status, created_at from work_items order by created_at desc limit 20' \
  cogni-candidate-a-operator-postgres | jq .
```

## Validation

Both humans and AI agents validate this end-to-end through Grafana Cloud only — no SSH, no `kubectl exec`, no public Postgres. Two independent signals must be green:

### 1. PDC tunnel is connected (Loki signal)

Alloy on the runtime VM ships the `pdc-agent` container's stdout/stderr to Grafana Cloud Loki under `service="pdc-agent"`. Read it like any other service:

```bash
COGNI_ENV_FILE=/path/to/.env.cogni \
  scripts/loki-query.sh \
    '{env="candidate-a",service="pdc-agent"}' \
    30 100 \
  | jq -r '.data.result[].values[][1]'
```

Healthy looks like:

```text
level=info msg="connecting to Grafana"
level=info msg="connected" ...
```

Failure looks like:

```text
key signing request failed: invalid credentials
ssh: handshake failed
```

If Loki returns no streams for `service="pdc-agent"`, Alloy is dropping the container. Confirm `infra/compose/runtime/configs/alloy-config.metrics.alloy` keeps `pdc-agent` in its `discovery.relabel "docker_logs"` keep regex.

### 2. Datasource end-to-end query (Postgres signal)

```bash
scripts/grafana-postgres-query.sh \
  'select current_user, count(*)::int as fills from poly_copy_trade_fills' \
  cogni-candidate-a-poly-postgres | jq .
```

Expected:

- `current_user = app_readonly`
- `fills` is an integer

Then verify write denial:

```sql
create table grafana_write_probe(id int);
```

Expected: the write probe fails with permission/read-only errors.

### Required local credentials for agent validation

Both helpers source from the first present file in `$COGNI_ENV_FILE`, then `./.env.canary`, then `./.env.local`:

- `GRAFANA_URL` (e.g. `https://<org>.grafana.net`)
- `GRAFANA_SERVICE_ACCOUNT_TOKEN` (`glsa_…`)

The same `glsa_…` token is used by CI to provision datasources and by agents to read them, so it needs all four datasource permissions: `datasources:read`, `datasources:query`, `datasources:create`, `datasources:write`. The simplest way to satisfy this is to attach the token to a service account with role **Editor** (or **Admin**); a `Viewer`-role SA will 403 on PUT during provisioning.

The PDC signing token (`glc_…`) is not used at agent-read time. It only authenticates the runtime `pdc-agent` container at deploy time.

## SOC 2 Notes

This is a v0 operational support role. Keep the compensating controls explicit:

- dedicated role, separate from app and service roles
- no `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE`, `ALTER`, or `DROP` grants
- no public inbound Postgres; use PDC/private network connectivity for Grafana Cloud
- Grafana service-account tokens scoped to datasource read/query for normal use
- datasource-write token used only for setup/rotation
- quarterly access review of Grafana service accounts and datasource permissions

## Pivot Criteria

Stay on Grafana PDC while the blocker is a correctable token or tunnel setup issue. Pivot only if Grafana Cloud cannot reliably issue or authenticate PDC signing tokens for this stack/network after direct signer preflight.

The preferred pivot is not SSH and not public Postgres. The fallback prototype should be an authenticated internal DB-read API or small query gateway deployed beside the app/Postgres, using the same `app_readonly` role, statement timeouts, and read-only SQL guard. That would trade Grafana's unified read key for a separate agent DB-read token, so PDC remains the better v0 if we can make it stable.
