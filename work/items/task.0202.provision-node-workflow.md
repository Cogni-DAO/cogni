---
id: task.0202
type: task
title: "provisionNode Temporal workflow — zero-touch node launch"
status: needs_design
priority: 1
rank: 1
estimate: 5
summary: "Implement the provisionNode Temporal workflow that chains: node record creation, GitHub repo from template, secret generation, database provisioning, k8s overlay materialization, payment activation, health check, and status transition. Shared cluster, namespace-per-node."
outcome: "Founder clicks 'Launch Node' after DAO formation -> async workflow runs -> node is live at {slug}.nodes.cognidao.org within 15 minutes. Zero manual steps."
spec_refs: node-launch-spec, node-formation-spec, node-operator-contract-spec
assignees: derekg1729
credit:
project: proj.node-formation-ui
branch:
pr:
reviewer:
revision: 1
blocked_by: task.0149
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [infra, multi-tenant, temporal, node-formation, akash-forward]
external_refs:
---

# provisionNode Temporal Workflow

## Context

Node formation (DAO creation via web wizard) is built and working. What's missing is the orchestration that takes formation output and provisions a running node — today this requires 7 manual steps. This task builds the single Temporal workflow that replaces all of them.

Architecture: shared k3s cluster, namespace per node, wildcard DNS, provider-agnostic (Cherry today, Akash later). See [node-launch spec](../../docs/spec/node-launch.md).

## Requirements

### Temporal Workflow: `provisionNode`

- [ ] Activity 1: `createNodeRecord` — write to `operator_node_registrations` (status: provisioning)
- [ ] Activity 2: `createRepoFromTemplate` — GitHub API, commit repo-spec.yaml
- [ ] Activity 3: `generateNodeSecrets` — 4 per-node secrets (AUTH_SECRET, LITELLM_MASTER_KEY, DB password, INTERNAL_OPS_TOKEN), store as k8s Secret in node namespace
- [ ] Activity 4: `provisionDatabase` — CREATE DATABASE + USER on shared Postgres, run migrations
- [ ] Activity 5: `materializeOverlay` — write `infra/cd/nodes/{short-id}/kustomization.yaml`, commit+push to staging. ArgoCD auto-syncs.
- [ ] Activity 6: `activatePayments` — Privy wallet + Split deploy + update repo-spec
- [ ] Activity 7: `waitForHealth` — poll `/readyz` at `{slug}.nodes.cognidao.org`, timeout 10 min
- [ ] Activity 8: `markNodeReady` — update node record status: active, notify founder

### Provider Interface

- [ ] `ClusterProvider` interface (ensureCluster, createNamespace, createSecret)
- [ ] `CherryK3sProvider` adapter (kubectl via kubeconfig)
- [ ] Provider selected via config, not hardcoded

### API Trigger

- [ ] `POST /api/nodes/provision` — accepts formation output, starts workflow
- [ ] Returns `{ node_id, status_url }` immediately (async)
- [ ] `GET /api/nodes/{node_id}/status` — poll endpoint for founder UI

### Prerequisites (blocked_by)

- task.0149: k3s + ArgoCD must be deployed and working
- task.0188: per-namespace pattern must be established
- One-time: wildcard DNS (`*.nodes.cognidao.org` -> cluster ingress)
- One-time: ArgoCD ApplicationSet with git-directory generator for `infra/cd/nodes/*`

## Allowed Changes

- `services/scheduler-worker/src/workflows/` — provisionNode workflow + activities
- `packages/repo-spec/src/` — add `infra` schema fields (v0.2.0)
- `src/app/api/nodes/` — provision + status endpoints
- `src/contracts/` — provision request/response contracts
- `infra/cd/base/node-app/` — shared base kustomize for node apps
- `infra/cd/argocd/` — ApplicationSet for nodes
- `packages/db-schema/src/` — operator_node_registrations table (if not from task.0122)

## Plan

- [ ] Step 1: Define `ClusterProvider` interface + `CherryK3sProvider` stub
- [ ] Step 2: Operator DB table (`operator_node_registrations`)
- [ ] Step 3: Kustomize base for node-app (`infra/cd/base/node-app/`)
- [ ] Step 4: ArgoCD ApplicationSet (git-directory generator for `infra/cd/nodes/*`)
- [ ] Step 5: Implement activities 1-5 (infra provisioning chain)
- [ ] Step 6: Implement activities 6-8 (payments + health + ready)
- [ ] Step 7: Wire Temporal workflow with retry/timeout policies
- [ ] Step 8: API endpoints (provision + status)
- [ ] Step 9: Integration test: mock provider, verify full workflow
- [ ] Step 10: `pnpm check`, docs, AGENTS.md

## Design Notes

### Why Temporal (not a simple background job)

- Idempotent retry per activity — if DB provisioning succeeds but overlay commit fails, retry from step 5 only
- Visibility — workflow status queryable for the founder UI
- Timeout management — per-activity timeouts prevent hung provisions
- Already deployed in the stack

### Akash Forward

The `ClusterProvider` interface exists so that swapping Cherry k3s for Akash SDL is an adapter change. The workflow logic doesn't change — "create namespace" becomes "create Akash deployment", "apply manifests" becomes "update SDL". Shared services may move to managed cloud (Neon Postgres, Temporal Cloud) when Akash migration happens.

## Validation

```bash
pnpm check && pnpm test -- --grep "provisionNode"
```

## Review Checklist

- [ ] All activities are idempotent (safe to retry)
- [ ] No hardcoded Cherry/k3s references in workflow logic (only in adapter)
- [ ] Secrets are generated, not human-provided
- [ ] Node sovereignty invariants upheld (FORK_FREEDOM, REPO_SPEC_AUTHORITY)
- [ ] Workflow completes in <15 min on happy path
