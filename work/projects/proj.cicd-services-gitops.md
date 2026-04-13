---
id: proj.cicd-services-gitops
type: project
primary_charter:
title: CI/CD Pipeline
state: Active
priority: 1
estimate: 5
summary: Get the canary-first pipeline fully green — build→promote→deploy→verify→E2E→preview→release→production
outcome: One clean flow from push-to-canary through production with no rebuilds, E2E-gated promotion, and CI-gated preview
assignees: derekg1729
created: 2026-02-06
updated: 2026-04-09
labels: [deployment, infra, ci-cd]
---

# CI/CD Pipeline

## Goal

Get the canary-first pipeline fully green: build once on canary, promote proven digests through preview to production. Currently 60% complete — build, promote-k8s, and deploy-infra work. Everything after verify is blocked (other dev actively fixing EndpointSlice routing + Temporal bootstrap). Even when unblocked, 9 verified gaps prevent clean end-to-end release flow.

## Pipeline Health

```
build → promote → deploy-infra → verify → e2e → preview → release → production
GREEN    GREEN      GREEN          AMBER    TBD    TBD       NEW       LEGACY
```

Verify is AMBER: TLS rate limit (resets hourly). Build Multi-Node + CI running on latest push. E2E, preview promotion (new `promote-to-preview.sh`), and release (`release.yml`) are untested in production — first real run pending.

## Active Blockers

| #   | Issue                                                                                                    | Status      | Owner | Impact                                                                     |
| --- | -------------------------------------------------------------------------------------------------------- | ----------- | ----- | -------------------------------------------------------------------------- |
| 1   | **TLS cert rate limit** — Let's Encrypt 5-per-identifier-per-hour limit hit after domain expiry recovery | ⏳ WAITING  | —     | Resets 01:39 UTC 2026-04-06. Re-trigger verify then.                       |
| 2   | **provision Phase 7 clones wrong branch** — `${BRANCH}` (staging) lacks `infra/k8s/argocd/` files        | ✅ FIXED    | —     | SCP from local checkout using per-env `APPSET_FILE`. No branch dependency. |
| 3   | **Caddyfile www redirect** — `www.{$DOMAIN}` block creates certs for nonexistent `www.test.*` domains    | ✅ FIXED    | —     | Removed www block. Only needed for production (with DNS record).           |
| 4   | **Deploy branches use PRs instead of direct commits**                                                    | ✅ DONE     | —     | task.0292: direct push for all envs                                        |
| 5   | **Production rebuilds instead of promoting** — `build-prod.yml` builds fresh `prod-${SHA}` on main push  | ❌ RED      | —     | Production gets different images than validated in canary/preview          |
| 6   | **CI doesn't gate canary→preview**                                                                       | ✅ DONE     | —     | task.0293: promote-to-preview.sh checks CI before dispatch                 |
| 7   | **Release PR conveyor belt**                                                                             | ✅ DONE     | —     | task.0294: policy-gated via release.yml workflow_dispatch                  |
| 8   | **No production promotion in pipeline** — promote-and-deploy supports it but nothing triggers it         | ❌ RED      | —     | Only legacy build-prod→deploy-production exists                            |
| 9   | **Rename staging→preview in workflows**                                                                  | ✅ DONE     | —     | deploy/preview branch created, all refs updated                            |
| 10  | **SHA-pin OpenClaw images** — gateway uses `:latest`, violates IMAGE_IMMUTABILITY                        | ❌ RED      | —     | Mutable tags in production                                                 |
| 11  | **Argo EndpointSlice OutOfSync** — k8s adds metadata fields not in Git manifests                         | ⚠️ COSMETIC | —     | Fix: add `ignoreDifferences` for EndpointSlice metadata in ApplicationSet  |
| 12  | **Canary missing Prometheus metrics** — Alloy running but preview has no Alloy deployed                  | ⚠️ GAP      | —     | Preview has no metrics scraping; canary Loki flowing                       |
| 13  | **VM IPs in public repo** — env-endpoints.yaml on deploy branches exposes bare VM IPs                    | ⚠️ SECURITY | —     | bug.0295: need floating IPs or DNS-only EndpointSlices                     |
| 14  | **Affected-only builds** — CI rebuilds/retests everything on every PR, no scope detection                | ❌ RED      | —     | task.0260: Turborepo --affected, mandatory for fast monorepo iteration     |
| 15  | **Stack tests + E2E not running on canary pipeline** — legacy staging-preview had full test coverage     | ❌ RED      | —     | Canary pipeline must reach parity: stack-test in CI, E2E after deploy      |

