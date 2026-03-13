---
id: task.0149
type: task
title: "GitOps k3s provisioning + scheduler-worker migration"
status: needs_implement
priority: 1
rank: 1
estimate: 3
summary: "Provision k3s cluster via OpenTofu, install Argo CD, point at deployment manifests from task.0148, migrate scheduler-worker from Docker Compose to k3s. Verify health, billing, and Temporal connectivity. Retire scheduler-worker from Compose."
outcome: "scheduler-worker running on k3s, managed by Argo CD, with rollback-by-revert capability. Docker Compose stack continues running app + postgres + temporal + litellm. Deployment promotion is a manifest change, not a script execution."
spec_refs: ci-cd-spec, services-architecture-spec
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: feat/gitops-k3s-provisioning
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-09
updated: 2026-03-13
labels: [deployment, infra, ci-cd, gitops]
external_refs:
---

# GitOps k3s Provisioning + Scheduler-Worker Migration

## Context

task.0148 created all deployment manifests, IaC modules, and Argo CD config with placeholder values. This task fills in the real values, provisions the k3s VM, installs Argo CD with SOPS decryption, migrates scheduler-worker off Docker Compose, and wires CI to update manifests on image push.

## Design

### Outcome

Scheduler-worker runs as a Kubernetes pod on k3s, managed by Argo CD, with GitOps promotion (manifest PR → Argo sync) and rollback-by-revert. The Compose VM continues running app + postgres + temporal + litellm. CI automatically updates the k8s overlay digest after pushing a new scheduler-worker image.

### Approach

**Solution**: Three-phase migration — (1) provision + bootstrap k3s with Argo CD + ksops, (2) fill placeholders with real values and deploy scheduler-worker to k3s alongside the Compose copy, (3) verify k3s scheduler-worker then retire it from Compose.

**Reuses**:

- task.0148 manifests (all Kustomize bases, overlays, Argo CD apps, SOPS templates, OpenTofu k3s module)
- Existing cherry/base OpenTofu pattern (same provider, same marker files, same health check)
- Existing CI pipeline (staging-preview.yml build job unchanged — only deploy job gains a k8s step)
- Standard OSS: ksops (Argo CD SOPS plugin), age (encryption), kubectl

**Rejected**:

- **Full Helm chart for Argo CD** — Kustomize remote base is simpler for non-HA single-node; Helm adds chart value management overhead without benefit at this scale
- **External Secrets Operator (ESO)** — Requires a secret backend (Vault, GCP Secret Manager). SOPS/age is simpler for single-cluster: secrets encrypted in git, decrypted at apply time. ESO is a P3 concern when multi-cluster arrives
- **Auto-promotion via Argo CD Image Updater** — Adds a running controller + GHCR poll loop. A 5-line CI script that commits the new digest is simpler and gives explicit PR-based promotion
- **Private networking (VLAN)** — Cherry Servers private networking requires same project + region and isn't available in all regions. Public IP + UFW firewall rules is simpler and proven (same as current Compose VM). k3s API is not exposed (only kubectl via SSH)

### Implementation Constraints (from design review)

1. **CLUSTERIP_NOT_HEADLESS**: Use plain selectorless ClusterIP Service + manual EndpointSlice for the Compose→k3s bridge. Remove `clusterIP: None` from task.0148's `external-services.yaml` — headless adds unnecessary constraints (no virtual IP, DNS returns all endpoints directly). Standard ClusterIP with EndpointSlice gives the same connectivity with simpler DNS semantics.

2. **KSOPS_MANIFESTS_EXPLICIT**: The ksops sidecar CMP must be explicit task output — actual repo-server sidecar container spec, volume mounts, plugin config YAML, and `cmp-plugin.yaml` ConfigMap all committed to the repo under `infra/cd/argocd/`. "We'll use ksops" is not sufficient.

3. **K3S_CONFIG_YAML**: Durable k3s settings (`--disable traefik`, `--disable servicelb`) go in `/etc/rancher/k3s/config.yaml` written by cloud-init, NOT as install-script `INSTALL_K3S_EXEC` flags. `registries.yaml` remains separate for GHCR auth. This makes the k3s config declarative and inspectable on the node.

