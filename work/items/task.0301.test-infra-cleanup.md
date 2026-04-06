---
id: task.0301
type: task
title: "Test infrastructure cleanup — deduplicate node tests + fix CI failures"
status: needs_implement
priority: 0
rank: 1
estimate: 5
summary: "Fix pre-existing test failures blocking CI (public-route-enforcement hardcoded path, analytics.summary contract mismatch), fix turbo --affected base ref, then extract shared test infrastructure into packages/node-test-utils to eliminate 99% duplication across 4 nodes (~832 duplicated test files)."
outcome: "CI green on canary. Shared test utils extracted. Each sovereign node keeps only node-specific tests + smoke suite. ~75% reduction in node test file count."
spec_refs:
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-06
updated: 2026-04-06
labels: [testing, ci, monorepo, deduplication, multi-node]
external_refs:
---

# Test Infrastructure Cleanup — Deduplicate Node Tests + Fix CI Failures

## Context

Audit of multi-node test infra revealed:

- **832 node test files** across 4 nodes (operator, poly, resy, node-template) — 99% identical
- **2 pre-existing failures** exposed by turbo --affected fallback running all workspaces:
  - `public-route-enforcement.test.ts` hardcodes `nodes/operator/app/src/app/api/v1/public` in ALL nodes
  - `analytics.summary.test.ts` contract failures from recent merge
- **turbo --affected** can't compute merge base (fetches SHA, needs branch ref)
- All vitest configs, test setup, \_fakes, \_fixtures, helpers duplicated per-node

## Requirements

- CI passes on canary with turbo --affected working correctly
- public-route-enforcement.test.ts resolves paths relative to its own node
- analytics.summary contract tests pass
- Shared test infrastructure extracted to reduce duplication
- Each node retains only node-specific tests + smoke suite

## Strategy

**Phase 1 — Unblock CI (immediate)**

1. Fix `public-route-enforcement.test.ts` hardcoded operator path → resolve relative to node
2. Fix `analytics.summary.test.ts` contract failures
3. Fix turbo `git fetch origin $BASE_SHA` → `git fetch origin $BASE_REF`

**Phase 2 — Extract shared test infra**

- Create `packages/node-test-utils/` with \_fakes, \_fixtures, helpers, setup.ts, vitest config factory
- Node tests import from `@cogni/node-test-utils`

**Phase 3 — Deduplicate test suites (Approach A)**

- Shared tests run in node-template only
- Operator/poly/resy keep node-specific tests + lightweight smoke suite
- Multi-node stack tests (operator-only) remain as integration proof
- Nightly full run covers everything everywhere as safety net

## Allowed Changes

- `nodes/*/app/tests/` — test files across all nodes
- `packages/node-test-utils/` — NEW shared test package
- `.github/workflows/ci.yaml` — turbo base ref fix
- `turbo.json` — if needed
- `vitest.workspace.ts` — add new package
- `pnpm-workspace.yaml` — add new package

## Validation

**Command:**

```bash
pnpm check:fast
```

**Expected:** All tests pass, no regressions.

## Review Checklist

- [ ] **Work Item:** task.0299 linked in PR body
- [ ] **Spec:** no new invariants violated
- [ ] **Tests:** existing tests pass, no coverage regression
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
