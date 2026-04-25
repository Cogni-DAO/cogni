---
id: task.0381
type: task
title: "Single-node-scope CI gate — reject PRs that touch >1 node (operator = infra exemption)"
status: needs_design
priority: 0
rank: 1
estimate: 1
summary: "Static CI invariant that fails any PR whose changes touch >1 sovereign node directory under `nodes/{poly,resy,ai-only,…}/`. Operator-infra paths (`nodes/operator/**`, `infra/**`, `.github/**`, `packages/**`, `docs/**`, `work/**`, `scripts/**`) are exempt and may appear in any PR. Closes the policy gap that task.0372's matrix fan-out leaves open: matrix supports multi-cell flights, but policy requires single-node PRs."
outcome: "When a contributor (or AI agent) opens a PR that touches `nodes/poly/` and `nodes/resy/` simultaneously, CI fails with a clear message naming the conflicting nodes and instructing to split the PR. Operator-infra-only PRs (e.g., docs, packages, .github changes) pass unaffected. The matrix in task.0372 degenerates to ≤1 node cell per PR in practice; multi-cell flights are reserved for the operator-infra exemption case where shared infra changes legitimately require flighting all consumer nodes."
spec_refs:
  - node-ci-cd-contract
assignees: []
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-25
updated: 2026-04-25
labels: [cicd, policy, monorepo, node-sovereignty]
---

# Single-Node-Scope CI Gate

## Problem

Task.0372's per-node matrix fan-out _supports_ multi-node PRs by design — multiple matrix cells run in parallel, one per affected node. But the underlying policy this monorepo wants is stricter: **a PR must touch at most one sovereign node**. Cross-node changes mask coordination bugs, complicate review (one node's reviewer cannot speak for another's rules), and undermine node sovereignty — the central architectural promise of the multi-node layout.

There is no current static enforcement of this. Without it:

- AI contributors (the inflood task.0372 + the per-node reviewer story exist to support) can land cross-node PRs that pass review on one node's rules and break invariants on another's.
- The reviewer, after task.0382's `extractOwningNode` lands, cannot answer "which node owns this PR?" deterministically when paths span multiple nodes.
- The candidate-flight matrix's `fail-fast: false` semantics lets a partial-success state ship — node A's cell green, node B's cell red, PR merged anyway because reviewers focused on A.

This is a policy gate, not a function. Implementation surface is small (~30 lines bash) but the _invariant_ it locks is load-bearing for every downstream multi-node story.

## Design

### Outcome

A required CI check `single-node-scope` that fails any PR touching >1 sovereign node directory unless the PR is operator-infra-only.

### Approach

**Solution**: Bash script `scripts/ci/check-single-node-scope.sh` invoked from a new job in `.github/workflows/ci.yaml`. Reads the PR diff (`git diff --name-only origin/main...HEAD`), filters changed files against two path classifications:

1. **Sovereign node paths**: `nodes/{poly,resy,ai-only,…}/**` (any directory under `nodes/` _except_ `nodes/operator`).
2. **Operator-infra paths**: `nodes/operator/**`, `infra/**`, `.github/**`, `packages/**`, `services/**`, `docs/**`, `work/**`, `scripts/**`, root configs (`pnpm-workspace.yaml`, `turbo.json`, `package.json`, `tsconfig.json`, etc.).

Algorithm:

```
affected_nodes = unique(node-prefix-of-each-changed-path under nodes/* excluding nodes/operator)
infra_only    = every changed path matches an operator-infra pattern
if !infra_only and len(affected_nodes) > 1:
  fail with: "PR touches {N} sovereign nodes: {list}. Split into {N} PRs (one per node)."
else:
  pass
```

Uses `turbo ls --affected --filter='./nodes/*/...' --json` already invested in by task.0260 / 0320 / 0372 for the affected-node list, **plus** a path-classification fallback for diff entries Turbo doesn't model (e.g., a stray edit to `nodes/poly/.cogni/repo-spec.yaml` outside the workspace graph).

### Path classification — the operator-infra exemption

The exemption is the subtle part. `nodes/operator/**` is treated as infra (not a sovereign node) because the operator IS the infra/control plane — not a peer node. Likewise `packages/**` (shared workspace packages) and `infra/**` (k8s manifests, OpenTofu) are infra. The exemption rule:

