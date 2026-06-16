---
id: spec.cd-pipeline-e2e
type: spec
title: CD Pipeline E2E — Multi-Node Argo CD GitOps
status: draft
trust: draft
summary: End-to-end specification for multi-node GitOps deployment aligned to trunk-based CI/CD, fixed pre-merge candidate slots, and post-merge digest promotion from `main`
read_when: Aligning the multi-node deployment pipeline, updating GitHub workflows, or deriving implementation tasks from the trunk-based CI/CD model
owner: cogni-dev
created: 2026-04-02
verified: 2026-04-20
initiative: proj.cicd-services-gitops
---

# CD Pipeline E2E: Multi-Node Argo CD GitOps

> End-to-end specification for continuous deployment of operator + node apps via
> Argo CD on k3s, with Docker Compose infrastructure services on the same VM.

> Historical note: the original canary/staging-era version of this document has been preserved at [`docs/spec/cd-pipeline-e2e-legacy-canary.md`](./cd-pipeline-e2e-legacy-canary.md).
> For branch-model axioms and the target operating rules, treat [`docs/spec/ci-cd.md`](./ci-cd.md) as the source of truth.
> For the dedicated v0 slot-control design, see [`docs/spec/candidate-slot-controller.md`](./candidate-slot-controller.md).

## Status

- **Target code branch model:** feature branches and PRs into `main`
- **Target deploy-state model:** `deploy/candidate-*`, `deploy/preview`, `deploy/production`
- **Date:** 2026-04-14
- **Constraint:** keep the strong parts of the multi-node GitOps design, while replacing branch semantics, artifact authority, and workflow ownership that were built around `staging` or a long-lived `canary` branch

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

