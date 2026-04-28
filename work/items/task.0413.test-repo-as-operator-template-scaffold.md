---
id: task.0413
type: task
title: "Promote Cogni-DAO/test-repo to a basic operator-template scaffold (turbo + real CICD + merge queue)"
status: needs_design
priority: 3
rank: 96
estimate: 5
summary: "Today Cogni-DAO/test-repo carries node-template's branch-protection + merge-queue config but only via parity-stub workflows that emit canned passes. Vision: make it a minimal real turbo workspace whose `static`, `unit`, `component`, `manifest` jobs do real work on a tiny scaffold. End state: test-repo IS the operator-template starting point for new Cogni node forks. Renaming and individual node-template(s) are separate tasks."
outcome: |
  - test-repo becomes a minimal turbo workspace (pnpm + turbo) with one tiny package and a Dockerfile that produces an image manifest.
  - `.github/workflows/node-template-parity.yml` evolves: jobs do real work — `static` runs `pnpm typecheck && pnpm lint`; `unit` runs `pnpm test`; `component` runs a tiny testcontainers smoke; `manifest` runs `pnpm build:images` (toy version).
  - The minimal scaffold is intentionally sparse — just enough that the four required-check jobs are real, not stub. New Cogni node forks clone test-repo, run `setup-main-branch.sh`, and start with a known-good gate.
  - This task does NOT rename test-repo. Naming convergence (test-repo → operator-template; node-template → individual nodes) is a separate task — likely paired with the GH org rename.
spec_refs:
  - docs/spec/node-ci-cd-contract.md
  - docs/spec/merge-queue-config.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-28
updated: 2026-04-28
labels: [cicd, operator-template, scaffolding, test-repo]
external_refs:
  - work/items/task.0391.enable-merge-queue.md
  - work/items/task.0416.operator-recover-from-merge-queue-cancel.md
---

# task.0413 — Promote test-repo to a basic operator-template scaffold

## Problem

`Cogni-DAO/test-repo` currently has node-template's canonical branch protection + merge queue applied (per task.0391 / PR #1096 / `infra/github/setup-main-branch.sh`), but the workflows producing the required checks (`static`, `unit`, `component`, `manifest`) are stubs that always pass. This means:

- New Cogni node forks that point at test-repo as a starting template inherit the gate but no real CI substance.
- A scaffold's gate IS its first-class API to contributors. A stub gate is a lie about what's enforced.

## Vision

`Cogni-DAO/test-repo` becomes the **basic operator-template scaffold** — the minimal, real, runnable starting point for any new Cogni node:

- pnpm + turbo workspace
- One tiny package (`@cogni-template/hello`) with a typecheck-able TS file, a passing unit test, and a Dockerfile
- `.github/workflows/node-template-parity.yml` evolves into real jobs:
  - `static` → `pnpm typecheck && pnpm lint`
  - `unit` → `pnpm test`
  - `component` → minimal testcontainers smoke (e.g., spin a postgres, query SELECT 1)
  - `manifest` → `pnpm build:images` producing one Docker image + a build-manifest.json

When a new fork is created from this template:

1. Clone fork.
2. `bash infra/github/setup-main-branch.sh` (or copy from node-template).
3. Click "Require merge queue" once.
4. CI works out of the box. Required checks fire on both pull_request + merge_group as designed.

## Out of scope

- **Renaming**. Today: `Cogni-DAO/test-repo` (was a github E2E test repo) and `Cogni-DAO/node-template` (current operator-template carrying all node code). The future-state naming (test-repo → `operator-template`, node-template → split into `node-template-{poly,resy,...}` + the operator's own repo) is a separate, larger refactor — likely paired with the GH org rename.
- **Renting the scaffold structure from node-template**. We don't copy nodes/, packages/, services/, etc. from node-template to test-repo. test-repo stays minimal — its job is to demonstrate the gate, not to ship features.
- **Per-node separation**. Splitting node-template into individual node repos is a separate task with much larger blast radius.

## Why low-priority

- test-repo's gate is already correct (parity stubs satisfy the required checks). New forks today can copy node-template's `infra/github/` and get a working gate; they just inherit node-template's full size.
- The "minimal scaffold" value is mostly to external contributors / external-node-formation flow (proj.agentic-interop / contribute-to-cogni). Until external contributor volume justifies it, real CI on test-repo is icing.

## Validation

- exercise: clone test-repo, push a one-line change to a branch, open a PR. All four required checks (`static`, `unit`, `component`, `manifest`) report green within ~3 minutes from real workflows (not stubs). Click "Merge when ready" — queue accepts, rebases, re-runs the four on merge_group, merges.
- observability: workflow run logs show actual commands executing (`pnpm typecheck`, `pnpm test`, etc.), not just `echo "static OK"`. `node-template-parity.yml` no longer contains the word "stub".

## PR / Links

- Filed alongside task.0416 (originally task.0412 — renumbered to resolve duplicate id with task.0412.poly-redeem-multi-tenant-fanout) on PR #1096 — both are merge-queue-rollout follow-ups, neither blocks the PR.
- Future related tasks (not yet filed): rename `test-repo` → `operator-template`; split `node-template` into individual node repos; agentic node-setup that targets the new operator-template.
