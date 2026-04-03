---
id: task.0279
type: task
title: "Multi-node execution routing — scheduler-worker graph execution targets correct node"
status: needs_design
priority: 1
rank: 3
estimate: 3
summary: "Scheduler-worker executes graphs against the originating node's API, not hardcoded operator. Ensures billing, data isolation, and graph catalog correctness across nodes."
outcome: "Scheduled graph runs on poly execute against poly's API with poly's DB and billing. No cross-node data leakage."
spec_refs:
  - packages-architecture-spec
  - graph-execution-spec
assignees: []
credit:
project: proj.unified-graph-launch
branch: feat/task-0279-multi-node-execution-routing
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-03
updated: 2026-04-03
labels:
  - ai-graphs
  - multi-node
  - scheduler
  - billing
external_refs:
---

# Multi-node execution routing

## Context

The scheduler-worker has a single `APP_BASE_URL` env var (`http://app:3000`), hardcoded to the operator node. When any node creates a Temporal schedule, the worker executes the graph against the operator — regardless of which node originated the schedule.

This means:

1. **Wrong billing** — execution charges operator's billing account, not the originating node's
2. **Wrong database** — graph_runs recorded in operator's DB, not the node's
3. **Wrong graph catalog** — when nodes have divergent graphs, execution fails (404)
4. **Wrong auth context** — execution_grant validated against operator's DB

Chat and webhook-triggered graph execution work correctly — they run in-process in each node's Next.js app. The gap is only in the Temporal scheduled path.

### Evidence

- `services/scheduler-worker/src/activities/index.ts:257`: `const url = ${config.appBaseUrl}/api/internal/graphs/${graphId}/runs`
- `services/scheduler-worker/src/bootstrap/env.ts:39`: `APP_BASE_URL: z.string().url()` — single string, not a map
- `infra/k8s/base/scheduler-worker/configmap.yaml:21`: `APP_BASE_URL: "http://app:3000"`
- `infra/k8s/base/scheduler-worker/external-services.yaml:71-96`: Single `app` Service → one IP
- `ExecuteGraphInput` interface: no `nodeId` field
- `execution_grants` table: no `node_id` column (scoped by per-node DB per DB_PER_NODE)

### Prior art that works

Billing callbacks are already multi-node routed via `COGNI_NODE_ENDPOINTS` in `infra/images/litellm/cogni_callbacks.py`. The `CogniNodeRouter` class routes billing ingest POSTs to the correct node based on `node_id` in spend_logs_metadata. This proves the pattern.

## Bug analysis

### What breaks today