### Design Decisions

#### Network: Public IP + UFW firewall

Both VMs use public IPs. The k3s VM's UFW allows:

- SSH (22) from CI runners + admin
- Ports 7233 (Temporal), 5432 (Postgres), 3000 (App) are NOT exposed on k3s VM — scheduler-worker reaches these via EndpointSlice pointing at Compose VM's public IP
- The Compose VM's UFW already allows these ports from internal services; add k3s VM IP

The EndpointSlice addresses in overlays get the Compose VM's public IP (currently known as `VM_HOST` in GitHub Secrets).

#### Argo CD access: kubectl port-forward

No Ingress for Argo CD UI. Admin access via:

```bash
ssh root@<k3s-vm> -L 8080:localhost:443
# Then: https://localhost:8080 with initial admin password
```

This avoids exposing the Argo CD API and requires no TLS cert management.

#### ksops: Sidecar CMP for SOPS decryption

Argo CD repo-server gets a ksops sidecar that decrypts `.enc.yaml` files using the age private key stored as a K8s Secret. This is the standard ksops pattern — no custom code.

Patch added to `infra/cd/argocd/install.yaml` Kustomization.

#### CI promotion: Commit digest to overlay

After CI pushes the scheduler-worker image, a new step:

1. Reads the pushed digest from `push.sh` output
2. Updates `infra/cd/overlays/staging/kustomization.yaml` with the new digest
3. Commits and pushes to staging
4. Argo CD auto-syncs the new manifest

This is a ~20-line addition to staging-preview.yml. No separate promotion PR for staging (direct commit is fine since the image was already tested). Production promotion remains a manual PR to the production overlay.

#### Compose VM firewall: Allow k3s pod traffic

Scheduler-worker in k3s needs to reach Temporal (7233), Postgres (5432), and App (3000) on the Compose VM. Add UFW rules on the Compose VM allowing traffic from the k3s VM's IP on these ports.

This is a manual one-time ops step documented in the runbook, not automated in OpenTofu (the Compose VM is managed by cherry/base, not cherry/k3s).

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] IMAGE_IMMUTABILITY: Overlay uses `digest: sha256:...` (not newTag) for real deployments (spec: ci-cd-spec)
- [ ] MANIFEST_DRIVEN_DEPLOY: Promotion = overlay digest change → Argo sync, not script execution (spec: ci-cd-spec)
- [ ] ROLLBACK_BY_REVERT: Git revert of digest change → Argo syncs previous image (spec: ci-cd-spec)
- [ ] NO_SECRETS_IN_MANIFESTS: All secrets SOPS-encrypted at rest, decrypted by ksops at apply time (spec: ci-cd-spec)
- [ ] WATCHDOG_LIVEZ_NOT_READYZ: k3s livenessProbe uses /livez (already correct in task.0148 deployment.yaml)
- [ ] CLUSTERIP_NOT_HEADLESS: External services use plain selectorless ClusterIP (not headless `clusterIP: None`) + manual EndpointSlice (review constraint)
- [ ] KSOPS_MANIFESTS_EXPLICIT: ksops sidecar CMP wiring is committed as actual manifests — container spec, volumes, plugin config YAML (review constraint)
- [ ] K3S_CONFIG_YAML: Durable k3s flags live in `/etc/rancher/k3s/config.yaml`, not install-script EXEC args (review constraint)
- [ ] SIMPLE_SOLUTION: Uses existing task.0148 manifests + standard OSS (ksops, age, UFW). No bespoke controllers or operators
- [ ] ARCHITECTURE_ALIGNMENT: Follows established patterns — cherry/base OpenTofu pattern, existing CI pipeline structure (spec: architecture)

### Files

#### Modify (fill placeholders + fix from task.0148)

