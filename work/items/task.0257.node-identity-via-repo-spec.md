---
id: task.0257
type: task
title: "Fix node identity — wire node_id from repo-spec, not env var slug"
status: needs_merge
priority: 0
rank: 1
estimate: 3
summary: "Replace COGNI_NODE_ID env var slug with UUID from .cogni/repo-spec.yaml. Add nodes[] registry to operator repo-spec. Create per-node repo-spec files. Wire getNodeId() into container. Update callback routing to use UUIDs."
outcome: "Each node reads its identity from its own .cogni/repo-spec.yaml (UUID). Operator repo-spec declares all nodes with paths and endpoints. LiteLLM callback routing uses UUIDs, not slugs. COGNI_NODE_ID env var removed."
spec_refs:
  - docs/spec/multi-node-tenancy.md
  - docs/spec/node-operator-contract.md
  - docs/spec/identity-model.md
assignees: derekg1729
credit:
project: proj.operator-plane
branch: feat/task-0257-repo-spec-identity
pr: https://github.com/Cogni-DAO/node-template/pull/690
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-01
updated: 2026-04-02
labels: [identity, repo-spec, multi-node, architecture]
external_refs:
---

## Context

task.0256 implemented per-node billing routing using `COGNI_NODE_ID=poly` (a string
slug in env). This violates REPO_SPEC_AUTHORITY — `node_id` should be a UUID read
from `.cogni/repo-spec.yaml`, not a hardcoded env var.

`getNodeId()` already exists in `shared/config/repoSpec.server.ts` and reads from
repo-spec. But:

- Poly has no `.cogni/repo-spec.yaml`
- Resy/node-template have stale `version: 1` format that doesn't match the real schema
- Container uses `env.COGNI_NODE_ID` instead of `getNodeId()`

## Design

### Operator repo-spec declares child nodes

Add `nodes[]` to operator's `.cogni/repo-spec.yaml`:

```yaml
nodes:
  - node_id: "4ff8eac1-..." # operator (self)
    node_name: "Cogni Operator"
    path: "."
    endpoint: "http://app:3000"
  - node_id: "<poly-uuid>"
    node_name: "Poly Prediction"
    path: "nodes/poly"
    endpoint: "http://poly:3100"
  - node_id: "<resy-uuid>"
    node_name: "Resy Helper"
    path: "nodes/resy"
    endpoint: "http://resy:3300"
```

Each node at `{path}/.cogni/repo-spec.yaml` has its own DAO, payments, governance.
Operator repo-spec is the node registry. Node formation appends to this list.

### Per-node repo-spec files

Create/rewrite `.cogni/repo-spec.yaml` for each node with real schema:

- `node_id` (UUID), `scope_id`, `scope_key`, `cogni_dao.chain_id` (minimum)
- Node-template uses placeholder UUIDs with comments

### Remove COGNI_NODE_ID env var

- `container.ts`: `nodeId: getNodeId()` (reads from repo-spec)
- Remove `COGNI_NODE_ID` from `server-env.ts` schema
- Dev scripts: set `COGNI_REPO_ROOT` per node so `getNodeId()` reads correct repo-spec
- `cogni_callbacks.py`: still reads `COGNI_NODE_ENDPOINTS` env (Python can't read YAML),
  but values are UUID-keyed from repo-spec `nodes[]`

### Schema changes

`packages/repo-spec/src/schema.ts`:

- Add `nodeRegistryEntrySchema` (node_id, node_name, path, endpoint)
- Add `nodes: z.array(nodeRegistryEntrySchema).optional()` to `repoSpecSchema`

`packages/repo-spec/src/accessors.ts`:

- Add `extractNodes()` accessor

## Allowed Changes

- `.cogni/repo-spec.yaml` — add `nodes` section
- `nodes/poly/.cogni/repo-spec.yaml` — CREATE
- `nodes/resy/.cogni/repo-spec.yaml` — REWRITE
- `nodes/node-template/.cogni/repo-spec.yaml` — REWRITE
- `packages/repo-spec/src/schema.ts` — add node registry schema
- `packages/repo-spec/src/accessors.ts` — add extractNodes
- `apps/operator/src/bootstrap/container.ts` — nodeId from getNodeId()
- `nodes/*/app/src/bootstrap/container.ts` — same
- `apps/operator/src/shared/env/server-env.ts` — remove COGNI_NODE_ID
- `nodes/*/app/src/shared/env/server-env.ts` — same
- `.env.local.example` — remove COGNI_NODE_ID, update COGNI_NODE_ENDPOINTS
- `package.json` — COGNI_REPO_ROOT per node in dev scripts

## Notes from task.0256 review

**Seed data for multi-node:** System tenant (billing account + virtual key) is
created by migration 0008, so `db:migrate:nodes` handles it — each node boots
fine. But `seed-money.mts` (dev credit top-up) only ran against operator.
Fixed in task.0256: `db:seed-money:nodes` tops up all 3 DBs, and
`db:setup:nodes` now includes it. Governance seed data (`seed.mts`) remains
operator-only — poly/resy have different features, not attribution.

When wiring `COGNI_NODE_ENDPOINTS` to use repo-spec UUIDs, update
`.env.local.example` and `COGNI_NODE_ENDPOINTS` format accordingly
(e.g., `<uuid>=http://...` instead of `operator=http://...`).

## Validation

- [ ] `pnpm check:fast` passes
- [ ] Each node's `getNodeId()` returns UUID from its own repo-spec
- [ ] Operator repo-spec `nodes[]` has 3 entries
- [ ] `COGNI_NODE_ID` env var no longer exists in any server-env.ts
- [ ] LLM call metadata contains UUID node_id, not slug
- [ ] Callback routing uses UUID keys in `COGNI_NODE_ENDPOINTS`
