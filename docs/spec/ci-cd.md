---
id: ci-cd-spec
type: spec
title: CI/CD Pipeline Flow
status: active
trust: reviewed
summary: Modular canary→staging→release→main pipeline with build-once digest promotion and automated E2E-gated releases
read_when: Understanding deployment pipelines, release workflow, or CI configuration
owner: derekg1729
created: 2026-02-05
verified: 2026-04-04
tags: []
---

# CI/CD Pipeline Flow

## Overview

Modular canary-first pipeline. Code builds once on canary, tested digests promote through staging to production. Each workflow has a single responsibility. E2E gates promotion between environments.

## Branch Model

```
feat/* → canary → staging → release/* → main          (app code)
deploy/canary, deploy/staging, deploy/production       (deploy state, Argo-tracked)
```

- **Feature branches** (`feat/`, `fix/`, `chore/`, etc.) → `canary` (via PR, CI required)
- **canary** → `staging` (automated after canary E2E success, same digests)
- **staging** → `release/YYYYMMDD-<shortsha>` (automated after staging E2E success)
- **release/\*** → `main` (via PR, manual approval)
- **deploy/\*** branches hold rendered k8s overlay state (image digests). Argo CD tracks these. CI updates them via auto-merge PRs, never direct push.

**Key invariant**: `main` receives code only via `release/*` branches, never direct commits or non-release PRs.

**Key invariant**: Staging and production never rebuild images. They receive promoted digests from canary.

**Key invariant**: CI never pushes directly to protected branches. Overlay digest updates go through PRs to `deploy/*` branches.

## Pipeline Chain

One push to canary triggers the full automated chain:

```
push to canary
  ├── ci.yaml                         CI gate (parallel with build)
  │   ├── static: typecheck + lint
  │   ├── unit: format + arch + docs + unit/contract tests + coverage
  │   ├── component: testcontainers integration tests
  │   ├── sonar: code quality scan
  │   └── stack-test: full Docker stack (postgres, temporal, litellm,
  │       openclaw, tigerbeetle, caddy, scheduler-worker + app)
  │
  └── build-multi-node.yml            Build images (canary only)
        ↓ workflow_run on success
      promote-and-deploy.yml [canary]  PR digest update to deploy/canary → auto-merge → deploy infra → verify
        ↓ workflow_run on success
      e2e.yml [canary]                 Playwright smoke tests
        ↓ canary E2E passes
      promote-and-deploy.yml [staging] Same digests → PR to deploy/staging → auto-merge → deploy infra → verify
        ↓ workflow_run on success
      e2e.yml [staging]                Playwright smoke tests
        ↓ staging E2E passes
      e2e.yml promote-release job      Creates release/* branch + PR to main
```

Release PR merge to main triggers `build-prod.yml` → `deploy-production.yml` (legacy, will migrate to same pattern).

## Workflow Inventory

### Active CD workflows (canary pipeline)

| File                     | Concern                                  | Trigger                                             | Branches                                     |
| ------------------------ | ---------------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| `build-multi-node.yml`   | Build images                             | push                                                | canary                                       |
| `promote-and-deploy.yml` | Promote overlays + deploy infra + verify | workflow_run on Build Multi-Node; workflow_dispatch | canary (auto), staging/production (dispatch) |
| `e2e.yml`                | E2E smoke + release promotion            | workflow_run on Promote and Deploy                  | canary, staging                              |

### Active CI workflows

| File           | Concern                                       | Trigger            | Branches              |
| -------------- | --------------------------------------------- | ------------------ | --------------------- |
| `ci.yaml`      | Typecheck, lint, unit, component, stack tests | pull_request; push | canary, staging, main |
| `pr-lint.yaml` | PR title lint                                 | pull_request       | all                   |

### Active utility workflows

| File                                     | Concern                        | Trigger              |
| ---------------------------------------- | ------------------------------ | -------------------- |
| `archive-feature-history.yml`            | Tag merged feature branches    | merged feat/fix PRs  |
| `auto-merge-release-prs.yml`             | Auto-merge release PRs         | PR events + schedule |
| `require-pinned-release-prs-to-main.yml` | Only release/\* can PR to main | PR to main           |

