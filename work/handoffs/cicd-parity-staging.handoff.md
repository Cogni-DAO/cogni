---
id: cicd-parity-staging
type: handoff
work_item_id: task.0281
status: active
created: 2026-04-04
updated: 2026-04-04
branch: canary
last_commit: 9cd213cdc
---

# Handoff: CI/CD Pipeline — Deploy Branch Model + Preview/Production Green

## Context

- Canary multi-node is working: 3 k8s pods (operator/poly/resy), Compose infra, Argo CD, Grafana pod logs flowing
- The pipeline is blocked because `promote-and-deploy.yml` needs to commit image digests but can't push to protected branches
- **Decision made:** use `deploy/*` branches (one per env) for Argo-tracked deploy state. CI PRs digest updates there. App code stays on protected branches. See `docs/spec/ci-cd.md` for the spec
- Preview VM (84.32.110.74) has k3s + Argo but no Compose services or apps — provision died mid-run
- Production is legacy single-node Compose, untouched

## Current State

- **Canary VM (84.32.109.222):** readyz 200 all nodes. Grafana logs via `{source="k8s", env="canary"}`. deploy-infra proven
- **Preview VM (84.32.110.74):** k3s + Argo bootstrapped. No Compose, no namespace, no secrets, no apps. DNS points here. Needs deploy-infra to run
- **Production VM (84.32.109.162):** Legacy single-node. `.env.production` saved locally. SSH key at `~/.ssh/cogni_template_production_deploy`
- **Pipeline chain:** `Build Multi-Node` (canary) ✅ → `Promote and Deploy` (runs from staging) ❌ fails: missing git identity + can't push to protected branch → `E2E Smoke` ⏭️ skipped
- **PR #744:** EndpointSlice IPs for preview, open to staging, waiting CI
- **`docs/spec/ci-cd.md`:** Updated with deploy branch model, but the code hasn't been implemented yet

## Decisions Made

- **Deploy branch model** agreed: `deploy/canary`, `deploy/staging`, `deploy/production` branches hold rendered overlay state. Argo tracks these. CI creates PRs to update digests, never pushes directly. See `docs/spec/ci-cd.md` sections: Branch Model, Promote and Deploy, Branch Protection
- deploy-infra.sh creates k8s secrets from GitHub env secrets (bridge until ESO — task.0284): PR #739
- SOPS/ksops removed from bootstrap — secrets managed directly by provision + deploy-infra: commit `4cbdccaed`
- `workflow_run` always executes from default branch (staging). Any workflow fix must land on staging to take effect
- Turborepo CI optimization (task.0260) plan reviewed and refined — separate from this work, no blockers between them

## Next Actions

- [ ] **Create deploy branches.** `deploy/canary`, `deploy/staging`, `deploy/production`. Seed each with its environment's `infra/k8s/overlays/{env}/` content. Update Argo ApplicationSets to track `deploy/{env}` instead of `canary`/`staging`/`main`
- [ ] **Update `promote-and-deploy.yml`** to create a PR against `deploy/{env}` branch (not push to app branch). Add `git config user.name/email`. Auto-merge the PR. This must land on staging (default branch) for `workflow_run` to use it
- [ ] **Verify canary pipeline end-to-end:** push to canary → Build Multi-Node → Promote and Deploy PRs to `deploy/canary` → auto-merge → Argo syncs → verify readyz → E2E smoke
- [ ] **Merge PR #744** (EndpointSlice IPs for preview) to staging
- [ ] **Run deploy-infra against preview VM** via `workflow_dispatch` of promote-and-deploy.yml for preview environment — starts Compose services, creates k8s secrets, applies ApplicationSets
- [ ] **Provision production VM** with `provision-test-vm.sh production --yes` (after preview is proven). `.env.production` saved locally. Old VM at 84.32.109.162 (project 254821)
- [ ] **Destroy old VMs** after new ones verified: staging at 84.32.109.160 (project 254586), production at 84.32.109.162 (project 254821). Also clean up `infra/tofu/` (old tofu state)
- [ ] **Fix provision-test-vm.sh** (task.0285): credential mismatch volume reset, migrations, Cherry SSH key collision, branch-protection-aware overlay push

## Risks / Gotchas

- **`workflow_run` reads from staging.** Every `promote-and-deploy.yml` fix must be cherry-picked or merged to staging before it takes effect. Canary-only changes are invisible to the triggered workflow
- **`.env.preview` and `.env.production` are on Derek's laptop** (gitignored). GitHub secrets are write-only — can't reconstruct DB passwords. These files are the only way to reprovision without losing database data
- **Provision script has 4 known bugs** (task.0285): TMPDIR collision (fixed #743), Cherry SSH key collision (manual workaround), ksops missing files (fixed), branch protection push failure (unfixed — deploy branch model eliminates this)
- **Old `infra/tofu/` directory** has production tofu state. The new `infra/provision/` directory is the standard. Production must be migrated before `infra/tofu/` can be deleted
- **Argo ApplicationSet paths must match deploy branch content.** If overlays move to deploy branches, the ApplicationSet `path:` must point to the same relative path on the deploy branch

## Pointers

| File / Resource                                                | Why it matters                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `docs/spec/ci-cd.md`                                           | **Read first.** Updated spec with deploy branch model, pipeline chain, branch protection rules |
| `.github/workflows/promote-and-deploy.yml`                     | The workflow to fix. Needs deploy-branch PR flow + git identity                                |
| `.github/workflows/build-multi-node.yml`                       | Build-only (canary). Works correctly. No changes needed                                        |
| `scripts/ci/deploy-infra.sh`                                   | Compose infra + k8s secrets. Runs in CI. Proven on canary                                      |
| `scripts/setup/provision-test-vm.sh`                           | VM creation. Multiple known bugs (task.0285)                                                   |
| `infra/k8s/argocd/*-applicationset.yaml`                       | Argo ApplicationSets — must update `targetRevision` to `deploy/{env}`                          |
| `infra/provision/cherry/base/bootstrap.yaml`                   | Cloud-init. ksops removed. Production needs migration from `infra/tofu/`                       |
| `.env.preview` (local, gitignored)                             | Staging DB passwords — preserves data on reprovision                                           |
| `.env.production` (local, gitignored)                          | Production DB passwords — DO NOT LOSE                                                          |
| `work/items/task.0281-canary-cicd-parity-staging-promotion.md` | Parent task with phase plan                                                                    |
| `work/items/task.0285-provision-reprovision-resilience.md`     | Provision script bug fixes                                                                     |
