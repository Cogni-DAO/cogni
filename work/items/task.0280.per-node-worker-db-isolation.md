---
id: task.0280
type: task
title: "Worker HTTP delegation: scheduler-worker drops direct-DB access for runs/grants"
status: needs_merge
priority: 1
rank: 1
estimate: 3
summary: "Scheduler-worker becomes stateless compute: all graph_runs writes and grant validations flow through the owning node's internal HTTP API. Worker holds zero per-node DB credentials on the scheduler path. Closes bug.0322 (cross-node runs visibility) and restores chat on poly/resy in preview/prod (worker can't write graph_runs into the wrong DB when it doesn't hold DB creds)."
outcome: "Scheduler-worker writes nothing to any node's Postgres. createGraphRunActivity/updateGraphRunActivity/validateGrantActivity call POST/PATCH against `{nodeUrl}/api/internal/...` authenticated by SCHEDULER_API_TOKEN. Each node owns its own graph_runs/grants via its own DATABASE_URL. Cross-node run isolation is enforced by data placement, not by hope."
spec_refs:
  - docs/spec/multi-node-tenancy.md
  - docs/spec/scheduler.md
assignees: []
credit:
project: proj.unified-graph-launch
initiative:
branch: worktree-task.0280-worker-http-persistence
pr: https://github.com/Cogni-DAO/node-template/pull/922
reviewer:
revision: 1
blocked_by:
  - task.0279
deploy_verified: false
related:
  - bug.0322
  - task.0324
created: 2026-04-03
updated: 2026-04-20
labels:
  - ai-graphs
  - multi-node
  - scheduler
  - security
external_refs:
---

# Worker HTTP delegation — design

## Principle

Shared compute services hold **no per-node DB credentials**. All node-owned state is mutated through the owning node's HTTP API. The worker becomes pure orchestration (Temporal client + retry + idempotency coordination). Data-plane isolation follows from data placement, not from hope.

## Why Option B, not Option A

Option A (worker holds N DSNs, resolves by nodeId) spreads the coupling across more credentials and forces the worker to track every node's schema version. Option B isolates schema knowledge in each node, reuses the `{nodeUrl}/api/internal/…` seam the worker already owns for `executeGraphActivity`, and gives us a natural place to enforce node-scoped authorization later. One extra in-cluster RTT per state transition is a non-measurable cost.

## What changes

### 1. New node internal endpoints

Auth'd by `Authorization: Bearer ${SCHEDULER_API_TOKEN}` (same pattern as existing `POST /api/internal/graphs/{graphId}/runs`). Added to every node (`operator`, `poly`, `resy`, `node-template`):

