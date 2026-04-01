---
id: task.0247
type: task
title: "Multi-node CI/CD deployment strategy — current stack vs ArgoCD"
status: needs_design
priority: 1
rank: 3
estimate: 3
summary: "Design and implement deployment infra for multiple node apps. Decision: extend current Docker Compose + Caddy stack (fast, proven) or jump to ArgoCD + Kustomize (right long-term, higher upfront cost)."
outcome: "Each node app deploys to its own domain (cognidao.org, poly.cognidao.org, resy.cognidao.org) with independent health checks and rollback capability."
spec_refs:
  - docs/spec/node-launch.md
  - docs/spec/node-operator-contract.md
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-01
updated: 2026-04-01
labels: [cicd, deployment, nodes, infrastructure]
external_refs:
---

## Context

Current deployment: single Cherry Servers VM, Docker Compose, SSH-based
`scripts/ci/deploy.sh`. One app image, one scheduler-worker, shared Postgres +
Temporal + LiteLLM + Caddy. Works for one app.

With multi-node (task.0245), we need to deploy 3 webapps to 3 domains. Two paths:

## Option A: Extend Current Stack (Compose + Caddy)

**What it takes:**

- Add `node-poly` and `node-resy` services to `docker-compose.yml`
- Each service builds from `nodes/{name}/app/Dockerfile`, runs on its own port
- Add Caddy routes: `poly.cognidao.org` → `node-poly:3100`, `resy.cognidao.org` → `node-resy:3200`
- `dns-ops` creates CNAME/A records for each subdomain → same VM IP
- Existing deploy.sh pulls all images, restarts all services
- Shared services (Postgres, Temporal, LiteLLM) unchanged

**Pros:**

- Works today. No new infra to provision.
- Single VM = simple networking, shared localhost Postgres
- Deploy script already handles multi-service compose
- Caddy auto-TLS for each domain

**Cons:**

- All apps on one VM = no isolation, shared resource contention
- Deploy = restart everything (no per-app rolling update)
- No namespace isolation (all containers see each other)
- Doesn't scale past ~3-4 apps without bigger VM
- Manual capacity planning

**Estimated effort:** 2-3 days (Dockerfiles, compose, Caddy config, dns-ops)

## Option B: ArgoCD + Kustomize on k3s

**What it takes (per proj.cicd-services-gitops P1-P2):**

- Provision k3s cluster (OpenTofu, `infra/tofu/cherry/k3s/` already scaffolded)
- Install ArgoCD on cluster
- Create Kustomize base for node apps (shared template)
- Per-node overlay in `infra/cd/nodes/{name}/kustomization.yaml`
- ArgoCD ApplicationSet discovers nodes from directory structure
- Wildcard DNS `*.nodes.cognidao.org` → cluster ingress IP
- Per-node: namespace, Ingress rule, k8s Secret, app Deployment

**Pros:**

- Namespace isolation per node (k8s enforced)
- Rolling updates per app (no restart-the-world)
- ArgoCD GitOps = desired state in repo, auto-sync
- Scales to N nodes without per-node deploy scripts
- Matches node-launch.md spec exactly (provisionNode workflow)
- Foundation for everything in proj.cicd-services-gitops P2+

**Cons:**

- Significant upfront cost (k3s cluster, ArgoCD, Kustomize bases)
- k3s on single VM still shares resources (multi-node k3s = P3)
- More moving parts to debug
- Need GHCR image pipeline per app (build-prod.yml changes)

**Estimated effort:** 1-2 weeks (cluster, ArgoCD, Kustomize, pipeline changes)

## Recommendation

**Option A first, Option B in parallel.**

Rationale:

- We need poly and resy live soon. Option A gets them deployed in days.
- Option B is the right architecture but blocks on k3s provisioning.
- Option A doesn't create tech debt — the Dockerfiles and Caddy config we build
  translate directly to k8s Deployments and Ingress rules.
- The `dns-ops` work (wildcard DNS, per-node subdomains) is needed by both options.

### Incremental path

1. **Now (this task):** Option A — add node apps to Docker Compose + Caddy
2. **proj.cicd-services-gitops P1:** Provision k3s, install ArgoCD
3. **proj.cicd-services-gitops P2:** Migrate from Compose → Kustomize overlays
4. **proj.cicd-services-gitops P3:** Multi-node k3s, HPA, managed Postgres

## Plan (Option A implementation)

### Phase 1: Per-node Dockerfiles

1. Create `nodes/poly/app/Dockerfile` (based on `apps/web/Dockerfile` pattern)
2. Create `nodes/resy/app/Dockerfile` (same pattern)
3. Add build scripts to `scripts/ci/build-node.sh`

### Phase 2: Compose + Caddy

1. Add `node-poly` and `node-resy` services to `docker-compose.yml`
2. Add Caddy routes for each domain
3. Wire dns-ops to create subdomains

### Phase 3: CI pipeline

1. Update `build-prod.yml` to build node images
2. Update `deploy.sh` to pull + restart node containers
3. Add per-node health checks to `staging-preview.yml`

## Non-goals

- k3s provisioning (proj.cicd-services-gitops P1)
- ArgoCD setup (proj.cicd-services-gitops P1)
- Per-node databases (V1+)
- Preview environments per PR (proj.cicd-services-gitops P2)

## Validation

- [ ] `docker compose up` starts all 3 node apps + shared services
- [ ] Caddy routes requests to correct app by domain
- [ ] Each app responds on its own domain with valid TLS
- [ ] CI builds and pushes images for each node app
- [ ] Deploy script handles multi-node deployment
- [ ] Health checks pass for all 3 apps post-deploy