### Legacy (production, pending migration)

| File                    | Concern                  | Trigger                    |
| ----------------------- | ------------------------ | -------------------------- |
| `build-prod.yml`        | Build production images  | push to main               |
| `deploy-production.yml` | SSH deploy to production | workflow_run on build-prod |

These will be retired when production migrates to k8s/Argo and uses the same promote-and-deploy.yml chain.

## Workflow Details

### 1. Build (`build-multi-node.yml`)

- **Trigger**: push to canary only
- **Jobs**: `build-nodes` (matrix: operator, poly, resy) + `build-services` (migrator, scheduler-worker)
- **Output**: Images pushed to GHCR as `preview-${SHA}`, `preview-${SHA}-poly`, etc.
- **Concern**: Build and push. Nothing else. No promotion, no deploy, no verify.
- **Concurrency**: cancel-in-progress per branch (safe for canary)

### 2. Promote and Deploy (`promote-and-deploy.yml`)

- **Trigger**: workflow_run on Build Multi-Node success; workflow_dispatch with environment + optional source_sha
- **Jobs**: `promote-k8s` → `deploy-infra` → `verify`
- **Promote**: Resolves digests from GHCR, creates a PR updating k8s overlays on the `deploy/{env}` branch. PR is auto-merged after checks. Argo CD watches the deploy branch and syncs on merge.
- **Deploy**: SSH to VM, runs `scripts/ci/deploy-infra.sh` (Compose infra + k8s secrets — Argo handles app pods)
- **Verify**: Polls `/readyz` on all 3 nodes, smoke tests `/livez`, SSH diagnostics on failure
- **Cross-env promotion**: `source_sha` input allows deploying canary's images to staging without rebuild
- **Concurrency**: cancel-in-progress: false (never cancel a deploy mid-flight)
- **Deploy branch model**: App code lives on `canary`/`staging`/`main`. Rendered deploy state (image digests, overlay patches) lives on `deploy/canary`, `deploy/staging`, `deploy/production`. This separation keeps branch protection real — CI never needs write access to protected app branches.

### 3. E2E and Release (`e2e.yml`)

- **Trigger**: workflow_run on Promote and Deploy success
- **Jobs**: `e2e` → `promote-to-staging` (canary only) → `promote-release` (staging only)
- **E2E**: Playwright smoke tests against the deployed environment
- **promote-to-staging**: Dispatches promote-and-deploy.yml for staging with canary's source_sha
- **promote-release**: Creates `release/YYYYMMDD-<shortsha>` branch + PR to main

### 4. CI Gate (`ci.yaml`)

- **Trigger**: pull_request (all branches) + push to canary, staging, main
- **Jobs**: static → unit + component + stack-test (parallel after static)
- **Stack test**: Full Docker Compose stack with postgres, temporal, litellm, openclaw, tigerbeetle, caddy, scheduler-worker, app. Runs `pnpm test:stack:docker`.
- **Gate behavior**: CI gates PR merge (required status check). CI also runs on canary/staging/main push as a safety net — build/deploy do not wait for CI.

## Environments (k8s via Argo CD)

| Environment | App Branch | Deploy Branch       | GH Environment | Namespace          | Argo Tracks         | Purpose           |
| ----------- | ---------- | ------------------- | -------------- | ------------------ | ------------------- | ----------------- |
| canary      | `canary`   | `deploy/canary`     | `canary`       | `cogni-canary`     | `deploy/canary`     | Automated testing |
| preview     | `staging`  | `deploy/staging`    | `preview`      | `cogni-preview`    | `deploy/staging`    | Human acceptance  |
| production  | `main`     | `deploy/production` | `production`   | `cogni-production` | `deploy/production` | Production        |

Each GH environment provides its own `VM_HOST`, `SSH_DEPLOY_KEY`, `DOMAIN`, and all infra/app secrets. promote-and-deploy.yml selects the environment based on the triggering branch or the `environment` input.

