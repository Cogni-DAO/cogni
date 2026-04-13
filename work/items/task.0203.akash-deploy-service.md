---
id: task.0203
type: task
title: "Akash deploy service — ContainerRuntimePort + mock provider + HTTP API"
status: needs_merge
priority: 2
rank: 10
estimate: 3
summary: "Shared ContainerRuntimePort package with group-based isolation model, akash-deployer HTTP service with mock adapter, crew-orchestrator LangGraph graph (unwired), GitOps manifests."
outcome: "ContainerRuntimePort is a shared package usable by provisionNode and akash-deployer. The HTTP service deploys workloads into isolated groups, proven e2e with curl and 9 smoke tests."
spec_refs: akash-deploy-service-spec
assignees: [derekg1729]
credit:
project: proj.akash-crew-deploy
branch: feat/akash-deploy-service
pr: https://github.com/Cogni-DAO/node-template/pull/638
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-26
updated: 2026-03-26
labels: [infra, akash, containers]
external_refs:
---

# Akash Deploy Service — ContainerRuntimePort + Mock + HTTP API

## Requirements

- `@cogni/container-runtime` shared package with `ContainerRuntimePort` interface
- Group-based isolation model (k8s namespace / Akash SDL / Docker network)
- `MockContainerRuntime` adapter for testing
- `services/akash-deployer` HTTP service with deploy/status/destroy/list APIs
- Crew-orchestrator graph with DI (no hard infrastructure imports)
- GitOps manifests (Kustomize base + overlays + ArgoCD app)
- Spec documenting 4-layer architecture

## Allowed Changes

- `packages/container-runtime/` (new)
- `services/akash-deployer/` (new)
- `packages/langgraph-graphs/src/graphs/crew-orchestrator/` (new)
- `infra/cd/base/akash-deployer/`, `infra/cd/overlays/*/akash-deployer/`
- `infra/cd/argocd/applications/akash-deployer.yaml`
- `infra/cd/gitops-service-catalog.json`
- `docs/spec/akash-deploy-service.md`
- `work/projects/proj.akash-crew-deploy.md`

## Plan

- [x] Design spec with 4-layer architecture
- [x] Implement ContainerRuntimePort with group isolation
- [x] MockContainerRuntime adapter
- [x] HTTP service (deploy, groups/:id GET/DELETE, groups list)
- [x] Smoke tests (9 passing)
- [x] E2E curl validation
- [x] Crew-orchestrator graph with DI
- [x] GitOps manifests + overlays
- [x] Extract port to shared package
- [x] pnpm check: 13/13 green

## Validation

**Command:**

```bash
pnpm --filter @cogni/container-runtime build
pnpm --filter @cogni/akash-deployer-service test
pnpm check
```

**Expected:** Package builds with dts. 9 tests pass. All 13 checks green.

## Review Checklist

- [x] **Work Item:** task.0203 linked in PR body
- [x] **Spec:** akash-deploy-service-spec invariants upheld
- [x] **Tests:** 9 smoke tests cover deploy lifecycle + isolation
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

- @derekg1729