```text
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

**One umbrella, not two.** A separate `deploy/` would split brain. Every deployment concern
(Caddy routing, LiteLLM callbacks, DB provisioning, bootstrap) crosses the
runtime and renderer boundary. Keeping everything in `infra/` means one place to look.

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
belong to it." K8s details stay in `k8s/`. Compose details stay in `compose/`.

**Deploy state is not app code.** App code lives on feature branches and `main`.
Rendered environment state lives on `deploy/*` branches watched by Argo.

---

## 1. Architecture Overview

Single VM per environment. Two runtimes coexist:

| Runtime            | Manages                                                                    | Why                                                                      |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Docker Compose** | Infrastructure: Postgres, Temporal, LiteLLM, Redis, Caddy, Alloy, Autoheal | Stateful, rarely changes, no GitOps churn needed                         |
| **k3s + Argo CD**  | Applications: Operator, Poly, Resy, Scheduler-Worker, Sandbox-OpenClaw     | Frequent changes, benefits from declarative sync, self-healing, rollback |

```text
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

The operator app currently runs on Compose. For multi-node, it must move to k3s alongside
poly and resy.

1. **Uniform deploy path** — all apps deploy the same way: image build → deploy-state update → Argo sync
2. **Uniform networking** — all apps are k3s Services, reachable by ClusterIP
3. **LiteLLM routing** — `COGNI_NODE_ENDPOINTS` can use k3s service DNS or NodePort routes consistently
4. **Self-healing** — Argo restarts crashed operator, not just nodes

### Operator Scope Clarification

The operator is both a formation factory and a running Cogni node with its own payments,
billing, and database. It is the first node in the network. Moving to k3s changes only the
deploy mechanism, not the operator's responsibilities.

### Billing Topology

LiteLLM is the single LLM proxy. All nodes call LiteLLM for completions. LiteLLM routes
billing callbacks back to each node's `/api/internal/billing/ingest`.

```text
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

| Component            | Runtime        | Image Source                           | Managed By                   | Changes Frequently? |
| -------------------- | -------------- | -------------------------------------- | ---------------------------- | ------------------- |
| **operator**         | k3s            | `nodes/operator/app/Dockerfile`        | Argo CD                      | Yes                 |
| **poly**             | k3s            | `nodes/poly/app/Dockerfile`            | Argo CD                      | Yes                 |
| **resy**             | k3s            | `nodes/resy/app/Dockerfile`            | Argo CD                      | Yes                 |
| **scheduler-worker** | k3s            | `services/scheduler-worker/Dockerfile` | Argo CD                      | Yes                 |
| **sandbox-openclaw** | k3s            | GHCR pre-built                         | Argo CD                      | Rarely              |
| **postgres**         | Compose        | `postgres:15`                          | `scripts/ci/deploy-infra.sh` | Never               |
| **temporal**         | Compose        | `temporalio/auto-setup`                | `scripts/ci/deploy-infra.sh` | Never               |
| **litellm**          | Compose        | `infra/images/litellm/Dockerfile`      | `scripts/ci/deploy-infra.sh` | Rarely              |
| **redis**            | Compose        | `redis:7-alpine`                       | `scripts/ci/deploy-infra.sh` | Never               |
| **caddy**            | Compose (edge) | `caddy:2`                              | `scripts/ci/deploy-infra.sh` | Rarely              |
| **alloy**            | Compose        | `grafana/alloy`                        | `scripts/ci/deploy-infra.sh` | Never               |

### 2.2 Node Identity Registry

| Node     | node_id                                | Port (dev) | DB Name          | Billing Endpoint               |
| -------- | -------------------------------------- | ---------- | ---------------- | ------------------------------ |
| operator | `4ff8eac1-4eba-4ed0-931b-b1fe4f64713d` | 3000       | `cogni_operator` | `/api/internal/billing/ingest` |
| poly     | `5ed2d64f-2745-4676-983b-2fb7e05b2eba` | 3100       | `cogni_poly`     | `/api/internal/billing/ingest` |
| resy     | `f6d2a17d-b7f6-4ad1-a86b-f0ad2380999e` | 3300       | `cogni_resy`     | `/api/internal/billing/ingest` |

Source of truth: `.cogni/repo-spec.yaml` and `nodes/{name}/.cogni/repo-spec.yaml`.

---

## 3. E2E Flow: First Provisioning (Fresh Environment)

### 3.1 Steps

| #   | Action                    | Actor      | Tool                                          | Output                                                              |
| --- | ------------------------- | ---------- | --------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Generate SSH deploy key   | Human      | `ssh-keygen -t ed25519`                       | Key pair → GitHub Secrets                                           |
| 2   | Generate SOPS age keypair | Human      | `pnpm setup:secrets`                          | Public key → `.sops.yaml`, private → TF var                         |
| 3   | Set GitHub Secrets        | Human      | `pnpm setup:secrets --all`                    | All env secrets populated                                           |
| 4   | Provision environment VM  | Human      | `tofu apply -var-file=terraform.{env}.tfvars` | VM with Docker + k3s + Argo CD                                      |
| 5   | Configure DNS             | Human      | Cloudflare / `dns-ops`                        | Records for operator and node subdomains                            |
| 6   | Deploy edge stack         | CI         | `scripts/ci/deploy-infra.sh`                  | Caddy running with TLS certs                                        |
| 7   | Deploy infra stack        | CI         | `scripts/ci/deploy-infra.sh`                  | Postgres, Temporal, LiteLLM, Redis                                  |
| 8   | Provision databases       | CI         | Compose bootstrap                             | `cogni_operator`, `cogni_poly`, `cogni_resy`, `litellm` DBs created |
| 9   | Argo CD bootstraps        | cloud-init | `bootstrap.yaml`                              | Argo CD watching deploy refs, ApplicationSets active                |
| 10  | Argo syncs apps           | Argo CD    | Auto-sync                                     | operator, poly, resy, scheduler-worker, openclaw Deployments        |
| 11  | Migrations run            | Argo CD    | PreSync Jobs                                  | Schema applied to each node DB                                      |
| 12  | Health checks pass        | k3s probes | `/livez`, `/readyz`                           | All pods Ready                                                      |

### 3.2 Bootstrap Ordering

| Gap                                                | Problem                                                              | Solution                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **DB must exist before Argo syncs apps**           | Argo will start pods that need DATABASE_URL pointing to existing DBs | Provision DBs before the first app sync of a fresh environment                |
| **LiteLLM must be healthy before app pods**        | App health depends on LiteLLM proxy                                  | Compose infra starts first; apps sync after foundational services are healthy |
| **Temporal must be ready before scheduler-worker** | Scheduler-worker fails if Temporal unreachable                       | Compose Temporal comes up before the scheduler-worker sync or readiness gate  |

Bootstrap ordering remains valid under the trunk-based model. What changes later is how candidate, preview, and production environments receive digests and how their deploy branches are updated.

---

## 4. E2E Flow: Code Change → Production

### 4.1 CI Pipeline (Target Model)

This section replaces the old staging-first flow. The target model has two lanes only.

| Lane | Stage | Job / Concern          | What Happens                                                                                                                                                                | Output                         |
| ---- | ----- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| PR   | 1     | **checks**             | `ci.yaml` runs affected static, unit, component, and stack checks as policy requires                                                                                        | Required status checks         |
| PR   | 2     | **build**              | `pr-build.yml` builds immutable `pr-{N}-{sha}` images for the PR head SHA. This is the authoritative v0 artifact.                                                           | Tagged images + digests        |
| PR   | 3     | **ready-for-flight**   | Passing PR becomes eligible for manual candidate flight                                                                                                                     | PR ready for operator choice   |
| PR   | 4     | **flight trigger**     | Human dispatches `candidate-flight.yml` with the PR number                                                                                                                  | One PR selected for inspection |
| PR   | 5     | **promote-candidate**  | `candidate-flight.yml` acquires the `candidate-a` lease and writes resolved digests to `deploy/candidate-a` via `promote-build-payload.sh`                                  | Deploy-branch commit           |
| PR   | 6     | **Argo sync**          | Argo reconciles the candidate-a environment from the deploy branch                                                                                                          | Updated pods                   |
| PR   | 7     | **validation**         | `smoke-candidate.sh` runs the v0 smoke pack against the stable candidate slot                                                                                               | Flight result status           |
| Main | 8     | **re-tag**             | On merge to main, `flight-preview.yml` re-tags `pr-{N}-{sha} → preview-{sha}` in GHCR (no rebuild)                                                                          | Promotable digest              |
| Main | 9     | **preview flight**     | `flight-preview.sh` always dispatches `promote-and-deploy.yml env=preview` for the merged SHA (latest-wins; no lease). Serialized by the `flight-preview` concurrency group | Promote-and-deploy dispatched  |
| Main | 10    | **preview deploy**     | `promote-and-deploy.yml env=preview` writes overlay digests to `deploy/preview`, SSH-deploys Compose infra, verifies health, runs E2E                                       | Preview pods rolled            |
| Main | 11    | **preview rollup**     | On E2E success, the `aggregate-preview` rollup step (`aggregate-rollup.sh`) writes `current-sha` + `source-sha-by-app.json` to `deploy/preview`. No reviewing hold          | Preview signal                 |
| Main | 12    | **release (policy)**   | Human dispatches `release.yml`, which cuts `release/*` from `current-sha`. `auto-merge-release-prs.yml` merges the release PR.                                              | Release PR merged              |
| Main | 13    | **promote-production** | Same digest promotes to `deploy/production` by policy                                                                                                                       | Production deploy-state commit |

See [ci-cd.md § Preview State](./ci-cd.md#preview-state) for the latest-wins preview model that drives stages 9–12 (no review lease; `current-sha` is written by the `aggregate-preview` rollup and consumed by `create-release.sh`).

### 4.2 Authoritative Artifact Rule

For v0, the authoritative artifact is the **PR head SHA artifact**.

That means:

- `pull_request` builds the artifact that candidate validation exercises
- candidate-slot validation proves that exact PR artifact safe when a human explicitly sends that PR to flight
- when the PR merges, the same digest promotes forward from `main`
- preview and production consume that same accepted digest without rebuild

This is the simplest clean path because it preserves build-once promotion and avoids merge-queue complexity while the candidate-slot model is still being stood up.

#### Why v0 does not include merge queue

GitHub merge queue requires separate `merge_group` workflow triggers and required-check reporting on merge-group runs. That is real orchestration complexity, not a naming tweak. Introducing it now would force the workflow graph to choose merge-group artifact authority and wire additional plumbing before the basic candidate-slot model is stable.

So v0 chooses:

- **authoritative artifact:** PR head SHA
- **pre-merge validation authority:** candidate-slot validation on the PR artifact when a human explicitly sends that PR to flight
- **post-merge promotion:** same digest from `main`
- **merge queue:** deferred to a later phase if concurrency pressure actually demands it

Rejected for v0:

- **merge-group artifact authority now** — stronger eventual model, but unnecessary complexity before the candidate controller exists
- **rebuild on `main`** — violates build-once promotion and reintroduces artifact drift

### 4.3 Image Build Matrix

| App               | Dockerfile                                 | Build Trigger                                              | Tag / Identity Direction                                                 |
| ----------------- | ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| operator          | `nodes/operator/app/Dockerfile`            | Changes to operator, shared packages, or shared infra      | immutable digest, human-friendly tag derived from authoritative artifact |
| operator-migrator | `nodes/operator/app/Dockerfile` (migrator) | Changes to migrations, schema, drizzle config              | immutable digest plus fingerprint metadata                               |
| poly              | `nodes/poly/app/Dockerfile`                | Changes to `nodes/poly/`, shared packages, or shared infra | immutable digest                                                         |
| resy              | `nodes/resy/app/Dockerfile`                | Changes to `nodes/resy/`, shared packages, or shared infra | immutable digest                                                         |
| scheduler-worker  | `services/scheduler-worker/Dockerfile`     | Changes to `services/scheduler-worker/`                    | immutable digest                                                         |
| litellm           | `infra/images/litellm/Dockerfile`          | Changes to `infra/images/litellm/`                         | should move toward digest-pin parity with the rest                       |

### 4.4 Promotion Flow

Promotion must be explicit and environment-driven, not branch-name-driven.

```text
PR update
  → ci.yaml (required checks)
  → source repo publishes image_repository:sha-<sourceSha>
  → sourceSha becomes ready for manual flight
  → human/API dispatches candidate-flight.yml with node_slug + source_sha
  → candidate-flight.yml resolves image_repository:sha-<sourceSha>, writes digests to deploy/candidate-a
  → Argo syncs candidate-a
  → smoke-candidate.sh runs validation
  → human decides merge based on standard CI + candidate-flight result

Merge to main
  → flight-preview.yml fires on push:main (or manual workflow_dispatch)
  → remote-source artifacts resolve image_repository:sha-<sourceSha>; legacy in-repo artifacts may still re-tag mq-{N}-{sha} → preview-{sha}
  → flight-preview.sh always dispatches promote-and-deploy for the merged SHA (latest-wins; no lease)
      (serialized by the flight-preview concurrency group, not a state-file lease)
  → promote-and-deploy.yml env=preview
      → promote-k8s → deploy-infra → verify → e2e
      └── success → aggregate-preview rollup: write current-sha + source-sha-by-app.json
  → human dispatches release.yml (cuts release/* from current-sha)
  → auto-merge-release-prs.yml merges release PR
  → same digest later promotes to deploy/production by policy
```

**Why separate workflows still matter:** a workflow that commits to the same branch that triggered it is fragile. That concern survives the trunk rewrite. Deploy-state updates should happen on deploy branches, with distinct orchestration and concurrency groups.

**Key detail:** the accepted artifact must flow through deploy branches unchanged. Preview and production should receive the same digest that was accepted pre-merge.

### 4.5 Deploy Branch Policy

`deploy/*` branches remain long-lived on purpose, but they are not alternate code trunks.

- `main` stays the protected, human-reviewed code truth
- `deploy/*` stays bot-written environment truth
- routine deploy-state bumps on `deploy/*` should not require PRs
- push access on `deploy/*` should be restricted to the CI app or bot, with incident-only human bypass
- Argo should keep watching those deploy refs rather than relying on direct CI-to-Argo mutation

**Invariant `INFRA_K8S_MAIN_DERIVED` (bug.0334).** Every file under `infra/k8s/` on a deploy branch is either byte-identical to `main` at the promoted SHA, OR is `env-state.yaml` (the per-overlay VM-truth file written by provision). Kustomize `replacements:` reads `env-state.yaml` to inject VM IPs into EndpointSlice addresses. `promote-and-deploy.yml` does a two-pass rsync: (1) `--ignore-existing` seed of `env-state.yaml` for new overlays; (2) `--delete --exclude='env-state.yaml'` authoritative sync of everything else. `promote-k8s-image.sh` mutates image-digest lines only. No other deploy-branch-local writes under `infra/k8s/` are permitted.

### 4.6 Validation Authority In V0

Validation authority must be blunt, not implied.

- **Required in v0:** standard CI and build for all PRs, plus candidate-flight for PRs explicitly sent to flight
- **Advisory in v0:** AI probes and broader exploratory validation
- **Optional by policy:** extra human signoff for sensitive surfaces if enforced separately from CI

Preview is not a pre-merge bottleneck in v0. It validates already-accepted code after merge.

### 4.7 Rollback

| Scenario             | Action                              | Effect                                                |
| -------------------- | ----------------------------------- | ----------------------------------------------------- |
| Bad app code         | `git revert` deploy-branch commit   | Argo syncs previous digest                            |
| Bad migration        | Manual intervention required        | Drizzle has no auto-rollback; write reverse migration |
| Bad config           | Update ConfigMap/Secret, Argo syncs | Pod restarts with new config                          |
| Full rollback        | Revert all overlay changes          | All apps return to previous version                   |
| Single node rollback | Revert only that node's overlay     | Only that node's pod restarts                         |

---

## 5. E2E Flow: New Node Formation

### 5.1 Steps to Add a New Node

| #   | Action                      | Actor                   | Files Changed                                                                                                         |
| --- | --------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Scaffold from template      | Developer / Operator AI | Copy `nodes/node-template/` → `nodes/{name}/`                                                                         |
| 2   | Generate node identity      | Developer               | Update `.cogni/repo-spec.yaml` with new UUIDs                                                                         |
| 3   | Register in operator        | Developer               | Add to `.cogni/repo-spec.yaml` `nodes[]` array                                                                        |
| 4   | Add Kustomize base          | Developer               | Create or reuse `infra/k8s/base/node-app/` overlays for new node                                                      |
| 5   | Add overlays                | Developer               | Create `infra/k8s/overlays/{candidate-a,candidate-b,preview,production}/{name}/` or the final agreed target structure |
| 6   | Add SOPS secrets            | Developer               | Create encrypted secrets for the node per environment                                                                 |
| 7   | Add to node catalog         | Developer               | Add entry to `infra/catalog/{name}.yaml`                                                                              |
| 8   | Add DB name                 | Developer               | Append to `COGNI_NODE_DBS` env var                                                                                    |
| 9   | Add billing endpoint        | Developer               | Append to `COGNI_NODE_ENDPOINTS` env var                                                                              |
| 10  | Add Caddy route             | Developer               | Add subdomain block to Caddy template or equivalent                                                                   |
| 11  | Add DNS record              | Developer               | A record for `{name}.cognidao.org` → environment VM IP                                                                |
| 12  | Add CI build                | Developer               | Add Dockerfile build step to the build workflow                                                                       |
| 13  | Open PR                     | Developer               | All above in one PR                                                                                                   |
| 14  | Candidate validation        | CI + Argo               | Candidate slot validates manifests, build, deploy, migration, and smoke checks                                        |
| 15  | Merge                       | Developer               | Accepted artifact is now eligible for post-merge promotion                                                            |
| 16  | Preview promotion           | CI deploy               | Same digest promoted to preview                                                                                       |
| 17  | Argo CD creates Application | Argo CD                 | ApplicationSet sees new catalog entry                                                                                 |
| 18  | Migration Job runs          | Argo CD                 | PreSync Job applies schema to new DB                                                                                  |
| 19  | Node app starts             | Argo CD                 | Deployment created, pods scheduled                                                                                    |

### 5.2 What Should Be Automatable (Future)

| Step  | Automation Path                                                      |
| ----- | -------------------------------------------------------------------- |
| 1-3   | `pnpm create:node {name}` generator script                           |
| 4-7   | Generator creates Kustomize manifests + catalog entry from templates |
| 8-9   | Generator appends to env var configs                                 |
| 10-11 | `dns-ops` package creates Cloudflare records                         |
| 12    | CI detects new node by scanning `nodes/*/app/Dockerfile`             |

---

## 6. Networking

### 6.1 k3s → Compose (Apps Reaching Infrastructure)

Uses selectorless Services plus EndpointSlices pointing to `127.0.0.1`.

| k3s Service         | Target    | Compose Service | Port |
| ------------------- | --------- | --------------- | ---- |
| `postgres-external` | 127.0.0.1 | postgres        | 5432 |
| `temporal-external` | 127.0.0.1 | temporal        | 7233 |
| `litellm-external`  | 127.0.0.1 | litellm         | 4000 |
| `redis-external`    | 127.0.0.1 | redis           | 6379 |

### 6.2 Compose → k3s (LiteLLM Reaching Node Billing Endpoints)

LiteLLM runs on Compose and must POST billing callbacks to each node's `/api/internal/billing/ingest`.

| Option                    | How                                                                   | Complexity                  | Chosen? |
| ------------------------- | --------------------------------------------------------------------- | --------------------------- | ------- |
| **k3s NodePort**          | Each node app exposes a NodePort, LiteLLM hits `127.0.0.1:{nodePort}` | Low                         | **Yes** |
| **k3s HostPort**          | Pod spec includes `hostPort`, bypasses Service                        | Low but fragile             | No      |
| **Shared Docker network** | Connect k3s container network to Compose                              | Complex, breaks isolation   | No      |
| **kubectl port-forward**  | Forward pod ports to localhost                                        | Fragile, not for production | No      |

### 6.3 Caddy → k3s (External Traffic to Node Apps)

| Approach                                  | How                                                                   | Pros                          | Cons                           |
| ----------------------------------------- | --------------------------------------------------------------------- | ----------------------------- | ------------------------------ |
| **Caddy → NodePort per app**              | Each app has a NodePort, Caddy routes by subdomain                    | Simple, no k8s ingress needed | NodePort allocation management |
| **Caddy → k3s Ingress**                   | Re-enable traefik or install nginx-ingress, Caddy forwards to ingress | Clean routing, standard k8s   | Extra component, double proxy  |
| **Caddy → single NodePort + Host header** | One ingress NodePort routes by Host                                   | Minimal NodePorts             | Requires ingress controller    |

**Recommended:** Caddy → NodePort per app for the current footprint.

### 6.4 NodePort Allocation

| App              | ClusterIP Port | NodePort | Purpose       |
| ---------------- | -------------- | -------- | ------------- |
| operator         | 3000           | 30000    | Main app      |
| poly             | 3000           | 30100    | Poly node     |
| resy             | 3000           | 30300    | Resy node     |
| scheduler-worker | 9000           | —        | Internal only |
| sandbox-openclaw | 18789          | —        | Internal only |

---

## 7. Secrets Management

### 7.1 Secret Layers

| Layer                  | Scope                            | Encryption                           | Managed By                                              |
| ---------------------- | -------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| **GitHub Secrets**     | CI builds + deploy orchestration | GitHub-managed                       | `pnpm setup:secrets`                                    |
| **K8s Secrets (SOPS)** | k3s app pods                     | age encryption at rest in Git        | ksops CMP decrypts at apply                             |
| **Compose .env**       | Compose infra services           | Not encrypted on VM filesystem       | `scripts/ci/deploy-infra.sh` writes from GitHub Secrets |
| **Terraform vars**     | VM provisioning                  | `terraform.auto.tfvars` (gitignored) | `pnpm setup:secrets`                                    |

### 7.2 Per-Node K8s Secrets

Each node needs its own encrypted Secret in `infra/k8s/secrets/{env}/{node}.enc.yaml`.

| Secret Key             | Operator              | Poly                  | Resy                  | Shared?                          |
| ---------------------- | --------------------- | --------------------- | --------------------- | -------------------------------- |
| `DATABASE_URL`         | `cogni_operator` DB   | `cogni_poly` DB       | `cogni_resy` DB       | No — per-node DB                 |
| `DATABASE_SERVICE_URL` | Same DB, service role | Same DB, service role | Same DB, service role | No — per-node DB                 |
| `AUTH_SECRET`          | Unique per node       | Unique per node       | Unique per node       | No — origin-scoped sessions      |
| `LITELLM_MASTER_KEY`   | Shared                | Shared                | Shared                | Yes — single LiteLLM instance    |
| `BILLING_INGEST_TOKEN` | Shared                | Shared                | Shared                | Yes — same auth for billing POST |
| `INTERNAL_OPS_TOKEN`   | Shared                | Shared                | Shared                | Yes                              |

### 7.3 Candidate Slot Secret Question

One implementation detail still needs a policy decision:

- candidate slots can each have their own secret layer
- or candidate slots can inherit a shared non-prod secret layer

This document keeps that open, but the secret tree and deploy workflows must eventually encode one rule consistently.

---

## 8. Database Migrations

### 8.1 Current State

Migrations currently run as a one-shot container using the migrator image target. In the target model, migration execution must follow the same authoritative artifact chosen for candidate validation and later promotion.

### 8.2 Multi-Node Migration Strategy

All nodes share the same schema. Each node has its own database.

| Approach                          | How                                                                                 | Pros                   | Cons                         |
| --------------------------------- | ----------------------------------------------------------------------------------- | ---------------------- | ---------------------------- |
| **Argo PreSync Job per node**     | K8s Job runs migrator image with node-specific DATABASE_URL before Deployment syncs | GitOps-native, ordered | Need Job manifest per node   |
| **Single multi-DB migration Job** | One Job iterates `COGNI_NODE_DBS`, migrates each                                    | Simple, one manifest   | Failure on one DB blocks all |
| **Init container**                | App pod runs migrations on startup                                                  | No separate Job        | Races if multiple replicas   |
| **CI step**                       | Migrations run before Argo sync                                                     | Decoupled from Argo    | Breaks GitOps purity         |

**Recommended:** Argo PreSync Job per node.

### 8.3 Migration Ordering

```text
Argo Sync Wave:
  PreSync (wave -1): provision databases if needed
  PreSync (wave 0):  run migrations per node
  Sync (wave 1):     deploy app pods
  PostSync:          health verification
