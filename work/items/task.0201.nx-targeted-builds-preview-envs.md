---
id: task.0201
type: task
title: "Nx targeted builds + preview environments for monorepo CI/CD"
status: backlog
priority: 1
rank: 1
estimate: 5
summary: "Implement affected-only builds/tests via Nx, per-PR preview environments on shared k3s cluster, and safe agent-triggered preview/test workflows. OSS-first, cost-efficient, pnpm monorepo native."
outcome: "A developer pushes a branch → only affected services/packages build and test → preview deploys to isolated namespace → targeted smoke tests run → URL + status reported to GitHub. Agents can request preview/test actions through narrow workflows, no raw infra access."
spec_refs:
assignees: [derekg1729]
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-25
updated: 2026-03-25
labels: [deployment, infra, ci-cd, nx, preview-envs]
external_refs:
  - url: https://github.com/argoproj/argo-cd
    note: "Argo CD — canonical GitOps deployment reconciler"
  - url: https://github.com/actions/actions-runner-controller
    note: "Autoscaled self-hosted runner pattern on Kubernetes"
  - url: https://github.com/camptocamp/devops-stack
    note: "Reference for cluster bootstrap, Argo structure, GitOps repo layout"
  - url: https://github.com/quipper/monorepo-deploy-actions
    note: "Monorepo-aware deploy slicing and service-targeted workflows"
---

# Nx Targeted Builds + Preview Environments

## Context

Current CI runs everything on every push. No affected-only execution. No per-branch preview environments. Agents can't safely deploy and validate changes end-to-end. Single-VM model couples app runtime, testing, and deployment.

## Core Principles

- Argo is the deploy reconciler, not the CI workflow brain
- Build once, promote by immutable image digest — never rebuild per environment
- Affected-only execution for builds/tests — don't run the world on every push
- Preview envs pooled on shared cluster using namespaces, quotas, TTL cleanup
- Agents request preview/test through narrow workflows — no raw kubectl/Docker
- Local dev stays fast and boring: pnpm + docker compose
- Prefer boring OSS primitives over custom platform magic

## Phase 1 Scope

- [ ] Add Nx targets for build/test/lint per package/service
- [ ] Implement `nx affected` in CI — only build/test what changed
- [ ] ApplicationSet generator for per-PR preview namespaces
- [ ] Wildcard DNS + Ingress for preview URLs
- [ ] ResourceQuota + LimitRange per preview namespace
- [ ] TTL cleanup on PR close or 48h expiry
- [ ] Targeted smoke/integration tests against preview
- [ ] Report preview URL + test status back to GitHub PR

## Phase 2 Scope

- [ ] Autoscaled runners on k3s (Actions Runner Controller)
- [ ] Cleanup TTLs, cost controls, pooled caching
- [ ] Agent-triggered preview/test workflows (`createPreview(branch, services)`)
- [ ] Promotion flow: preview → staging → production by digest
- [ ] Akash portability path where feasible

## Non-Goals

- Do not replace local dev with Kubernetes
- Do not make Argo own test selection or CI orchestration
- Do not give agents direct cluster credentials
- Do not optimize for Akash before Kubernetes shape is clean

## Required Deliverables

- Architecture doc: CI/CD split of responsibilities
- Repo layout: app code, deploy manifests, infra bootstrap
- Preview environment flow: git push → URL + test result
- Runner execution plan: isolated builds/tests off prod VM
- Migration plan: single-VM → shared-cluster previews
- Risk register: what not to attempt in phase 1

## Acceptance

- [ ] Branch push → affected-only build/test → preview deploy → smoke test → PR status
- [ ] Preview environments isolated, resource-limited, auto-cleaned
- [ ] Immutable image digests for promotion
- [ ] Argo only reconciles deploy state; CI/test orchestration separate
- [ ] Documented as phased plan, not just manifests

## References

- [Argo CD](https://github.com/argoproj/argo-cd)
- [Actions Runner Controller](https://github.com/actions/actions-runner-controller)
- [Camptocamp DevOps Stack](https://github.com/camptocamp/devops-stack)
- [Quipper monorepo-deploy-actions](https://github.com/quipper/monorepo-deploy-actions)