> A PR is **operator-infra-only** if every changed path matches at least one infra pattern AND no path matches a sovereign node pattern.

Operator-infra-only PRs are allowed to be arbitrarily large and span many concerns — they're the legitimate cross-cutting case (e.g., upgrade `@cogni/repo-spec` and update operator + scheduler-worker callers).

### Reuses

- Existing `turbo ls --affected --filter=...[$BASE]` integration from task.0320 / 0372
- Existing `ci.yaml` workflow infrastructure (just adds a new required job)
- Existing `nodes/*` directory convention as the source-of-truth for sovereign nodes (no new registry needed)

### Rejected

- _CODEOWNERS-based enforcement_ — GitHub CODEOWNERS doesn't fail PRs on multi-owner diffs, only routes review requests. Wrong tool.
- _GraphQL/GitHub-API-based check inside the operator review-handler_ — couples policy to operator runtime; operator outages would let policy-violating PRs through. Static CI is independent of operator availability.
- _Soft warning instead of hard fail_ — defeats the gate. Single-node-scope is a hard invariant or it isn't an invariant.
- _Listing sovereign nodes in a config file_ — the directory layout `nodes/*` (minus `nodes/operator`) IS the source of truth. Adding a separate list creates a sync hazard. Glob the filesystem.
- _Putting this in `arch:check` (dep-cruiser)_ — depcruise reasons about imports, not git diffs. Wrong layer.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **SINGLE_NODE_HARD_FAIL**: When >1 sovereign node is touched (and PR is not infra-only), CI fails with non-zero exit. No warning mode, no override flag.
- [ ] **OPERATOR_IS_INFRA**: `nodes/operator/**` is treated as infra, not a sovereign node. Operator changes can ride alongside any other path.
- [ ] **DIRECTORY_IS_SOURCE_OF_TRUTH**: The set of sovereign nodes is computed from `nodes/*` directory listing, not from a hand-maintained list. Adding `nodes/ai-only/` automatically extends the gate.
- [ ] **CLEAR_FAILURE_MESSAGE**: The failure message names the conflicting nodes and tells the contributor exactly what to do (split the PR). AI contributors must be able to act on it.
- [ ] **REQUIRED_CHECK**: The job is a required status check on `main`, not a soft "informational" one.

### Files

- Create: `scripts/ci/check-single-node-scope.sh` — the gate script (~30 lines).
- Create: `tests/ci-invariants/check-single-node-scope.test.sh` (or vitest) — covers: single-node PR ✓, operator-infra-only PR ✓, two-node PR ✗ with expected error message, edge cases (empty diff, deletes, renames across nodes).
- Modify: `.github/workflows/ci.yaml` — add `single-node-scope` job to the static checks set.
- Modify: branch protection rules — add `single-node-scope` as a required status check (manual gh action or terraform).
- Modify: `docs/spec/node-ci-cd-contract.md` — add the SINGLE_NODE_HARD_FAIL invariant to the merge-gate matrix.

### Out of scope

- Auto-splitting cross-node PRs (manual contributor action).
- Detecting _semantic_ cross-node coupling (e.g., a `packages/` change that breaks node A but not node B). That's task.0382 + the per-node reviewer's job, not this gate's.
- Retroactive enforcement on already-merged PRs.

## Links

- Handoff: [handoff](../handoffs/task.0381.handoff.md)

## Validation

```yaml
exercise: |
  # Negative cases (must fail):
  bash scripts/ci/check-single-node-scope.sh --diff "nodes/poly/app/foo.ts nodes/resy/app/bar.ts"
  # Positive cases (must pass):
  bash scripts/ci/check-single-node-scope.sh --diff "nodes/poly/app/foo.ts packages/repo-spec/src/x.ts"
  bash scripts/ci/check-single-node-scope.sh --diff "infra/k8s/foo.yaml docs/spec/bar.md"
observability: |
  CI run for an intentionally-cross-node test PR shows the `single-node-scope` job
  failing with the expected diagnostic. CI run for an infra-only PR shows the job
  passing. Branch-protection page on github.com lists single-node-scope as required.
```