## Environment Status (2026-04-06)

| Check                     | Canary (84.32.109.160) | Preview (84.32.110.92) |
| ------------------------- | ---------------------- | ---------------------- |
| VM + k3s + Argo CD        | ✅                     | ✅                     |
| All node pods Running 1/1 | ✅                     | ✅                     |
| Migrations completed      | ✅                     | ✅                     |
| NodePort /readyz 200      | ✅ (all 3)             | ✅ (all 3)             |
| Compose infra healthy     | ✅                     | ✅                     |
| TLS certs (HTTPS)         | ❌ rate limited        | ❌ rate limited        |
| Loki logs flowing         | ✅                     | TBD                    |
| Prometheus metrics        | ⚠️ canary only         | ❌ no Alloy            |
| GitHub secrets set        | ✅                     | ✅                     |
| DNS A records correct     | ✅                     | ✅                     |

## E2E Success Milestone (Project Completion Gate)

Project is complete when one work item achieves `deploy_verified=true` via fully autonomous pipeline:

```
✅ PR merged (code gate — needs_implement → done)
✅ candidate-flight dispatched by pr-manager (task.0297: flightCandidate)
✅ getCandidateHealth() → healthy scorecard (task.0308: memory < 90%, restarts=0, oom_kills=0)
✅ qa-agent: feature exercised (exercise: field from work item ## Validation)
✅ Loki observability signal confirmed at deployed SHA (observability: field from work item)
✅ deploy_verified = true set autonomously by qa-agent (task.0309)
```

**vNext gate (not in v0):** qa-agent posts `qa-validation` commit status on PR head SHA via GitHub App → becomes third PR merge gate alongside `build-images` and `candidate-flight`.

### Active Tasks (Candidate Flight + QA Pipeline)

| Task      | Title                                                                | Status       | Priority |
| --------- | -------------------------------------------------------------------- | ------------ | -------- |
| task.0309 | QA agent — reads task, exercises feature, confirms observability     | needs_design | 0        |
| task.0308 | Deployment observability scorecard (getCandidateHealth, SHA in logs) | needs_design | 1        |
| task.0297 | Add candidate-flight tool to VCS capability (flightCandidate)        | needs_design | 1        |

## Roadmap

### Crawl (P0) — Done

| Deliverable                                                                    | Status |
| ------------------------------------------------------------------------------ | ------ |
| Canonical `pnpm packages:build` (tsup + tsc -b + validation)                   | Done   |
| Manifest-first Docker layering (app + scheduler-worker)                        | Done   |
| `check:full` local CI-parity gate                                              | Done   |
| Runtime DSN isolation (`validate-dsns.sh`)                                     | Done   |
| App to `apps/operator` workspace, flatten platform/ → infra/ + scripts/        | Done   |
| K8s overlays + Kustomize bases (node-app, scheduler-worker, sandbox)           | Done   |
| Argo CD catalog-driven ApplicationSets tracking deploy branches                | Done   |
| Deploy branch model (deploy/canary, deploy/preview, deploy/production)         | Done   |
| Multi-node CI scripts (promote-k8s-image, deploy-infra)                        | Done   |
| k3s + Argo CD bootstrap via cloud-init                                         | Done   |
| Service contract (livez, readyz, version, pino, Zod config, graceful shutdown) | Done   |
| staging-preview.yml disabled (replaced by multi-node pipeline)                 | Done   |

### Walk (P1) — DSN-Only Provisioning & Build Improvements

**Goal:** Provisioner uses DSNs instead of component vars; build-time env coupling removed.