Per `DB_PER_NODE`, each node has its own Postgres database. The scheduler-worker connects to ONE `DATABASE_URL` (operator's service DB). When it validates execution grants for a poly schedule, it queries operator's DB — the grant doesn't exist there.

Actually — today this is silently safe: no node other than operator has schedules yet. Poly and resy don't have schedule-creation UI or API enabled. But the moment they do, this breaks.

### What's at risk

The scheduler-worker's `DATABASE_URL` is the operator's service-role connection. If poly creates a schedule:

1. Worker picks up the Temporal schedule event
2. Worker tries to validate the execution grant against operator's DB → grant not found → execution rejected
3. Even if grant validation is skipped, the HTTP POST goes to operator → operator's billing context is used

This is a data isolation violation per `NO_CROSS_NODE_QUERIES` invariant.

## Design

### Core principle: NODE_IDENTITY_IN_WORKFLOW_INPUT

Every Temporal workflow that triggers graph execution carries `nodeId` in its input. The worker uses this to resolve the correct:

- **API endpoint** (which node to POST to)
- **Database connection** (which node's grants/runs to access)

### Option A: Multi-endpoint routing + per-node DB connections (recommended)

The worker maintains a node registry — a map of `nodeId → { apiUrl, databaseUrl }`. It resolves per-node on every activity execution.

```
SCHEDULER_NODE_REGISTRY = {
  "operator": { "apiUrl": "http://operator-node-app:3000", "dbUrl": "postgresql://...operator_db" },
  "poly":     { "apiUrl": "http://poly-node-app:3000",     "dbUrl": "postgresql://...poly_db" },
  "resy":     { "apiUrl": "http://resy-node-app:3000",     "dbUrl": "postgresql://...resy_db" }
}
```

#### Changes required

**1. Workflow/schedule input carries nodeId**

Add `nodeId: string` to `ExecuteGraphInput` and the Temporal schedule creation payload. Each node's app reads `COGNI_NODE_ID` from its env and passes it when creating schedules.

**2. Worker resolves per-node config**

New env var: `SCHEDULER_NODE_REGISTRY` (JSON string or structured env). The worker parses it at startup and creates per-node DB clients + endpoint URLs.

In `executeGraphActivity`:

```typescript
const nodeConfig = nodeRegistry.get(input.nodeId);
const url = `${nodeConfig.apiUrl}/api/internal/graphs/${graphId}/runs`;
```

**3. Per-node grant validation**

The `DrizzleExecutionGrantWorkerAdapter` currently uses a single DB client. Change to accept the node's DB client from the registry.

**4. Per-node graph_runs recording**

Same pattern — use the node's DB client for inserting/updating graph_runs records.

**5. Infra config**

- k8s ConfigMap: Replace `APP_BASE_URL` with `SCHEDULER_NODE_REGISTRY`
- Docker Compose: Same
- k8s external-services: Add per-node app Services (`operator-app`, `poly-app`, `resy-app`)

#### Migration path

1. Add `nodeId` to `ExecuteGraphInput` with fallback: `input.nodeId ?? "operator"` (backwards compat for existing schedules)
2. Add `SCHEDULER_NODE_REGISTRY` env with fallback to legacy `APP_BASE_URL` (single-node mode)
3. When all schedules carry nodeId, remove the fallback

### Option B: Per-node task queues (deferred)

Each node gets its own Temporal task queue and its own worker instance. Schedules target the correct queue at creation time.

This provides full isolation but requires N worker deployments. Deferred until traffic patterns justify it.

## Plan

### Step 1: Schema + workflow input

- [ ] Add `nodeId: string` to `ExecuteGraphInput` in `services/scheduler-worker/src/activities/index.ts`
- [ ] Add `nodeId` to Temporal schedule creation in app code (where schedules are created)
- [ ] Read `COGNI_NODE_ID` from `serverEnv()` and pass to schedule payload

### Step 2: Worker node registry

- [ ] Add `SCHEDULER_NODE_REGISTRY` to `services/scheduler-worker/src/bootstrap/env.ts`
- [ ] Parse into `Map<string, { apiUrl: string; dbUrl: string }>`
- [ ] Fallback: if not set, use `APP_BASE_URL` as single-node mode for backwards compat

### Step 3: Per-node routing in executeGraphActivity

- [ ] Resolve `nodeConfig` from registry using `input.nodeId`
- [ ] Use `nodeConfig.apiUrl` for the HTTP POST
- [ ] Log node routing decision for observability

### Step 4: Per-node DB connections for grants + runs

- [ ] Create per-node `DrizzleExecutionGrantWorkerAdapter` instances at bootstrap
- [ ] Route grant validation to the correct node's DB
- [ ] Route graph_runs insert/update to the correct node's DB

### Step 5: Infra config

- [ ] Update `infra/k8s/base/scheduler-worker/configmap.yaml` with `SCHEDULER_NODE_REGISTRY`
- [ ] Update k8s overlays (staging, production) with per-node URLs
- [ ] Add per-node `app` Services + EndpointSlices to `external-services.yaml`
- [ ] Update `docker-compose.dev.yml` and `docker-compose.yml`

### Step 6: Validate

- [ ] `pnpm check`
- [ ] Stack test: create schedule on node, verify execution routes correctly
- [ ] Verify billing goes to correct node's charge_receipts

## Invariants

- **NODE_IDENTITY_IN_WORKFLOW_INPUT**: Every Temporal workflow input carries `nodeId`
- **DB_PER_NODE**: Worker accesses the correct node's database for grants and runs
- **NO_CROSS_NODE_QUERIES**: Worker never queries the wrong node's DB
- **BACKWARDS_COMPAT**: Existing schedules without `nodeId` default to operator

## Validation

```bash
pnpm check
```

- Stack test: create schedule on operator, verify execution targets operator API
- Stack test: create schedule on poly (when enabled), verify execution targets poly API
- Verify grant validation uses the correct node's DB
- Verify graph_runs written to the correct node's DB
- Verify billing charge_receipts land in the correct node's DB

## Related

- [Multi-Node Tenancy Spec](../../docs/spec/multi-node-tenancy.md) — DB_PER_NODE, NO_CROSS_NODE_QUERIES
- [Graph Execution Spec](../../docs/spec/graph-execution.md) — UNIFIED_GRAPH_EXECUTOR
- [Multi-Node Graph Execution Scaling](../../docs/research/multi-node-graph-execution-scaling.md) — Paths A/B/C analysis
- task.0250 — Extract @cogni/graph-execution-host (done)
- task.0181 — Spike: Worker-local execution (future)
