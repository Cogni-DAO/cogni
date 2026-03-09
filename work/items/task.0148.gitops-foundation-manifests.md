---
id: task.0148
type: task
title: "GitOps foundation — Kustomize manifests, k3s IaC module, Argo CD bootstrap"
status: needs_implement
priority: 1
rank: 1
estimate: 3
summary: "Create the deployment manifest infrastructure for GitOps: Kustomize bases+overlays for scheduler-worker, OpenTofu module for k3s provisioning on Cherry Servers, and Argo CD Application manifests. Pure infra files — no app code changes, fully parallelizable with feature work."
outcome: "A complete, validated set of deployment manifests that can be applied to a k3s cluster. `kubectl kustomize` builds clean YAML for both staging and production overlays. OpenTofu module is plan-ready for k3s provisioning. Argo CD knows how to watch the manifests repo and deploy scheduler-worker."
spec_refs: ci-cd-spec, services-architecture-spec
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: feat/gitops-foundation
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-09
updated: 2026-03-09
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
deployments/ (manifests)      → Kustomize bases + overlays
    ↓ (Argo syncs)
k3s cluster (OpenTofu)        → Argo CD watches + applies
```

This task creates all the **files** needed. The actual provisioning and migration is task.0149.

## Design

### Outcome

A complete set of deployment manifests, IaC modules, and Argo CD configuration — validated locally with `kubectl kustomize` and `tofu plan` — ready to be applied when the k3s cluster is provisioned.

### Approach

**Solution**: Kustomize (built into kubectl, no extra tools) for manifest management. OpenTofu extending existing Cherry Servers provider for k3s VM provisioning. Argo CD for GitOps reconciliation. All pure infrastructure files under `deployments/` and `platform/infra/`.

**Reuses**:
- Existing Cherry Servers OpenTofu provider (`platform/infra/providers/cherry/base/`)
- Existing cloud-init bootstrap pattern (`bootstrap.yaml`)
- Existing scheduler-worker service contract (health endpoints, env schema, image tagging)
- Existing GHCR image registry and tagging strategy (`{env}-{sha}-{service}`)

**Rejected alternatives**:
- **Helm**: More powerful but more complex. Kustomize's overlay model is simpler for our use case (same base, env-specific patches). No template language to debug. Built into kubectl.
- **Separate `cogni-deployments` repo**: Adds repo management overhead. Monorepo `deployments/` directory works for now — Argo CD can watch a subdirectory. Extract when the need arises (multiple teams, access control).
- **Full k8s (EKS/GKE)**: Overkill for pre-users. k3s gives us full K8s API on a single node with ~512MB RAM overhead. Same manifests work on full k8s later.
- **Pulumi/CDK**: TypeScript IaC is appealing but adds runtime dependency. OpenTofu is already established in the repo and battle-tested.
- **k3s on same VM as Docker Compose**: Messy coexistence. Dedicated VM keeps the transition clean and allows easy rollback.

### Migration Strategy

**Phase A (this task)**: Write all manifests and IaC files. Validate locally. No infrastructure changes.

**Phase B (task.0149)**: Provision k3s VM. Install Argo CD. Point at `deployments/`. Migrate scheduler-worker. Verify. Retire scheduler-worker from Compose.

**Phase C (future, P2)**: Migrate remaining services (app, litellm, temporal, postgres) to k3s. Retire Docker Compose entirely.

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

**Approach**: Dedicated k3s VM on same Cherry Servers network. Services exposed via VM's internal IP. ExternalName or headless services in k3s point to the Compose VM's IP.

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

### Files

**Deployment Manifests** (`deployments/`):

- Create: `deployments/AGENTS.md` — directory-level documentation
- Create: `deployments/base/scheduler-worker/kustomization.yaml` — Kustomize base resource list
- Create: `deployments/base/scheduler-worker/deployment.yaml` — K8s Deployment (replicas, probes, env, resources)
- Create: `deployments/base/scheduler-worker/service.yaml` — ClusterIP Service for health probes
- Create: `deployments/base/scheduler-worker/configmap.yaml` — Non-secret env vars (TEMPORAL_ADDRESS, etc.)
- Create: `deployments/overlays/staging/kustomization.yaml` — Staging overlay (image digest, namespace, replicas)
- Create: `deployments/overlays/production/kustomization.yaml` — Production overlay (image digest, namespace, replicas)
- Create: `deployments/overlays/staging/namespace.yaml` — Namespace definition
- Create: `deployments/overlays/production/namespace.yaml` — Namespace definition

**Argo CD Configuration** (`deployments/argocd/`):

- Create: `deployments/argocd/install.yaml` — Argo CD install reference (namespace + kustomize remote base)
- Create: `deployments/argocd/app-of-apps.yaml` — Root Application that manages all service Applications
- Create: `deployments/argocd/applications/scheduler-worker.yaml` — Per-service Argo Application pointing at overlay

**Secrets Strategy** (`deployments/secrets/`):

- Create: `deployments/secrets/README.md` — SOPS/age setup instructions, key management
- Create: `deployments/secrets/.sops.yaml` — SOPS configuration (age recipient, path rules)
- Create: `deployments/secrets/staging/scheduler-worker.enc.yaml` — Encrypted K8s Secret (SOPS-encrypted)
- Create: `deployments/secrets/production/scheduler-worker.enc.yaml` — Encrypted K8s Secret (SOPS-encrypted)

**OpenTofu k3s Module** (`platform/infra/providers/cherry/k3s/`):

- Create: `platform/infra/providers/cherry/k3s/main.tf` — VM resource + k3s cloud-init
- Create: `platform/infra/providers/cherry/k3s/variables.tf` — Input variables (extends base pattern)
- Create: `platform/infra/providers/cherry/k3s/outputs.tf` — VM IP + kubeconfig path
- Create: `platform/infra/providers/cherry/k3s/bootstrap-k3s.yaml` — Cloud-init: k3s install + Argo CD bootstrap

**Documentation**:

- Modify: `work/projects/proj.cicd-services-gitops.md` — Update P1 status, link work items

### Kustomize Base Design (scheduler-worker)

Derived from current `docker-compose.yml` scheduler-worker definition:

```yaml
# deployment.yaml
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
          image: ghcr.io/cogni-dao/cogni-template  # overridden by overlay
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
    path: deployments/argocd/applications
    targetRevision: staging  # or main for production
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
- `ksops` Kustomize plugin OR Argo CD SOPS plugin for automatic decryption
- Secrets encrypted at rest in git, decrypted at apply time

### Promotion Flow (CI Integration — future, not this task)

```
CI pushes image → CI creates PR updating overlay digest →
  merge PR → Argo CD detects change → syncs to cluster
```

This task creates the manifests. CI integration (auto-PR on image push) is a follow-up.

### Validation

- `kubectl kustomize deployments/overlays/staging/` produces valid YAML
- `kubectl kustomize deployments/overlays/production/` produces valid YAML
- `tofu plan` in `platform/infra/providers/cherry/k3s/` succeeds (with mock vars)
- Argo CD Application manifests are valid YAML

## Validation

**Automated:**
- `kubectl kustomize deployments/overlays/staging/` exits 0
- `kubectl kustomize deployments/overlays/production/` exits 0
- All YAML files are valid

**Manual:**
1. Review Kustomize output matches current docker-compose scheduler-worker config
2. Review OpenTofu module extends cherry/base pattern correctly
3. Review Argo CD Applications point at correct paths
4. Review SOPS config has correct path rules
