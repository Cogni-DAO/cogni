---
id: task.0149
type: task
title: "GitOps k3s provisioning + scheduler-worker migration"
status: needs_design
priority: 1
rank: 1
estimate: 3
summary: "Provision k3s cluster via OpenTofu, install Argo CD, point at deployment manifests from task.0148, migrate scheduler-worker from Docker Compose to k3s. Verify health, billing, and Temporal connectivity. Retire scheduler-worker from Compose."
outcome: "scheduler-worker running on k3s, managed by Argo CD, with rollback-by-revert capability. Docker Compose stack continues running app + postgres + temporal + litellm. Deployment promotion is a manifest change, not a script execution."
spec_refs: ci-cd-spec, services-architecture-spec
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0148
deploy_verified: false
created: 2026-03-09
updated: 2026-03-09
labels: [deployment, infra, ci-cd, gitops]
external_refs:
---

# GitOps k3s Provisioning + Scheduler-Worker Migration

## Context

task.0148 creates all deployment manifests, IaC modules, and Argo CD config. This task applies them: provision the k3s VM, install Argo CD, migrate scheduler-worker, verify, and retire it from Docker Compose.

## Design

_Detailed design deferred until task.0148 is implemented and manifests are validated. Key open questions:_

- Cherry Servers VM plan/region for k3s node
- Network connectivity between k3s VM and Compose VM (same VLAN? public IP + firewall?)
- SOPS age key generation and distribution
- Argo CD admin access and RBAC
- CI integration for auto-PR on image push (may be separate task)
- Monitoring: how Alloy/Grafana Cloud scrapes k3s pod metrics

## Validation

- [ ] k3s cluster provisioned via `tofu apply`
- [ ] Argo CD installed and accessible
- [ ] scheduler-worker pod running, /livez and /readyz healthy
- [ ] Temporal workflows executing successfully
- [ ] Billing attribution flowing (scheduler-worker → app billing ingest)
- [ ] Rollback test: revert manifest PR → Argo syncs previous image
- [ ] scheduler-worker removed from Docker Compose runtime stack
