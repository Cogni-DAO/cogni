---
id: bug.0195
type: bug
title: "TigerBeetle unreachable in all envs — native client floods ~72M garbage log lines/day to Grafana Cloud"
status: needs_merge
priority: 1
rank: 10
estimate: 3
summary: "TB server is unreachable in preview AND production (ConnectionRefused). The tigerbeetle-node N-API client retries sub-second, writing ~36M warning(message_bus) lines/day per env directly to stderr from its Zig runtime — bypassing Pino, invisible to linters, shipping ~8.6GB/day of unstructured garbage to Grafana Cloud Loki."
outcome: "TB either runs healthy in preview/prod or TIGERBEETLE_ADDRESS is unset so no client is created. Zero message_bus lines in Loki. Local dev is opt-in only."
spec_refs: financial-ledger
assignees: derekg1729
credit:
project: proj.financial-ledger
branch: bug/0195-tigerbeetle-oom-log-flood
pr: https://github.com/Cogni-DAO/node-template/pull/623
reviewer:
revision: 3
blocked_by:
deploy_verified: false
created: 2026-03-24
updated: 2026-03-24
labels: [infra, docker, observability, financial-ledger, cost]
external_refs:
---

# TigerBeetle unreachable in all environments

## Problem

Three compounding issues affecting local dev, preview, AND production:

### 1. TB server is down/unreachable in preview and production

Grafana Cloud Loki confirms both environments are emitting continuous `error.ConnectionRefused` from the app's TB client. The app has `TIGERBEETLE_ADDRESS` configured but the TB server is either not deployed, OOM-killed, or misconfigured in those environments.

**Evidence (2026-03-24, 24h window):**

- Preview: ~152K warnings per 6-min Loki bucket, constant rate
- Production: ~125K warnings per 6-min Loki bucket, constant rate
- Estimated total: **~72 million log lines/day** across both envs
- At ~120 bytes/line: **~8.6 GB/day of garbage to Grafana Cloud**
- TB "connected" log appeared only twice in preview (app restarts) — server unreachable in between

### 2. Native client floods stderr on connection failure

When the TB server is down, the `tigerbeetle-node` N-API addon's internal `message_bus` retries connections on a sub-second loop. Each retry writes `warning(message_bus): <id>: on_connect: error to=0 error.ConnectionRefused` directly to **stderr from the Zig runtime**. This is not a JS `console.warn` — it's a native write that:

- Bypasses Pino entirely (no JSON structure, no log level filtering)
- Cannot be caught by ESLint/Biome `no-console` rules
- Pollutes dev terminal output and Loki in all environments
- Produces 20+ lines per second continuously

### 3. Local dev: TB OOM crash-loops

TB 0.16.x mmaps a 1GiB journal (1024 WAL slots × 1MiB, `prepares_size=1GiB`) at startup. Combined with `--cache-grid`, TB needs ~1.1–1.3GiB. With Docker Desktop at 3.8GiB shared across 15+ services, the kernel OOM-killer targets TB every ~60s (exit 137, `OOMKilled=true`). The `--development` flag only relaxes safety checks — does NOT reduce journal size. No flag exists to control slot count in 0.16.x.

## Partial Fix Applied

Local dev only — makes TB opt-in so the default dev experience is clean:

- Moved TB to opt-in `--profile tigerbeetle` in docker-compose.dev.yml
- Removed TB from `dev:infra` / `dev:infra:test` default service lists
- Added `pnpm dev:infra:tb` convenience script
- Commented out `TIGERBEETLE_ADDRESS` in `.env.local` and `.env.local.example`
- Added `mem_limit: 2g` to container definition
- Reduced `--cache-grid` from 256MiB to 128MiB
- CI updated to pass `--profile tigerbeetle` explicitly

## Remaining Work (URGENT)

### P0: Stop the log flood in preview/prod

1. **Unset `TIGERBEETLE_ADDRESS`** in preview and production env configs — the app already handles `undefined` gracefully (`FinancialLedgerPort | undefined`). This immediately stops the ~72M lines/day flood.
2. **Verify Grafana Cloud bill impact** — check if the garbage volume has pushed us into a higher billing tier or exhausted free-tier log ingestion.

### P1: Decide on TB deployment strategy

3. **Is TB actually deployed in preview/prod?** — Check docker-compose.yml (prod) on the Cherry Servers VMs. If TB isn't provisioned or OOM-killed, the address config is just wrong.
4. **If TB should be deployed:** ensure it has adequate memory (≥2GiB container limit) and a healthcheck dependency so the app doesn't start its client until TB is ready.
5. **If TB is not needed yet:** remove `TIGERBEETLE_ADDRESS` from all non-CI env configs and document when it should be re-enabled (e.g., when financial ledger features are user-facing).

### P2: Architectural improvements

6. **Structured logging for native client warnings** — Zig runtime stderr writes can't be intercepted in JS. Options: upstream log callback request, accept healthy-server = no warnings.
7. **Docker Desktop memory guidance** — Document 6GB+ minimum for full stack with TB in dev setup docs.
8. **Investigate TB memory reduction** — upstream may support smaller journals in future versions.

## Validation

```bash
# Local: TB should NOT start with default dev:infra
pnpm dev:infra
docker ps --format '{{.Names}}' | grep tigerbeetle  # should be empty

# Local: TB starts only when explicitly requested
pnpm dev:infra:tb
docker ps --format '{{.Names}}' | grep tigerbeetle  # should show container

# Local: No message_bus warnings when TIGERBEETLE_ADDRESS is unset
pnpm dev 2>&1 | grep -c message_bus  # should be 0

# Preview/Prod: After env fix, verify in Grafana Cloud
# {env="preview", service="app"} |~ "message_bus"  → should be 0 results
# {env="production", service="app"} |~ "message_bus"  → should be 0 results
```

## Affected files

- `infra/compose/runtime/docker-compose.dev.yml` — profile + mem_limit + cache-grid
- `package.json` — dev:infra scripts, dev:infra:tb
- `.github/workflows/ci.yaml` — --profile tigerbeetle
- `.env.local` / `.env.local.example` — TIGERBEETLE_ADDRESS commented out
- `infra/compose/runtime/docker-compose.yml` — profile + mem_limit (prod compose, deployed via deploy.sh to Cherry Servers VMs)
