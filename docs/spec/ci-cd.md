---
id: ci-cd-spec
type: spec
title: CI/CD Pipeline Flow
status: active
trust: draft
summary: Automated staging→release→main workflow with fork-safe CI/CD and E2E-triggered promotions
read_when: Understanding deployment pipelines, release workflow, or CI configuration
owner: derekg1729
created: 2026-02-05
verified: 2026-02-05
tags: []
---

# CI/CD Pipeline Flow

## Overview

Automated staging→release→main workflow with fork-safe CI/CD and E2E-triggered promotions.

## Critical TODOs

**P0 - Production Reliability**:

- [ ] **Post-deploy verification and rollback**: Add automated smoke tests to `deploy-production.yml` after deploy completes; on failure, automatically redeploy last known-good `prod-<sha>` and mark bad release as blocked. Current state: green pipeline means "deploy finished", not "prod is healthy".
- [ ] **Image scanning and signing**: Integrate container scanning into `build-prod.yml` (fail on high/critical CVEs) and sign images (cosign or equivalent); `deploy-production.yml` must refuse unsigned/unverified images.

**P1 - Optimization and Maintainability**:

- [ ] **Edge routing CI validation**: Add CI job that starts full stack and validates edge Caddyfile routes via smoke tests: `/health`, `/api/v1/public/*`. Prevents edge config drift from breaking local/CI.
- [ ] **Config as code validation**: Enforce env schema validation in CI (type-check + required keys), block deploy if invalid, surface staging/prod config diffs during release promotion.
- [ ] **Refactor `deploy.sh`**: Split 600+ line monolith into composable modules (edge, runtime, cleanup functions).
- [ ] **Complete migrator fingerprinting**:
  - [x] `compute_migrator_fingerprint.sh`: Generates stable 12-char content hash
  - [x] `ci.yaml` (stack-test): Pull by fingerprint, build only if missing
  - [x] `build-prod.yml`: Compute fingerprint, dual-tag and push migrator
  - [ ] `staging-preview.yml`: Add fingerprint computation and dual tagging
  - [ ] `deploy-production.yml`: Compute fingerprint, pass to deploy.sh
  - [ ] `deploy.sh`: Pull `migrate-${FINGERPRINT}` instead of coupled tag
  - [ ] Remove legacy coupled `-migrate` tags after all envs use fingerprints
  - [ ] `build.sh`/`push.sh`: Optionally skip build/push if fingerprint exists remotely

**Non-goals** (defer until needed):

- Per-PR ephemeral environments for every feature branch (not mission-critical at current scale)
- Full blue/green or traffic-split canaries (staging+release gating sufficient for now)

---

## Branch Model

- **Feature branches** (`feat/`, `fix/`, `chore/`, etc.) → `staging` (via PR)
- **staging** → `release/YYYYMMDD-<shortsha>` (automated after E2E success)
- **release/\*** → `main` (via PR, manual approval)
- **main** → production (manual deploy via workflow_dispatch)

```
feat/* → staging → release/* → main
```

**Key invariant**: `main` receives code only via `release/*` branches, never direct commits or non-release PRs.

## Workflow Details

### 1. Feature Development

```
feat/xyz → staging (PR with full CI checks)
fix/abc → staging (PR with full CI checks)
```

