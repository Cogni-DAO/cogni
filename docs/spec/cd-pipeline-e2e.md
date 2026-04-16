---
id: spec.cd-pipeline-e2e
type: spec
title: CD Pipeline E2E — Multi-Node Argo CD GitOps
status: draft
trust: draft
summary: End-to-end specification for continuous deployment of operator + node apps via Argo CD on k3s
read_when: Setting up CD pipeline, adding nodes, deploying to k3s, troubleshooting Argo CD
owner: cogni-dev
created: 2026-04-02
initiative: proj.cicd-services-gitops
---

# CD Pipeline E2E: Multi-Node Argo CD GitOps

> End-to-end specification for continuous deployment of operator + node apps via
> Argo CD on k3s, with Docker Compose infrastructure services on the same VM.

## Status

- **Source branch:** `integration/multi-node`
- **Argo branch:** `worktree-cicd-gap-analysis` (PR #628 — needs rebase onto integration/multi-node)
- **Date:** 2026-04-02
- **Constraint:** No production users — staging + prod can be wiped for clean bootstrap.

---

## 0. Directory Structure: `infra/` Reorganization

Everything about "how the system runs" lives under one umbrella: `infra/`. The previous
layout mixed inventory, provisioning, runtime renderers, and image builds in a flat layer.
The new layout splits by responsibility.

### Current → Target

| Current Path                   | Target Path                   | Responsibility                             |
| ------------------------------ | ----------------------------- | ------------------------------------------ |
| `infra/cd/`                    | `infra/k8s/`                  | Kubernetes renderer (Argo CD + Kustomize)  |
| _(new)_                        | `infra/catalog/`              | Thin inventory: what apps/nodes exist      |
| `infra/compose/`               | `infra/compose/`              | VM-shared infra runtime (stays)            |
| `infra/litellm/`               | `infra/images/litellm/`       | Infra-owned image build contexts           |
| `infra/compose/sandbox-proxy/` | `infra/images/sandbox-proxy/` | Infra-owned image build contexts           |
| `infra/tofu/`                  | `infra/provision/`            | Substrate/bootstrap (OpenTofu, cloud-init) |
| `infra/tofu/akash/`            | `infra/akash/`                | Future Akash renderer (SDL, not TF)        |

### Target Layout

```
infra/
├── catalog/                      # WHAT exists (renderer-agnostic, thin)
│   ├── operator.yaml
│   ├── poly.yaml
│   ├── resy.yaml
│   ├── scheduler-worker.yaml
│   └── sandbox-openclaw.yaml
├── k8s/                          # Kubernetes renderer (k3s + Argo CD)
│   ├── argocd/                   # Argo CD install + ApplicationSets
│   ├── base/                     # Kustomize bases per app type
│   ├── overlays/                 # Per-env, per-app patches (image digests)
│   └── secrets/                  # SOPS/age encrypted K8s Secrets
├── compose/                      # VM-shared infra runtime (stays)
│   ├── edge/                     # Caddy TLS termination
│   ├── runtime/                  # Postgres, Temporal, Redis, Alloy, etc.
│   └── posthog/                  # Optional analytics
├── images/                       # Infra-owned Docker build contexts
│   ├── litellm/                  # LiteLLM Dockerfile + callback Python
│   └── sandbox-proxy/            # nginx gateway configs
├── provision/                    # Substrate/bootstrap (VM + k3s + Argo)
│   └── cherry/                   # Cherry Servers OpenTofu modules
│       └── base/                 # main.tf, variables.tf, bootstrap.yaml
└── akash/                        # Future: Akash SDL renderer (empty)
    └── README.md
```

### Design Principles

**One umbrella, not two.** A separate `deploy/` would split brain — every deployment
concern (Caddy routing, LiteLLM callbacks, DB provisioning, bootstrap) crosses the
`deploy/` ↔ `infra/` boundary. Keeping everything in `infra/` means one place to look.

**Split by responsibility, not by anxiety.** Each subdirectory has one job:

| Directory    | Answers the question                      | Changes when...                        |
| ------------ | ----------------------------------------- | -------------------------------------- |
| `catalog/`   | "What apps/nodes exist?"                  | A new node is added                    |
| `k8s/`       | "How do apps deploy to Kubernetes?"       | Image digests change, manifests change |
| `compose/`   | "What infra services run on the VM?"      | Infrastructure config changes          |
| `images/`    | "How are infra-owned images built?"       | LiteLLM/proxy code changes             |
| `provision/` | "How is the VM created and bootstrapped?" | Cloud provider or bootstrap changes    |
| `akash/`     | "How do apps deploy to Akash?"            | (Future — SDL renderer)                |

**`catalog/` must stay thin.** It answers only "what exists and which renderer inputs
belong to it." K8s details stay in `k8s/`. Compose details stay in `compose/`. The moment
catalog grows k8s-specific or Akash-specific fields, the abstraction leaks.

**Akash is a renderer, not a TF module.** Akash tenant deployment is driven by SDL, not
Kubernetes manifests, not OpenTofu. It belongs at `infra/akash/` as a peer to `infra/k8s/`,
not buried under `infra/provision/`. The existing `FUTURE_AKASH_INTEGRATION.md` moves here.

### Akash Portability

| Concern                        | Portable to Akash? | Why                                                  |
| ------------------------------ | ------------------ | ---------------------------------------------------- |
| `infra/catalog/*.yaml`         | **Yes**            | Renderer-agnostic app descriptors                    |
| Immutable digest-pinned images | **Yes**            | Same `@sha256:` refs work in SDL                     |
| Per-node env/secret separation | **Yes**            | SDL has `env:` per service                           |
| node-template scaffolding      | **Yes**            | Repo-level, deploy-target independent                |
| `infra/k8s/` (Kustomize, Argo) | **No**             | k8s-specific; `infra/akash/` renders SDL instead     |
| EndpointSlices / NodePorts     | **No**             | Single-VM networking; Akash uses provider networking |
| PreSync migration Jobs         | **No**             | k8s Jobs; Akash uses separate deploy or init command |

**Decision:** Use k3s + Kustomize now (`infra/k8s/`). When Akash is ready, build a
renderer in `infra/akash/` that reads catalog files and emits SDL. Do not build the
SDL renderer now.

---

## 1. Architecture Overview

Single VM per environment. Two runtimes coexist:

| Runtime            | Manages                                                                    | Why                                                                      |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Docker Compose** | Infrastructure: Postgres, Temporal, LiteLLM, Redis, Caddy, Alloy, Autoheal | Stateful, rarely changes, no GitOps churn needed                         |
| **k3s + Argo CD**  | Applications: Operator, Poly, Resy, Scheduler-Worker, Sandbox-OpenClaw     | Frequent changes, benefits from declarative sync, self-healing, rollback |

```
┌─────────────────────────────────────────────────────────────────┐
│  VM (Cherry Servers)                                            │
│                                                                 │
│  ┌─── Docker Compose ──────────────────────────────────┐        │
│  │  caddy (edge)  postgres  temporal  litellm  redis   │        │
│  │  alloy  autoheal  git-sync                          │        │
│  └─────────────────────────────────────────────────────┘        │
│           ↕ 127.0.0.1 (EndpointSlices)                          │
│  ┌─── k3s + Argo CD ──────────────────────────────────┐        │
│  │  operator  poly  resy  scheduler-worker  openclaw   │        │
│  │  (Argo CD controller + repo-server + ksops)         │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                 │
│  Caddy :443 → k3s NodePort (operator, poly, resy)               │
└─────────────────────────────────────────────────────────────────┘
```

### Key Decision: Operator Moves to k3s

The operator app currently runs on Compose. For multi-node, it must move to k3s alongside poly/resy. Reasons:

1. **Uniform deploy path** — All apps deploy the same way (image build → overlay update → Argo sync)
2. **Uniform networking** — All apps are k3s Services, reachable by ClusterIP
3. **LiteLLM routing** — COGNI_NODE_ENDPOINTS can use k3s service DNS instead of Compose hostnames
4. **Self-healing** — Argo restarts crashed operator, not just nodes

This means `deploy.sh` shrinks to infrastructure-only (Compose) and Argo handles all application deploys.

### Operator Scope Clarification

The operator is **both** a formation factory and a running Cogni node with its own payments,
billing, and database. It is the first node in the network — other nodes are peers, not children.

| Role                  | Description                                                                        |
| --------------------- | ---------------------------------------------------------------------------------- |
| **Formation factory** | Hosts DAO setup wizard, node-template scaffolding, VCS tools                       |
| **Running node**      | Has `node_id`, own DB (`cogni_operator`), receives billing callbacks, serves users |

Both roles run in the same Next.js app. Moving to k3s does not change the operator's
responsibilities — it only changes the deploy mechanism.

### Billing Topology

LiteLLM is the single LLM proxy. All nodes call LiteLLM for completions. LiteLLM routes
billing callbacks back to each node's `/api/internal/billing/ingest`.

```
Node (k3s pod) → LiteLLM (Compose, port 4000) → OpenRouter
                       ↓ (async callback)
                  CogniNodeRouter reads node_id from spend_logs_metadata
                       ↓
                  POST to node's billing endpoint via COGNI_NODE_ENDPOINTS
                       ↓
                  Node (k3s pod, via NodePort from Compose)
```

All traffic flows through localhost on the same VM. No cross-network routing.

---

## 2. Component Inventory

### 2.1 What Runs Where

| Component            | Runtime        | Image Source                           | Managed By | Changes Frequently? |
| -------------------- | -------------- | -------------------------------------- | ---------- | ------------------- |
| **operator**         | k3s            | `apps/operator/Dockerfile`             | Argo CD    | Yes                 |
| **poly**             | k3s            | `nodes/poly/app/Dockerfile`            | Argo CD    | Yes                 |
| **resy**             | k3s            | `nodes/resy/app/Dockerfile`            | Argo CD    | Yes                 |
| **scheduler-worker** | k3s            | `services/scheduler-worker/Dockerfile` | Argo CD    | Yes                 |
| **sandbox-openclaw** | k3s            | GHCR pre-built                         | Argo CD    | Rarely              |
| **postgres**         | Compose        | `postgres:15`                          | deploy.sh  | Never               |
| **temporal**         | Compose        | `temporalio/auto-setup`                | deploy.sh  | Never               |
| **litellm**          | Compose        | `infra/litellm/Dockerfile`             | deploy.sh  | Rarely              |
| **redis**            | Compose        | `redis:7-alpine`                       | deploy.sh  | Never               |
| **caddy**            | Compose (edge) | `caddy:2`                              | deploy.sh  | Rarely              |
| **alloy**            | Compose        | `grafana/alloy`                        | deploy.sh  | Never               |
| **autoheal**         | Compose        | `willfarrell/autoheal`                 | deploy.sh  | Never               |

### 2.2 Node Identity Registry

| Node     | node_id                                | Port (dev) | DB Name          | Billing Endpoint               |
| -------- | -------------------------------------- | ---------- | ---------------- | ------------------------------ |
| operator | `4ff8eac1-4eba-4ed0-931b-b1fe4f64713d` | 3000       | `cogni_operator` | `/api/internal/billing/ingest` |
| poly     | `5ed2d64f-2745-4676-983b-2fb7e05b2eba` | 3100       | `cogni_poly`     | `/api/internal/billing/ingest` |
| resy     | `f6d2a17d-b7f6-4ad1-a86b-f0ad2380999e` | 3300       | `cogni_resy`     | `/api/internal/billing/ingest` |

Source of truth: `.cogni/repo-spec.yaml` (operator), `nodes/{name}/.cogni/repo-spec.yaml` (nodes)

---

## 3. E2E Flow: First Provisioning (Fresh VM)

### 3.1 Steps

| #   | Action                    | Actor           | Tool                                          | Output                                                              |
| --- | ------------------------- | --------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Generate SSH deploy key   | Human           | `ssh-keygen -t ed25519`                       | Key pair → GitHub Secrets                                           |
| 2   | Generate SOPS age keypair | Human           | `pnpm setup:secrets`                          | Public key → `.sops.yaml`, private → TF var                         |
| 3   | Set GitHub Secrets        | Human           | `pnpm setup:secrets --all`                    | All env secrets populated                                           |
| 4   | Provision VM              | Human           | `tofu apply -var-file=terraform.{env}.tfvars` | VM with Docker + k3s + Argo CD                                      |
| 5   | Configure DNS             | Human           | Cloudflare / `dns-ops`                        | A records: `cognidao.org`, `poly.cognidao.org`, `resy.cognidao.org` |
| 6   | Deploy edge stack         | CI (first push) | `deploy.sh`                                   | Caddy running with TLS certs                                        |
| 7   | Deploy infra stack        | CI (first push) | `deploy.sh`                                   | Postgres, Temporal, LiteLLM, Redis                                  |
| 8   | Provision databases       | CI (first push) | `provision.sh` via Compose                    | `cogni_operator`, `cogni_poly`, `cogni_resy`, `litellm` DBs created |
| 9   | Argo CD bootstraps        | cloud-init      | `bootstrap.yaml`                              | Argo CD watching repo, ApplicationSet active                        |
| 10  | Argo syncs apps           | Argo CD         | Auto-sync                                     | operator, poly, resy, scheduler-worker, openclaw Deployments        |
| 11  | Migrations run            | Argo CD         | PreSync Jobs                                  | Schema applied to each node DB                                      |
| 12  | Health checks pass        | k3s probes      | `/livez`, `/readyz`                           | All pods Ready                                                      |

### 3.2 Bootstrap Cloud-Init (What PR #628 Provides)

| Component          | Installed By              | Version          | Status in PR #628                |
| ------------------ | ------------------------- | ---------------- | -------------------------------- |
| Docker             | `get.docker.com`          | Latest           | **Done**                         |
| k3s                | `get.k3s.io`              | v1.31.4+k3s1     | **Done**                         |
| Argo CD            | `kubectl apply`           | v2.13.4 (non-HA) | **Done**                         |
| ksops CMP          | ConfigMap + sidecar patch | v4.3.2           | **Done**                         |
| SOPS age key       | K8s Secret injection      | —                | **Done**                         |
| GHCR registry auth | `registries.yaml`         | —                | **Done**                         |
| Traefik            | Disabled                  | —                | **Done** (Caddy handles ingress) |
| ServiceLB          | Disabled                  | —                | **Done**                         |

### 3.3 Critical Gap: Bootstrap Ordering

| Gap                                                | Problem                                                              | Solution                                                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **DB must exist before Argo syncs apps**           | Argo will start pods that need DATABASE_URL pointing to existing DBs | provision.sh must run in Compose before Argo syncs. Cloud-init order: Docker → Compose infra → provision DBs → k3s → Argo |
| **LiteLLM must be healthy before app pods**        | App health depends on LiteLLM proxy                                  | Compose infra starts first (cloud-init), k3s apps start after                                                             |
| **Temporal must be ready before scheduler-worker** | Scheduler-worker fails if Temporal unreachable                       | EndpointSlice for Temporal only works after Compose Temporal is healthy                                                   |

---

## 4. E2E Flow: Code Change → Production

### 4.1 CI Pipeline (Per Push to Integration Branch)

| Stage | Job            | What Happens                                                   | Output                   |
| ----- | -------------- | -------------------------------------------------------------- | ------------------------ |
| 1     | **static**     | typecheck + lint                                               | Gate for other jobs      |
| 2a    | **unit**       | `pnpm check` + `test:ci`                                       | Coverage report          |
| 2b    | **component**  | Testcontainers tests                                           | Pass/fail                |
| 2c    | **stack-test** | Full docker-compose stack + integration tests                  | Pass/fail                |
| 3     | **build**      | Build affected images (operator, poly, resy, scheduler-worker) | Tagged images            |
| 4     | **push**       | Push to GHCR with digest refs                                  | `@sha256:...` digests    |
| 5     | **promote**    | Update k8s overlays with new digests                           | Commit to staging branch |
| 6     | **Argo sync**  | Argo CD detects overlay change, reconciles                     | Pods rolling-updated     |
| 7     | **e2e**        | Playwright tests against preview                               | Pass/fail                |
| 8     | **release**    | Create `release/*` branch + PR to main                         | Release PR               |

### 4.2 Image Build Matrix

| App               | Dockerfile                             | Build Trigger                                    | Tag Format                                           |
| ----------------- | -------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| operator          | `apps/operator/Dockerfile` (runner)    | Changes to `apps/operator/`, `packages/`, shared | `preview-{sha}` / `prod-{sha}`                       |
| operator-migrator | `apps/operator/Dockerfile` (migrator)  | Changes to migrations, schema, drizzle config    | `preview-{sha}-migrate` + fingerprint tag            |
| poly              | `nodes/poly/app/Dockerfile` (runner)   | Changes to `nodes/poly/`, `packages/`, shared    | `preview-{sha}-poly`                                 |
| poly-migrator     | `nodes/poly/app/Dockerfile` (migrator) | Changes to migrations (shared schema)            | `preview-{sha}-poly-migrate`                         |
| resy              | `nodes/resy/app/Dockerfile` (runner)   | Changes to `nodes/resy/`, `packages/`, shared    | `preview-{sha}-resy`                                 |
| resy-migrator     | `nodes/resy/app/Dockerfile` (migrator) | Changes to migrations (shared schema)            | `preview-{sha}-resy-migrate`                         |
| scheduler-worker  | `services/scheduler-worker/Dockerfile` | Changes to `services/scheduler-worker/`          | `preview-{sha}-scheduler-worker`                     |
| litellm           | `infra/litellm/Dockerfile`             | Changes to `infra/litellm/`                      | `cogni-litellm:latest` (Compose-local, not GHCR yet) |

### 4.3 Promotion Flow

**Promotion uses a separate workflow**, not in-line in the build pipeline. This avoids
the branch-mutation loop where a workflow commits to the branch that triggered it.
The pattern mirrors `deploy-production.yml` (triggered by `build-prod` success via
`workflow_run`).

```
Push to staging
  → staging-preview.yml: build + push images + SSH deploy (Compose) + e2e + release PR
  → promote-k8s-staging.yml (workflow_run trigger on staging-preview success):
      fetch digest from GHCR → promote-k8s-image.sh per app → commit [skip ci] → push
  → Argo CD detects overlay change → auto-syncs apps on k3s

Merge release/* to main
  → build-prod.yml: build + push prod images
  → deploy-production.yml (workflow_run trigger): SSH deploy (Compose)
  → promote-k8s-production.yml (workflow_run trigger on build-prod success):
      fetch digest → promote-k8s-image.sh --env production → commit [skip ci] → push
  → Argo CD syncs production apps
```

**Why separate workflows:** A workflow that commits to its own trigger branch is
fragile even with `[skip ci]`. Separate `workflow_run`-triggered workflows fire once
on completion, have their own concurrency group, and cannot loop.

**Key detail:** Overlay digests flow with the code through the branch model. The
`release/*` branch carries the staging overlay digests. After merge to main, CI
rebuilds images with `prod-` prefix and updates production overlays. Production
overlays always contain production-built digests, not staging ones.

### 4.4 Rollback

| Scenario             | Action                              | Effect                                                |
| -------------------- | ----------------------------------- | ----------------------------------------------------- |
| Bad app code         | `git revert` overlay commit         | Argo syncs previous digest                            |
| Bad migration        | Manual intervention required        | Drizzle has no auto-rollback; write reverse migration |
| Bad config           | Update ConfigMap/Secret, Argo syncs | Pod restarts with new config                          |
| Full rollback        | Revert all overlay changes          | All apps return to previous version                   |
| Single node rollback | Revert only that node's overlay     | Only that node's pod restarts                         |

---

## 5. E2E Flow: New Node Formation

### 5.1 Steps to Add a New Node

| #   | Action                      | Actor                   | Files Changed                                                    |
| --- | --------------------------- | ----------------------- | ---------------------------------------------------------------- |
| 1   | Scaffold from template      | Developer / Operator AI | Copy `nodes/node-template/` → `nodes/{name}/`                    |
| 2   | Generate node identity      | Developer               | Update `.cogni/repo-spec.yaml` with new UUIDs                    |
| 3   | Register in operator        | Developer               | Add to `.cogni/repo-spec.yaml` `nodes[]` array                   |
| 4   | Add Kustomize base          | Developer               | Create `infra/k8s/base/{name}/` (deployment, service, configmap) |
| 5   | Add overlays                | Developer               | Create `infra/k8s/overlays/{staging,production}/{name}/`         |
| 6   | Add SOPS secrets            | Developer               | Create encrypted secrets for new node per env                    |
| 7   | Add to node catalog         | Developer               | Add entry to `infra/catalog/{name}.yaml`                         |
| 8   | Add DB name                 | Developer               | Append to `COGNI_NODE_DBS` env var                               |
| 9   | Add billing endpoint        | Developer               | Append to `COGNI_NODE_ENDPOINTS` env var                         |
| 10  | Add Caddy route             | Developer               | Add subdomain block to `Caddyfile.tmpl`                          |
| 11  | Add DNS record              | Developer               | A record for `{name}.cognidao.org` → VM IP                       |
| 12  | Add CI build                | Developer               | Add Dockerfile build step to CI workflow                         |
| 13  | Open PR                     | Developer               | All above in one PR                                              |
| 14  | CI validates                | CI                      | Manifest check + coverage check + tests                          |
| 15  | Merge                       | Developer               | Triggers full pipeline                                           |
| 16  | provision.sh creates DB     | CI deploy               | Idempotent — creates new DB, skips existing                      |
| 17  | Argo CD creates Application | Argo CD                 | ApplicationSet sees new catalog entry                            |
| 18  | Migration Job runs          | Argo CD                 | PreSync Job applies schema to new DB                             |
| 19  | Node app starts             | Argo CD                 | Deployment created, pods scheduled                               |

### 5.2 What Should Be Automatable (Future)

| Step  | Automation Path                                                      |
| ----- | -------------------------------------------------------------------- |
| 1-3   | `pnpm create:node {name}` generator script                           |
| 4-7   | Generator creates Kustomize manifests + catalog entry from templates |
| 8-9   | Generator appends to env var configs                                 |
| 10-11 | `dns-ops` package (exists) creates Cloudflare records                |
| 12    | CI detects new node by scanning `nodes/*/app/Dockerfile`             |

---

## 6. Networking

### 6.1 k3s → Compose (Apps Reaching Infrastructure)

Uses the pattern from PR #628: selectorless Services + EndpointSlices pointing to `127.0.0.1`.

| k3s Service         | Target    | Compose Service | Port |
| ------------------- | --------- | --------------- | ---- |
| `postgres-external` | 127.0.0.1 | postgres        | 5432 |
| `temporal-external` | 127.0.0.1 | temporal        | 7233 |
| `litellm-external`  | 127.0.0.1 | litellm         | 4000 |
| `redis-external`    | 127.0.0.1 | redis           | 6379 |

Each app's Kustomize base includes an `external-services.yaml` with these definitions.

### 6.2 Compose → k3s (LiteLLM Reaching Node Billing Endpoints)

This is the reverse direction. LiteLLM runs on Compose and must POST billing callbacks to each node's `/api/internal/billing/ingest`.

| Option                    | How                                                                   | Complexity                  | Chosen? |
| ------------------------- | --------------------------------------------------------------------- | --------------------------- | ------- |
| **k3s NodePort**          | Each node app exposes a NodePort, LiteLLM hits `127.0.0.1:{nodePort}` | Low                         | **Yes** |
| **k3s HostPort**          | Pod spec includes `hostPort`, bypasses Service                        | Low but fragile             | No      |
| **Shared Docker network** | Connect k3s container network to Compose                              | Complex, breaks isolation   | No      |
| **kubectl port-forward**  | Forward pod ports to localhost                                        | Fragile, not for production | No      |

**COGNI_NODE_ENDPOINTS** format changes from Docker hostnames to localhost NodePorts:

```bash
# Before (Compose-to-Compose):
COGNI_NODE_ENDPOINTS=4ff8eac1...=http://app:3000/api/internal/billing/ingest,...

# After (Compose-to-k3s via NodePort):
COGNI_NODE_ENDPOINTS=4ff8eac1...=http://127.0.0.1:30000/api/internal/billing/ingest,5ed2d64f...=http://127.0.0.1:30100/api/internal/billing/ingest,...
```

### 6.3 Caddy → k3s (External Traffic to Node Apps)

| Approach                                  | How                                                                   | Pros                          | Cons                            |
| ----------------------------------------- | --------------------------------------------------------------------- | ----------------------------- | ------------------------------- |
| **Caddy → NodePort per app**              | Each app has a NodePort, Caddy routes by subdomain                    | Simple, no k8s ingress needed | NodePort allocation management  |
| **Caddy → k3s Ingress**                   | Re-enable traefik or install nginx-ingress, Caddy forwards to ingress | Clean routing, standard k8s   | Extra component, double proxy   |
| **Caddy → single NodePort + Host header** | One k3s ingress NodePort, routes by Host                              | Minimal NodePorts             | Requires k8s ingress controller |

**Recommended: Caddy → NodePort per app** (simplest for ≤5 apps on single VM).

Caddyfile becomes:

```caddyfile
cognidao.org {
  reverse_proxy 127.0.0.1:30000  # operator NodePort
}
poly.cognidao.org {
  reverse_proxy 127.0.0.1:30100  # poly NodePort
}
resy.cognidao.org {
  reverse_proxy 127.0.0.1:30300  # resy NodePort
}
```

### 6.4 NodePort Allocation

| App              | ClusterIP Port | NodePort | Purpose                             |
| ---------------- | -------------- | -------- | ----------------------------------- |
| operator         | 3000           | 30000    | Main app                            |
| poly             | 3000           | 30100    | Poly node                           |
| resy             | 3000           | 30300    | Resy node                           |
| scheduler-worker | 9000           | —        | Internal only (no external traffic) |
| sandbox-openclaw | 18789          | —        | Internal only                       |

---

## 7. Secrets Management

### 7.1 Secret Layers

| Layer                  | Scope                      | Encryption                           | Managed By                             |
| ---------------------- | -------------------------- | ------------------------------------ | -------------------------------------- |
| **GitHub Secrets**     | CI builds + Compose deploy | GitHub-managed                       | `pnpm setup:secrets`                   |
| **K8s Secrets (SOPS)** | k3s app pods               | age encryption at rest in Git        | ksops CMP decrypts at apply            |
| **Compose .env**       | Compose infra services     | Not encrypted (on VM filesystem)     | `deploy.sh` writes from GitHub Secrets |
| **Terraform vars**     | VM provisioning            | `terraform.auto.tfvars` (gitignored) | `pnpm setup:secrets`                   |

### 7.2 Per-Node K8s Secrets

Each node needs its own encrypted Secret in `infra/k8s/secrets/{env}/{node}.enc.yaml`:

| Secret Key               | Operator              | Poly                  | Resy                  | Shared?                          |
| ------------------------ | --------------------- | --------------------- | --------------------- | -------------------------------- |
| `DATABASE_URL`           | `cogni_operator` DB   | `cogni_poly` DB       | `cogni_resy` DB       | No — per-node DB                 |
| `DATABASE_SERVICE_URL`   | Same DB, service role | Same DB, service role | Same DB, service role | No — per-node DB                 |
| `AUTH_SECRET`            | Unique per node       | Unique per node       | Unique per node       | **No** — origin-scoped sessions  |
| `LITELLM_MASTER_KEY`     | Shared                | Shared                | Shared                | Yes — single LiteLLM instance    |
| `BILLING_INGEST_TOKEN`   | Shared                | Shared                | Shared                | Yes — same auth for billing POST |
| `INTERNAL_OPS_TOKEN`     | Shared                | Shared                | Shared                | Yes                              |
| `OPENCLAW_GATEWAY_TOKEN` | Operator only         | —                     | —                     | N/A                              |
| `OPENROUTER_API_KEY`     | —                     | —                     | —                     | Injected via LiteLLM, not app    |

### 7.3 Secret Rotation

| Secret               | Rotation Method                                               | Blast Radius                     |
| -------------------- | ------------------------------------------------------------- | -------------------------------- |
| `AUTH_SECRET`        | Re-encrypt SOPS, push, Argo syncs → pod restart               | Single node sessions invalidated |
| `DATABASE_URL`       | Change DB password, update SOPS + Compose .env, redeploy both | Full stack restart for that node |
| `LITELLM_MASTER_KEY` | Update SOPS + Compose .env, restart LiteLLM + all apps        | All nodes restart                |
| `SOPS age key`       | Generate new keypair, re-encrypt all secrets, update TF var   | Full re-provision                |

---

## 8. Database Migrations

### 8.1 Current State (Compose)

Migrations run as a one-shot Compose service (`db-migrate`) using the migrator image target. Single `DATABASE_URL` points to one DB.

### 8.2 Multi-Node Migration Strategy

All nodes share the same schema (same Drizzle migrations from `apps/operator/`). Each node has its own database.

| Approach                          | How                                                                                 | Pros                   | Cons                         |
| --------------------------------- | ----------------------------------------------------------------------------------- | ---------------------- | ---------------------------- |
| **Argo PreSync Job per node**     | K8s Job runs migrator image with node-specific DATABASE_URL before Deployment syncs | GitOps-native, ordered | Need Job manifest per node   |
| **Single multi-DB migration Job** | One Job iterates COGNI_NODE_DBS, migrates each                                      | Simple, one manifest   | Failure on one DB blocks all |
| **Init container**                | App pod runs migrations on startup                                                  | No separate Job        | Races if multiple replicas   |
| **CI step**                       | Migrations run in CI via SSH before Argo sync                                       | Decoupled from Argo    | Breaks GitOps purity         |

**Recommended: Argo PreSync Job per node.**

Each node's Kustomize base includes a `migration-job.yaml`:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: migrate-{node}
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: BeforeHookCreation
spec:
  template:
    spec:
      containers:
        - name: migrate
          image: <migrator-image>  # Patched by overlay
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: {node}-secrets
                  key: DATABASE_URL
      restartPolicy: Never
  backoffLimit: 3
```

### 8.3 Migration Ordering

```
Argo Sync Wave:
  PreSync (wave -1): provision databases (if new node)
  PreSync (wave 0):  run migrations per node
  Sync (wave 1):     deploy app pods
  PostSync:          health verification
```

### 8.4 DB Provisioning in Argo Context

Database provisioning (`provision.sh`) still runs via Compose because it needs Postgres superuser access. Two options:

| Option                          | When It Runs                                                           | Triggered By             |
| ------------------------------- | ---------------------------------------------------------------------- | ------------------------ |
| **Compose bootstrap (current)** | `deploy.sh` runs `docker compose --profile bootstrap run db-provision` | Every CI deploy of infra |
| **Standalone script via SSH**   | CI calls `ssh ... provision.sh` before Argo sync                       | New node PR merged       |

Either works because `provision.sh` is idempotent. The Compose bootstrap approach is simpler — just ensure `COGNI_NODE_DBS` includes all node DB names and `deploy.sh` always runs provisioning.

---

## 9. ApplicationSet Design

### 9.1 Current (PR #628): Hardcoded List Generator

```yaml
generators:
  - list:
      elements:
        - name: scheduler-worker
          path: infra/k8s/overlays/staging/scheduler-worker
        - name: sandbox-openclaw
          path: infra/k8s/overlays/staging/sandbox-openclaw
```

**Problem:** Adding a node requires editing the ApplicationSet YAML.

### 9.2 Target: Git File Generator

```yaml
generators:
  - git:
      repoURL: https://github.com/cogni-dao/cogni-template.git
      revision: staging
      files:
        - path: "infra/catalog/*.yaml"
```

Each catalog file (`infra/catalog/operator.yaml`, `infra/catalog/poly.yaml`, etc.):

```yaml
name: poly
type: node # "node" or "service"
overlay_path: infra/k8s/overlays/staging/poly
namespace: cogni-staging
```

**Adding a new node = adding a catalog YAML file.** No ApplicationSet edit needed.

### 9.3 Dual-Environment ApplicationSets

| ApplicationSet     | Watches                | Target Branch | Namespace          |
| ------------------ | ---------------------- | ------------- | ------------------ |
| `cogni-staging`    | `infra/catalog/*.yaml` | `staging`     | `cogni-staging`    |
| `cogni-production` | `infra/catalog/*.yaml` | `main`        | `cogni-production` |

Both live in `infra/k8s/argocd/` and are applied during bootstrap.

---

## 10. Critical Gap Analysis

### 10.1 Gaps in PR #628 (Must Fix Before Merge)

| #   | Gap                                         | Severity | What Exists                                                  | What's Needed                                                                   | Effort   |
| --- | ------------------------------------------- | -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------- |
| G1  | **Rebase onto integration/multi-node**      | Blocker  | PR based on staging ancestor                                 | Rebase 25+ commits; resolve conflicts in deploy.sh, docs, setup-secrets         | 1-2 days |
| G2  | **No node app manifests**                   | Blocker  | Only scheduler-worker + sandbox-openclaw bases               | Add Kustomize base/overlays for operator, poly, resy                            | 1 day    |
| G3  | **No node image builds in CI**              | Blocker  | CI builds only `apps/operator/Dockerfile` + scheduler-worker | Add build steps for `nodes/poly/app/Dockerfile`, `nodes/resy/app/Dockerfile`    | 0.5 day  |
| G4  | **Promote script is scheduler-worker only** | Blocker  | `promote-k8s-image.sh` hardcoded to one service              | Generalize: accept `--app {name} --digest {ref}` args, loop over all built apps | 0.5 day  |
| G5  | **ApplicationSet uses list generator**      | High     | Hardcoded list of 2 services                                 | Switch to Git file generator reading `catalog/*.yaml`                           | 0.5 day  |
| G6  | **No Caddy multi-domain routing**           | High     | Single `{$DOMAIN}` reverse_proxy to `app:3000`               | Per-subdomain blocks for operator, poly, resy with NodePort backends            | 0.5 day  |
| G7  | **No Compose→k3s networking**               | High     | Only k3s→Compose (EndpointSlices)                            | NodePort services for node apps so LiteLLM can POST billing callbacks           | 0.5 day  |
| G8  | **No per-node SOPS secrets**                | High     | Only scheduler-worker + sandbox-openclaw secrets             | Encrypt secrets for operator, poly, resy per environment                        | 0.5 day  |
| G9  | **Operator still on Compose**               | High     | `app` service in docker-compose.yml                          | Move to k3s Deployment; remove from Compose runtime                             | 1 day    |
| G10 | **No migration Jobs in Argo**               | High     | Migrations run via Compose bootstrap                         | Add PreSync Job per node in Kustomize bases                                     | 0.5 day  |

### 10.2 Gaps in integration/multi-node (Must Fix for Multi-Node CD)

| #   | Gap                                              | Severity | Current State                                            | What's Needed                                                                  | Effort        |
| --- | ------------------------------------------------ | -------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------- |
| G11 | **COGNI_NODE_ENDPOINTS not in deploy workflows** | Blocker  | Missing from staging-preview.yml + deploy-production.yml | Add as env var (hardcoded or GitHub Secret)                                    | 0.5 hr        |
| G12 | **LiteLLM image not versioned/pushed to GHCR**   | Medium   | `cogni-litellm:latest` built by Compose locally          | Build in CI, push to GHCR with digest pinning                                  | 0.5 day       |
| G13 | **Per-node AUTH_SECRET not implemented**         | Medium   | Single shared AUTH_SECRET                                | Per-node AUTH_SECRET in env schema + SOPS secrets                              | 0.5 day       |
| G14 | **No per-node DNS records**                      | Medium   | Single domain                                            | Create `poly.cognidao.org`, `resy.cognidao.org` A records                      | 1 hr          |
| G15 | **No affected-only builds**                      | Medium   | CI rebuilds everything on every push                     | Turbo/Nx affected detection or Dockerfile path filtering                       | 1 day         |
| G16 | **Shared Dockerfile base across nodes**          | Low      | All node Dockerfiles identical except path               | Consider multi-app Dockerfile with build arg, or keep separate for flexibility | Decision only |

### 10.3 Gaps in Argo CD Operations

| #   | Gap                                    | Severity | What's Needed                                                         | Effort                                                   |
| --- | -------------------------------------- | -------- | --------------------------------------------------------------------- | -------------------------------------------------------- | ------- |
| G17 | **No Argo CD monitoring**              | Medium   | Prometheus ServiceMonitor for Argo CD metrics, alert on sync failures | 0.5 day                                                  |
| G18 | **No Argo CD admin password rotation** | Low      | Initial admin password set at bootstrap; rotate or disable            | 1 hr                                                     |
| G19 | **No Argo CD RBAC**                    | Low      | Default `admin` role only. Fine for single-team, not for multi-tenant | Defer                                                    |
| G20 | **Remote Terraform state**             | Low      | State is local. Risk: state loss = re-provision                       | Migrate to S3 backend                                    | 0.5 day |
| G21 | **Golden image (Packer)**              | Low      | Docker installed at boot via `curl \| sh` (nondeterministic)          | Pre-bake with Packer                                     | 1 day   |
| G22 | **Resource limits not tuned**          | Medium   | No memory/CPU limits on k3s pods                                      | Profile actual usage, set requests/limits to prevent OOM | 0.5 day |

---

## 11. Infra Directory Layout (Target State)

See §0 for the full `infra/` reorganization. Below is the detailed `infra/k8s/` tree:

```
infra/k8s/                                  # Kubernetes renderer (k3s + Argo CD)
├── argocd/
│   ├── kustomization.yaml                  # Argo CD v2.13.4 install
│   ├── ksops-cmp.yaml                      # SOPS CMP plugin
│   ├── repo-server-patch.yaml              # ksops sidecar
│   ├── staging-applicationset.yaml         # Git file generator → cogni-staging
│   └── production-applicationset.yaml      # Git file generator → cogni-production
├── base/
│   ├── node-app/                           # Shared base for all node apps
│   │   ├── deployment.yaml                 # 1 replica, /livez + /readyz probes
│   │   ├── service.yaml                    # ClusterIP + NodePort
│   │   ├── configmap.yaml                  # APP_ENV, LITELLM_BASE_URL, TEMPORAL_ADDRESS
│   │   ├── external-services.yaml          # EndpointSlices to Compose infra
│   │   ├── migration-job.yaml              # PreSync Job for drizzle migrations
│   │   └── kustomization.yaml
│   ├── scheduler-worker/                   # Existing (PR #628, path-renamed)
│   └── sandbox-openclaw/                   # Existing (PR #628, path-renamed)
├── overlays/
│   ├── staging/
│   │   ├── namespace.yaml
│   │   ├── operator/
│   │   │   └── kustomization.yaml          # image digest, NODE_PORT=30000
│   │   ├── poly/
│   │   │   └── kustomization.yaml          # image digest, NODE_PORT=30100
│   │   ├── resy/
│   │   │   └── kustomization.yaml          # image digest, NODE_PORT=30300
│   │   ├── scheduler-worker/               # Existing
│   │   └── sandbox-openclaw/               # Existing
│   └── production/
│       └── (mirror of staging structure)
└── secrets/
    ├── .sops.yaml
    ├── staging/
    │   ├── operator.enc.yaml
    │   ├── poly.enc.yaml
    │   ├── resy.enc.yaml
    │   ├── scheduler-worker.enc.yaml       # Existing
│       │   └── sandbox-openclaw.enc.yaml   # Existing
│       └── production/
│           └── (mirror)
└── akash/                                  # Future: Akash SDL renderer (empty)
    └── README.md
```

### 11.1 Shared Base Pattern

All node apps (operator, poly, resy) use `base/node-app/` as a shared Kustomize base. Overlays customize:

| Field                      | Base (shared) | Overlay (per-node)           |
| -------------------------- | ------------- | ---------------------------- |
| Deployment replicas        | 1             | Override if needed           |
| Container image            | Placeholder   | `@sha256:...` digest         |
| Container port             | 3000          | 3000 (same for all)          |
| Service NodePort           | —             | 30000, 30100, 30300          |
| ConfigMap: APP_ENV         | —             | `preview` / `production`     |
| ConfigMap: NODE_NAME       | —             | `operator` / `poly` / `resy` |
| Secret ref                 | —             | `{node}-secrets`             |
| Migration Job image        | Placeholder   | Migrator `@sha256:...`       |
| Migration Job DATABASE_URL | —             | From `{node}-secrets`        |

---

## 12. CI Workflow Changes Required

### 12.1 Build Matrix

```yaml
# In ci.yaml stack-test job and staging-preview.yml build job:
strategy:
  matrix:
    app:
      - name: operator
        dockerfile: apps/operator/Dockerfile
        context: .
      - name: poly
        dockerfile: nodes/poly/app/Dockerfile
        context: .
      - name: resy
        dockerfile: nodes/resy/app/Dockerfile
        context: .
      - name: scheduler-worker
        dockerfile: services/scheduler-worker/Dockerfile
        context: services/scheduler-worker
```

### 12.2 Promote Step (Generalized)

```bash
# For each built app:
scripts/ci/promote-k8s-image.sh \
  --app operator \
  --digest ghcr.io/cogni-dao/cogni-template@sha256:abc... \
  --env staging

# Updates: infra/k8s/overlays/staging/operator/kustomization.yaml
# Commits all overlay changes in one [skip ci] commit
```

### 12.3 Affected-Only Builds (Future Optimization)

| Approach             | Tool                           | How                                                               |
| -------------------- | ------------------------------ | ----------------------------------------------------------------- |
| **Path filters**     | GitHub Actions `paths`         | Only trigger node build if `nodes/{name}/` or `packages/` changed |
| **Turbo affected**   | `turbo run build --filter=...` | Turbo graph detects affected packages                             |
| **Always build all** | None (current)                 | Simpler but slower; fine for ≤5 apps                              |

For now: **always build all** (simplicity). Optimize later when build times are painful.

### 12.4 CLI Entry Points (SCRIPTS_ARE_THE_API)

Per `node-ci-cd-contract.md`, workflows call named pnpm scripts, never inline commands.

| Script                                              | Purpose                                                   | Calls                                         |
| --------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| `pnpm check:gitops:manifests`                       | Validate all Kustomize overlays render                    | `scripts/ci/check-gitops-manifests.sh`        |
| `pnpm check:gitops:coverage`                        | Validate catalog coverage (every app has base + overlays) | `scripts/ci/check-gitops-service-coverage.sh` |
| `pnpm cd:promote`                                   | Update overlay digests for all built apps                 | `scripts/ci/promote-k8s-image.sh --all`       |
| `pnpm cd:promote -- --app poly --digest sha256:...` | Update single app overlay                                 | `scripts/ci/promote-k8s-image.sh`             |

These are added to root `package.json` and run in both `pnpm check` (local gate) and CI.

---

## 13. Implementation Sequence

### Phase 0: Unblock Current Pipeline (Day 1)

| Task                                           | What        | Risk if Skipped           |
| ---------------------------------------------- | ----------- | ------------------------- |
| Set `COGNI_NODE_ENDPOINTS` in deploy workflows | G11         | LiteLLM crashes on deploy |
| Pin LiteLLM image                              | G12 partial | Non-reproducible deploys  |

### Phase 1: Rebase + Node Manifests (Days 2-4)

| Task                                          | What | Depends On     |
| --------------------------------------------- | ---- | -------------- |
| Rebase PR #628 onto integration/multi-node    | G1   | Phase 0        |
| Create shared `base/node-app/` Kustomize base | G2   | Rebase         |
| Create overlays for operator, poly, resy      | G2   | Base           |
| Create SOPS secrets for each node             | G8   | Overlays       |
| Add PreSync migration Jobs                    | G10  | Base           |
| Switch ApplicationSet to Git file generator   | G5   | Catalog files  |
| Create `catalog/*.yaml` for all 5 apps        | G5   | ApplicationSet |

### Phase 2: CI Pipeline + Networking (Days 4-6)

| Task                              | What | Depends On   |
| --------------------------------- | ---- | ------------ |
| Add node image builds to CI       | G3   | Phase 1      |
| Generalize promote script         | G4   | Phase 1      |
| Add NodePort services for nodes   | G7   | Phase 1      |
| Update Caddyfile for multi-domain | G6   | NodePorts    |
| Move operator from Compose to k3s | G9   | All above    |
| Implement per-node AUTH_SECRET    | G13  | SOPS secrets |

### Phase 3: Bootstrap + Verify (Days 6-8)

| Task                                         | What | Depends On           |
| -------------------------------------------- | ---- | -------------------- |
| Create DNS records                           | G14  | Caddy config         |
| Wipe staging VM                              | —    | Phase 2              |
| Re-provision via `tofu apply`                | —    | DNS records          |
| Verify Argo CD syncs all apps                | —    | Re-provision         |
| Verify migrations run per node               | —    | Argo sync            |
| Verify Caddy routes to each subdomain        | —    | DNS + Caddy          |
| Verify LiteLLM billing callbacks reach nodes | —    | NodePorts            |
| Run E2E tests                                | —    | All above            |
| Set resource limits                          | G22  | Profiling on staging |

### Phase 4: Production (Days 8-10)

| Task                         | What | Depends On       |
| ---------------------------- | ---- | ---------------- |
| Wipe production VM           | —    | Staging verified |
| Re-provision production      | —    | Wipe             |
| Verify production deployment | —    | Re-provision     |
| Monitor for 24h              | —    | Deploy           |

---

## 14. Risk Register

| Risk                                  | Likelihood | Impact                                       | Mitigation                                                                                               |
| ------------------------------------- | ---------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **k3s OOM on 4GB VM**                 | High       | Argo + 5 pods + Compose infra may exceed RAM | Upgrade to 8GB VM; set resource limits (G22)                                                             |
| **SOPS age key loss**                 | Low        | Cannot decrypt secrets, full re-provision    | Backup private key in secure vault; document recovery                                                    |
| **Argo CD itself unhealthy**          | Medium     | Apps don't reconcile, drift accumulates      | Add monitoring (G17); Argo is non-HA, single pod restart recovers                                        |
| **Migration failure blocks all apps** | Medium     | PreSync Job failure prevents Sync            | Per-node Jobs isolate failures; backoffLimit=3                                                           |
| **NodePort conflicts**                | Low        | Two services claim same port                 | Explicit allocation table (section 6.4); CI manifest validation                                          |
| **Compose↔k3s networking breaks**    | Medium     | LiteLLM can't reach nodes or vice versa      | Test networking in staging first; EndpointSlices + NodePorts are stable primitives                       |
| **Cloud-init bootstrap fails**        | Low        | VM stuck without k3s/Argo                    | bootstrap.fail marker + diagnostics; manual SSH recovery                                                 |
| **Rebase conflicts in PR #628**       | High       | Significant merge work                       | Conflicts in docs/deploy.sh — accept integration/multi-node; rename infra/cd/ → infra/k8s/ during rebase |

---

## 15. Open Questions

| #   | Question                                                              | Options                                                    | Recommendation                                                                                                 |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Q1  | Should all nodes share one migrator image or have per-node migrators? | Shared (same schema) vs Per-node (schema could diverge)    | **Shared for now** — all nodes use identical schema from `apps/operator/`. Revisit if nodes get custom tables. |
| Q2  | Should Argo watch `staging` branch or `integration/multi-node`?       | Staging (standard) vs integration (current work branch)    | **Staging** — integration/multi-node merges to staging when ready. Argo watches stable branch.                 |
| Q3  | One ApplicationSet per env or one parameterized?                      | Two (staging + production) vs One with matrix              | **Two separate** — simpler to reason about, different targetRevision per env.                                  |
| Q4  | NodePort allocation: static or dynamic?                               | Static (hardcoded in overlays) vs Dynamic (let k8s assign) | **Static** — Caddy config must know ports. Use 30000-30999 range with explicit table.                          |
| Q5  | When to move to k8s Ingress instead of Caddy→NodePort?                | Now vs When pain                                           | **When pain** — Caddy→NodePort works for ≤10 nodes. Ingress adds complexity for no gain yet.                   |
| Q6  | LiteLLM: keep on Compose or move to k3s?                              | Compose (status quo) vs k3s                                | **Compose** — LiteLLM has a custom Python callback, Postgres dependency, and doesn't change often.             |
| Q7  | How to handle shared packages changes triggering all node rebuilds?   | Rebuild all vs Detect actual dependency                    | **Rebuild all for now** — correctness over speed. Turbo affected detection later.                              |

---

## Appendix A: Branch Alignment

```
                    common ancestor (78583447f)
                   /                            \
  worktree-cicd-gap-analysis                     staging
  (PR #628: Argo + k3s)                          |
  25 commits: k3s bootstrap,                     integration/multi-node
  Argo CD, ApplicationSet,                       15 commits: nodes/, billing,
  ksops, promote script,                         identity, stack tests
  CI checks, docs
```

**Rebase strategy:** `git rebase origin/integration/multi-node` on the Argo branch. During rebase, rename `infra/cd/` → `infra/k8s/`, move `infra/tofu/` → `infra/provision/`, create `infra/catalog/`. Expected conflicts:

| File                                       | Conflict Type | Resolution                                                                            |
| ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------- |
| `scripts/ci/deploy.sh`                     | Both modified | Accept integration/multi-node, re-apply Argo's k3s comment additions                  |
| `scripts/setup-secrets.ts`                 | Both modified | Accept integration/multi-node base, cherry-pick SOPS age keypair additions            |
| `.github/workflows/staging-preview.yml`    | Both modified | Accept integration/multi-node, re-add gitops CI checks + promote step                 |
| `.github/workflows/ci.yaml`                | Both modified | Accept integration/multi-node, re-add gitops checks                                   |
| `docs/runbooks/DEPLOYMENT_ARCHITECTURE.md` | Both modified | Rewrite for multi-node + Argo (new content)                                           |
| `infra/compose/runtime/docker-compose.yml` | Both modified | Accept integration/multi-node (has node services), remove operator from Compose later |
| `infra/cd/*` → `infra/k8s/*`               | Path rename   | Rename Argo manifests directory during rebase                                         |
| `package.json`                             | Both modified | Accept integration/multi-node, re-add gitops scripts with updated paths               |

---

## Appendix B: Glossary

| Term                   | Meaning                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| **ApplicationSet**     | Argo CD resource that generates multiple Applications from a template + generator                  |
| **Git file generator** | ApplicationSet generator that reads YAML files from a Git repo to produce template parameters      |
| **Kustomize overlay**  | Environment-specific patches applied on top of a shared base                                       |
| **PreSync hook**       | Argo CD annotation that runs a resource before the main sync (used for migrations)                 |
| **EndpointSlice**      | k8s resource that maps a Service to arbitrary IP:port endpoints (used for Compose→k3s bridge)      |
| **NodePort**           | k8s Service type that exposes a port on every node's IP (used for k3s→Compose bridge)              |
| **SOPS**               | Mozilla's Secrets OPerationS — encrypts YAML values while leaving keys readable                    |
| **age**                | Modern file encryption tool (replaces PGP). SOPS uses age for key management                       |
| **ksops**              | Kustomize plugin that integrates SOPS decryption into `kubectl kustomize`                          |
| **CMP**                | Config Management Plugin — Argo CD extension mechanism for custom manifest generation              |
| **digest ref**         | Immutable container image reference using content hash (`@sha256:...`) instead of mutable tag      |
| **SDL**                | Akash Service Definition Language — declares compute, storage, and placement for Akash deployments |
