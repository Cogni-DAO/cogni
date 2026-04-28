---
id: task.0412
type: task
title: "PrReviewWorkflowInput Zod schema + contract test — fix modelRef-shape regression class"
status: needs_merge
priority: 0
rank: 1
estimate: 1
branch: feat/task-0412-pr-review-input-zod
summary: "Workflow input contracts drift between dispatch and route — PR #1067 fixed the modelRef instance, but the regression class survives. Add a single Zod schema for `PrReviewWorkflowInput` in `packages/temporal-workflows/`; convert dispatch + activity types to `z.infer<>`; add a round-trip contract test. ~150 lines, lands independently of any other in-flight VCS work. Highest-value cleanup that does NOT gate on test:external."
outcome: "(1) `PrReviewWorkflowInputSchema` (Zod) is the single source of truth for the workflow input shape. (2) `dispatch.server.ts`, `pr-review.workflow.ts`, and `services/scheduler-worker/src/activities/review.ts` all consume the type via `z.infer<typeof PrReviewWorkflowInputSchema>`; no manual TS interfaces duplicating the shape. (3) A round-trip contract test in `tests/unit/packages/temporal-workflows/` parses a fixture through `z.parse()` and asserts the dispatch-side payload + the activity-side input both validate. Future drift between dispatch and activity will fail the test before it ships."
spec_refs:
  - vcs-integration
  - temporal-patterns
assignees: derekg1729
credit:
project: proj.vcs-integration
pr: https://github.com/Cogni-DAO/node-template/pull/1109
reviewer:
revision: 2
blocked_by: []
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [vcs, review, temporal, contracts, zod]
external_refs:
  - work/items/task.0409.multi-tenant-git-review-routing.md
  - work/items/task.0408.split-temporal-workflows-per-node.md
---

## Problem

PR #1067 fixed a real bug where `pr-review.workflow.ts:131` sent `model: "gpt-4o-mini"` (legacy string) but the graphs runs route required `modelRef: { providerKey, modelId }` (post-tightening of `route.ts:475`). The workflow→activity contract was a plain TS interface, so the drift was invisible to the type system across the wire.

Same regression class survives — every field on `PrReviewWorkflowInput` is currently a manual TS interface in `packages/temporal-workflows/src/workflows/pr-review.workflow.ts` + a parallel definition in `nodes/operator/app/src/app/_facades/review/dispatch.server.ts`. Next time the input shape changes, we have ~80% chance of repeating the modelRef silent-drift bug.

## Approach

Add `PrReviewWorkflowInputSchema = z.object({...})` in `packages/temporal-workflows/`. Both producer (dispatch) and consumer (activity) use `z.infer<>`. Add a unit test that round-trips a fixture through `z.parse()` and asserts both call sites' payloads validate. The schema is the contract — TypeScript catches structural drift, the test catches semantic drift, and Zod runtime validation at the activity boundary catches anything that slipped through both.

## Files

- New: `packages/temporal-workflows/src/workflows/pr-review.schema.ts` — `PrReviewWorkflowInputSchema` (Zod) + exported type via `z.infer<>`.
- Modify: `packages/temporal-workflows/src/workflows/pr-review.workflow.ts` — consume the type, drop the manual TS interface.
- Modify: `nodes/operator/app/src/app/_facades/review/dispatch.server.ts` — consume the type via `z.infer<>` import; consider validating the args before `workflowClient.start(...)` for fail-fast at the dispatch boundary.
- Modify: `services/scheduler-worker/src/activities/review.ts` — activity input typed via `z.infer<>` (parses-or-throws on entry already by Temporal default; explicit `z.parse()` belt-and-suspenders).
- New: `tests/unit/packages/temporal-workflows/pr-review-input-contract.test.ts` — round-trip a fixture through the schema; assert dispatch payload + activity input both validate.

## Validation

- **exercise:** `pnpm vitest run tests/unit/packages/temporal-workflows/pr-review-input-contract.test.ts` — green. Then run `pnpm test:external:operator` to confirm the existing pr-review-e2e flow still passes against `derekg1729/test-repo` (or `Cogni-DAO/test-repo` after task.0409 lands).
- **observability:** No new Loki signal needed. The schema + test ARE the validation surface; CI green = invariant held.

## Plan

- [ ] **Checkpoint 1 — Zod schema + exported types**
  - Milestone: `PrReviewWorkflowInputSchema` exists in `packages/temporal-workflows/`. Existing manual TS interface replaced with `z.infer<>`. Type-only change; no runtime behavior change. Build + typecheck green.
  - Invariants: `SINGLE_INPUT_CONTRACT` (one Zod schema, no parallel TS definitions); `BACKWARD_COMPAT` (existing fields unchanged in shape).
  - Todos:
    - [ ] Create `packages/temporal-workflows/src/workflows/pr-review.schema.ts` with `PrReviewWorkflowInputSchema = z.object({...})` matching the current 9 fields (nodeId, owner, repo, prNumber, headSha, installationId, actorUserId, billingAccountId, virtualKeyId).
    - [ ] Export `PrReviewWorkflowInput` type from the schema file via `z.infer<>`.
    - [ ] Modify `packages/temporal-workflows/src/workflows/pr-review.workflow.ts:35` — drop the manual interface, import the type from the schema file.
    - [ ] Modify `packages/temporal-workflows/src/index.ts:56` — re-export from the schema location.
  - Validation/Testing:
    - [ ] Build green: `pnpm --filter @cogni/temporal-workflows build`.
    - [ ] Typecheck green: `pnpm --filter @cogni/temporal-workflows typecheck`.
    - [ ] Downstream typecheck: `pnpm --filter @cogni/scheduler-worker-service typecheck` (consumes the workflow type via activities).

