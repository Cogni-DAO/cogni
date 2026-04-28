---
id: task.0411
type: task
title: "Split `@cogni/temporal-workflows` per-node — `nodes/<X>/packages/temporal-workflows` for node-owned workflows"
status: needs_design
priority: 1
rank: 1
estimate: 5
branch:
summary: "`packages/temporal-workflows` started as a shared bundle (bug.0193) but has accumulated workflows owned by individual node concerns: `PrReviewWorkflow` (operator), governance heartbeat (operator), mirror-coordinator (poly). This is the same architectural drift that bug.0319 fixed for AI tools (per-node tool packages) and that recent work fixed for DB schema (`nodes/<X>/packages/db-schema`). Sovereign nodes need to own their workflows, not have them gate-kept in shared infra."
outcome: "(1) `packages/temporal-workflows/` retains only cross-cutting workflows + types: `GraphRunWorkflow`, `GraphRunResult`, ledger workflows, base activity-type contracts, deterministic helpers. (2) Per-node workflows live at `nodes/<X>/packages/temporal-workflows/` — at minimum `nodes/operator/packages/temporal-workflows/` (PrReviewWorkflow, governance) and `nodes/poly/packages/temporal-workflows/` (mirror-coordinator). (3) Each node's scheduler-worker bundle imports its own workflows + the shared base. (4) Single-domain-hard-fail enforcement covers temporal-workflows: a poly PR cannot edit operator's PrReviewWorkflow, same way it can't edit operator's DB schema today. (5) The dev currently writing reviewer-per-node-routing (task.0410) lands on the new boundary, not the old one."
spec_refs:
  - temporal-patterns
  - packages-architecture
assignees: derekg1729
credit:
project:
pr:
reviewer:
revision: 1
blocked_by: []
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [architecture, temporal, per-node, packaging]
external_refs:
  - work/items/bug.0193.worker-houses-workflow-definitions.md
  - work/items/task.0410.reviewer-per-node-routing.md
  - work/items/task.0407.review-modelref-from-repo-spec.md
---

## Problem

