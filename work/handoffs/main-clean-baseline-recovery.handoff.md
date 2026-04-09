---
id: main-clean-baseline-recovery
type: handoff
work_item_id: task.0260
status: active
created: 2026-04-09
updated: 2026-04-09
branch: fix/main-clean-baseline
---

# Handoff: Main Clean Baseline Recovery

## Goal

Define the smallest credible set of changes required to make `main` a trustworthy baseline again before feature-recovery PRs rebase on top of it.

This document intentionally separates:

- **Required now for clean main**
- **Likely required if "clean main" includes deploy-path baseline**
- **Top-priority affected-only CI pieces from `#790`**
- **What should explicitly stay out of the cleanup branch**

## Canary Landings Relevant To Recovery

`origin/canary` is ahead of `origin/main` by these commits:

- `41a123701` `feat(ci): Turborepo affected-scope CI pipeline (task.0260) (#790)`
- `2753b2414` `feat(ci): scope local checks with turbo (#828)`
- `6d901954e` `fix(cd): reorder deploy-infra — compose up before k8s pod restart (#835)`
- `3978d5f52` `fix(cd): remove COGNI_NODE_ENDPOINTS from k8s secrets — ConfigMap is source of truth (#837)`
- `39f3a7245` `feat(agent-api): agent-first API — register, auth, run, stream + Bearer on all routes (#833)`
- `0e05f99b4` `feat(dashboard): group git activity by PR with inline CI status (#834)`
- `dee2104ae` `docs: UI update validation process (#831)`

For this cleanup branch, only `#790`, `#828`, `#835`, and `#837` are in-scope candidates.

## Required Now For Clean Main

### 1. Scheduler worker compatibility fix (`#844`)

Why it is required:

- Current `main` cannot credibly pass the scheduler worker proof without the compatibility fixes already identified.
- After rebuilding the necessary workspace package declarations, `@cogni/scheduler-worker-service` typecheck succeeds with this fix in place.

Expected content:

- `services/scheduler-worker/src/activities/index.ts`
- `services/scheduler-worker/src/activities/ledger.ts`
- `services/scheduler-worker/src/activities/sweep.ts`
- `services/scheduler-worker/src/observability/events.ts`
- `packages/temporal-workflows/src/index.ts`

Decision:

- **Required in cleanup branch**

### 2. Trunk-safe local affected-check plumbing from `#828`

Why it is required:

- The desired trunk baseline explicitly includes fast, trustworthy local validation.
- `#828` is the smallest canary-landed commit that cleanly isolates affected-check plumbing without swallowing the full `#790` umbrella.

Expected content:

- `scripts/check-fast.sh`
- `scripts/check-all.sh`
- `scripts/run-turbo-checks.sh`
- `scripts/run-scoped-package-build.mjs`
- `turbo.json`
- `package.json` (`turbo` devDependency only)
- `pnpm-lock.yaml`

Important cleanup constraint:

- Any fallback logic must target `origin/main`, not `origin/canary`.
- Work-tracking additions from `#828` are optional and should not block the branch.

Decision:

- **Required in cleanup branch**

### 3. Tooling config generalization for all node apps

Why it is required:

- The current baseline problem is not only "missing turbo."
- `main` still hard-codes tooling assumptions around `nodes/operator/app`.
- Bringing `poly`, `resy`, and `node-template` into the intended lint scope exposes that the config itself is operator-only.

Minimum config areas implicated:

- `biome.json`
- `biome/base.json`
- `biome/app.json`
- `eslint.config.mjs`

What this means:

- The cleanup branch must generalize shared tool configuration to all node apps.
- This is not optional if the goal is a clean, reproducible trunk baseline across the current multi-node repo shape.

Decision:

- **Required in cleanup branch**

## Conditionally Required

### 4. Deploy ordering and secret-source fixes (`#835` + `#837`)

Why they matter:

- These are real canary-landed deployment stabilizations.
- `#837` is a tiny follow-up to `#835`, so they should be treated as one unit if included.

Primary files:

- `.github/workflows/promote-and-deploy.yml`
- `scripts/ci/deploy-infra.sh`
- `scripts/ci/verify-deployment.sh`
- `scripts/ci/wait-for-argocd.sh`