| Deliverable                                                                     | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Add `DATABASE_ROOT_URL` secret (admin DSN for provisioning)                     | Not Started | 1   | (create at P1 start) |
| Implement Node provisioner (`provision.ts`) parsing 3 DSNs with `URL()`         | Not Started | 2   | (create at P1 start) |
| Update `db-provision` container env: only 3 DSNs                                | Not Started | 1   | (create at P1 start) |
| Delete `APP_DB_*` usage from provisioner codepath                               | Not Started | 1   | (create at P1 start) |
| Runtime-only env validation: remove build-time env coupling                     | Not Started | 2   | (create at P1 start) |
| `check:full --only-stack` and `--verbose` CLI enhancements                      | Not Started | 2   | (create at P1 start) |
| Multi-node CI: per-node `validate:chain`, fix `COGNI_NODE_DBS` in component job | Not Started | 1   | (create at P1 start) |

### Run (P2+) — Secret Cleanup & Graph-Scoped Builds

| Deliverable                                                                | Status      | Est |
| -------------------------------------------------------------------------- | ----------- | --- |
| Delete `APP_DB_*` + `POSTGRES_ROOT_*` secrets from GitHub                  | Not Started | 2   |
| Graph-scoped builds (`pnpm deploy` for service Dockerfiles)                | Not Started | 3   |
| Test architecture: move `tests/_fakes/` and `tests/_fixtures/` out of root | Not Started | 3   |

### GitOps Foundation

| Deliverable                                               | Status      | Work Item |
| --------------------------------------------------------- | ----------- | --------- |
| OpenTofu k3s module (Cherry Servers provider)             | Done        | task.0149 |
| k3s provisioned + Argo CD installed via cloud-init        | Done        | task.0149 |
| Promotion flow: PR→overlay→Argo syncs (canary working)    | Done        | task.0149 |
| Multi-node Argo CD: catalog-driven ApplicationSets        | Done        | task.0247 |
| infra/ reorg: k8s/, provision/, catalog/                  | Done        | task.0247 |
| Storage plan: PVCs for stateful deps, backup strategy     | Not Started | —         |
| K8s API read-only service account for AI agent debugging  | Not Started | task.0187 |
| Argo CD API token for sync status / rollback by AI agents | Not Started | task.0187 |

## Constraints

- **IMAGE_IMMUTABILITY**: Tags are `{env}-{sha}-{service}` or content-addressed; never `:latest`
- **MANIFEST_DRIVEN_DEPLOY**: Promotion = overlay digest change, not rebuild
- **BUILD_ONCE_PROMOTE**: Canary builds images; preview and production promote the exact same digests
- **NO_SSH_PAST_GITOPS**: No SSH deploy after production joins promote-and-deploy chain
- **AFFECTED_ONLY_CI**: Run lint/test/build only for changed packages (target: Turborepo, task.0260)

## Dependencies

- [x] EndpointSlice IPs on deploy branches + Temporal namespace bootstrap — fixed in #774. Provision writes IPs, promote writes digests. One writer per deploy fact.
- [ ] turbo.json pipeline config (blocks affected-only CI)

## Relocated Sections

The following content was removed from this project during the 2026-04-05 stabilization cleanup. It lives in dedicated specs/projects:

- **Preview Environments** → [preview-deployments.md](../../docs/spec/preview-deployments.md)
- **Health Probe Separation** → [health-probes.md](../../docs/spec/health-probes.md)
- **Node → Operator Migration** → [node-operator-contract.md](../../docs/spec/node-operator-contract.md) (needs its own project file)
- **Scaling Infrastructure** (HPA, managed Postgres, CDN) → trigger-based, not active
- **CI Portability / Dagger** → deferred, evaluate when GitHub Actions becomes limiting
- **CI Acceleration / Turborepo** → task.0260, referenced in constraints above

## Design Notes

Content aggregated from original CI/CD roadmap docs during 2026-04-05 stabilization pass. See Relocated Sections above for pointers.

## As-Built Specs

- [ci-cd.md](../../docs/spec/ci-cd.md) — Pipeline flow, branch model, workflow inventory
- [build-architecture.md](../../docs/spec/build-architecture.md) — Build order, Docker layering
- [health-probes.md](../../docs/spec/health-probes.md) — Liveness/readiness probe separation
- [services-architecture.md](../../docs/spec/services-architecture.md) — Service structure contracts
- [database-url-alignment.md](../../docs/spec/database-url-alignment.md) — DSN source of truth
