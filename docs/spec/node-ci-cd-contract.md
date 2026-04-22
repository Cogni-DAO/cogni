---
id: spec.node-ci-cd-contract
type: spec
title: Node CI/CD Contract
status: active
trust: reviewed
summary: CI/CD sovereignty invariants, merge gate checks, workflow entrypoints, and file ownership classification
read_when: Modifying CI workflows, adding checks to merge gate, or planning multi-node CI extraction
implements: []
owner: cogni-dev
created: 2025-12-22
verified: 2026-04-04
tags:
  - ci-cd
  - deployment
---

# Node CI/CD Contract

## Context

Node sovereignty is non-negotiable. CI must run from repo with zero operator dependencies. This spec defines what checks are required, which files are node-owned vs rails-eligible, and the ownership split between orchestration and policy.

## Goal

Define the CI/CD invariants, merge gate, and file ownership boundaries that ensure every node can run its full pipeline independently.

## Non-Goals

- Reusable workflow extraction (see [proj.ci-cd-reusable](../../work/projects/proj.ci-cd-reusable.md))
- Jenkins migration (gated on Dolt CI/CD requirements)

---

## Core Invariants

1. **FORK_FREEDOM**: CI runs without secrets; CD (build/deploy) is gated and skippable on forks.

2. **POLICY_STAYS_LOCAL**: ESLint/depcruise/prettier/tsconfig never centralized.

3. **LOCAL_GATE_PARITY**: `pnpm check` runs same assertions as CI, different execution (sequential vs parallel).

4. **NO_RUNTIME_FETCHES**: Workflows never fetch config from outside repo.

5. **SCRIPTS_ARE_THE_API**: Workflows orchestrate by calling named pnpm scripts; no inline command duplication.

6. **BUILD_ONCE_PROMOTE_DIGEST**: Images build on canary. Staging and production deploy the exact same digests. No per-environment rebuilds.

7. **SINGLE_RESPONSIBILITY**: Each workflow file owns one concern (build, promote+deploy, E2E+release). No monoliths.

---

## Design

### Merge Gate (Required for PR Merge)

| Check                               | Local            | CI             |
| ----------------------------------- | ---------------- | -------------- |
| `pnpm typecheck`                    | yes              | static job     |
| `pnpm lint`                         | yes              | static job     |
| `pnpm format:check`                 | yes              | unit job       |
| `pnpm test:ci` (unit/contract/meta) | yes              | unit job       |
| `pnpm arch:check`                   | yes              | unit job       |
| `pnpm test:component`               | yes              | component job  |
| `pnpm test:stack:docker`            | no (needs infra) | stack-test job |

**Optional** (not blocking): coverage upload, SonarCloud scan.

### Workflow Entrypoints

| File                     | Type | Secrets            | Trigger                                  | Concern                                           |
| ------------------------ | ---- | ------------------ | ---------------------------------------- | ------------------------------------------------- |
| `ci.yaml`                | CI   | No                 | PR; push canary/staging/main             | typecheck, lint, unit, component, stack-test      |
| `build-multi-node.yml`   | CD   | Yes (GHCR)         | push canary                              | Build + push images                               |
| `promote-and-deploy.yml` | CD   | Yes (SSH, secrets) | workflow_run on build; workflow_dispatch | Promote overlays + deploy infra + verify          |
| `e2e.yml`                | CD   | Yes (PAT)          | workflow_run on promote-and-deploy       | E2E smoke + canary→staging promotion + release PR |
| `build-prod.yml`         | CD   | Yes (GHCR)         | push main                                | Build production images (legacy)                  |
| `deploy-production.yml`  | CD   | Yes (SSH, secrets) | workflow_run on build-prod               | Deploy to production (legacy)                     |

### Local Gates

| Command               | Script                        | Purpose                                                                  |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| `pnpm check:fast`     | `scripts/check-fast.sh`       | Strict iteration gate (pre-push): verify-only, fails on any drift        |
| `pnpm check:fast:fix` | `scripts/check-fast.sh --fix` | Auto-fix variant: rewrites lint/format, fails if drift persists          |
| `pnpm check`          | `scripts/check-all.sh`        | Pre-commit gate: typecheck + lint + format + unit/contract + docs + arch |
| `pnpm check:full`     | `scripts/check-full.sh`       | CI parity: Docker build + stack + all test suites (~20 min)              |

### File Ownership Classification

**Node-Owned (Never Centralize):**

| Path                           | Why                         |
| ------------------------------ | --------------------------- |
| `.dependency-cruiser.cjs`      | Hex architecture boundaries |
| `eslint.config.mjs`, `eslint/` | UI/chain governance rules   |
| `biome.json`, `biome/`         | Lint rules                  |
| `.prettierrc`                  | Formatting                  |
| `tsconfig*.json`               | Path aliases                |
| `scripts/check-*.sh`           | Local gate definitions      |
| `nodes/*/app/Dockerfile`       | Image definition            |

**Rails-Eligible (future extraction candidates):**

| Path                                 | Purpose               |
| ------------------------------------ | --------------------- |
| `.github/actions/loki-ci-telemetry/` | CI telemetry capture  |
| `.github/actions/loki-push/`         | Loki push             |
| `scripts/ci/build.sh`                | Docker build          |
| `scripts/ci/push.sh`                 | GHCR push             |
| `scripts/ci/test-image.sh`           | Image liveness test   |
| `scripts/ci/promote-k8s-image.sh`    | Overlay digest update |
| `scripts/ci/deploy-infra.sh`         | Compose infra deploy  |

**Ownership split:** Nodes own scripts and policy configs. Kit owns invocation conventions (when to call, how to parallelize, what to cache).

### Key Decisions

#### 1. Why Canary-First

Canary replaces staging as the primary integration branch. Benefits: multi-node testing from day one, k8s/Argo deployment model, build-once-promote-digest. Staging receives promoted digests, not fresh builds.

#### 2. Why In-Repo Seam First

Extracting to external repo too early causes version pinning overhead, false abstraction boundaries, and reduced iteration speed.

#### 3. Why Policy Stays Node-Owned

Centralizing lint/depcruise configs causes fork friction, policy fights, and loss of sovereignty. Rails kit provides orchestration defaults, not policy mandates.

### File Pointers

| File                                       | Purpose                          |
| ------------------------------------------ | -------------------------------- |
| `.github/workflows/ci.yaml`                | CI entrypoint                    |
| `.github/workflows/build-multi-node.yml`   | Image build                      |
| `.github/workflows/promote-and-deploy.yml` | Promote + deploy + verify        |
| `.github/workflows/e2e.yml`                | E2E + promotion chain            |
| `scripts/check-fast.sh`                    | `pnpm check:fast` implementation |
| `scripts/check-all.sh`                     | `pnpm check` implementation      |
| `scripts/check-full.sh`                    | `pnpm check:full` implementation |

## Acceptance Checks

**Automated:**

- `pnpm check` — local gate parity with CI
- Fork PRs pass CI without secrets

**Manual:**

1. Verify `ci.yaml` calls only pnpm scripts (no inline commands)
2. Verify CD workflows skip gracefully when secrets are missing (fork mode)
3. Verify canary E2E success triggers staging promotion without manual intervention

## Related

- [ci-cd.md](./ci-cd.md) — CI/CD pipeline specification
- [check-full.md](./check-full.md) — check:full CI-parity gate
- [Project: Reusable CI/CD Rails](../../work/projects/proj.ci-cd-reusable.md)
