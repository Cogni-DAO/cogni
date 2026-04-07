---
id: task.0260
type: task
title: "Monorepo CI pipeline — affected-scope testing + multi-node test lane"
status: needs_design
priority: 0
rank: 2
estimate: 5
summary: "Replace single-pipeline CI with a 3-lane monorepo pipeline: (1) affected-only fast checks on every PR via Turborepo, (2) multi-node stack tests when node/runtime/shared scopes change, (3) nightly/manual protected-branch validation. Remote cache for speed."
outcome: "PRs that touch only poly skip operator tests. PRs that touch shared/ run both. Multi-node billing isolation tests run in CI. Average PR CI time drops by 50%+."
spec_refs:
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0247
deploy_verified: false
created: 2026-04-02
updated: 2026-04-03
labels: [ci, monorepo, turborepo, testing, multi-node]
external_refs:
---

# Monorepo CI Pipeline — Affected-Scope Testing + Multi-Node Test Lane

## Context

Today CI runs a single `stack-test` job: build everything, boot one operator node,
run all stack tests. This was fine for a single-app repo but breaks down with
multi-node:

- Poly/resy changes don't get tested in CI (no node Docker images built)
- `test:stack:multi` (task.0258) runs locally but has no CI job
- Every PR rebuilds and retests everything, even when only docs changed
- P5 in proj.cicd-services-gitops planned NX for this, but NX is heavy and
  Turborepo `--affected` is a better fit for our pnpm workspace

## Design

### Lane 1: Fast checks (every PR, affected-only)

Turborepo `--affected` with remote cache. Runs `typecheck`, `lint`, `test:unit`,
`test:contract` only for changed packages/apps. Unchanged packages hit cache.

```yaml
- run: pnpm turbo run typecheck lint test --affected
```

**Why Turbo over NX:** pnpm native, simpler config (`turbo.json`), `--affected`
uses Git history (no daemon), remote cache via Vercel or self-hosted.

### Lane 2: Multi-node stack tests (conditional)

Runs when PR touches `nodes/`, `apps/operator/`, `packages/`, `infra/litellm/`,
or `infra/compose/`. Uses internal `if` condition (not GitHub `paths:` filter —
skipped required workflows stay pending and block merges).

```yaml
- name: Check affected scope
  id: scope
  run: |
    CHANGED=$(git diff --name-only origin/staging...HEAD)
    if echo "$CHANGED" | grep -qE '^(nodes/|apps/operator/|packages/|infra/)'; then
      echo "run_multi=true" >> $GITHUB_OUTPUT
    fi

- name: Build node images
  if: steps.scope.outputs.run_multi == 'true'
  # Build operator + poly + resy Docker images

- name: Run multi-node tests
  if: steps.scope.outputs.run_multi == 'true'
  run: pnpm test:stack:multi
```

### Lane 3: Protected-branch gate (nightly + merge queue)

Always runs the expensive 3-node Docker job. Promotes to merge-queue requirement
when poly/resy become deploy-critical.

## Requirements

- PRs that touch only `nodes/poly/` skip operator unit tests (Turbo affected)
- PRs that touch `packages/` run tests for all dependents
- `test:stack:multi` runs in CI when node/runtime/infra scopes change
- Multi-node CI job builds poly + resy Docker images and boots 3 app containers
- Remote cache (Vercel Turbo or self-hosted) enables cross-PR cache hits
- No GitHub `paths:` filters on required workflows (causes pending-block)
- Average PR CI time drops measurably vs current "test everything" approach
- **Deduplicate image builds**: ci.yaml stack-test and build-multi-node.yml currently
  build the same Dockerfile independently with separate GHA cache scopes (`stack-test`
  vs `build-operator`). stack-test should pull images from GHCR after build-multi-node
  pushes them, not rebuild. Trades parallelism for dedup — stack-test waits for build,
  but skips ~3 min of redundant Docker builds per push to canary

## Allowed Changes

- `.github/workflows/ci.yaml` — refactor into multi-lane pipeline
- `turbo.json` — CREATE (Turborepo pipeline config)
- `package.json` — add `turbo` dependency, update script names if needed
- `infra/compose/runtime/docker-compose.dev.yml` — add poly/resy service entries for CI
- `.env.test.example` / `.env.test` — per-node test DB URLs (already done in task.0258)

## Plan

- [ ] **Spike:** Verify Turborepo `--affected` works with our pnpm workspace
      structure (root + `apps/operator` + `nodes/poly` + `nodes/resy` + `packages/*`)
- [ ] **Add `turbo.json`** with pipeline: `typecheck`, `lint`, `test`, `build`
      respecting workspace dependency graph
- [ ] **Refactor `ci.yaml` Lane 1:** Replace monolithic `static` + `stack-test` with
      `turbo run typecheck lint test --affected` for fast checks
- [ ] **Add Lane 2 job:** `stack-test-multi` with scope detection, node image builds,
      3-node compose up, `pnpm test:stack:multi`
- [ ] **Add Lane 3:** Nightly workflow + merge-queue trigger for protected-branch gate
- [ ] **Remote cache:** Configure Turbo remote cache (Vercel free tier or self-hosted)
- [ ] **Validate:** PR touching only `docs/` skips all tests. PR touching `packages/db-schema`
      runs operator + poly + resy tests. PR touching `nodes/poly/` runs only poly tests.

## Relationship to proj.cicd-services-gitops

This task supersedes **P5: CI Acceleration (NX)** in the project. Turborepo replaces
NX as the affected-graph tool (simpler, pnpm-native). P4 (Dagger) remains orthogonal —
Turbo selects WHAT to run, Dagger (future) defines HOW to run it.

task.0247 (multi-node CICD deployment) is the CD counterpart. This task is CI only.
task.0247 provides the Docker compose entries that Lane 2 depends on for node images.

## Validation

```bash
# Lane 1: affected-only (simulated)
pnpm turbo run typecheck lint test --affected --dry-run

# Lane 2: multi-node (already proven locally)
pnpm test:stack:multi
```

**Expected:** Turbo graph shows correct dependency relationships. Multi-node tests pass.

## Review Checklist

- [ ] **Work Item:** `task.0260` linked in PR body
- [ ] **Tests:** CI pipeline validates itself (meta-test: docs-only PR skips tests)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Supersedes: proj.cicd-services-gitops P5 (NX → Turborepo)
- Depends on: task.0247 (node Docker images for Lane 2)
- Related: task.0258 (multi-node stack tests — Lane 2 test suite)
- PR: [#790](https://github.com/Cogni-DAO/node-template/pull/790)
- Handoff: [handoff](../handoffs/task.0260.handoff.md)

## Attribution

-