```

---

## 9. ApplicationSet Design

### 9.1 Current Problem

The old design hardcoded environment paths and app lists inside Argo configuration. That does not scale with node formation or with candidate-slot deploy branches.

### 9.2 Target: Git File Generator With Deploy-Branch Revisions

```yaml
generators:
  - git:
      repoURL: https://github.com/cogni-dao/cogni.git
      revision: deploy/preview
      files:
        - path: "infra/catalog/*.yaml"
```

Each catalog file remains thin:

```yaml
name: poly
type: node
overlay_path: infra/k8s/overlays/preview/poly
namespace: cogni-preview
```

### 9.3 Environment Sets

| ApplicationSet / Group | Watches                | Target Revision      | Namespace           |
| ---------------------- | ---------------------- | -------------------- | ------------------- |
| `cogni-candidate-a`    | `infra/catalog/*.yaml` | `deploy/candidate-a` | `cogni-candidate-a` |
| `cogni-preview`        | `infra/catalog/*.yaml` | `deploy/preview`     | `cogni-preview`     |
| `cogni-production`     | `infra/catalog/*.yaml` | `deploy/production`  | `cogni-production`  |

If a separate post-merge soak environment exists later, add it explicitly here. Do not smuggle it in through legacy `canary` semantics.

### 9.4 Candidate Slot Control Hooks

ApplicationSets alone are not enough. The control plane also needs:

- a manual way to choose which PR is sent to candidate flight now
- a lease model for in-use slots
- cleanup semantics when a PR is superseded or closed

Those rules belong in workflow and controller logic, but the Argo model must leave room for them.

Deploy refs themselves should remain long-lived. The control boundary is not short-lived versus long-lived branch; it is human-reviewed code branch versus machine-written environment branch.

---

## 10. Critical Gap Analysis

### 10.1 Trunk-Alignment Gaps

| #   | Gap                                                           | Severity | What Exists                                                                    | What's Needed                                                                  | Effort   |
| --- | ------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------- |
| G1  | **Candidate slot controller undefined**                       | Blocker  | Candidate-flight concept exists in prose only                                  | Define manual trigger, lease, TTL, cancellation, cleanup, and status ownership | 1 day    |
| G2  | **Validation authority too squishy**                          | Blocker  | Human and AI validation mentioned loosely                                      | State required vs advisory checks in v0                                        | 0.5 day  |
| G3  | **Preview semantics can drift back into gate behavior**       | High     | Preview exists, but legacy habits may reuse it as shared pre-merge bottleneck  | Keep preview post-merge only in workflow and docs                              | 0.5 day  |
| G4  | **Legacy branch semantics remain in workflows and docs**      | High     | `staging`, `canary`, and `release/* -> main` assumptions still appear in files | Purge workflow, prompt, AGENTS, and namespace drift                            | 1-2 days |
| G5  | **Deploy routing still inferred from branch names**           | High     | Current workflow logic still maps env from branch names                        | Make environment routing explicit and deploy-state driven                      | 1 day    |
| G6  | **Production can still drift from accepted artifact lineage** | High     | Legacy rebuild assumptions still exist in some paths                           | Ensure preview and production consume the accepted digest lineage              | 1 day    |
| G7  | **Deploy branch access policy is not encoded yet**            | High     | Deploy refs exist, but push authority and no-PR policy are still implicit      | Restrict push to CI app or bot and document incident-only human bypass         | 0.5 day  |

### 10.2 Multi-Node Gaps That Still Matter

| #   | Gap                                                             | Severity | What's Needed                                                 |
| --- | --------------------------------------------------------------- | -------- | ------------------------------------------------------------- |
| G8  | **LiteLLM image still needs parity with digest-pinned deploys** | Medium   | Move toward the same reproducibility guarantees as app images |
| G9  | **Per-node AUTH_SECRET strategy needs to stay explicit**        | Medium   | Keep node-specific auth isolation in SOPS and env schema      |
| G10 | **Affected-only builds are still incomplete**                   | Medium   | Use Turbo or equivalent to scope PR costs                     |
| G11 | **Resource limits and observability need follow-through**       | Medium   | Profile actual usage and monitor Argo and app health          |

---

## 11. Infra Directory Layout (Target State)

See §0 for the top-level `infra/` reorganization. Below is the detailed `infra/k8s/` tree after trunk-aligned environment renaming:

```text
infra/k8s/
├── argocd/
│   ├── kustomization.yaml
│   ├── ksops-cmp.yaml
│   ├── repo-server-patch.yaml
│   ├── <env>-<node>-applicationset.yaml  # one AppSet per (env,node), rendered by
│   │                                     # scripts/ci/render-node-appset.sh (LANE_ISOLATION)
│   └── candidate-b-applicationset.yaml   # candidate-b provisioned separately
├── base/
│   ├── node-app/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── configmap.yaml
│   │   ├── external-services.yaml
│   │   ├── migration-job.yaml
│   │   └── kustomization.yaml
│   ├── scheduler-worker/
│   └── sandbox-openclaw/
├── overlays/
│   ├── candidate-a/
│   ├── candidate-b/
│   ├── preview/
│   └── production/
└── secrets/
    ├── .sops.yaml
    ├── candidate-a/
    ├── candidate-b/
    ├── preview/
    └── production/
```

### 11.1 Shared Base Pattern

All node apps use `base/node-app/` as a shared Kustomize base. Overlays customize:

| Field                | Base (shared) | Overlay (per-node)           |
| -------------------- | ------------- | ---------------------------- |
| Deployment replicas  | 1             | Override if needed           |
| Container image      | Placeholder   | `@sha256:...` digest         |
| Container port       | 3000          | 3000                         |
| Service NodePort     | —             | 30000, 30100, 30300          |
| ConfigMap: APP_ENV   | `production`  | —                            |
| ConfigMap: NODE_NAME | —             | `operator` / `poly` / `resy` |
| Secret ref           | —             | `{node}-secrets`             |
| Migration Job image  | Placeholder   | Migrator `@sha256:...`       |

---

## 12. CI Workflow Changes Required

### 12.1 Workflow Ownership

| File                                           | Current Role                                                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yaml`                    | Required PR checks: typecheck, lint, unit, component, stack tests                                                                                                           |
| `.github/workflows/pr-build.yml`               | Authoritative PR-artifact builder; produces `pr-{N}-{sha}` images                                                                                                           |
| `.github/workflows/build-multi-node.yml`       | Workflow_dispatch fallback when `pr-build.yml` is unavailable                                                                                                               |
| `.github/workflows/candidate-flight.yml`       | Human-dispatched pre-merge candidate flight into the `candidate-a` slot                                                                                                     |
| `.github/workflows/flight-preview.yml`         | On push:main (or manual dispatch), re-tag `pr-{N}-{sha}` → `preview-{sha}` and call `flight-preview.sh`, which always dispatches the preview flight (latest-wins, no lease) |
| `.github/workflows/promote-and-deploy.yml`     | Writes overlay digests to deploy branch, SSH-deploys Compose infra, verifies, runs E2E; the `aggregate-preview` rollup step writes `current-sha` + `source-sha-by-app.json` |
| `.github/workflows/auto-merge-release-prs.yml` | Auto-merge approved `release/*` PRs                                                                                                                                         |
| `.github/workflows/release.yml`                | Human-dispatched release PR creation from `deploy/preview:.promote-state/current-sha`                                                                                       |

### 12.2 Build Matrix

```yaml
strategy:
  matrix:
    app:
      - name: operator
        dockerfile: nodes/operator/app/Dockerfile
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

### 12.3 Promote Step (Generalized)

```bash
scripts/ci/promote-k8s-image.sh \
  --app operator \
  --digest ghcr.io/cogni-dao/cogni-template@sha256:abc... \
  --env candidate-a

# Updates: infra/k8s/overlays/candidate-a/operator/kustomization.yaml
```

The same interface should work for `candidate-b`, `preview`, and `production`.

### 12.4 Candidate Slot Orchestration Hooks

The workflow layer needs concrete hooks for:

- trigger one explicit flight attempt
- acquire slot
- renew or hold lease while validation is running
- release slot on success, failure, superseding push, PR close, or timeout
- post status back to the PR

This may live in plain workflow logic, in a dedicated script, or in a git-manager style agent, but the owner must be explicit.

### 12.5 CLI Entry Points (Scripts Are The API)

| Script                                        | Purpose                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `scripts/ci/promote-k8s-image.sh`             | Update overlay digest for a target app and env                                                  |
| `scripts/ci/promote-build-payload.sh`         | Apply a resolved pr-image digest payload to a target overlay                                    |
| `scripts/ci/resolve-pr-build-images.sh`       | Resolve pr-{N}-{sha} digests from GHCR into a JSON payload                                      |
| `scripts/ci/acquire-candidate-slot.sh`        | Acquire the candidate-a lease on `deploy/candidate-a`                                           |
| `scripts/ci/release-candidate-slot.sh`        | Release the candidate-a lease                                                                   |
| `scripts/ci/wait-for-candidate-ready.sh`      | Poll candidate slot until healthy pods are rolled                                               |
| `scripts/ci/smoke-candidate.sh`               | Run the v0 smoke pack against the candidate slot                                                |
| `scripts/ci/report-candidate-status.sh`       | Post `candidate-flight` commit status back to the PR                                            |
| `scripts/ci/flight-preview.sh`                | Always dispatch `promote-and-deploy.yml env=preview` for the merged SHA (latest-wins; no lease) |
| `scripts/ci/aggregate-rollup.sh`              | `aggregate-preview` rollup: write `current-sha` + `source-sha-by-app.json` to `deploy/preview`  |
| `scripts/ci/create-release.sh`                | Cut a release/\* branch + PR from `deploy/preview:.promote-state/current-sha`                   |
| `scripts/ci/check-gitops-manifests.sh`        | Validate Kustomize overlays render                                                              |
| `scripts/ci/check-gitops-service-coverage.sh` | Validate catalog and overlay coverage                                                           |
| `scripts/ci/deploy-infra.sh`                  | Reconcile Compose-managed infrastructure                                                        |

---

## 13. Implementation Sequence

### Phase 0: Lock The Rules Before YAML Surgery

| Task                                  | Why                                                         |
| ------------------------------------- | ----------------------------------------------------------- |
| Freeze authoritative artifact rule    | Lock PR-head artifact authority and prevent promotion drift |
| Define candidate-slot operating rules | Prevent deadlocks and human-chaos slot usage                |
| Define v0 validation authority        | Prevent ambiguous merge decisions                           |

### Phase 1: Align The Specs And Control Plane

| Task                                                               | Why                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------- |
| Finish `ci-cd.md` and this document                                | Docs become the source of truth                     |
| Update prompts, skills, AGENTS, and workflow docs                  | Prevent cultural regression back to legacy branches |
| Rename legacy environment references in namespace and overlay docs | Remove active semantic drift                        |

### Phase 2: Rewire Workflows

| Task                                                        | Why                                                 |
| ----------------------------------------------------------- | --------------------------------------------------- |
| Rework `ci.yaml` for PR authority in v0                     | Required checks must match accepted-code flow       |
| Rework `build-multi-node.yml` around authoritative artifact | Build once, promote once                            |
| Rework `promote-and-deploy.yml` around explicit env routing | Remove branch-name inference                        |
| Decide fate of `e2e.yml` and `release.yml`                  | Remove duplicate orchestration and legacy conveyors |

### Phase 3: Rewire Deploy-State And Argo

| Task                                                                                  | Why                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------- |
| Create or standardize `deploy/candidate-*`, `deploy/preview`, and `deploy/production` | Argo must watch the right refs              |
| Update ApplicationSets and namespaces                                                 | Make runtime topology match the new model   |
| Verify migration and networking still hold across envs                                | Preserve the strong parts of the old design |

---

## 14. Risk Register

| Risk                                                  | Likelihood | Impact                                                             | Mitigation                                                           |
| ----------------------------------------------------- | ---------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **Future merge queue and artifact mismatch**          | Medium     | Later merge-queue adoption could break the accepted-artifact model | Keep merge queue out of v0 and revisit artifact authority explicitly |
| **Candidate slot starvation or stale locks**          | High       | PRs stop flowing or require manual babysitting                     | Define slot lease, TTL, and cleanup semantics                        |
| **Validation authority remains ambiguous**            | Medium     | Unsafe merges or unnecessary merge blocking                        | Make required vs advisory checks explicit                            |
| **Legacy guidance causes branch-model regression**    | High       | Agents and humans keep reintroducing staging/canary behavior       | Purge prompts, AGENTS, and workflow docs                             |
| **Promotion drift from accepted digest lineage**      | Medium     | Preview or production diverges from accepted code                  | Enforce build-once promotion through deploy branches                 |
| **Compose↔k3s networking breaks during env renames** | Medium     | Billing callbacks or readiness fail                                | Preserve networking primitives while changing branch semantics only  |

---

## 15. Open Questions And TODO Headers

- [x] **Freeze authoritative artifact rule**
      V0 uses the PR head SHA artifact as authoritative. Merge queue is explicitly deferred.
- [x] **Define candidate-slot operating rules**
      Covered by [`candidate-slot-controller.md`](./candidate-slot-controller.md) spec plus `candidate-flight.yml` + `acquire-candidate-slot.sh` / `release-candidate-slot.sh` implementation.
- [ ] **Define v0 validation authority**
      Pin which checks are required, which are advisory, and where optional human policy fits.
- [ ] **Decide merge queue integration model later**
      If concurrency pressure justifies it, add `merge_group` support as a separate phase and revisit artifact authority then.
- [ ] **Decide git-manager agent ownership boundaries**
      Define whether a first-class agent owns PR build tracking, slot coordination, promotion, and status fan-in.
- [ ] **Decide OpenFeature rollout expectations**
      Define how feature flags help code merge when safe rather than when every capability is fully released.

---

## Appendix A: Workflow And File Crosswalk

| Concern                      | Primary Files                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Required PR checks           | `.github/workflows/ci.yaml`                                                                                          |
| PR image build               | `.github/workflows/pr-build.yml`                                                                                     |
| Manual pre-merge flight      | `.github/workflows/candidate-flight.yml`, `scripts/ci/acquire-candidate-slot.sh`, `scripts/ci/smoke-candidate.sh`    |
| Merge-to-main preview flight | `.github/workflows/flight-preview.yml`, `scripts/ci/flight-preview.sh`                                               |
| Preview state rollup         | `.github/workflows/promote-and-deploy.yml` (`aggregate-preview` step), `scripts/ci/aggregate-rollup.sh`              |
| Deployment and promotion     | `.github/workflows/promote-and-deploy.yml`, `scripts/ci/promote-k8s-image.sh`, `scripts/ci/promote-build-payload.sh` |
| Release creation and merge   | `.github/workflows/release.yml`, `.github/workflows/auto-merge-release-prs.yml`, `scripts/ci/create-release.sh`      |
| Manifest validation          | `scripts/ci/check-gitops-manifests.sh`                                                                               |
| Overlay coverage             | `scripts/ci/check-gitops-service-coverage.sh`                                                                        |
| Compose infra deploy         | `scripts/ci/deploy-infra.sh`                                                                                         |

## Appendix B: Glossary

| Term                  | Meaning                                                                           |
| --------------------- | --------------------------------------------------------------------------------- |
| **ApplicationSet**    | Argo CD resource that generates multiple Applications from a template + generator |
| **Candidate slot**    | Fixed pre-running environment used to validate unknown code before merge          |
| **Deploy branch**     | Machine-written branch containing environment state, not application code         |
| **Kustomize overlay** | Environment-specific patches applied on top of a shared base                      |
| **PreSync hook**      | Argo CD annotation that runs a resource before the main sync                      |
| **EndpointSlice**     | k8s resource that maps a Service to arbitrary IP:port endpoints                   |
| **NodePort**          | k8s Service type that exposes a port on every node IP                             |
| **digest ref**        | Immutable container image reference using `@sha256:...`                           |
