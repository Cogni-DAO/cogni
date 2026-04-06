---
id: ci-cd-spec
type: spec
title: CI/CD Pipeline Flow
status: active
trust: draft
summary: Canary-first CI/CD with build-once digest promotion, E2E-gated releases, and deploy-branch GitOps
read_when: Understanding deployment pipelines, release workflow, or CI configuration
owner: derekg1729
created: 2026-02-05
verified: 2026-04-05
tags: []
---

# CI/CD Pipeline Flow

## Overview

Modular canary-first pipeline. Code builds once on canary, tested digests promote through preview to production. Each workflow has a single responsibility. E2E gates promotion between environments.

## Operating Rules

1. **Default branch = main** — clean, protected, human-reviewed, matches latest stable release
2. **AI commits to canary, never to main** — canary is the fast integration lane for all development
3. **No long-lived staging code branch** — preview is an environment, not a code branch (a `staging` git branch exists temporarily for workflow dispatch; target: eliminate post-stabilization)
4. **Build once on canary, promote same artifact by digest** — preview and production never rebuild images
5. **Deploy branches hold deploy state only** — `deploy/*` branches contain image digests and overlay patches, never application code
6. **Code promotion: canary → release/\* → main** — E2E-tested, human-approved
7. **Affected-only CI** — run lint/test/build only for changed packages and their dependents (target: Turborepo `--affected`)
8. **Code ownership on high-risk paths** — CODEOWNERS for infra, workflows, shared packages, deploy logic
9. **Reusable workflows** — one thin orchestrator calling composable units, not duplicated YAML
10. **Feature flags for experiments, with expiry** — decouple deploy from release; flags have TTL

## Branch Model

```
feat/* → canary → release/* → main                    (app code)
deploy/canary, deploy/preview, deploy/production       (deploy state, Argo-tracked)
```

- **Feature branches** (`feat/`, `fix/`, `chore/`, etc.) → `canary` (via PR, CI required)
- **canary** → `release/YYYYMMDD-<shortsha>` (human-initiated after preview E2E success)
- **release/\*** → `main` (via PR, manual approval)
- **deploy/\*** branches hold rendered k8s overlay state (image digests). Argo CD tracks these. CI updates them via direct bot commits (not PRs — git history provides the audit trail).

**Key invariant**: `main` receives code only via `release/*` branches, never direct commits or non-release PRs.

**Key invariant**: Preview and production never rebuild images. They receive promoted digests from canary.

**Key invariant**: CI never pushes directly to protected app branches. Overlay digest updates target `deploy/*` branches.

**Temporary compatibility note**: A `staging` git branch exists as a workflow dispatch target for the preview leg of the pipeline. It receives no direct development. Target: rename to `preview` or eliminate entirely by dispatching from canary ref with environment input once the pipeline is fully green.

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
      promote-and-deploy.yml [canary]  Commit digests to deploy/canary → deploy infra → verify
        ↓ workflow_run on success
      e2e.yml [canary]                 Playwright smoke tests
        ↓ canary E2E passes (CI must also be green)
      promote-and-deploy.yml [preview] Same digests → commit to deploy/preview → deploy infra → verify
        ↓ workflow_run on success
      e2e.yml [preview]                Playwright smoke tests
        ↓ preview E2E passes → candidate SHA recorded
