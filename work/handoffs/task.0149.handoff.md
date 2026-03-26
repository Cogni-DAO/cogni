---
id: task.0149
type: handoff
work_item_id: task.0149
status: active
created: 2026-03-25
updated: 2026-03-25
branch: worktree-cicd-gap-analysis
last_commit: 3bf0f056
---

# Handoff: GitOps k3s + Argo CD — Single-VM Migration

## What This Branch Does

Migrates all `services/` (scheduler-worker, sandbox-openclaw) from Docker Compose to k3s + Argo CD on a single VM. Production Compose only runs infrastructure (postgres, temporal, litellm, app, caddy). PR #628.

## Current State: NOT DEPLOYED

The branch has all code changes done and reviewed. Deployment was attempted but hit multiple issues. Preview and production VMs were destroyed during troubleshooting. **Both environments are currently DOWN.**

### Immediate Priority: Restore Preview + Production on Staging

The user is restoring preview and production VMs using staging's known-working Compose-only bootstrap. This does NOT use the gitops branch — it uses staging's existing `bootstrap.yaml` (Docker + Compose only, no k3s).

To apply from staging:
```bash
cd infra/tofu/cherry/base
source ../../../../.env.deployments && export CHERRY_AUTH_TOKEN
# SSH key 13815 already imported into preview workspace state
tofu apply -var-file=terraform.preview.tfvars
```

After preview is stable, switch workspace and apply production.

## What Was Built (All on This Branch)

### Infrastructure
- `infra/tofu/cherry/base/bootstrap.yaml` — cloud-init installs Docker + k3s + Argo CD + ksops
- `infra/tofu/cherry/base/main.tf` — `templatefile()` for GHCR token, SOPS key, repo ref injection
- `infra/tofu/cherry/base/variables.tf` — new vars: `ghcr_deploy_token`, `sops_age_private_key`, `cogni_repo_url`, `cogni_repo_ref`
- Both tfvars upgraded to `B1-4-4gb-80s-shared` (4GB RAM required for k3s + Argo CD)

### Kustomize Manifests
- `infra/cd/base/scheduler-worker/` — Deployment, Service, ConfigMap, EndpointSlices (127.0.0.1 for single-VM)
- `infra/cd/base/sandbox-openclaw/` — 2-container pod (nginx proxy + gateway), ported from PR #625
- `infra/cd/overlays/{staging,production}/{service}/` — per-service, per-env patches
- `infra/cd/argocd/kustomization.yaml` — Argo CD v2.13.4 non-HA (renamed from install.yaml — kustomize requires standard name)
- `infra/cd/argocd/ksops-cmp.yaml` + `repo-server-patch.yaml` — SOPS secret decryption sidecar
- `infra/cd/argocd/services-applicationset.yaml` — generates one Application per managed service
- `infra/cd/gitops-service-catalog.json` — scheduler-worker + sandbox-openclaw managed, sandbox-runtime deferred

### Secrets
- SOPS/age keypairs generated, stored at `~/.cogni/{staging,production}-age-key.txt`
- `.sops.yaml` has real public keys (committed on this branch)
- `infra/cd/secrets/{staging,production}/*.enc.yaml` — encrypted with real values (committed)
- `~/.cogni/secret-values.json` — local cache of generated secret values
- `scripts/setup-secrets.ts` — SOPS_AGE_KEY integrated into existing secrets catalog

### CI Changes
- `scripts/ci/promote-k8s-image.sh` — updates overlay digest, commits with `[skip ci]`
- `scripts/ci/check-gitops-manifests.sh` + `check-gitops-service-coverage.sh` — CI validation
- `staging-preview.yml` — promote step after push
- `deploy-production.yml` — removed scheduler-worker + sandbox-openclaw from Compose deploy
- `deploy.sh` — removed service image pulls, config sync, healthchecks, COMPOSE_PROFILES
- `docker-compose.yml` — services removed (only in `docker-compose.dev.yml` for local dev/CI)