- `infra/cd/base/scheduler-worker/external-services.yaml` — Remove `clusterIP: None` from all 3 Services (CLUSTERIP_NOT_HEADLESS constraint). Plain selectorless ClusterIP + EndpointSlice
- `infra/tofu/cherry/k3s/bootstrap-k3s.yaml` — Move `--disable traefik --disable servicelb` from `INSTALL_K3S_EXEC` to `/etc/rancher/k3s/config.yaml` (K3S_CONFIG_YAML constraint). Uncomment Argo CD install block. Add ksops setup
- `infra/cd/argocd/install.yaml` — Add ksops sidecar CMP patches (KSOPS_MANIFESTS_EXPLICIT constraint)
- `infra/cd/overlays/staging/kustomization.yaml` — Replace placeholder image digest + EndpointSlice IPs with real values
- `infra/cd/overlays/production/kustomization.yaml` — Same (production IPs + digest, when ready)
- `infra/cd/secrets/.sops.yaml` — Replace placeholder age public keys with real generated keys
- `infra/cd/secrets/staging/scheduler-worker.enc.yaml` — Encrypt with real secret values (DATABASE_URL, SCHEDULER_API_TOKEN)

#### Modify (retire scheduler-worker from Compose)

- `infra/compose/runtime/docker-compose.yml` — Remove `scheduler-worker` service block
- `scripts/ci/deploy.sh` — Remove scheduler-worker from TARGETED_PULL list, remove scheduler-worker log tail in `on_fail`, remove `SCHEDULER_WORKER_IMAGE` from required secrets

#### Modify (CI k8s promotion)

- `.github/workflows/staging-preview.yml` — Add step after image push to update k8s overlay digest and commit

#### Create

- `infra/cd/argocd/ksops-cmp.yaml` — ksops ConfigManagementPlugin config (plugin.yaml content for the sidecar)
- `infra/cd/argocd/repo-server-patch.yaml` — Kustomize strategic merge patch: ksops sidecar container, volume mounts, age key secret volume on argocd-repo-server Deployment
- `infra/tofu/cherry/k3s/terraform.tfvars.example` — Example tfvars matching base pattern
- `scripts/ci/promote-k8s-image.sh` — Updates overlay kustomization.yaml with new image digest, commits to staging
- `docs/runbooks/k3s-bootstrap.md` — One-time ops runbook: provision, firewall, age keygen, secret encryption, verify

#### Test

- Manual validation (no automated tests — this is infra ops):
  - `tofu plan` / `tofu apply` — VM provisioned
  - `kubectl get nodes` — k3s healthy
  - `kubectl -n argocd get app` — Argo CD synced
  - `kubectl -n cogni-staging get pods` — scheduler-worker running
  - `curl <k3s-vm>:9000/livez` (via kubectl port-forward) — health check
  - Temporal workflow execution — end-to-end signal test
  - Rollback test — revert digest commit, verify Argo syncs previous

### Allowed Changes

- `infra/tofu/cherry/k3s/` — fill placeholders, add tfvars example
- `infra/cd/` — fill placeholders, add ksops patch
- `infra/compose/runtime/docker-compose.yml` — remove scheduler-worker only
- `scripts/ci/deploy.sh` — remove scheduler-worker references only
- `scripts/ci/promote-k8s-image.sh` — new, small promotion script
- `.github/workflows/staging-preview.yml` — add k8s promotion step
- `docs/runbooks/k3s-bootstrap.md` — new runbook

### Out of Scope

- Production k3s provisioning (staging first, production follows when stable)
- Argo CD Ingress / external access (port-forward is sufficient for single admin)
- Monitoring/Alloy on k3s (separate task — observability stack migration)
- Auto-promotion PRs for production overlay (manual PR for now)
- Other services migration to k3s (app, litellm, temporal — P2)
- HA Argo CD or multi-node k3s (P3)

## Validation

- [ ] k3s cluster provisioned via `tofu apply`
- [ ] Argo CD installed, synced, and accessible via port-forward
- [ ] ksops decrypting secrets successfully (scheduler-worker pod starts with real env vars)
- [ ] scheduler-worker pod running, /livez and /readyz healthy
- [ ] Temporal workflows executing successfully (governance scheduled run)
- [ ] EndpointSlice connectivity: scheduler-worker → Temporal, Postgres, App on Compose VM
- [ ] CI promotion: staging-preview pushes new digest → Argo CD syncs updated image
- [ ] Rollback test: revert digest commit → Argo syncs previous image
- [ ] scheduler-worker removed from Docker Compose runtime stack
- [ ] `pnpm check` passes (no app code changes, but lint/format on modified files)
