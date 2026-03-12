---
id: task.0148
type: task
title: "GitOps foundation — Kustomize manifests, k3s IaC module, Argo CD bootstrap"
status: needs_implement
priority: 1
rank: 1
estimate: 3
summary: "Create the GitOps delivery foundation: Kustomize bases+overlays (scheduler-worker first, structured for all services), app-of-apps Argo CD pattern, SOPS/age secrets, and OpenTofu k3s module. Pure infra files — no app code changes, fully parallelizable with feature work."
outcome: "A complete, validated set of deployment manifests ready for multi-service GitOps. Scheduler-worker base is fully specified; directory structure accommodates app, litellm, temporal, postgres migration in P2. `kubectl kustomize` builds clean YAML for both overlays. OpenTofu module is plan-ready. Argo CD app-of-apps manages per-service Applications."
spec_refs: ci-cd-spec, services-architecture-spec
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: feat/gitops-foundation
pr:
reviewer:
revision: 3
blocked_by: task.0151
deploy_verified: false
created: 2026-03-09
updated: 2026-03-12
labels: [deployment, infra, ci-cd, gitops]
external_refs:
---

# GitOps Foundation — Manifests, IaC, and Argo CD Bootstrap

## Context

Today's deployment is a 950-line imperative `deploy.sh` that SSHs into bare metal VMs and runs Docker Compose. This works but lacks:

- **Rollback-by-revert** (currently must redeploy previous image manually)
- **Audit trail** (deploy history buried in CI logs, not git)
- **Self-healing** (relies on autoheal sidecar, not orchestrator-level)
- **Declarative promotion** (deploy = script execution, not manifest change)

The project plan (`proj.cicd-services-gitops` P1) already defines the target architecture:

```
cogni-template (app repo)     → Build + test + push images
    ↓ (image pushed)
infra/cd/ (manifests)      → Kustomize bases + overlays
    ↓ (Argo syncs)
k3s cluster (OpenTofu)        → Argo CD watches + applies
```

This task creates all the **files** needed. The actual provisioning and migration is task.0149.

## Design

### Outcome

A complete set of deployment manifests, IaC modules, and Argo CD configuration — validated locally with `kubectl kustomize` and `tofu plan` — ready to be applied when the k3s cluster is provisioned.

### Approach

**Solution**: Kustomize (built into kubectl, no extra tools) for manifest management. OpenTofu extending existing Cherry Servers provider for k3s VM provisioning. Argo CD for GitOps reconciliation. All pure infrastructure files under `infra/cd/` and `infra/`.

**Reuses**:

- Existing Cherry Servers OpenTofu provider (`infra/tofu/cherry/base/`)
- Existing cloud-init bootstrap pattern (`bootstrap.yaml`)
- Existing scheduler-worker service contract (health endpoints, env schema, image tagging)
- Existing GHCR image registry and tagging strategy (`{env}-{sha}-{service}`)

**Rejected alternatives**:

- **Helm**: More powerful but more complex. Kustomize's overlay model is simpler for our use case (same base, env-specific patches). No template language to debug. Built into kubectl.
- **Separate `cogni-deployments` repo**: Adds repo management overhead. Monorepo `infra/cd/` directory works for now — Argo CD can watch a subdirectory. Extract when the need arises (multiple teams, access control).
- **Full k8s (EKS/GKE)**: Overkill for pre-users. k3s gives us full K8s API on a single node with ~512MB RAM overhead. Same manifests work on full k8s later.
- **Pulumi/CDK**: TypeScript IaC is appealing but adds runtime dependency. OpenTofu is already established in the repo and battle-tested.
- **k3s on same VM as Docker Compose**: Messy coexistence. Dedicated VM keeps the transition clean and allows easy rollback.
- **Akash SDL directly (skip k3s)**: Akash SDL is a docker-compose-like format (`services` + `profiles` + `deployment`), not raw Kubernetes manifests. However: (1) Akash requires Cosmos wallet + cross-chain bridging (EVM→axlUSDC) — blocked by dual-chain complexity (see `infra/tofu/akash/FUTURE_AKASH_INTEGRATION.md`), (2) Akash's managed k8s gives us no control over probes, rolling updates, or reconciliation — k3s gives us full K8s API now, (3) the service definitions we write (images, env vars, resource requests, health endpoints) translate mechanically to SDL when ready. Starting with Akash SDL now would block on payment infrastructure with no deployment benefit.