- Triggers: `ci.yaml` (contains `pnpm check`, `docker-compose.dev build`, `test:stack:docker`)
- Branch types: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`
- Merge requires: approval + green CI

### 2. Staging Preview Pipeline

```
push to staging → staging-preview.yml
```

**Jobs:** `build → test-image → push → deploy → e2e → promote`

- Builds Docker image
- Tests liveness (/livez gate with minimal env, pre-push validation)
- Pushes validated image to GHCR
- Deploys to preview environment (readiness hard-gate on /readyz)
- Runs full Playwright E2E tests
- **If E2E passes:** auto-creates release branch + PR to main

### 3. Release Promotion

```
release/YYYYMMDD-<shortsha> → main (PR)
```

- Triggers: `ci.yaml` (fast sanity checks)
- **Enforced:** Only `release/*` branches can PR to main
- Merge requires: approval + green CI

### 4. Production Deploy

```
push to main → build-prod.yml (build → test → push) → deploy-production.yml (triggers on success only)
```

- Auto-builds immutable `prod-<sha>` image
- Tests container health before push (hardcoded test environment)
- Deploy workflow triggers only on build success
- Rolling deployment (no downtime)

### 5. Multi-Node Pipeline (canary → preview → production)

```
push to canary → build-multi-node.yml
```

**Jobs:** `build-nodes (operator, poly, resy) + build-services (scheduler-worker) → promote-k8s → verify → e2e-canary.yml`

Parallel builds for all nodes. After build:

- Resolves image digests from GHCR
- Maps branch → overlay: `canary` → `overlays/canary/`, `staging` → `overlays/preview/`, `main` → `overlays/production/`
- Commits digest updates to overlay kustomization.yaml files `[skip ci]`
- Argo CD auto-syncs (30s reconciliation, ApplicationSet per environment)
- Verify job polls `/readyz` on all 3 nodes
- E2E Canary (separate workflow) runs Playwright smoke tests against deployed apps

**Environments (k8s via Argo CD):**

| Environment | Branch    | Namespace          | Argo ApplicationSet | Purpose                     |
| ----------- | --------- | ------------------ | ------------------- | --------------------------- |
| canary      | `canary`  | `cogni-canary`     | `cogni-canary`      | AI e2e testing (Playwright) |
| preview     | `staging` | `cogni-preview`    | `cogni-preview`     | Human e2e testing           |
| production  | `main`    | `cogni-production` | `cogni-production`  | Production                  |

**Note:** This pipeline coexists with the single-node staging-preview pipeline (section 2). The staging-preview pipeline handles the `staging` branch for operator-only deploys with E2E gating and release branch promotion. The multi-node pipeline handles `canary` branch with all 3 nodes. These will be unified when multi-node replaces single-node as the primary deployment path.

**Note:** These are long-lived Argo-managed environments — NOT ephemeral per-PR previews. Ephemeral previews are a separate P2 initiative (see `docs/spec/preview-deployments.md`).

## Key Features

- **Fork-safe:** No secrets in PR CI checks
- **SHA-pinned:** Release branches locked to tested commits via `${GITHUB_SHA}`
- **SHA-enforced:** CI prevents modification of release branches after promotion
- **Automated:** E2E success triggers promotion
- **Enforced:** Workflow prevents bypass of staging gate
- **Rollback-ready:** Any prod image can be redeployed
- **History preservation:** Feature branches auto-archived as tags after merge

## TypeScript Package Build Strategy

**Rule**: If a step imports `@cogni/*` packages, run `pnpm packages:build` first.

**Applies to**:

- CI jobs running typecheck/tests
- Dockerfile before `next build`

**Canonical command**: `pnpm packages:build` runs tsup (JS), tsc -b (declarations), and validation atomically. Same command in local dev, CI, and Docker.

**Current**: Each context builds independently (~1-2s overhead). Future: Turborepo remote caching when scale justifies complexity.

## Image Tagging Strategy

**App images**: Commit-based

- `prod-${GITHUB_SHA}` or `preview-${GITHUB_SHA}`

**Migrator images**: Dual-tagged for backward compatibility during transition

- `prod-${GITHUB_SHA}-migrate` (deploy consumption, legacy)
- `migrate-${FINGERPRINT}` (content-addressed, CI caching - partial implementation)

**Service images** (see [CI/CD Services Roadmap](CICD_SERVICES_ROADMAP.md)):

- `prod-${GITHUB_SHA}-${SERVICE}` (e.g., `prod-abc123-scheduler-worker`)
- Future: Content fingerprinting like migrator

## Branch Management

### Auto-cleanup

- **Setting:** "Automatically delete head branches" enabled in repo settings
- **Result:** Feature branches deleted after PR merge to prevent accumulation

### History archival

- **Trigger:** `archive-feature-history.yml` runs on merged `feat/*` and `fix/*` PRs
- **Archive format:** `archive/pr-{number}-{safe-branch-name}` tags
- **Purpose:** Preserve full incremental commit history for AI training and debugging
- **Expandable:** Can be extended to include `chore/*`, `docs/*`, etc. as needed

## Branch Configuration Settings

### Repository-wide Settings

**Settings → General → Pull Requests:**

- Enable: "Allow squash merging"
- Enable: "Allow merge commits"
- Enable: "Automatically delete head branches"
- Disable: "Allow rebase merging"

### Branch Protection: staging

**Settings → Branches → staging:**

- Require pull request before merging
- Require status checks to pass: `ci`
- Require linear history (enforces squash merge)
- Optional: Restrict pushes to admins only

### Branch Protection: main

**Settings → Branches → main:**

- Require pull request before merging
- Require status checks to pass:
  - `ci`
  - `require-pinned-release-branch` (prevents modified release branches)
- DO NOT require linear history (allows merge commits from release/\*)
- DO NOT require branches to be up to date (release/\* branches are clean snapshots)
- Optional: Restrict pushes to admins only

### Workflow Enforcement

- `require-pinned-release-prs-to-main.yml` ensures only `release/*` branches can target main AND that release branches match their tested SHA suffix

---

## Related Documentation

- [Application Architecture](architecture.md) - Hexagonal design and code organization
- [Deployment Architecture](../docs/runbooks/DEPLOYMENT_ARCHITECTURE.md) - Infrastructure and deployment details
- [CI/CD Services Roadmap](CICD_SERVICES_ROADMAP.md) - Service build/deploy integration plan (GitOps migration)
- [CI/CD Conflict Recovery](../docs/runbooks/CICD_CONFLICT_RECOVERY.md) - How to resolve release→main conflicts without polluting history
