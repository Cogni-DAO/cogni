# knowledge-sync-service · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Status:** draft

## Purpose

**KNOWLEDGE_SYNC_SERVICE:** A scheduled reconciliation worker that mirrors each node's
Doltgres knowledge DB (`knowledge_<node>`) to its DoltHub remote (`cogni-dao/knowledge-<node>`)
via `dolt_push`. It is the catch-up layer for the operator app's best-effort, no-retry
post-merge push (MIRROR_BEST_EFFORT_NO_RETRY): a periodic, idempotent, fast-forward push heals
any commits that an on-merge push dropped (failures, restarts, the doltgres outage windows).
This is the spec's named v1 — "reconciliation cron diffs dolt_log against origin/main".

v0 wires only the `operator` node. Per-node fan-out is config-driven and deferred.

## The two paths (read before touching the adapters)

| Path                                                | Adapter                    | Status                                                                                         |
| --------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| **GRPC `dolt_push`** (creds in the Doltgres server) | `DoltGrpcRemoteAdapter`    | **LIVE** — the only path that lands commits on DoltHub                                         |
| DoltHub HTTP SQL/write API (PAT)                    | `DoltHubHttpRemoteAdapter` | **SEAM** — 2026-06-03 spike proved PAT writes silently no-op; reserved for read-side lag check |
| In-memory (CI)                                      | `FakeDoltRemoteAdapter`    | test isolation                                                                                 |

The 2026-06-03 spike (live, throwaway DoltHub repo, prod PAT): the HTTP `write/{from}/{to}`
endpoint returns `Success` but commits nothing (`to_commit_id` empty); no repo-delete REST
endpoint; error bodies echo the `Authorization` token. The push creds (`DOLT_CREDS_JWK`/`KEYID`)
live in the doltgres container (`install-creds.sh`), so this worker only needs a SQL connection
to trigger `dolt_push`. See `work/handoffs/task.5069.spike-findings.md`.

## HARD SAFETY — push/additive ONLY

Every emitted statement passes `assertAdditive`: only `dolt_remote('add', …)` (idempotent) and
`dolt_push(remote, branch)` (no `--force`). NEVER `dolt_reset` / `drop` / `truncate` / `--force`.
A non-fast-forward push is rejected by the remote (safe); a forced push or reset would overwrite
published history — exactly the `reset --hard` mirror seed that truncated 688 work_items.

## Architecture

```
src/
├── config.ts            # Zod env singleton + isMirrorEnabled() gate
├── ports/
│   └── dolt-remote.port.ts   # DoltRemotePort + DoltRemotePortError + DoltPushResult
├── adapters/
│   ├── dolt-grpc-remote.ts   # LIVE: dolt_remote add + dolt_push over Doltgres SQL
│   ├── dolthub-http-remote.ts# SEAM: HTTP write API (throws — see spike)
│   └── fake-dolt-remote.ts   # CI fake
├── sql/escape.ts        # escapeRef/escapeValue + assertAdditive (HARD SAFETY guard)
├── reconcile.ts         # buildRemoteAdapter() gate + the interval loop (drain, non-overlapping)
├── observability/       # pino logger (sole importer), redact, prom-client metrics
├── health.ts            # /livez /readyz /version /metrics (node:http, no framework)
└── main.ts              # composition root: loadConfig → buildRemoteAdapter → startReconciler
```

### Hard rules

- **WORKER_IS_DUMB**: thin composition root. No row introspection — `dolt_push` mirrors the whole DB.
- **observability/logger.ts is the only file** that imports pino directly.
- **ports/ is interfaces + error classes only** — no runtime IO.
- Relative imports use `.js` extensions (ESM, `bundle: false`).

## Boundaries

```json
{
  "layer": "services",
  "may_import": ["packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "bootstrap",
    "types"
  ]
}
```

## Public Surface

- **Exports:** none (standalone service).
- **CLI:** `pnpm --filter @cogni/knowledge-sync-service dev|build|start`
- **Env** (`src/config.ts`, all optional → boots healthy + idle when unset):
  - `DOLTGRES_URL` — node's `knowledge_<node>` connection (superuser).
  - `DOLTHUB_REMOTE_URL` — **the push gate** (MIRROR_PROD_ONLY_WRITER; prod scope only).
  - `SYNC_NODE` (default `operator`), `SYNC_REMOTE_NAME` (`origin`), `SYNC_BRANCH` (`main`),
    `SYNC_INTERVAL_SECONDS` (900, min 60), `SYNC_RUN_ON_START` (`true`),
    `SYNC_PUSH_TIMEOUT_MS` (120000), `LOG_LEVEL`, `SERVICE_NAME`, `HEALTH_PORT` (9000).
- **Metrics:** `knowledge_sync_push_total{node,outcome}`, `knowledge_sync_push_duration_ms{node}`,
  `knowledge_sync_last_push_success_timestamp_seconds{node}`, `knowledge_sync_mirror_enabled{node}`.
- **Log events:** `knowledge-sync.push.{start,ok,error}`, `knowledge-sync.reconcile.{tick,disabled}`,
  `knowledge-sync.lifecycle.{starting,ready,shutdown,fatal}`.

## Deployment

- **Optional / in-flight** (create-service.md §10): kept OUT of `wait-for-argocd.sh` APPS so a
  best-effort reconciler never blocks a flight.
- Mirror disabled on candidate-a/preview/dev (no `DOLTHUB_REMOTE_URL`) → healthy no-op.

## Change Protocol

- Update this file when env vars, adapters, or the safety guard change.
- Changes require updating `infra/compose/runtime/docker-compose*.yml` and the k8s base.