### Akash Network Compatibility

**Status**: Akash is the Phase 5 target per `FUTURE_AKASH_INTEGRATION.md`. Blocked by EVM→Cosmos bridge complexity.

**Key finding**: Akash SDL is structurally similar to docker-compose, NOT Kubernetes manifests. SDL has `services` (image, env, expose, credentials), `profiles` (compute resources, placement/pricing), and `deployment` (service→profile mapping with replica count). Akash providers run k8s internally, but tenants interact via SDL only.

**What carries forward to Akash** (reusable across both platforms):

| Artifact                               | k3s (now)                     | Akash SDL (future)                              |
| -------------------------------------- | ----------------------------- | ----------------------------------------------- |
| Docker images + GHCR registry          | `image:` in Deployment        | `image:` + `credentials:` in services           |
| Env vars (ConfigMap)                   | `envFrom: configMapRef`       | `env:` list in services                         |
| Resource requests                      | `resources.requests`          | `profiles.compute.resources`                    |
| Health endpoints (`/livez`, `/readyz`) | K8s liveness/readiness probes | Provider's k8s handles probes internally        |
| Service-to-service networking          | K8s Service DNS               | SDL `expose.to.service` (same hostname pattern) |
| Image immutability (digests)           | Kustomize `images:` overlay   | SDL `image:` field                              |
| Private registry auth                  | k3s `registries.yaml`         | SDL `credentials:` block                        |

**What does NOT carry forward** (k3s-specific, replaced on Akash):

- **Argo CD** → replaced by Akash Terraform provider or CLI deployment
- **Kustomize overlays** → replaced by per-env SDL files (or OpenTofu templating)
- **Selectorless Service + EndpointSlice** → not needed (Akash SDL handles inter-service networking natively)
- **k3s OpenTofu module** → replaced by Akash OpenTofu provider (already scaffolded in `infra/tofu/akash/`)
- **SOPS/age/ksops** → replaced by SDL `env:` vars injected via CI (Akash has no native secret management)

**Migration path** (k3s → Akash): Mechanical translation. For each Kustomize base, generate an SDL file: map Deployment→services, ConfigMap→env list, resource requests→profiles.compute. The Akash Terraform provider (`akash-network/terraform-provider-akash`) handles deployment lifecycle. Existing CI pipeline swaps `kubectl kustomize | kubectl apply` for `akash tx deployment create`.