**Deploy branches** contain only `infra/k8s/overlays/{env}/` with image digests and EndpointSlice IPs. They are never merged into app branches. Argo CD ApplicationSets point to the deploy branch for each environment.

## Image Tagging Strategy

**App images**: `preview-${SHA}` (canary/staging share the same images via digest promotion)

**Migrator images**: `preview-${SHA}-migrate`

**Service images**: `preview-${SHA}-scheduler-worker`

**Production images** (legacy): `prod-${SHA}` (from build-prod.yml, will converge when production joins the chain)

**Deployment uses digests, not tags.** Overlays reference `image@sha256:...`. Tags are for GHCR organization only.

## Key Features

- **Build once, promote digest**: Canary builds images. Staging and production deploy the exact same images.
- **Fork-safe**: CI runs without secrets; CD is gated and skippable on forks.
- **SHA-pinned**: Release branches locked to tested commits. Promote-and-deploy checks out the exact build SHA.
- **Automated**: E2E success triggers promotion through environments.
- **Enforced**: Only `release/*` branches can PR to main.
- **Rollback-ready**: Revert an overlay commit → Argo syncs previous image.

## Critical TODOs

**P0 — Pipeline completion**:

- [ ] Implement deploy branch model: create `deploy/canary`, `deploy/staging`, `deploy/production` branches; update Argo ApplicationSets to track them; update promote-and-deploy.yml to PR digest updates to deploy branches
- [ ] Fix promote-and-deploy.yml git identity (`git config user.name/email`) on staging
- [ ] Production migration: add `main` to promote-and-deploy.yml triggers, retire build-prod.yml + deploy-production.yml
- [ ] Gate canary→staging promotion on CI success (currently promotes even if CI fails in parallel)

**P1 — CI optimization (task.0260)**:

- [ ] Turborepo `--affected` for PR-scoped typecheck/lint/test
- [ ] Merge static + unit jobs into single `checks` job
- [ ] Scope detection for conditional component/stack-test skip on docs-only PRs
- [ ] Nightly full validation gate

**P2 — Infrastructure**:

- [ ] Provision script resilience (task.0285): credential reset, migrations, SSH key collision
- [ ] Secrets single source of truth via ESO (task.0284)
- [ ] Provision as GitHub Action (task.0283)
- [ ] Migrator fingerprinting: content-addressed `migrate-${FINGERPRINT}` tags
- [ ] Image scanning and signing (cosign)

## TypeScript Package Build Strategy

**Rule**: If a step imports `@cogni/*` packages, run `pnpm packages:build` first.

**Canonical command**: `pnpm packages:build` runs tsup (JS), tsc -b (declarations), and validation atomically.

## Branch Configuration Settings

### Branch Protection: canary, staging, main (app branches)

- Require pull request before merging
- Require status checks to pass: `checks` (replaces `static` + `unit` after task.0260)
- canary + staging: require linear history (squash merge)
- main: DO NOT require linear history (allows merge commits from release/\*)
- main: require `require-pinned-release-branch` check
- **No CI bot bypass.** All changes go through PRs.

### Branch Protection: deploy/\* (deploy state branches)

- No branch protection required — these are machine-written, auto-merged
- Argo CD has read access; CI bot has write access via PAT
- Changes are always PRs from CI (never direct push), but no required checks gate them
- Content is limited to `infra/k8s/overlays/{env}/` — image digests and EndpointSlice patches

### Workflow Enforcement

- `require-pinned-release-prs-to-main.yml` ensures only `release/*` branches can target main AND that release branches match their tested SHA suffix

## Related Documentation

- [Node CI/CD Contract](node-ci-cd-contract.md) — CI/CD sovereignty invariants, file ownership
- [Application Architecture](architecture.md) — Hexagonal design and code organization
- [Deployment Architecture](../runbooks/DEPLOYMENT_ARCHITECTURE.md) — Infrastructure details
- [CI/CD Conflict Recovery](../runbooks/CICD_CONFLICT_RECOVERY.md) — Release→main conflict resolution
