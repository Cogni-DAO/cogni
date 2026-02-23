---
id: task.0105
type: task
title: "Allocation algorithm expansion — multi-source credit estimate algos + per-source weight derivation"
status: needs_design
priority: 2
rank: 99
estimate: 3
summary: "Expand the allocation algorithm framework beyond weight-sum-v0 and cogni-v0.0. Support per-source credit_estimate_algo selection, configurable weight derivation, and new algorithm versions."
outcome: "Weight config derivation is driven by per-source credit_estimate_algo instead of hardcoded V0 mapping. New allocation algorithms can be added via the versioned dispatch in computeProposedAllocations. creditEstimateAlgo extracted cleanly from multi-source configs."
spec_refs: epoch-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-02-23
updated: 2026-02-23
labels: [governance, ledger, allocation]
external_refs:
---

# Allocation Algorithm Expansion

## Requirements

- `creditEstimateAlgo` is read per-source (not just from the first source entry — current V0 behavior in `collect-epoch.workflow.ts:172-174`)
- `deriveWeightConfigV0` is replaced or extended with a configurable derivation that reads weights from repo-spec instead of hardcoding `github:pr_merged: 1000` etc.
- New allocation algorithm versions can be registered in `computeProposedAllocations` dispatch without changing the framework
- `deriveAllocationAlgoRef` maps new `credit_estimate_algo` values to internal algorithm refs
- Weight config in repo-spec supports per-source custom weights (not just the implicit V0 mapping)

## Context

V0 implementation (task.0102) uses:

- Single `creditEstimateAlgo` extracted from the first `activitySources` entry (`Object.values(...)[0]`)
- Hardcoded `deriveWeightConfigV0()` in the workflow with fixed weights
- Single algorithm dispatch: `cogni-v0.0` → `weight-sum-v0`

This task makes the framework extensible for real governance use.

## Allowed Changes

- `.cogni/repo-spec.yaml` — extended weight config schema
- `src/shared/config/repoSpec.schema.ts` — weight config schema
- `src/shared/config/repoSpec.server.ts` — weight config mapping
- `packages/ledger-core/src/allocation.ts` — new algorithm versions
- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — per-source algo handling
- `packages/scheduler-core/src/services/syncGovernanceSchedules.ts` — schedule payload changes
- Tests for new algorithms and derivation

## Plan

- [ ] Step 1: Design weight config schema in repo-spec (per-source custom weights)
- [ ] Step 2: Implement configurable weight derivation replacing hardcoded V0
- [ ] Step 3: Handle per-source `creditEstimateAlgo` in workflow
- [ ] Step 4: Add at least one new algorithm version to prove extensibility
- [ ] Step 5: Tests for new derivation and algorithm dispatch

## Validation

**Command:**

```bash
pnpm check
pnpm test
```

**Expected:** All tests pass, existing behavior unchanged for `cogni-v0.0`.

## Review Checklist

- [ ] **Work Item:** `task.0105` linked in PR body
- [ ] **Spec:** ALLOCATION_ALGO_PINNED and ALLOCATION_ALGO_VERSIONED upheld
- [ ] **Tests:** new algorithms and derivation tested
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
