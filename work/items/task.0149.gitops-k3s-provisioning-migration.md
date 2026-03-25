---
id: task.0149
type: task
title: "GitOps k3s provisioning + scheduler-worker migration"
status: needs_review
priority: 1
rank: 1
estimate: 3
summary: "Install k3s on existing Compose VM, install Argo CD, migrate scheduler-worker from Docker Compose to k3s. Single VM per environment — no separate k3s VM."
outcome: "scheduler-worker running on k3s, managed by Argo CD, with rollback-by-revert capability. Same VM as Compose. Deployment promotion is a manifest change, not a script execution."
spec_refs: ci-cd-spec, services-architecture-spec
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: feat/gitops-k3s-provisioning
pr: 573
reviewer:
revision: 1
blocked_by:
deploy_verified: false
created: 2026-03-09
updated: 2026-03-20
labels: [deployment, infra, ci-cd, gitops]
external_refs:
---

# GitOps k3s Provisioning + Scheduler-Worker Migration

## Context

task.0148 creates all deployment manifests, IaC modules, and Argo CD config. This task applies them: install k3s + Argo CD, migrate scheduler-worker, verify, and retire it from Docker Compose.

PR #573 is the initial implementation. Revision 1 consolidates from 2 VMs to 1 VM per environment.

## Review (rev 1) — Single-VM Consolidation

PR #573 provisions a **separate k3s VM** via `infra/tofu/cherry/k3s/main.tf`. This doubles VMs per environment (cost, ops surface) for a single-service migration. Not worth it.

**Decision:** Install k3s on the existing Compose VM instead.

### Why this works

- k3s is lightweight (~512MB RAM) and coexists with Docker Compose on the same host
- scheduler-worker pod on k3s talks to Postgres/Temporal/LiteLLM on localhost — no cross-VM networking, no firewall rules, no `inventory.env` IP management
- A crashed k3s pod doesn't affect Compose any more than a crashed Compose container does today
- Same GitOps value: Argo CD, manifest-driven promotion, rollback-by-revert — all independent of VM count
- Unblocks P2 (preview envs) without requiring additional VMs

### TODOs for rev 1

- [ ] Merge k3s install into `base/bootstrap.yaml` cloud-init (remove `infra/tofu/cherry/k3s/` module)
- [ ] Update `inventory.env` overlays: service addresses → `127.0.0.1` / localhost
- [ ] Remove cross-VM firewall rules from provisioning
- [ ] Keep: Argo CD install, SOPS/age, app-of-apps, ksops sidecar, profile gating, `promote-k8s-image.sh`
- [ ] Keep: `COMPOSE_PROFILES` gating for scheduler-worker migration
- [ ] Update `INFRASTRUCTURE_SETUP.md` runbook: remove "provision k3s VM" step, add "k3s installed via cloud-init on Compose VM"
- [ ] Verify k3s + Docker Compose coexistence (k3s uses containerd, Compose uses dockerd — no conflict)

## Validation

- [ ] Single VM provisioned via `tofu apply` with k3s installed
- [ ] Argo CD installed and accessible
- [ ] scheduler-worker pod running, /livez and /readyz healthy
- [ ] Temporal workflows executing successfully
- [ ] Billing attribution flowing (scheduler-worker → app billing ingest)
- [ ] Rollback test: revert manifest PR → Argo syncs previous image
- [ ] scheduler-worker removed from Docker Compose runtime stack

## PR / Links

- PR: [#573](https://github.com/Cogni-DAO/node-template/pull/573)
- Handoff: [handoff](../handoffs/task.0149.handoff.md)
