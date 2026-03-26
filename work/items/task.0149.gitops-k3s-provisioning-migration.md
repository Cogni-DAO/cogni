---
id: task.0149
type: task
title: "GitOps k3s provisioning + scheduler-worker migration"
status: needs_merge
priority: 1
rank: 1
estimate: 3
summary: "Install k3s on existing Compose VM, install Argo CD, migrate scheduler-worker from Docker Compose to k3s. Single VM per environment — no separate k3s VM."
outcome: "scheduler-worker running on k3s, managed by Argo CD, with rollback-by-revert capability. Same VM as Compose. Deployment promotion is a manifest change, not a script execution."
spec_refs: ci-cd-spec, services-architecture-spec
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: worktree-cicd-gap-analysis
pr: 628
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-03-09
updated: 2026-03-25
labels: [deployment, infra, ci-cd, gitops]
external_refs:
  - pr: 625
    note: "Codex-generated PR with partial single-VM work; cherry-picked selectively"
---

# GitOps k3s Provisioning + Scheduler-Worker Migration

## Context

task.0148 creates all deployment manifests, IaC modules, and Argo CD config. This task applies them: install k3s + Argo CD, migrate scheduler-worker, verify, and retire it from Docker Compose.

PR #573 is the initial implementation. PR #625 is a Codex-generated follow-up that partially implements single-VM consolidation. Revision 2 merges the best of both.

## Review (rev 1) — Single-VM Consolidation

PR #573 provisions a **separate k3s VM** via `infra/tofu/cherry/k3s/main.tf`. This doubles VMs per environment (cost, ops surface) for a single-service migration. Not worth it.

**Decision:** Install k3s on the existing Compose VM instead.

### Why this works

- k3s is lightweight (~512MB RAM) and coexists with Docker Compose on the same host
- scheduler-worker pod on k3s talks to Postgres/Temporal/LiteLLM on localhost — no cross-VM networking, no firewall rules, no `inventory.env` IP management
- A crashed k3s pod doesn't affect Compose any more than a crashed Compose container does today
- Same GitOps value: Argo CD, manifest-driven promotion, rollback-by-revert — all independent of VM count
- Unblocks P2 (preview envs) without requiring additional VMs

## Review (rev 2) — Gap Analysis of PR #573 + PR #625

### What PR #625 got right (take from #625)

- k3s install merged into `base/bootstrap.yaml` (correct single-VM approach)
- `main.tf` remote-exec health check validates k3s + kubectl availability
- CI gitops validation scripts (`check-gitops-manifests.sh`, `check-gitops-service-coverage.sh`)
- `gitops-service-catalog.json` for enforcing service coverage
- Wired gitops checks into `ci.yaml`, `check-all.sh`, `check-fast.sh`

### What PR #625 is missing (BLOCKERS — take from #573)

1. **No Argo CD install in cloud-init.** Bootstrap installs k3s but not Argo CD. After `tofu apply` there's k3s but no GitOps controller.
2. **No ksops CMP / SOPS secret decryption.** Missing `ksops-cmp.yaml` and `repo-server-patch.yaml`. Argo CD cannot decrypt SOPS-encrypted secrets — every `secretRef` fails.
3. **No GHCR registry auth.** Missing `/etc/rancher/k3s/registries.yaml`. k3s cannot pull private images from `ghcr.io/cogni-dao/*`.
4. **No `promote-k8s-image.sh`.** No way for CI to update overlay digests after pushing a new image. The GitOps promotion loop is broken.
5. **No k3s version pinning.** Uses unpinned `curl | sh` which installs whatever `latest` is. #573 pins `v1.31.4+k3s1`.

### What PR #625 adds that is out of scope (defer)

- `sandbox-openclaw` Kustomize base + overlays — complex multi-container pod, untested. Scheduler-worker goes first per migration strategy.
- `packages/temporal-workflows/` deletion (separate refactor, not infra)
- Dashboard/RLS/review changes (unrelated)
- Work item deletions (unrelated cleanup)

### Implementation checklist (rev 2 — MVP)

**Bootstrap (cloud-init):**

- [ ] k3s install in `base/bootstrap.yaml` with pinned version `v1.31.4+k3s1`
- [ ] Write `/etc/rancher/k3s/registries.yaml` for GHCR private registry auth
- [ ] Write `/etc/rancher/k3s/config.yaml` to disable traefik + servicelb
- [ ] Install age for SOPS decryption
- [ ] Install Argo CD (pinned v2.13.4, non-HA) via `kubectl apply`
- [ ] Apply ksops CMP sidecar to repo-server for secret decryption
- [ ] Create `sops-age-key` K8s Secret (from generated keypair)
- [ ] Apply app-of-apps Application pointing at `infra/cd/overlays/staging`
- [ ] Validate k3s + kubectl + Argo CD in `main.tf` remote-exec health check

**Kustomize manifests:**

- [ ] EndpointSlice addresses → `127.0.0.1` (single-VM, localhost)
- [ ] Keep flat overlay structure (one kustomization.yaml per env, not per-service subdirs)

**CI integration:**

- [ ] `promote-k8s-image.sh` updates overlay digest and commits to staging
- [ ] Wire promote script into `staging-preview.yml` after image push
- [ ] `COMPOSE_PROFILES` gating: scheduler-worker gets `compose-scheduler-worker` profile
- [ ] `deploy.sh` passes `COMPOSE_PROFILES` from workflow env (no hardcoded `--profile`)

**Argo CD config (from task.0148, keep as-is):**

- [ ] `infra/cd/argocd/install.yaml` — Kustomization with pinned Argo CD + ksops
- [ ] `infra/cd/argocd/ksops-cmp.yaml` — CMP plugin ConfigMap
- [ ] `infra/cd/argocd/repo-server-patch.yaml` — Sidecar container + age key mount

**CI validation (from #625):**

- [ ] `check-gitops-manifests.sh` — render overlays via `kubectl kustomize`
- [ ] `check-gitops-service-coverage.sh` — catalog ↔ services/ ↔ manifests sync
- [ ] `gitops-service-catalog.json` — scheduler-worker managed, sandbox-openclaw deferred
- [ ] Wire into `ci.yaml`, `check-all.sh`, `check-fast.sh`

**Cleanup:**

- [ ] Delete `infra/tofu/cherry/k3s/` module (replaced by base bootstrap)
- [ ] Remove cross-VM firewall rules
- [ ] Update `INFRASTRUCTURE_SETUP.md` runbook

**NOT in scope (defer to future tasks):**

- sandbox-openclaw k8s manifests (separate task after scheduler-worker is proven)
- ApplicationSet pattern (app-of-apps is simpler for 1 service)
- temporal-workflows refactor (separate PR)
- Any non-infra code changes

## Validation

- [ ] `tofu apply` on fresh VM → k3s + Argo CD running
- [ ] Argo CD UI accessible (port-forward or NodePort)
- [ ] scheduler-worker pod running, /livez and /readyz healthy
- [ ] Temporal workflows executing successfully
- [ ] Rollback test: revert manifest PR → Argo syncs previous image
- [ ] `pnpm check` passes (including new gitops checks)
- [ ] scheduler-worker removed from Docker Compose runtime stack

## PR / Links

- PR: [#573](https://github.com/Cogni-DAO/node-template/pull/573) — original (2-VM, to be superseded)
- PR: [#625](https://github.com/Cogni-DAO/node-template/pull/625) — Codex partial work (cherry-picked selectively)
- Handoff: [handoff](../handoffs/task.0149.handoff.md)