| Method | Path                                      | Purpose                                                                  |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/api/internal/graph-runs`                | Create `graph_runs` row (idempotent; re-create on same runId is a no-op) |
| PATCH  | `/api/internal/graph-runs/{runId}`        | Update status / traceId / errorCode / errorMessage                       |
| POST   | `/api/internal/grants/{grantId}/validate` | Validate grant for graph; returns `ok` + grant summary or mapped 403     |

### 2. New contracts

`packages/node-contracts/src/`:

- `graph-runs.create.internal.v1.contract.ts`
- `graph-runs.update.internal.v1.contract.ts`
- `grants.validate.internal.v1.contract.ts`

Every consumer imports `z.infer` types; no hand-rolled shapes.

### 3. Worker adapters (new)

`services/scheduler-worker/src/adapters/run-http.ts`:

- `HttpGraphRunWriter` — implements the write subset of `GraphRunRepository` the worker uses (`createRun`, `markRunStarted`, `markRunCompleted`).
- `HttpExecutionGrantValidator` — implements `ExecutionGrantWorkerPort.validateGrantForGraph`.

Constructor: `({ nodeEndpoints, schedulerApiToken, logger })`. Each method takes `nodeId` as its first positional parameter (after `actorId`) so the adapter resolves `nodeUrl = nodeEndpoints.get(nodeId)` and routes correctly.

### 4. Activity + workflow signature change

`CreateGraphRunInput`, `UpdateGraphRunInput`, `ValidateGrantInput` gain `nodeId: string`. Plumbed from `GraphRunWorkflowInput.nodeId` (already present). Activities pass `nodeId` to adapters.

### 5. Bootstrap

`services/scheduler-worker/src/bootstrap/container.ts::createContainer` no longer constructs Drizzle adapters for runs/grants. `DATABASE_URL` becomes optional in the scheduler path — the ledger container still consumes it (orthogonal; noted as follow-up task).

### 6. CI/CD + rollout

- Both node-app and scheduler-worker rebuild on any shared-package change already — no new wiring needed.
- **Deploy order: node-apps first, scheduler-worker second.** New worker against old nodes would 404 on the new routes. candidate-flight already `kubectl rollout status`'s each deployment; enforce order explicitly in `scripts/ci/deploy-infra.sh` or by adding an initContainer on the worker that waits for node readyz.
- `scheduler-worker-secrets.DATABASE_URL` stays for now (ledger path). Scheduler path tolerates its absence. Follow-up task: rename to `LEDGER_DATABASE_URL` and enforce "no plain DATABASE_URL on worker".
- Revert is image-only — Drizzle adapters live in git history; no secret or schema migration.

### 7. Regression test

Stack test: register on poly → chat/completions → assert poly `/agent/runs` returns the run AND operator `/agent/runs` does not contain it. Locks bug.0322 closed.

### 8. Spec invariant

`docs/spec/multi-node-tenancy.md` gains a **run-visibility invariant**: "A run originated on node X is persisted in node X's database and is never retrievable from another node's API, regardless of bearer origin. Shared compute services hold no per-node DB credentials."

## Phase 2 — failure isolation (QUEUE_PER_NODE_ISOLATION)

Review caught that phase 1 isolated **data** per node but coupled **liveness** across all nodes via:

1. A single Temporal task queue — a flapping node's retries ate worker concurrency shared with healthy nodes.
2. An initContainer blocking worker boot until every node's `/readyz` passed — one dead node stalled all workflow execution everywhere.

Phase 2:

1. **Per-node task queues**: submitters send to `${TEMPORAL_TASK_QUEUE}-${getNodeId()}`; worker runs one Temporal `Worker` per canonical nodeId found in `COGNI_NODE_ENDPOINTS` plus a drain Worker on the legacy queue. Each `worker.run()` catches its own error so one failing queue doesn't tear down siblings.
2. **Delete initContainer**: the worker's only hard startup dep is Temporal. Per-node HTTP reachability emits a Prometheus gauge `scheduler_worker_node_reachable{node_id}` and a boot-time warn log — never gates.
3. **4xx → non-retryable**: `translateHttpError` in activities wraps `GrantNotFound/Expired/Revoked/ScopeMismatch` + non-retryable `RunHttpClientError` as `ApplicationFailure.nonRetryable`; 5xx and network errors bubble for Temporal's retry policy.
4. **Config drift guard**: worker logs an error at boot if `COGNI_NODE_ENDPOINTS` has no UUID entries. Submitters use UUIDs (from `.cogni/repo-spec.yaml`), so slug-only endpoints would starve every per-node queue. Compose `docker-compose.yml` + `docker-compose.dev.yml` defaults updated to include UUID aliases, matching k8s overlays.

Invariant added: `QUEUE_PER_NODE_ISOLATION` in `docs/spec/multi-node-tenancy.md`.

Follow-ups:

- task.0327 — drain-queue migration script (rewrite existing Temporal Schedules' `taskQueue` to per-node) + per-node HTTP circuit breaker on the worker adapter.
- task.0326 — rename ledger-only `DATABASE_URL` → `LEDGER_DATABASE_URL` to make `SHARED_COMPUTE_HOLDS_NO_DB_CREDS` enforceable.

## Out of scope

- Ledger/attribution still uses `DATABASE_URL` in the worker (separate port, separate workflow). task.0326.
- Bearer `aud` / nodeId claim (bug.0322 defect-2). Separate PR — orthogonal to data-plane fix.
- Per-Worker concurrency tuning (task.0327 candidate).

## Validation

- Typecheck, lint, and unit tests green locally: `pnpm --filter @cogni/scheduler-worker-service test` (116 tests) + 4 node-app typechecks.
- bug.0322 regression check shipped in `scripts/ci/smoke-candidate.sh` (register-on-poly → chat → assert run on poly, not on operator).
- Dep-cruiser: `services/scheduler-worker/src` clean; activities import ports, not adapters.
- Flight to candidate-a via normal app-lever flight; no infra flight required.

## PR / Links

- PR: https://github.com/Cogni-DAO/node-template/pull/922 (merged as commit `27db31327`)
- Handoff: [handoff](../handoffs/task.0280.handoff.md)
