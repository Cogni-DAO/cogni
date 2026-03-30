---
id: task.0187
type: task
title: "AI-accessible production debugging — K8s + Argo CD API access"
status: needs_design
priority: 1
rank: 2
estimate: 2
summary: "Create read-only K8s service account and Argo CD API token so AI agents can inspect pod status, logs, events, sync state, and trigger rollbacks without SSH."
outcome: "AI agents can query pod logs, describe pods, view Argo sync status, and initiate rollback via API — no SSH keys required."
spec_refs:
assignees: []
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0149
deploy_verified: false
created: 2026-03-19
updated: 2026-03-19
labels: [deployment, infra, gitops, observability]
external_refs:
---

# AI-Accessible Production Debugging

## Problem

Production debugging currently requires SSH to the Cherry Servers VM. AI agents cannot SSH — they have no access to privileged deploy keys. When production goes down (as it did 2026-03-17), the AI agent can see Loki logs and CI logs but cannot inspect container state, restart services, or roll back.

## Deliverables

1. **K8s read-only service account** — ClusterRole with get/list/watch on pods, events, logs, deployments, services. Token stored as GitHub secret for CI/agent use.
2. **Argo CD API token** — read + sync permissions. Enables AI agents to check sync status, view app health, and trigger sync/rollback.
3. **Agent toolchain wiring** — kubeconfig available to CI agents so they can run kubectl commands (pod status, logs, deploy diffs) without SSH.

## Validation

- [ ] AI agent can run `kubectl get pods -n production` via service account token
- [ ] AI agent can query Argo CD API for app sync status
- [ ] No SSH key required for any debugging operation

## Depends On

- task.0149 (k3s cluster provisioned + Argo CD installed)
