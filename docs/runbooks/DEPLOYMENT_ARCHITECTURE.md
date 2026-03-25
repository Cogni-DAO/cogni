# Deployment Architecture Overview

- ## Goal

  Single VM per environment. Set up once via OpenTofu, continuous CI/CD after.

  Two runtimes on the same host:
  - **Docker Compose** — infrastructure services (postgres, temporal, litellm, app, caddy)
  - **k3s + Argo CD** — application services from `services/` (scheduler-worker, sandbox-openclaw)

  Compose services deploy via SSH + `docker compose up`. k3s services deploy via GitOps: CI pushes image → updates overlay digest → Argo CD syncs.

- ## Architecture Layers
- ### Base Infrastructure (`infra/tofu/cherry/base/`)
- **Purpose**: VM provisioning with Cherry Servers API
- **Bootstrap**: Docker + k3s + Argo CD installed via cloud-init
- **Creates**: Single VM per environment with SSH deploy keys, k3s cluster, Argo CD
- **Authentication**: SSH for Compose deploys; GHCR PAT for k3s image pulls; SOPS/age for k8s secrets
- ### Edge Infrastructure (`infra/compose/edge/`)
- **Purpose**: Always-on TLS termination layer (Caddy)
- **Key invariant**: **Never stopped during app deployments** — prevents ERR_CONNECTION_RESET
- ### Compose Infrastructure (`infra/compose/runtime/`)
- **Purpose**: Infrastructure services (postgres, temporal, litellm, app, alloy, autoheal)
- **Deployment**: SSH from GitHub Actions, pull-while-running
- **Network**: `cogni-edge` (external), `internal`, `sandbox-internal`
- ### k3s Services (`infra/cd/`)
- **Purpose**: Application services from `services/` (scheduler-worker, sandbox-openclaw)
- **Deployment**: Argo CD watches `infra/cd/overlays/{env}/{service}/` — digest change triggers sync
- **Pattern**: ApplicationSet generates one Application per managed service
- **Secrets**: SOPS/age encrypted in repo, decrypted by ksops CMP sidecar at apply time
- **Connectivity**: k3s pods reach Compose services via localhost EndpointSlices (127.0.0.1)
- ## File Structure

  ```
  infra/
  ├── tofu/cherry/base/              # VM provisioning (OpenTofu)
  │   ├── main.tf                    # Cherry provider + VM + health check
  │   ├── variables.tf               # VM config + GHCR + SOPS + repo vars
  │   ├── bootstrap.yaml             # Cloud-init: Docker + k3s + Argo CD
  │   └── terraform.tfvars.example   # All required variables documented
  ├── compose/
  │   ├── edge/                      # TLS termination (Caddy, immutable)
  │   └── runtime/                   # Infrastructure services (Compose)
  │       ├── docker-compose.yml     # Production: app + postgres + temporal + litellm
  │       └── docker-compose.dev.yml # Dev/CI: adds scheduler-worker + openclaw for testing
  └── cd/                            # GitOps manifests (k3s / Argo CD)
      ├── base/{service}/            # Kustomize base per service
      ├── overlays/{env}/{service}/  # Per-service, per-env patches
      ├── argocd/                    # Argo CD install + ApplicationSet
      ├── secrets/                   # SOPS-encrypted K8s Secrets
      └── gitops-service-catalog.json
  ```

- ## Container Stack

  **Environment-specific image tags**: Same IMAGE_NAME, environment-aware tags:

- App image: `preview-${GITHUB_SHA}` or `prod-${GITHUB_SHA}`
- Migrator image: `preview-${GITHUB_SHA}-migrate` or `prod-${GITHUB_SHA}-migrate`

  **Edge containers** (project: `cogni-edge`, rarely touched):

- `caddy`: HTTPS termination and routing - **never stopped during app deploys**

  **Compose runtime** (project: `cogni-runtime`, updated each deploy):

- `app`: Next.js application
- `postgres`: Database server
- `temporal` + `temporal-postgres`: Workflow orchestration
- `litellm` + `redis`: AI proxy service
- `alloy`: Log collection and forwarding
- `autoheal`: Container auto-restart
- `git-sync`, `db-provision`, `db-migrate`: Bootstrap profile (one-time setup)

  **k3s services** (managed by Argo CD, deployed via GitOps):

- `scheduler-worker`: Temporal worker for scheduled graph execution
- `sandbox-openclaw`: OpenClaw gateway + nginx auth proxy
  **Registry Authentication**:

  For private GHCR images, VMs authenticate using bot account credentials:

