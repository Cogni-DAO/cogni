---
id: task.0149
type: handoff
work_item_id: task.0149
status: active
created: 2026-03-24
updated: 2026-03-24
branch: feat/gitops-k3s-provisioning
last_commit: 9aa3f712
---

# Handoff: GitOps k3s provisioning — single-VM consolidation

## Context

- Production went down 2026-03-17 because the SSH+Compose deploy pipeline is fragile (openclaw-gateway health check failure killed the whole deploy) and AI agents cannot debug it (no SSH access)
- PR #573 (`feat/gitops-k3s-provisioning`) implements k3s + Argo CD GitOps for scheduler-worker, but provisions a **separate VM** per environment — doubles cost and ops surface
- **Rev 1 decision**: install k3s on the existing Compose VM instead of a second VM. All GitOps machinery (Argo CD, Kustomize, SOPS, promote script) stays — only the VM topology changes
- This unblocks task.0187 (AI-accessible prod debugging) and task.0188 (per-branch preview envs) without additional infrastructure cost
- Parent project: `proj.cicd-services-gitops` — P1 GitOps Foundation

## Current State

- PR #573 is open, CI green, but **not mergeable** as-is (2-VM architecture rejected)
- task.0148 (Kustomize manifests, Argo CD config, SOPS/age) is **done** — all reusable
- Rev 1 review with TODOs written in `work/items/task.0149.gitops-k3s-provisioning-migration.md`
- Production is currently running on Docker Compose (last successful deploy: March 14, patched since)
- TigerBeetle disabled by default as of `73fc5f7d` (was crash-looping on both envs)

## Decisions Made

- Single VM per environment — see `work/items/task.0149.gitops-k3s-provisioning-migration.md` § "Review (rev 1)"
- P1 outcome includes AI-accessible debugging (K8s API + Argo CD API, no SSH) — `work/projects/proj.cicd-services-gitops.md` line 111
- P2 elevated to per-branch preview environments — same project file, line 133
- Profile gating (`COMPOSE_PROFILES`) for scheduler-worker migration is the right approach — keep it

## Next Actions

- [ ] Merge k3s install into `infra/tofu/cherry/base/bootstrap.yaml` cloud-init (remove `infra/tofu/cherry/k3s/` module entirely)
- [ ] Update `infra/cd/overlays/*/inventory.env`: service addresses → `127.0.0.1`
- [ ] Remove cross-VM firewall rules from OpenTofu provisioning
- [ ] Update `docs/runbooks/INFRASTRUCTURE_SETUP.md`: remove "provision k3s VM" step
- [ ] Verify k3s + Docker Compose coexistence (k3s uses containerd, Compose uses dockerd — no conflict)
- [ ] Test full flow: `tofu apply` → cloud-init installs k3s + Argo CD → scheduler-worker pod healthy → Temporal connectivity works
- [ ] Run `pnpm check` before committing

## Risks / Gotchas

- k3s and Docker use different container runtimes (containerd vs dockerd) — they coexist fine, but `docker ps` won't show k3s pods; use `kubectl` or `crictl`
- Disk pressure on prod VM (was 3GB free / 95% used as of March 17) — k3s images add to this. Deploy script already has cleanup, but monitor
- The `promote-k8s-image.sh` script had a broken `sed` command — fixed in `fe5e5ab6`, verify it works on the overlay path
- Do NOT merge without a running k3s cluster — merging removes scheduler-worker from staging Compose (profile not active) with nothing to replace it

## Pointers

| File / Resource                                             | Why it matters                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `work/items/task.0149.gitops-k3s-provisioning-migration.md` | Work item with rev 1 review + TODOs                          |
| `work/projects/proj.cicd-services-gitops.md`                | P1/P2 roadmap with updated outcomes                          |
| PR #573 (`feat/gitops-k3s-provisioning`)                    | Current implementation to rework                             |
| `infra/tofu/cherry/base/bootstrap.yaml`                     | Target: merge k3s install here                               |
| `infra/tofu/cherry/k3s/`                                    | Source: k3s cloud-init to port, then delete module           |
| `infra/cd/`                                                 | Kustomize manifests + Argo CD config (task.0148, keep as-is) |
| `infra/cd/overlays/staging/inventory.env`                   | Cross-VM IPs → change to localhost                           |
| `scripts/ci/promote-k8s-image.sh`                           | Image digest promotion script                                |
| `scripts/ci/deploy.sh`                                      | Compose deploy script (reads `COMPOSE_PROFILES`)             |
| `docs/runbooks/INFRASTRUCTURE_SETUP.md`                     | Provisioning runbook to update                               |
