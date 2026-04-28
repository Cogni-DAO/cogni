---
id: task.0419
type: task
title: "PrReviewWorkflowInput Zod schema + contract test — fix modelRef-shape regression class"
status: done
priority: 0
rank: 1
estimate: 1
branch: feat/task-0415-pr-review-input-zod
summary: "Workflow input contracts drift between dispatch and route — PR #1067 fixed the modelRef instance, but the regression class survives. Add a single Zod schema for `PrReviewWorkflowInput` in `packages/temporal-workflows/`; convert dispatch + activity types to `z.infer<>`; add a round-trip contract test. ~150 lines, lands independently of any other in-flight VCS work. Highest-value cleanup that does NOT gate on test:external."
outcome: "(1) `PrReviewWorkflowInputSchema` (Zod) is the single source of truth for the workflow input shape. (2) `dispatch.server.ts`, `pr-review.workflow.ts`, and `services/scheduler-worker/src/activities/review.ts` all consume the type via `z.infer<typeof PrReviewWorkflowInputSchema>`; no manual TS interfaces duplicating the shape. (3) A round-trip contract test in `tests/unit/packages/temporal-workflows/` parses a fixture through `z.parse()` and asserts the dispatch-side payload + the activity-side input both validate. Future drift between dispatch and activity will fail the test before it ships."
spec_refs:
  - vcs-integration
  - temporal-patterns
assignees: derekg1729
credit:
project: proj.vcs-integration
pr: https://github.com/Cogni-DAO/node-template/pull/1111
reviewer:
revision: 3
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
- **B2 — Task ID collision.** PR #1098 renumbered the dev's `task.0403` → `task.0410` at merge, taking the ID. My filing renumbered to `task.0419` (next available — my originally-filed `task.0419` tenant-config-audit was dropped from PR #1098's merge, so the slot reopened). Branch renamed to `feat/task-0412-pr-review-input-zod`. References in `task.0407`, `task.0411`, this file, and the schema file's docstring updated to point at `task.0419`.
- **B3 — Missing ZodError handling in dispatch.** `dispatch.server.ts` now catches `ZodError` distinctly from `WorkflowExecutionAlreadyStartedError`, logs structured `issues` payload to Pino at `error` level with a separate message, and returns. Drift bugs are now queryable in Loki separately from infra failures.

### Suggestions (applied in revision 2)

- **S1 — `.strict()` on the schema.** `PrReviewWorkflowInputSchema` now uses `.strict()`. Typo'd field names (`virtualKeyld`) reject at parse time instead of being silently stripped. Added a dedicated test for this case + updated the unknown-field-stripping test to assert rejection.
- **S2 — Strengthened regression-class tests.** Replaced the misnamed "stray legacy field" test with two explicit cases: (a) string-in-place-of-int (the literal modelRef-shape pattern), (b) typo'd field name + missing required (the renamed-field pattern that `.strict()` closes).
- **S3 — `workflowId` template uses parsed input.** Now built from `workflowInput.*` (post-parse), not unparsed `ctx.*`. A future shape drift in `ctx` cannot bypass validation by routing through the workflowId template.

### Not addressed in revision 2 (rolled into revision 3)

- **S4 — zod 3.x vs 4.x split in monorepo.** Triggered the critical bug below; addressed inline in revision 3 (only this package's zod was bumped — broader monorepo unification still a separate task).

## Review Feedback (revision 3)

`/review-implementation` returned **REQUEST CHANGES** with one critical bug + four suggestions. All addressed:

### Critical (resolved)

- **B1 — Cross-package Zod-version `instanceof` failure.** revision 2 added `if (error instanceof ZodError)` in `dispatch.server.ts:158` to log structured Zod issues. Operator's `import { ZodError } from "zod"` resolved to `zod 4.3.6`; the schema in `@cogni/temporal-workflows` used `zod ^3.24.1` (resolved `3.25.76`). When the schema threw, the error class was zod 3's `ZodError` — `instanceof` (against zod 4's class) returned `false`. The whole structured-error log path was dead code. Verified via runtime test before fix:

  ```
  thrown class: ZodError
  instanceof ZodError (operator zod): false
  ```

  Fix: bumped `packages/temporal-workflows`'s `zod` from `^3.24.1` to `^4.1.12` (matches operator + node-contracts + node-shared). Re-verified post-fix:

  ```
  thrown class: ZodError
  instanceof ZodError (operator zod): true
  issues count: 9
  ```

- **B2 — Missing test for the dispatch-side ZodError handling.** Added `nodes/operator/app/tests/unit/app/_facades/review/zod-version-cross-package.spec.ts`. Single test: parses an empty payload through `PrReviewWorkflowInputSchema`, asserts the thrown error `instanceof ZodError` (operator's import) returns `true` and `.issues.length > 0`. This pins the cross-package version-parity invariant — any future regression where temporal-workflows' zod and operator's zod drift apart breaks this test before it ships.

### Suggestions (applied)

- **S1 — Reorganized test file.** Tests `rejects unknown fields under .strict()` and `rejects typo'd field name` moved out of the `valid inputs` describe block into `rejects misshapen inputs`. Added new `rejects misshapen numeric inputs` and `rejects format-violating strings` describe blocks for cleaner taxonomy.
- **S2 — Tightened schema field formats.** `nodeId`, `actorUserId`, `billingAccountId` use `z.string().uuid()`. `headSha` uses `z.string().regex(/^[a-f0-9]{40}$/)` (Git SHA-1 lowercase hex). Adds tests for non-UUID nodeId, malformed headSha, uppercase headSha.
- **S3 — Trimmed `SINGLE_INPUT_CONTRACT` spec invariant** in `temporal-patterns.md` from a 6-sentence paragraph to one sentence + reference. Matches the tightness of invariants #1-9.
- **S4 — Added boundary tests** for `prNumber: 0` and `installationId: 0` (edges of `.positive()`).

### Renumbering (B3 from this round)

PR #1107 (merge-queue tracking) merged `task.0412` and `task.0413` while this PR was in review. My filing renumbered `task.0412` → `task.0419` (next available). Branch renamed `feat/task-0412-*` → `feat/task-0415-*`. PR #1109 retitled to match.
