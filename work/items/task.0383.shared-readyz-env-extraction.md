---
id: task.0383
type: task
title: "First-class shared `readyz`/env-invariants into operator territory so cross-cutting infra fixes can land as a single PR"
status: needs_design
priority: 3
rank: 5
estimate: 2
summary: "Substrate-request surfaced by single-node-scope gate (task.0381). Today every node duplicates `src/app/(infra)/readyz/route.ts` and `src/shared/env/invariants.ts` — a fix that touches readiness or env-validation logic must edit it in 4 places (operator + poly + resy + node-template), which the gate now correctly rejects as a 4-domain PR (e.g., PR #1069). Extract the shared logic into a workspace package (operator territory) so node files become thin imports. Then a future fix is a single operator-domain PR + zero per-node touches."
outcome: "When a contributor improves readyz or env-invariant logic, they edit one file in `packages/<name>/` (operator domain) and per-node `route.ts` / `invariants.ts` shims pick up the change automatically via re-export. The single-node-scope gate sees an operator-only PR and passes. The substrate-request signal that produced this task — 'cross-cutting infra duplicated across nodes' — is closed for these two surfaces."
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
created: 2026-04-26
updated: 2026-04-26
labels: [cicd, monorepo, refactor, substrate-request, single-node-scope]
---

# Shared `readyz`/env-invariants extraction (substrate-request)

## Problem

The single-node-scope gate (task.0381, shipped in #1059) correctly rejects any PR touching `nodes/poly/`, `nodes/resy/`, `nodes/node-template/`, AND `nodes/operator/` simultaneously — that's 4 domains, must be 4 PRs. Working as designed.

But there are real cross-cutting fixes where the duplicated logic is the bug, not the gate. PR #1069 ("fix(readyz): cache EVM RPC probe + degrade non-fatally") is the canonical example: the same readiness-probe logic lives copy-pasted in:

- `nodes/operator/app/src/app/(infra)/readyz/route.ts`
- `nodes/poly/app/src/app/(infra)/readyz/route.ts`
- `nodes/resy/app/src/app/(infra)/readyz/route.ts`
- `nodes/node-template/app/src/app/(infra)/readyz/route.ts`

Same file four times. Same env-invariants four times. Any improvement must touch all four — which is now correctly blocked.

This is the **substrate-request signal the gate exists to surface**: the duplication was never load-bearing; it was a node-template bootstrapping convenience that became a cross-cutting tax. Extract it.

## Approach (sketch — refine in /design)

1. New workspace package (e.g., `packages/node-runtime-infra/` or fold into an existing operator package) exporting:
   - `createReadyzHandler(deps)` — the probe + caching + degrade-non-fatally logic, parameterized by node-specific dependencies (env, db, providers).
   - `validateEnvInvariants(env)` — the EVM-cache-aware invariant checks.
2. Per-node `(infra)/readyz/route.ts` becomes a 5-line shim: import the factory, pass the node's deps, export the handler.
3. Per-node `shared/env/invariants.ts` becomes a re-export of the shared validator with node-specific overrides.
4. PR shape after extraction: cross-cutting fix → operator-only PR (touches `packages/...`). Future per-node tweaks remain per-node.

## Out of scope

- Extracting other duplicated surfaces (auth, observability, etc.) — same pattern, file separately as substrate-requests are surfaced by the gate.
- Removing the duplication is a refactor; **not** a behavior change. Keep verbatim parity in the first PR; behavior tweaks come after.

## Why low priority

- The gate already shipped; the workaround (split into N PRs) works.
- No active customer is blocked; #1069 can land as 4 separate PRs in the meantime.
- The pattern matters more than the speed — once one extraction lands cleanly, future substrate-requests (auth, observability) follow the same template.

## Pointers

- [Single-Domain Scope spec](../../docs/spec/node-ci-cd-contract.md#single-domain-scope) — the rule that produced this request
- [task.0381](task.0381.single-node-scope-ci-gate.md) — the gate
- [task.0382](task.0382.extract-owning-node-resolver.md) — the runtime resolver
- [PR #1069](https://github.com/Cogni-DAO/node-template/pull/1069) — the canonical blocked PR; will need to split until this task lands

## Validation

```yaml
exercise: |
  # After implementation: open a PR that improves the readyz logic.
  # Edit only the shared package; per-node files unchanged. Confirm:
  #   1. CI single-node-scope gate passes (operator-only domain).
  #   2. All four nodes' /readyz routes return identical behavior in stack tests.
  #   3. PR #1069's diff can be re-expressed as a single operator-domain change.
observability: |
  CI run for the cross-cutting fix shows the single-node-scope job green with
  domain=[operator]. Each node's /readyz endpoint on candidate-a returns the
  expected payload at the deployed SHA (curl + Loki line per node).
```
