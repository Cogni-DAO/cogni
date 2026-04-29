---
id: task.0422
type: task
title: "Dep-cruiser inter- and intra-node design — root rules vs `nodes/<X>/.dependency-cruiser.cjs`"
status: needs_design
priority: 1
rank: 3
estimate: 3
summary: "Design how dependency-cruiser should be split between repo-wide (inter-node) rules and per-node (intra-node) rules. Today the root `.dependency-cruiser.cjs` (~767 lines) carries both — cross-node graph invariants AND node-specific module-boundary rules — so any node-internal architectural rule change is a root-config edit, which (a) is a cross-cutting churn vector and (b) burns the operator domain in `single-node-scope`. Goal: a small, simple split where root config enforces inter-node invariants (e.g. 'no node imports another node's app/'), and each node owns a `nodes/<X>/.dependency-cruiser.cjs` for its own module-boundary rules. Bias toward minimum machinery — extend root config, don't fork it. Depends on task.0421 landing first so paths are stable."
outcome: "A design doc (or extension of `docs/spec/node-ci-cd-contract.md`) that specifies: (1) which rule classes belong at root vs per-node, (2) how the root config composes (or inherits) per-node rules — extends-via-options vs separate dep-cruise runs, (3) how `pnpm dep:check` discovers and runs them (single command, fan-out), (4) failure mode when a node lacks a config (default = inherit root). One reference implementation in `nodes/poly/.dependency-cruiser.cjs` proving the design works without weakening global rules. No follow-up tasks fanned out from this — implementation lands in the same PR as the design write-up if the design is small enough; if not, splits at /implement time."
spec_refs:
  - docs/spec/node-ci-cd-contract.md
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0421]
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [cicd, node-boundary, dep-cruiser, design]
external_refs: []
---

# Dep-cruiser inter- and intra-node design

## Why

The 767-line root `.dependency-cruiser.cjs` mixes two concerns:

1. **Inter-node invariants** — cross-cutting graph rules: "no node imports another node's app/", "graphs/ may not import app/", layering between `packages/*`, etc. These belong at root because they govern relationships _between_ nodes and shared packages.
2. **Intra-node module boundaries** — rules that are scoped to one node's internal architecture (its hexagonal layers, its facades, its server/client split). These leak into the root config today and force every node-internal rule change through the operator domain.

Result: any architectural tightening inside `nodes/poly/app/**` is a root-config edit → operator-domain change → can't ride along with the poly PR it's actually motivated by.

This is the dep-cruiser side of queue #2 of [`operator-dev-manager`](.claude/skills/operator-dev-manager/SKILL.md): _per-node dep-cruiser setups_.

## Scope (design first, implement if small)

**Design questions:**

- Which rule classes are inter-node (root) vs intra-node (per-node)? First pass: anything mentioning two different `nodes/*` paths or a `packages/*` ↔ `nodes/*` boundary stays at root; anything that only references paths under one `nodes/<X>/**` moves to that node.
- Composition model: does root extend per-node configs, or does `pnpm dep:check` run N+1 dep-cruise invocations (root + each node)? N+1 is simpler, no config-merging risk. Root config can set `forbidden` only; per-node sets its own.
- Discovery: glob `nodes/*/.dependency-cruiser.cjs` from a single `pnpm dep:check:all` script. Missing per-node config = node inherits root only (zero-config default — easy onboarding for new nodes).
- Reporter: keep one combined output so CI failure UX doesn't regress.

**Reference implementation (in same PR if design is small):**

- One `nodes/poly/.dependency-cruiser.cjs` that owns the intra-poly rules currently bleeding into root.
- Root config slimmed to inter-node invariants only.
- `pnpm dep:check` updated to fan out.

**Out of scope:**

- Per-node biome / eslint / prettier configs — different problem, different design.
- Per-node `tsconfig.json` strictness deltas — already partially supported, not blocked on this.

## Dependencies

Blocked by **task.0421** (per-node package carve-out). Splitting dep-cruiser before paths stabilize means rewriting the per-node config twice.

## Validation

```yaml
exercise: |
  Land an intra-poly architectural rule (e.g. "nodes/poly/app/src/adapters/** may not import nodes/poly/app/src/app/**")
  in a poly-only PR by editing only nodes/poly/.dependency-cruiser.cjs. Verify the PR classifies as ["poly"]
  and `pnpm dep:check` catches a deliberate violation locally.
observability: |
  CI run for the test PR: `single-node-scope` MATCHED=["poly"]; the dep-check job fails on the violation
  with output sourced from nodes/poly/.dependency-cruiser.cjs (rule name visible in the failure line).
```

## Risk

- Forgetting an inter-node rule that should stay at root → silent weakening of the global graph. Mitigation: design doc lists the inter-node rules explicitly, code review checks none disappeared.
- Per-node configs drifting in style → enforce a tiny shared helper (`tooling/dep-cruiser/base.cjs`) if needed. Don't over-engineer — three nodes today.

## Refs

- Surface: same CI run that motivated task.0421 — [run #25082460609 PR #1118](https://github.com/Cogni-DAO/node-template/actions/runs/25082460609/job/73490473681?pr=1118)
- Sister carve-outs: task.0411 (temporal-workflows), task.0317 (graph catalogs), task.0421 (packages)