Decision rule:

- If "clean main" means **static/tooling baseline only**, keep these out of the cleanup branch.
- If "clean main" means **default deploy path is also trustworthy**, include both `#835` and `#837` together.

Current recommendation:

- **Defer unless deploy-path trust is explicitly part of this branch's success definition**

## `#790` Enumeration

`#790` is not one coherent "affected-only CI" patch. It is a very large umbrella commit that mixes CI work with a broad amount of agent workflow, setup, bootstrap, scripts, docs, and work-tracking content.

### What `#790` appears to contain

#### A. Top-priority affected-only CI core

This is the highest-value portion to eventually achieve on `main`:

- `turbo.json`
- `package.json`
- `pnpm-lock.yaml`
- `.github/workflows/ci.yaml`
- `scripts/check-all.sh`
- `scripts/check-fast.sh`
- `scripts/check-full.sh`
- `.husky/pre-push`

Interpretation:

- This is the core "affected-only CI" objective.
- It should be extracted intentionally, not recovered by replaying the full umbrella commit.

#### B. Broader CI/CD workflow and runtime script churn

These files were also touched by `#790`, but they are not all necessary for the immediate cleanup branch:

- `.github/workflows/build-multi-node.yml`
- `.github/workflows/promote-and-deploy.yml`
- `.github/workflows/staging-preview.yml`
- `.github/workflows/e2e.yml`
- `.github/workflows/nightly-full.yml`
- `.github/workflows/pr-lint.yaml`
- `.github/workflows/release.yml`
- `scripts/ci/*`
- `scripts/check-runtime-env.ts`
- `scripts/check-root-layout.ts`
- `scripts/check-ui-tokens.sh`
- `scripts/validate-*`

Interpretation:

- These should be reviewed as separate workflow/system slices.
- They are not automatically part of the "affected-only CI" nucleus.

#### C. Local dev/bootstrap/setup expansion

Examples from `#790`:

- `scripts/bootstrap/*`
- `scripts/setup/*`
- `scripts/experiments/*`
- assorted dev/db helper scripts

Interpretation:

- Not required for the cleanup branch.
- Should not be pulled in just because they were adjacent in `#790`.

#### D. Agent/rule/workflow scaffolding and large work-tracking payload

Examples from `#790`:

- `.agent/workflows/*`
- `.agents/skills/*`
- `.claude/commands/*`
- `.claude/skills/*`
- many `work/items/*`
- project and process docs

Interpretation:

- This is the most overwhelming part of `#790`.
- It is not the same thing as "affected-only CI."
- It should stay out of the cleanup branch.

## Recommended Extraction Strategy For The `#790` Goal

If the priority is to achieve affected-only CI on `main`, the correct target is not "merge `#790`."

The correct target is this narrower sequence:

1. Land the cleanup branch with:
   - `#844`
   - the trunk-safe `#828` subset
   - shared Biome/ESLint config generalization
2. After cleanup is green, create a dedicated affected-only CI PR that extracts only the `#790` core:
   - `turbo.json`
   - `package.json`
   - `pnpm-lock.yaml`
   - `.github/workflows/ci.yaml`
   - `scripts/check-fast.sh`
   - `scripts/check-all.sh`
   - `scripts/check-full.sh`
   - optionally `.husky/pre-push` if local/CI parity is still desired
3. Keep broader workflow/deploy/bootstrap/agent scaffolding out unless each slice is separately justified.

## Explicit Exclusions For The Cleanup Branch

- `#833` agent-first API
- `#834` PR-grouped dashboard
- `#831` UI validation docs
- the broad non-CI ballast from `#790`
- opportunistic node-app rewrites not proven necessary by baseline config/tooling alignment

## Working Definition Of Success

The cleanup branch should be able to say:

- `main` has the minimum scheduler-worker compatibility fixes it needs
- `main` has a trunk-safe path for affected local checks
- `main` no longer has operator-only shared lint/config assumptions for a multi-node repo
- feature-recovery branches can rebase on top of a known baseline instead of a moving target

## Open Decision

Still needs explicit confirmation:

- Should deploy-path stabilization (`#835` + `#837`) be part of this cleanup branch, or should cleanup remain strictly static/tooling baseline work?
