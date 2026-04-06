---
id: task.0279
type: task
title: "Node-aware execution routing — nodeId in workflow input + per-node API dispatch"
status: needs_closeout
priority: 1
rank: 3
estimate: 2
summary: "Add nodeId to GraphRunWorkflowInput. Worker resolves per-node API URL for executeGraphActivity. Chat facade + schedule creation pass nodeId from repo-spec. Billing follows automatically."
outcome: "All graph execution routes to the originating node. Billing callbacks land on the correct node's DB. No cross-node charge misattribution."
spec_refs:
  - graph-execution-spec
assignees: []
credit:
project: proj.unified-graph-launch
branch: feat/task-0279-multi-node-execution-routing
pr:
reviewer:
revision: 1
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

# Node-aware execution routing

## Context

On canary, ALL graph execution (chat + scheduled + webhook) flows through Temporal → scheduler-worker → `executeGraphActivity` → HTTP POST to `APP_BASE_URL`. The worker's `APP_BASE_URL` is a single string hardcoded to operator (`http://app:3000`).

When a user on poly sends a chat message, the execution happens on operator. The LiteLLM billing callback carries operator's `node_id` (set by operator's `InProcCompletionUnitAdapter`). The charge lands in operator's DB. Poly's activity dashboard shows nothing.

**The billing pipeline is already multi-node capable** — `cogni_callbacks.py` routes by `node_id`, each node's billing ingest writes to its own DB. The problem is the execution doesn't happen on the right node.

## Bug

**One field missing**: `GraphRunWorkflowInput` has no `nodeId`. The workflow has no way to tell the worker which node originated the request. The worker POSTs to operator for everything.

Each node already has a unique `node_id` in `.cogni/repo-spec.yaml` (operator: `4ff8eac1...`, poly: `5ed2d64f...`, resy: `f6d2a17d...`). The app reads it via `getNodeId()` at bootstrap. It's just not threaded into the Temporal workflow input.

## Design

### Add `nodeId` at the source, resolve at the worker

**Principle**: The originating node sets `nodeId` once. It flows through unchanged. The worker uses it to route. No backwards compat — all new workflows carry `nodeId`.

### Changes

**1. `GraphRunWorkflowInput` — add `nodeId`**

File: `packages/temporal-workflows/src/workflows/graph-run.workflow.ts`

```typescript
export interface GraphRunWorkflowInput {
  nodeId: string; // ← NEW: originating node identity
  graphId: string;
  // ... rest unchanged
}
```

The workflow passes `nodeId` through to `executeGraphActivity`:

```typescript
const result = await executeGraphActivity({
  nodeId, // ← NEW
  temporalScheduleId,
  graphId,
  // ... rest unchanged
});
```

**2. `ExecuteGraphInput` — add `nodeId`**

File: `services/scheduler-worker/src/activities/index.ts`

```typescript
export interface ExecuteGraphInput {
  nodeId: string; // ← NEW
  temporalScheduleId?: string;
  graphId: string;
  // ... rest unchanged
}
```

**3. Worker resolves per-node API URL**

File: `services/scheduler-worker/src/bootstrap/env.ts` — add:

```typescript
COGNI_NODE_ENDPOINTS: z.string().min(1),
// Format: "operator=http://operator-node-app:3000,poly=http://poly-node-app:3000,resy=http://resy-node-app:3000"
```

File: `services/scheduler-worker/src/activities/index.ts` — change:

```typescript
// Before:
const url = `${config.appBaseUrl}/api/internal/graphs/${graphId}/runs`;

// After:
const nodeUrl = config.nodeEndpoints.get(input.nodeId);
if (!nodeUrl) throw new ApplicationFailure(`Unknown nodeId: ${input.nodeId}`);
const url = `${nodeUrl}/api/internal/graphs/${graphId}/runs`;
```

**4. Chat facade passes `nodeId`**

File: `nodes/*/app/src/app/_facades/ai/completion.server.ts`

```typescript
args: [
  {
    nodeId: getNodeId(), // ← NEW: from repo-spec
    graphId,
    // ... rest unchanged
  },
];
```

**5. Schedule creation passes `nodeId`**

File: `nodes/*/app/src/adapters/server/temporal/schedule-control.adapter.ts`

The schedule's workflow args include `nodeId: getNodeId()`.

**6. Infra config**

- `infra/k8s/base/scheduler-worker/configmap.yaml`: Replace `APP_BASE_URL` with `COGNI_NODE_ENDPOINTS`
- `infra/k8s/overlays/staging/scheduler-worker/kustomization.yaml`: Set per-node URLs
- `infra/k8s/base/scheduler-worker/external-services.yaml`: Add per-node app Services
- `infra/compose/runtime/docker-compose.dev.yml`: Add `COGNI_NODE_ENDPOINTS`

### What about grant validation + graph_runs?

The worker also calls `validateGrantActivity`, `createGraphRunActivity`, `updateGraphRunActivity` — these hit the worker's single `DATABASE_URL`. This is a separate concern (task.0280). For now, the shared DB in staging/prod means these work. When per-node DBs deploy, task.0280 addresses it.

### Evaluating: stable context envelope

Today `nodeId` threads through 4 layers: facade → workflow input → activity input → HTTP URL resolution. That's acceptable for one field. If more per-node context is needed later (billing policy, LLM config, etc.), a `NodeExecutionContext` envelope makes sense. But for now, one field is not worth an abstraction.

## Plan

- [ ] Add `nodeId: string` to `GraphRunWorkflowInput`
- [ ] Add `nodeId: string` to `ExecuteGraphInput`
- [ ] Workflow passes `nodeId` through to executeGraphActivity
- [ ] Worker parses `COGNI_NODE_ENDPOINTS` env, resolves per-node URL
- [ ] Chat facade passes `nodeId` from `getNodeId()`
- [ ] Schedule creation passes `nodeId` from `getNodeId()`
- [ ] Webhook-triggered runs pass `nodeId` from `getNodeId()`
- [ ] Remove `APP_BASE_URL` from worker env (replaced by `COGNI_NODE_ENDPOINTS`)
- [ ] Update k8s configmaps + external-services for per-node routing
- [ ] Update docker-compose for dev
- [ ] `pnpm check`

## Invariants

- **NODE_IDENTITY_IN_WORKFLOW_INPUT**: Every `GraphRunWorkflowInput` carries `nodeId`
- **EXECUTION_ON_ORIGINATING_NODE**: Worker routes to the node that started the workflow
- **NO_BACKWARDS_COMPAT**: All new workflows require `nodeId`. No fallback to operator.

## Validation

```bash
pnpm check
```

- Unit test: worker routes to correct URL based on nodeId
- Integration: verify COGNI_NODE_ENDPOINTS parsing
- Stack test (future): create schedule on poly, verify execution hits poly's API

## Related

- task.0280 — Per-node DB isolation for worker activities (evaluate approach)
- [Multi-Node Tenancy Spec](../../docs/spec/multi-node-tenancy.md) — DB_PER_NODE
- [Graph Execution Spec](../../docs/spec/graph-execution.md) — UNIFIED_GRAPH_EXECUTOR
- [Multi-Node Graph Execution Scaling](../../docs/research/multi-node-graph-execution-scaling.md)
- Handoff: [canary-deploy-secrets-infra](../handoffs/canary-deploy-secrets-infra.handoff.md)