- [ ] **Checkpoint 2 — Contract test**
  - Milestone: A round-trip Zod-parse contract test exists and passes. Future drift between the schema and any consumer fails this test.
  - Invariants: `CONTRACT_ENFORCED_BY_TEST` (a known-good fixture parses; a known-bad fixture rejects).
  - Todos:
    - [ ] Create `tests/unit/packages/temporal-workflows/pr-review-input-contract.spec.ts` — three cases: valid fixture parses; missing-field fixture rejects; wrong-type fixture rejects.
  - Validation/Testing:
    - [ ] unit: `pnpm vitest run tests/unit/packages/temporal-workflows/pr-review-input-contract.spec.ts` — 3/3 green.

- [ ] **Checkpoint 3 — Producer fail-fast (dispatch)**
  - Milestone: `dispatch.server.ts` validates the input via `z.parse()` before `workflowClient.start(...)`. Misshapen dispatch payloads fail loudly at the source instead of becoming an Activity-side `400` later.
  - Invariants: `DISPATCH_FAIL_FAST` (parse before start, throw on parse error, log structured error).
  - Todos:
    - [ ] Modify `nodes/operator/app/src/app/_facades/review/dispatch.server.ts` — import the schema, replace the inline arg object with `PrReviewWorkflowInputSchema.parse({...})` immediately before `workflowClient.start(...)`. Catch + log `parse-error` distinctly from `WorkflowExecutionAlreadyStartedError` already handled.
  - Validation/Testing:
    - [ ] unit: extend the contract test with one case asserting the dispatch payload (built from a synthetic webhook fixture) parses without error.
    - [ ] Repo typecheck: `pnpm --filter operator typecheck`.

- [ ] **Checkpoint 4 — Final gate**
  - Milestone: All work merged to checkpoint state; full `pnpm check` green; work item ready for closeout.
  - Invariants: All preceding invariants hold simultaneously.
  - Validation/Testing:
    - [ ] `pnpm lint:fix && pnpm format && pnpm check` — green.

## Dependencies & ordering

- **Lands BEFORE task.0409.** Per task.0409 review feedback: every PR that touches `PrReviewWorkflowInput` between now and this task is one more chance for the next modelRef-shape regression. Ship this first.
- **task.0411** (split temporal-workflows per-node, formerly numbered 0408) merged via PR #1098 alongside reviewer per-node routing. The schema therefore lives in shared `packages/temporal-workflows/` for now; if a future per-node split moves `PrReviewWorkflow` into `nodes/operator/packages/temporal-workflows/`, the schema relocates with it (mechanical rebase).

## Review Feedback (revision 2)

`/review-implementation` returned **REQUEST CHANGES** with three blocking issues + three suggestions. All addressed:

### Blocking (resolved in revision 2)

- **B1 — Stale base branch.** Branch `feat/task-0410-pr-review-input-zod` was based on `cb2d46355`; PR #1098 (`33aa1a003`) merged in between. Diff against current `origin/main` showed ~1100 lines of regressions. Rebased onto current `origin/main`. Auto-merge resolved code-side conflicts in `pr-review.workflow.ts` and `index.ts`; the only manual conflict was `_index.md` (regenerated post-rename).
- **B2 — Task ID collision.** PR #1098 renumbered the dev's `task.0403` → `task.0410` at merge, taking the ID. My filing renumbered to `task.0412` (next available — my originally-filed `task.0412` tenant-config-audit was dropped from PR #1098's merge, so the slot reopened). Branch renamed to `feat/task-0412-pr-review-input-zod`. References in `task.0407`, `task.0411`, this file, and the schema file's docstring updated to point at `task.0412`.
- **B3 — Missing ZodError handling in dispatch.** `dispatch.server.ts` now catches `ZodError` distinctly from `WorkflowExecutionAlreadyStartedError`, logs structured `issues` payload to Pino at `error` level with a separate message, and returns. Drift bugs are now queryable in Loki separately from infra failures.

### Suggestions (applied in revision 2)

- **S1 — `.strict()` on the schema.** `PrReviewWorkflowInputSchema` now uses `.strict()`. Typo'd field names (`virtualKeyld`) reject at parse time instead of being silently stripped. Added a dedicated test for this case + updated the unknown-field-stripping test to assert rejection.
- **S2 — Strengthened regression-class tests.** Replaced the misnamed "stray legacy field" test with two explicit cases: (a) string-in-place-of-int (the literal modelRef-shape pattern), (b) typo'd field name + missing required (the renamed-field pattern that `.strict()` closes).
- **S3 — `workflowId` template uses parsed input.** Now built from `workflowInput.*` (post-parse), not unparsed `ctx.*`. A future shape drift in `ctx` cannot bypass validation by routing through the workflowId template.

### Not addressed (filed as separate concerns)

- **S4 — zod 3.x vs 4.x split in monorepo.** Out of scope for this task. Filing a separate cleanup task once two more zod-using packages drift further apart.