**Design decision**: Build k3s + Kustomize + Argo CD now. This gives immediate value (rollback-by-revert, self-healing, audit trail) on Cherry Servers. The service-level artifacts (images, env, resources, health) are platform-portable. The k3s orchestration layer (~30% of this task's output) is intentionally disposable when Akash payment infra unblocks.

### Migration Strategy

**Phase A (this task)**: Write all manifests and IaC files. Validate locally. No infrastructure changes.

**Phase B (task.0149)**: Provision k3s VM. Install Argo CD. Point at `infra/cd/`. Migrate scheduler-worker. Verify. Retire scheduler-worker from Compose.

**Phase C (future, P2)**: Migrate remaining services (app, litellm, temporal, postgres) to k3s. Retire Docker Compose entirely.

**Phase D (future, P5)**: When Akash payment infra unblocks (EVM→Cosmos bridge), generate SDL files from Kustomize bases. Swap Argo CD + k3s for Akash Terraform provider. Retire Cherry Servers VMs.

**Scheduler-worker goes first** because it's:

- Stateless (no volumes to migrate)
- Has health endpoints (`/livez`, `/readyz`)
- Has Zod-validated env (fail-fast on misconfiguration)
- Already digest-pinned in CI
- Lowest risk if migration fails (worker restarts don't affect users)

### Network Connectivity (Phase B)

During the transition period (scheduler-worker in k3s, everything else in Compose), the k3s pod needs to reach:

- **Temporal** (gRPC port 7233)
- **PostgreSQL** (port 5432)
- **App** (HTTP port 3000, for `APP_BASE_URL`)

**Approach**: Dedicated k3s VM on same Cherry Servers network. Services exposed via VM's internal IP. Selectorless Services + EndpointSlices in k3s point to the Compose VM's IP.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] IMAGE_IMMUTABILITY: Kustomize images use `@sha256:` digests, never mutable tags (spec: proj.cicd-services-gitops)
- [ ] MANIFEST_DRIVEN_DEPLOY: Promotion = changing image digest in overlay, not rebuilding (spec: proj.cicd-services-gitops)
- [ ] ROLLBACK_BY_REVERT: Git revert on overlay restores previous digest (spec: proj.cicd-services-gitops)
- [ ] SERVICE_AS_PRODUCT: scheduler-worker manifest owns its own deployment + health config (spec: services-architecture-spec)
- [ ] HEALTH_ENDPOINTS_REQUIRED: K8s probes map to existing /livez (liveness) and /readyz (readiness) (spec: services-architecture-spec)
- [ ] NO_DOCKERFILE_HEALTHCHECK: Probes defined in K8s manifest, not Dockerfile (spec: services-architecture-spec)
- [ ] NO_SECRETS_IN_MANIFESTS: Secrets referenced via K8s Secret objects; SOPS/age encrypts at rest in repo (spec: proj.cicd-services-gitops)
- [ ] SIMPLE_SOLUTION: Kustomize (built-in) over Helm (template engine), k3s (lightweight) over full k8s
- [ ] ARCHITECTURE_ALIGNMENT: Extends existing OpenTofu + Cherry Servers pattern
- [ ] AKASH_PORTABLE_SERVICES: Service definitions (images, env, resources, health) must be extractable for future SDL generation — no k3s-specific logic baked into service configs

### Files

**Deployment Manifests** (`infra/cd/`):

- Create: `infra/cd/AGENTS.md` — directory-level documentation
- Create: `infra/cd/base/scheduler-worker/kustomization.yaml` — Kustomize base resource list
- Create: `infra/cd/base/scheduler-worker/deployment.yaml` — K8s Deployment (replicas, probes, env, resources)
- Create: `infra/cd/base/scheduler-worker/service.yaml` — ClusterIP Service for health probes
- Create: `infra/cd/base/scheduler-worker/configmap.yaml` — Non-secret env vars (TEMPORAL_ADDRESS, etc.)
- Create: `infra/cd/base/scheduler-worker/external-services.yaml` — Selectorless Service + EndpointSlice for Compose VM connectivity (temporal, postgres, app)
- Create: `infra/cd/overlays/staging/kustomization.yaml` — Staging overlay (image digest, namespace, replicas, EndpointSlice IP patches)
- Create: `infra/cd/overlays/production/kustomization.yaml` — Production overlay (image digest, namespace, replicas)
- Create: `infra/cd/overlays/staging/namespace.yaml` — Namespace definition
- Create: `infra/cd/overlays/production/namespace.yaml` — Namespace definition

**Argo CD Configuration** (`infra/cd/argocd/`):

- Create: `infra/cd/argocd/install.yaml` — Argo CD non-HA install reference (namespace + pinned kustomize remote base). Non-HA is appropriate for single-node k3s crawl; HA install is a P2 concern.
- Create: `infra/cd/argocd/app-of-apps.yaml` — Root Application that manages all service Applications
- Create: `infra/cd/argocd/applications/scheduler-worker.yaml` — Per-service Argo Application pointing at overlay

**Secrets Strategy** (`infra/cd/secrets/`):

- Create: `infra/cd/secrets/README.md` — SOPS/age setup instructions, key management
- Create: `infra/cd/secrets/.sops.yaml` — SOPS configuration (age recipient, path rules)
- Create: `infra/cd/secrets/staging/scheduler-worker.enc.yaml` — Encrypted K8s Secret (SOPS-encrypted)
- Create: `infra/cd/secrets/production/scheduler-worker.enc.yaml` — Encrypted K8s Secret (SOPS-encrypted)

**OpenTofu k3s Module** (`infra/tofu/cherry/k3s/`):

- Create: `infra/tofu/cherry/k3s/main.tf` — VM resource + k3s cloud-init
- Create: `infra/tofu/cherry/k3s/variables.tf` — Input variables (extends base pattern)
- Create: `infra/tofu/cherry/k3s/outputs.tf` — VM IP + kubeconfig path
- Create: `infra/tofu/cherry/k3s/bootstrap-k3s.yaml` — Cloud-init: k3s install (Argo CD install step included in file but exercised in task.0149)

**Documentation**:

- Modify: `work/projects/proj.cicd-services-gitops.md` — Update P1 status, link work items

### Kustomize Base Design (scheduler-worker)

Derived from current `docker-compose.yml` + `services/scheduler-worker/src/bootstrap/env.ts` Zod schema:

**ConfigMap** (non-secret, env-specific values in overlays):

| Key                   | Base Value         | Overlay Override                                               |
| --------------------- | ------------------ | -------------------------------------------------------------- |
| `TEMPORAL_ADDRESS`    | —                  | `temporal:7233` (selectorless Service, see below)              |
| `TEMPORAL_NAMESPACE`  | —                  | `cogni-production` / `cogni-staging`                           |
| `TEMPORAL_TASK_QUEUE` | `scheduler-tasks`  | —                                                              |
| `APP_BASE_URL`        | —                  | `http://app:3000` (selectorless Service)                       |
| `LOG_LEVEL`           | `info`             | —                                                              |
| `SERVICE_NAME`        | `scheduler-worker` | —                                                              |
| `HEALTH_PORT`         | `9000`             | —                                                              |
| `IMAGE_DIGEST`        | —                  | Set to image digest from overlay (used by `/version` endpoint) |
| `GH_REVIEW_APP_ID`    | —                  | Optional — GitHub App ID (not secret, public identifier)       |
| `GH_REPOS`            | —                  | Optional — comma-separated repos (not secret)                  |

**Secret** (SOPS-encrypted in repo, decrypted at apply time):

| Key                                | Source                                                           |
| ---------------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`                     | Postgres DSN (service role, BYPASSRLS)                           |
| `SCHEDULER_API_TOKEN`              | min 32 chars, internal API auth                                  |
| `GH_REVIEW_APP_PRIVATE_KEY_BASE64` | Optional — GitHub App private key (only truly secret GitHub var) |

**Selectorless Service + EndpointSlice** (transition period — scheduler-worker in k3s, deps in Compose):

| K8s Service Name | Port | Target                 | Purpose           |
| ---------------- | ---- | ---------------------- | ----------------- |
| `temporal`       | 7233 | `<compose-vm-ip>:7233` | gRPC connectivity |
| `postgres`       | 5432 | `<compose-vm-ip>:5432` | DB connectivity   |
| `app`            | 3000 | `<compose-vm-ip>:3000` | HTTP connectivity |

> **R1: Why selectorless Service + EndpointSlice, not ExternalName or legacy Endpoints.** ExternalName returns a CNAME — DNS-only, can't remap ports. Legacy `kind: Endpoints` is deprecated in K8s v1.33+. Selectorless Service + EndpointSlice is the current K8s-documented pattern for services without pod selectors. Overlay patches the IP per environment.

```yaml
# Example: external-services.yaml (base)
apiVersion: v1
kind: Service
metadata:
  name: temporal
spec:
  clusterIP: None
  ports:
    - port: 7233
      protocol: TCP
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: temporal-1
  labels:
    kubernetes.io/service-name: temporal
addressType: IPv4
endpoints:
  - addresses: ["10.0.0.1"] # placeholder — patched by overlay
ports:
  - port: 7233
    protocol: TCP
```

These let the scheduler-worker pod use the same hostnames (`temporal`, `app`) as in Compose. Replaced with real K8s Services when those workloads migrate to k3s.

**Deployment manifest:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: scheduler-worker
  labels:
    app.kubernetes.io/name: scheduler-worker
    app.kubernetes.io/part-of: cogni
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: scheduler-worker
  template:
    spec:
      containers:
        - name: scheduler-worker
          image: ghcr.io/cogni-dao/cogni-template # overridden by overlay
          ports:
            - containerPort: 9000
              name: health
          livenessProbe:
            httpGet:
              path: /livez
              port: health
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /readyz
              port: health
            initialDelaySeconds: 5
            periodSeconds: 5
          envFrom:
            - configMapRef:
                name: scheduler-worker-config
            - secretRef:
                name: scheduler-worker-secrets
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
```

### k3s Cloud-Init Design

Extends existing `bootstrap.yaml` pattern but installs k3s instead of Docker:

```yaml
# Key differences from base/bootstrap.yaml:
# 1. Installs k3s (includes containerd) instead of Docker
# 2. Configures k3s with --disable traefik (Caddy handles ingress)
# 3. Writes kubeconfig for remote kubectl access
# 4. Installs SOPS + age for secret decryption
# 5. Installs Argo CD via kubectl apply
```

k3s install is a single command: `curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik --disable servicelb" sh -`

**GHCR private registry auth**: k3s reads `/etc/rancher/k3s/registries.yaml` at startup. Cloud-init writes this file with GHCR credentials (PAT token). This is simpler than per-Deployment `imagePullSecrets` for single-node — all pods get registry auth automatically.

```yaml
# /etc/rancher/k3s/registries.yaml
mirrors:
  ghcr.io:
    endpoint:
      - "https://ghcr.io"
configs:
  "ghcr.io":
    auth:
      username: cogni-deploy
      password: "${ghcr_deploy_token}" # from OpenTofu variable
```

### Argo CD Application Pattern

App-of-apps pattern: one root Application creates per-service Applications.

```yaml
# app-of-apps.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: cogni-apps
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/cogni-dao/cogni-template.git
    path: infra/cd/argocd/applications
    targetRevision: staging # or main for production
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### SOPS/age Secret Strategy

- Generate one age keypair per environment (staging, production)
- Public key committed in `.sops.yaml` (safe — encryption only)
- Private key stored as K8s Secret in the cluster (manual, one-time)
- **ksops** as an Argo CD sidecar CMP (repo-server sidecar container with ksops binary + plugin.yaml). The legacy `configManagementPlugins` in argocd-cm was removed in Argo CD 2.8; sidecar model is the only supported path.
- Secrets encrypted at rest in git, decrypted at apply time
- `infra/cd/secrets/README.md` documents the full setup: key generation, cluster secret creation, ksops plugin config

### Promotion Flow (CI Integration — future, not this task)

```
CI pushes image → CI creates PR updating overlay digest →
  merge PR → Argo CD detects change → syncs to cluster
```

This task creates the manifests. CI integration (auto-PR on image push) is a follow-up.

### Design Review Notes

Findings from two rounds of `/review-design` applied to this design:

**R1 review:**

1. **R1 — Selectorless Service + EndpointSlice**: ExternalName does DNS-only (CNAME), can't remap ports. Legacy `kind: Endpoints` deprecated in K8s v1.33+. Using selectorless Service + EndpointSlice (current K8s-documented pattern). _(Applied above.)_
2. **R2 — ksops as sidecar CMP**: Legacy `configManagementPlugins` in argocd-cm removed in Argo CD 2.8. ksops runs as repo-server sidecar container. _(Applied above.)_
3. **R3 — Non-secret env vars moved to ConfigMap**: `GH_REVIEW_APP_ID` and `GH_REPOS` are not sensitive. Only `GH_REVIEW_APP_PRIVATE_KEY_BASE64` stays in Secret. _(Applied above.)_
4. **R4 — IMAGE_DIGEST added to ConfigMap**: Used by `/version` endpoint. Set in overlay to match the image digest. _(Applied above.)_
5. **R5 — Cloud-init scope clarified**: `bootstrap-k3s.yaml` includes Argo CD install commands but they're exercised in task.0149, not this task. _(Applied above.)_

**R2 review:** 6. **R6 — GHCR private registry auth**: k3s `registries.yaml` provides node-level auth for private GHCR. Simpler than per-Deployment `imagePullSecrets` for single-node. _(Applied above.)_ 7. **R7 — Non-HA Argo install labeled explicitly**: Non-HA is correct for single-node crawl; HA install is a P2 concern. _(Applied above.)_ 8. **R8 — Multi-service scope**: Directory structure and app-of-apps pattern designed for all services (scheduler-worker, app, litellm, temporal, postgres), not just scheduler-worker. Only scheduler-worker base is fully specified in this task. _(Applied above.)_

## Validation

**Automated:**

- `kubectl kustomize infra/cd/overlays/staging/` exits 0
- `kubectl kustomize infra/cd/overlays/production/` exits 0
- `tofu plan` in `infra/tofu/cherry/k3s/` succeeds (with mock vars)
- All YAML files are valid

**Manual:**

1. Review Kustomize output matches current docker-compose scheduler-worker env config
2. Review OpenTofu module extends cherry/base pattern correctly
3. Review Argo CD Applications point at correct paths
4. Review SOPS config has correct path rules
5. Review EndpointSlice addresses use placeholder IPs (replaced during task.0149)