```

Preview success does NOT auto-create release PRs. Release promotion is policy-gated:

- **Human-initiated**: workflow dispatch or manual trigger creates a singleton `release/YYYYMMDD-<sha>` branch + PR to main from the latest successful preview SHA
- **At most one active release PR at a time** — new candidates replace the previous one
- Release PR merge to main → promote-and-deploy.yml [production] → same proven digests

Legacy: main push currently triggers `build-prod.yml` → `deploy-production.yml` (to be retired).

## Workflow Inventory

### Active CD workflows (canary pipeline)

| File                     | Concern                                  | Trigger                                             | Branches                                     |
| ------------------------ | ---------------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| `build-multi-node.yml`   | Build images                             | push                                                | canary                                       |
| `promote-and-deploy.yml` | Promote overlays + deploy infra + verify | workflow_run on Build Multi-Node; workflow_dispatch | canary (auto), preview/production (dispatch) |
| `e2e.yml`                | E2E smoke + release promotion            | workflow_run on Promote and Deploy                  | canary, preview                              |

### Active CI workflows

| File           | Concern                                       | Trigger            | Branches                                    |
| -------------- | --------------------------------------------- | ------------------ | ------------------------------------------- |
| `ci.yaml`      | Typecheck, lint, unit, component, stack tests | pull_request; push | canary, main (staging temporarily included) |
| `pr-lint.yaml` | PR title lint                                 | pull_request       | all                                         |

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
- **Promote**: Resolves digests from GHCR, commits overlay updates directly to the `deploy/{env}` branch. Argo CD watches the deploy branch and auto-syncs on commit. No PRs — deploy branches are machine-written state, git history is the audit trail.
- **Deploy**: SSH to VM, runs `scripts/ci/deploy-infra.sh` (Compose infra + k8s secrets — Argo handles app pods)
- **Verify**: Polls `/readyz` on all 3 nodes, smoke tests `/livez`, SSH diagnostics on failure
- **Cross-env promotion**: `source_sha` input allows deploying canary's images to preview without rebuild
- **Concurrency**: cancel-in-progress: false (never cancel a deploy mid-flight)
- **Deploy branch model**: App code lives on `canary`/`main`. Rendered deploy state (image digests, overlay patches) lives on `deploy/canary`, `deploy/preview`, `deploy/production`. This separation keeps branch protection real — CI never needs write access to protected app branches.

### 3. E2E and Release (`e2e.yml`)

- **Trigger**: workflow_run on Promote and Deploy success
- **Jobs**: `e2e` → `promote-to-preview` (canary only)
- **E2E**: Playwright smoke tests against the deployed environment
- **promote-to-preview**: Dispatches promote-and-deploy.yml for preview with canary's source_sha
- **Release promotion is separate**: human-initiated workflow dispatch creates singleton release branch from the latest successful preview SHA. Not triggered automatically by preview E2E.

### 4. CI Gate (`ci.yaml`)

- **Trigger**: pull_request (all branches) + push to canary, main (staging temporarily included)
- **Jobs**: static → unit + component + stack-test (parallel after static)
- **Stack test**: Full Docker Compose stack with postgres, temporal, litellm, openclaw, tigerbeetle, caddy, scheduler-worker, app. Runs `pnpm test:stack:docker`.
- **Gate behavior**: CI gates PR merge (required status check). CI runs in parallel with build on canary push. **Hard invariant**: canary→preview promotion MUST gate on CI success — no promotion while CI is red.

## Environments (k8s via Argo CD)

Three deployment environments, each with its own VM, k8s namespace, and Argo ApplicationSet:

| Environment | Deploy Branch       | GH Environment | Namespace          | Overlay Path           | Purpose          |
| ----------- | ------------------- | -------------- | ------------------ | ---------------------- | ---------------- |
| canary      | `deploy/canary`     | `canary`       | `cogni-canary`     | `overlays/canary/`     | Automated AI E2E |
| preview     | `deploy/preview`    | `preview`      | `cogni-preview`    | `overlays/preview/`    | Human acceptance |
| production  | `deploy/production` | `production`   | `cogni-production` | `overlays/production/` | Production       |

**Note**: `deploy/preview` branch created 2026-04-06. The `deploy/staging` branch still exists as a legacy alias — can be deleted once all references are confirmed migrated.

Each GH environment provides its own `VM_HOST`, `SSH_DEPLOY_KEY`, `DOMAIN`, and all infra/app secrets. promote-and-deploy.yml selects the environment based on the triggering branch or the `environment` input.

**Deploy branches** contain only `infra/k8s/overlays/{env}/` with image digests and EndpointSlice IPs. They are never merged into app branches. Argo CD ApplicationSets point to the deploy branch for each environment.

## Image Tagging Strategy

**App images**: `preview-${SHA}` (canary and preview share the same images via digest promotion)

**Migrator images**: `preview-${SHA}-migrate`

**Service images**: `preview-${SHA}-scheduler-worker`

**Production images** (legacy): `prod-${SHA}` (from build-prod.yml, will converge when production joins the chain)

**Deployment uses digests, not tags.** Overlays reference `image@sha256:...`. Tags are for GHCR organization only.

## Key Features

- **Build once, promote digest**: Canary builds images. Preview and production deploy the exact same images.
- **Fork-safe**: CI runs without secrets; CD is gated and skippable on forks.
- **SHA-pinned**: Release branches locked to tested commits. Promote-and-deploy checks out the exact build SHA.
- **Automated canary→preview**: E2E success triggers promotion to preview. Production promotion is policy-gated.
- **Enforced**: Only `release/*` branches can PR to main.
- **Rollback-ready**: Revert an overlay commit → Argo syncs previous image.

## Critical TODOs

### Stabilization — Get the Pipeline Green

These gaps block the end-to-end release flow. Verified against workflow source code 2026-04-05.

- [x] Deploy branch model: `deploy/canary`, `deploy/preview`, `deploy/production` branches created; Argo ApplicationSets track them
- [x] **Deploy branches use direct commits, not PRs** (task.0292): all envs use direct push. Git history is the audit trail.
- [x] **Gate canary→preview on CI success** (task.0293): `promote-to-preview.sh` checks CI status before dispatch. No promotion while CI is red.
- [x] **Policy-gated release promotion** (task.0294): `release.yml` workflow_dispatch creates singleton release PR. Auto-release conveyor belt removed.
- [x] **Rename staging→preview** : `deploy/preview` branch created, promote-and-deploy.yml + Argo ApplicationSet + provision script updated.
- [ ] **Stop production rebuilds (GAP A+E)**: `build-prod.yml` rebuilds fresh `prod-${SHA}` images on every main push instead of promoting the proven canary digests. Wire promote-and-deploy.yml for production after release merge; retire `build-prod.yml` + `deploy-production.yml`

### Post-Green — Simplify

- [ ] Eliminate `staging` git branch entirely: after renaming to `preview`, optionally refactor dispatches to use `--ref canary` + environment input
- [ ] Turborepo `--affected` for PR-scoped checks (task.0260)
- [ ] CODEOWNERS for high-risk paths (infra/, .github/, packages/, scripts/ci/)
- [ ] Image scanning + signing (cosign)
- [ ] Provision script resilience (task.0285) — other dev actively working

## TypeScript Package Build Strategy

**Rule**: If a step imports `@cogni/*` packages, run `pnpm packages:build` first.

**Canonical command**: `pnpm packages:build` runs tsup (JS), tsc -b (declarations), and validation atomically.

## Branch Configuration Settings

### Branch Protection: canary, main (app branches)

- Require pull request before merging
- Require status checks to pass: `checks` (replaces `static` + `unit` after task.0260)
- canary: require linear history (squash merge)
- main: DO NOT require linear history (allows merge commits from release/\*)
- main: require `require-pinned-release-branch` check
- **No CI bot bypass.** All changes go through PRs.

### Branch Protection: preview (pipeline dispatch target)

- Restrict pushes: pipeline automation only (no direct dev pushes)
- No PR requirement (pipeline dispatches against this ref)
- Currently named `staging` in git — rename to `preview` is a stabilization task

### Branch Protection: deploy/\* (deploy state branches)

- No branch protection — these are machine-written deploy state
- Argo CD has read access; CI bot and provision scripts have write access via PAT
- Updates are direct bot commits (not PRs) — git history is the audit trail
- Content is limited to `infra/k8s/overlays/{env}/` — image digests and EndpointSlice IPs
- Provision scripts also write `env-endpoints.yaml` (real VM IPs) directly to deploy branches

### Code Ownership

Current: `* @Cogni-DAO` (global catch-all, no path-specific rules — effectively a no-op).

Target: path-specific CODEOWNERS for high-risk paths requiring human review even when AI auto-merges low-risk changes. Priority paths: `.github/workflows/`, `scripts/ci/`, `infra/`, `packages/`.

### Workflow Enforcement

- `require-pinned-release-prs-to-main.yml` ensures only `release/*` branches can target main AND that release branches match their tested SHA suffix

## Related Documentation

- [Node CI/CD Contract](node-ci-cd-contract.md) — CI/CD sovereignty invariants, file ownership
- [Application Architecture](architecture.md) — Hexagonal design and code organization
- [Deployment Architecture](../runbooks/DEPLOYMENT_ARCHITECTURE.md) — Infrastructure details
- [CI/CD Conflict Recovery](../runbooks/CICD_CONFLICT_RECOVERY.md) — Release→main conflict resolution