- **Manual setup required**: Create GitHub PAT for `Cogni-1729` (our bot, you'll need your own) with `read:packages` scope
- **Environment secrets**: `GHCR_DEPLOY_TOKEN` (PAT), `GHCR_USERNAME=Cogni-1729`
- **Deploy flow**: CI injects `docker login ghcr.io` before `docker compose pull`
- ## GitHub Actions Workflows

  See [CI/CD](../../docs/spec/ci-cd.md) for complete workflow documentation.

  **Key workflows:**

- `staging-preview.yml` - Push to staging: build → test → push → deploy → e2e → auto-promote
- `build-prod.yml` - Push to main: build → test → push
- `deploy-production.yml` - Triggered on build-prod success: deploy to production
- ## Getting Started

  **First-time setup / Disaster recovery**: See [INFRASTRUCTURE_SETUP.md](INFRASTRUCTURE_SETUP.md)

- ## Deployment Flows

  **VM Provisioning (One-time)**: Manual via OpenTofu (see INFRASTRUCTURE_SETUP.md)
  **App Deployment (Routine)**: Auto-triggered on staging/main → rsync bundle → SSH → `docker compose up`

- ## Secrets Management

  **GitHub Secrets** (clean naming):

- **Repository secrets**: `GHCR_DEPLOY_TOKEN`, `CHERRY_AUTH_TOKEN`, `SONAR_TOKEN` (shared across environments)
- **Environment secrets** (`preview`/`production`): `POSTGRES_ROOT_USER`, `POSTGRES_ROOT_PASSWORD`, `APP_DB_USER`, `APP_DB_PASSWORD`, `APP_DB_NAME`, `DATABASE_URL`, `LITELLM_MASTER_KEY`, `OPENROUTER_API_KEY`, `AUTH_SECRET`, `SSH_DEPLOY_KEY`, `VM_HOST`, `DOMAIN`

  **CI-Generated Variables**:

- `APP_IMAGE`: Derived from `IMAGE_NAME:IMAGE_TAG`
- `MIGRATOR_IMAGE`: Derived from `IMAGE_NAME:IMAGE_TAG-migrate` (tag coupling invariant)
- `COGNI_REPO_URL`: Derived from `github.repository` (`https://github.com/<org>/<repo>.git`)
- `COGNI_REPO_REF`: Pinned to deploy commit SHA (`github.sha` or `workflow_run.head_sha`)

  **Private Registry Access**: `GHCR_DEPLOY_TOKEN` enables pulling private images from GitHub Container Registry using `Cogni-1729` bot account.

  **SSH Security**: Private keys never in Terraform state. SSH agent authentication only.
  **Deployment**: Github Actions and Docker Compose for app deployment. Faster, simpler rollbacks.

- ## Database Security Model

  **Two-User Architecture**: Separates database administration from application access:

- **Root User** (`POSTGRES_ROOT_USER`): Creates databases and users, not used by application
- **App User** (`APP_DB_USER`): Limited to application database, used by runtime containers

  **Initialization**: `postgres-init/01-init-app-db.sh` script runs on first container start to create application database and user with proper permissions.

  **Environment Variable Mapping**:

  ```bash
  # Container postgres service
  POSTGRES_USER=${POSTGRES_ROOT_USER}      # Container's POSTGRES_USER
  POSTGRES_PASSWORD=${POSTGRES_ROOT_PASSWORD}
  POSTGRES_DB=postgres                      # Default database for user creation

  # Application service
  POSTGRES_USER=${APP_DB_USER}             # App's POSTGRES_USER
  POSTGRES_PASSWORD=${APP_DB_PASSWORD}
  POSTGRES_DB=${APP_DB_NAME}
  ```

- ## Environment Configuration

  **Base Layer**: VM topology in `env.{preview,prod}.tfvars`  
  **Runtime**: Environment secrets → Docker Compose `.env` on VM

- ## State Management

  **Terraform state**: Only for base infrastructure (VMs)

- Base: `cherry-base-${environment}.tfstate`
- App: No Terraform state (Docker Compose managed)
- ## Health Validation
  1. **Container healthchecks**: Docker HEALTHCHECK uses `/readyz` (full validation)
  2. **Deployment readiness**: `https://${domain}/readyz` successful curl (hard gate)
  3. **Liveness probe**: `/livez` available for fast boot verification

- ## Current State

  **Live**: Production VM with automated deployment pipeline
  **Available**: Preview environment ready for provisioning via GitHub Actions

  ***

- ## Related Documentation
- [CI/CD Pipeline Flow](../../docs/spec/ci-cd.md) - Branch model, workflows, and deployment automation
- [Infrastructure Setup](INFRASTRUCTURE_SETUP.md) - VM provisioning and disaster recovery
- [Application Architecture](../../docs/spec/architecture.md) - Hexagonal design and code organization
- [Cogni Brain Spec](../../docs/spec/cogni-brain.md) - Brain repo tools, git-sync mount, citation guard