### Documentation
- `docs/runbooks/DEPLOYMENT_ARCHITECTURE.md` — rewritten for dual-runtime
- `docs/runbooks/INFRASTRUCTURE_SETUP.md` — k3s vars in provisioning steps
- `docs/guides/create-service.md` — k8s manifest steps replace Compose guidance
- `docs/spec/ci-cd.md` — service promotion flow
- `.claude/commands/env-update.md` — dual-runtime env var propagation
- All AGENTS.md files updated

### Follow-up Tasks (Filed)
- `task.0200` — Move runtime secrets to cluster-side management (ESO)
- `task.0201` — Nx targeted builds + per-PR preview environments

## Bugs Found and Fixed During Deploy Attempts

1. **`$$AUTHED_URL`** — templatefile `$$` produces literal `$`, but `$$VAR` in bash is PID + VAR. Fix: bare `$AUTHED_URL` (no braces = not Terraform syntax, passes through).

2. **`install.yaml` not found by kustomize** — file must be named `kustomization.yaml`. Renamed.

3. **Strategic merge patch fails in one shot** — `kubectl kustomize` with remote URL base + patch fails. Fix: staged install (base → wait → CMP → patch → ApplicationSet).

4. **VM sizing** — 2GB RAM insufficient for Docker + k3s + Argo CD. Upgraded to 4GB.

5. **`setup:secrets --all` silently regenerated production DB passwords** — broke running deployments. Added destructive warning banner.

6. **SSH key label conflicts on Cherry Servers** — tofu create fails if label already exists. Must delete or import before apply.

## Known Risks for Next Deploy Attempt

### Cherry Servers Gotchas
- VMs in "Provisioning" state cannot be deleted via portal (API returns 204 but doesn't terminate)
- Cherry shared VPS provisioning takes 5-20 minutes — not a code bug
- Killed tofu processes leave orphaned VMs — Cherry doesn't deduplicate by hostname
- **NEVER run tofu apply from background processes, piped commands, or anything that might get killed**
- Always verify 0 servers on Cherry before applying: `curl -s -H "Authorization: Bearer $TOKEN" "https://api.cherryservers.com/v1/projects/254586/servers" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))"`

### Bootstrap Sequence
Cloud-init runs: Docker → k3s → git clone (needs GHCR PAT for private repo) → argocd namespace → SOPS age key secret → Argo CD base install → wait for server → ksops CMP → patch repo-server → ApplicationSet. Total ~10 min after VM is active.

### Secret State
- GitHub Actions secrets were regenerated (all agent secrets have new random values)
- `GH_WEBHOOK_SECRET` was regenerated — needs re-sync to both GitHub Apps (values in `~/.cogni/secret-values.json`)
- `GHCR_DEPLOY_TOKEN` set in GitHub repo secrets (read-only PAT, packages:read scope)
- SSH deploy keys regenerated — old keys no longer match any VM
- Preview and production have SEPARATE webhook secrets now (set via `gh secret set` per-env)

### Tofu State
- Preview workspace exists with SSH key 13815 imported
- Production workspace may need creation (`tofu workspace new production`)
- `.auto.tfvars` files were deleted for staging compatibility — recreate from `~/.cogni/` cache when returning to this branch

### What the Next Agent Must Do
1. Ensure preview + production are stable on staging's Compose deploy first
2. Then switch to this branch, recreate `.auto.tfvars` from cached values
3. Apply to a FRESH Cherry VM (verify 0 servers first)
4. Wait for full cloud-init completion (~15 min) — do NOT kill, background, or pipe the apply
5. After health check passes: set VM_HOST in GitHub secrets, update DNS, merge PR, push to staging
6. First push to staging triggers promote-k8s-image.sh → Argo CD syncs → pods deploy

## Files Changed (Summary)

```
41 files changed, ~1200 insertions, ~700 deletions
Key: infra/tofu/cherry/base/bootstrap.yaml, main.tf, variables.tf
     infra/cd/ (entire directory — manifests, argocd, overlays, secrets)
     scripts/ci/deploy.sh, promote-k8s-image.sh, check-gitops-*.sh
     scripts/setup-secrets.ts
     .github/workflows/ (ci, staging-preview, deploy-production)
     infra/compose/runtime/docker-compose.yml (services removed)
     docs/ (deployment arch, infra setup, ci-cd spec, create-service guide)
```
