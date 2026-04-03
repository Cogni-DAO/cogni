---
id: task.0280
type: task
title: "Per-node DB isolation for worker activities — evaluate approach"
status: needs_design
priority: 2
rank: 8
estimate: 2
summary: "Evaluate whether worker should connect to N databases or delegate grant/run persistence to node internal APIs. Required before per-node DB reprovisioning."
outcome: "Clear decision + implementation for how the worker handles per-node grant validation and graph_runs persistence when each node has its own database."
spec_refs:
  - graph-execution-spec
assignees: []
credit:
project: proj.unified-graph-launch
branch:
pr:
reviewer:
revision: 0
blocked_by:
  - task.0279
deploy_verified: false
created: 2026-04-03
updated: 2026-04-03
labels:
  - ai-graphs
  - multi-node
  - scheduler
external_refs:
---

# Per-node DB isolation for worker activities

## Context

After task.0279 lands, the worker routes graph execution to the correct node's API. But the worker also calls 3 DB-touching activities directly:

1. `validateGrantActivity` — queries `execution_grants` table
2. `createGraphRunActivity` — inserts into `graph_runs` table
3. `updateGraphRunActivity` — updates `graph_runs` status

These use the worker's single `DATABASE_URL`. Today, staging/prod share one DB across nodes, so this works. When per-node DBs deploy (reprovisioning), the worker can only see one node's grants and runs.

## Options

### Option A: Worker connects to N databases

Worker parses per-node DB URLs from `SCHEDULER_NODE_REGISTRY`. Activities resolve the correct DB client using `nodeId` from the workflow input.

**Pros**: Worker remains the authority for run lifecycle (create/update/status).
**Cons**: N connection pools in one process. Worker needs DB credentials for every node. More config surface.

### Option B: Delegate grant/run persistence to node internal API

Extend the node's internal API to handle grant validation and graph_runs CRUD. The worker calls HTTP endpoints instead of querying DB directly. The node uses its own DB connection.

```
Worker activities:
  validateGrantActivity → POST {nodeUrl}/api/internal/grants/{grantId}/validate
  createGraphRunActivity → POST {nodeUrl}/api/internal/runs
  updateGraphRunActivity → PATCH {nodeUrl}/api/internal/runs/{runId}
  executeGraphActivity → POST {nodeUrl}/api/internal/graphs/{graphId}/runs  (already exists)
```

**Pros**: Worker becomes stateless (no DB connections). Single source of truth per node. Connection pooling handled by each node's app.
**Cons**: More HTTP calls per workflow (4 instead of 1). Latency. Need new API routes.

### Option C: Hybrid — execution on node, metadata on shared DB

Keep a single shared "orchestration DB" for graph_runs and execution_grants (these are small, low-write tables). Node-local DBs only for heavy data (billing, threads, activity).

**Pros**: Simplest. Worker stays as-is. No new APIs.
**Cons**: Partial DB_PER_NODE — some tables shared, some isolated. Harder to reason about boundaries.

## Evaluation criteria

- Aligns with DB_PER_NODE invariant
- Minimal config surface for N nodes
- Worker stays stateless (or as close as possible)
- No N+1 connection pool problem
- Works for 3 nodes today, 10+ nodes later

## Validation

```bash
pnpm check
```

Decision documented + implementation plan before per-node DB reprovisioning.

## Related

- task.0279 — Node-aware execution routing (prerequisite)
- [Multi-Node Tenancy Spec](../../docs/spec/multi-node-tenancy.md) — DB_PER_NODE