bug.0193 (PR #624) consolidated all workflow definitions into `packages/temporal-workflows/` to thin out the scheduler-worker. Correct at the time. But the package has since accumulated workflows owned by **specific node concerns**, all colocated in shared land:

| Workflow                  | Real owner | Currently lives in                                    |
| ------------------------- | ---------- | ----------------------------------------------------- |
| `PrReviewWorkflow`        | operator   | `packages/temporal-workflows/src/workflows/`          |
| Governance heartbeat      | operator   | `packages/temporal-workflows/src/workflows/`          |
| Mirror-coordinator (poly) | poly       | `packages/temporal-workflows/src/workflows/`          |
| `GraphRunWorkflow`        | shared     | `packages/temporal-workflows/src/workflows/`          |
| Ledger workflows          | shared     | `packages/temporal-workflows/src/workflows/ledger.ts` |

Same pattern that drove the per-node refactors elsewhere:

- **DB schema:** moved per-node (`nodes/poly/packages/db-schema/`, etc.) — each node owns its tables.
- **AI tools:** moved per-node (PR #1080, bug.0319 — `nodes/poly/packages/ai-tools/`) — each node owns its MCP surface and `SINGLE_DOMAIN_HARD_FAIL` couldn't be enforced otherwise.
- **AI graphs:** owned per-node under `nodes/<X>/graphs/`.

Workflows are the next domino. Without this split, a poly PR that adds a poly-specific Temporal workflow has to edit a shared package — violating single-domain-hard-fail and forcing operator review on a poly-internal change.

## Symptoms today

- task.0410 (reviewer-per-node-routing) — operator-concern code lands in `packages/temporal-workflows/src/domain/review.ts`, `packages/temporal-workflows/src/workflows/pr-review.workflow.ts`. Mechanically necessary because there's nowhere else for it to go. The dev is doing it correctly _given current packaging_; the packaging is the problem.
- A future poly Phase 4 streaming workflow (task.0322) would land in shared land for the same reason. Inevitable accumulation.
- `single-node-scope` CI gate (task.0381) would have to add `packages/temporal-workflows/` to operator's territory — but operator doesn't own poly's mirror-coordinator. The gate has no clean answer today.

## Design questions to resolve

1. **Shared base shape.** What stays in `packages/temporal-workflows/`? Proposed: `GraphRunWorkflow`, ledger workflows, base activity-type contracts, deterministic helpers (`evaluateCriteria`, `aggregateGateStatuses`), `domain/review.ts` formatters that are policy-uniform across nodes (cross-domain refusal, no-scope neutral). Per-node workflows + their domain helpers move out.
2. **Per-node package layout.** `nodes/<X>/packages/temporal-workflows/` parallels existing `nodes/<X>/packages/{db-schema,ai-tools,doltgres-schema,knowledge}`. Same `package.json` / `tsup` shape. Same `@cogni/<X>-temporal-workflows` naming.
3. **Worker bundling.** Each node's scheduler-worker container needs to import its own per-node workflow package + the shared base. The `webpack` bundler step in scheduler-worker will need to be parameterized by nodeId (env-driven) so each container ships only what its node owns.
4. **GraphRun child invocation.** `PrReviewWorkflow` in `nodes/operator/packages/temporal-workflows` calls `GraphRunWorkflow` via `executeChild` — that name needs to be registered on whichever worker polls the right task queue. Either (a) GraphRun stays shared and every worker registers it, or (b) GraphRun moves per-node too. Recommend (a) — GraphRun is genuinely cross-cutting (ledger emission, virtual-key billing, etc.).
5. **Activity-type contracts.** `ReviewActivities` interface — does it live shared (so the workflow can reference the type) or move with the workflow? Recommend shared base + per-node augmentation, mirroring how `@cogni/db-client` exposes a base + per-node schemas extend it.
6. **Migration order.** Operator-owned workflows first (smaller, owns the most lines), then poly. Each move = its own PR with parity tests.

## Out of scope

- Migrating individual rule content (per-node `.cogni/rules/*`) — that's task.0410 + task.0407 territory.
- Per-node Temporal namespaces (still single namespace, queue-per-node isolation only — task.0280 stands).
- Per-node billing / virtual-key changes — separate concern.

## Files likely to touch

- `packages/temporal-workflows/src/workflows/` — workflows split out by ownership
- `packages/temporal-workflows/src/domain/` — domain helpers split (uniform stays, node-specific moves)
- `nodes/operator/packages/temporal-workflows/` — NEW
- `nodes/poly/packages/temporal-workflows/` — NEW
- `services/scheduler-worker/src/main.ts` + `worker.ts` — register per-node workflow bundle (env-driven by nodeId)
- `services/scheduler-worker/src/Dockerfile` — copy per-node packages into the build image
- `pnpm-workspace.yaml` — already globs `nodes/<X>/packages/*` (no change needed)
- `scripts/ci/detect-affected.sh` — ensure per-node temporal-workflows packages are scoped to their node's domain in `single-node-scope`
- `tests/ci-invariants/single-node-scope-meta.spec.ts` — add `nodes/<X>/packages/temporal-workflows/` to the per-node territory list

## Validation

- **exercise:** open a poly-only PR that adds a new Temporal workflow under `nodes/poly/packages/temporal-workflows/src/workflows/example.workflow.ts`. CI's `single-node-scope` job passes (no operator-territory edits). Operator's reviewer fires using `nodes/operator/packages/temporal-workflows`'s rules. After merge, candidate-a's poly scheduler-worker registers and successfully executes the new workflow; operator's worker does NOT register it (proves bundle isolation).
- **observability:** `scripts/loki-query.sh '{namespace=~"cogni-candidate-a", pod=~"scheduler-worker-.*"} | json | event="worker.lifecycle.ready"' 10 100` should show two distinct worker bundles per nodeId, with non-overlapping `registeredWorkflows` arrays for the per-node entries.

## Pointers

- [bug.0193 — original consolidation](bug.0193.worker-houses-workflow-definitions.md)
- [task.0410 — current reviewer-per-node-routing work, blocked on this](task.0410.reviewer-per-node-routing.md)
- [task.0407 — review.modelRef from repo-spec, parallel concern](task.0407.review-modelref-from-repo-spec.md)
- [PR #1080 — bug.0319 ai-tools-per-node fix, the precedent](https://github.com/Cogni-DAO/node-template/pull/1080)
