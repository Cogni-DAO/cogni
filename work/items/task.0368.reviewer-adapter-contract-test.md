---
id: task.0368
type: task
title: "Reviewer adapter-boundary contract test — lock ReviewHandlerDeps before per-node scoping refactor"
status: needs_implement
priority: 1
rank: 1
estimate: 1
summary: "Add a fake-deps unit test against review-handler.ts that exercises every ReviewHandlerDeps method (executor, createCheckRun, gatherEvidence, postPrComment, readRepoSpec, readRuleFile) and asserts the verdict pipeline produces a contract-conforming ReviewResult. Locks the adapter boundary before the per-node rule scoping refactor so AI PRs cannot silently break it."
outcome: "When the per-node rule scoping refactor lands (factory takes nodeBasePath, model moves to repo-spec, nodeId threads through), any drift in the ReviewHandlerDeps interface or the ReviewResult/EvaluationOutputSchema contracts fails this test before review. AI-authored PRs touching the reviewer pipeline are mechanically gated on the existing structural contract, not on Derek catching it at self-review."
spec_refs:
  - vcs-integration
assignees: []
project: proj.vcs-integration
branch: test/task-reviewer-adapter-contract
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-25
updated: 2026-04-25
labels: [vcs, ai, review, test, contract]
---

# Reviewer Adapter-Boundary Contract Test

## Problem

The AI PR reviewer pipeline (`nodes/operator/app/src/features/review/services/review-handler.ts`) is architecturally clean — feature layer is VCS-agnostic, all GitHub I/O is behind the `ReviewHandlerDeps` interface (review-handler.ts:38-73), and the verdict shape is a Zod-validated structured output (`EvaluationOutputSchema` ai-rule.ts:29-38, `ReviewResult` types.ts:17-31).

But the entire boundary is **untested at unit level**:

- `review-handler.ts` itself — no unit test for the orchestration flow
- `review-adapter.factory.ts` — no test for adapter creation
- `check-run.ts`, `evidence-gatherer.ts`, `pr-comment.ts` — no unit tests
- `dispatch.server.ts` (facade) — no test

The only end-to-end coverage is `pr-review-e2e.external.test.ts` — a full-stack test that needs real GitHub credentials, a running app, LiteLLM, and the smee webhook relay. It runs in CI only.

The next planned change to the reviewer is the per-node rule scoping refactor: parameterize `review-adapter.factory.ts:62-65` with `nodeBasePath`, thread `PrReviewWorkflowInput.nodeId` (currently decorative — present at pr-review.workflow.ts:35 but unused) through the activity payload, and move the hardcoded `DEFAULT_REVIEW_MODEL = "gpt-4o-mini"` (review-handler.ts:32) into the per-node repo-spec. Without a unit-level lock on the adapter boundary, that refactor lands without a regression net — and the AI contributors expected to flow through this pipeline have no machine-readable gate against drifting the interface.

This task is the **prerequisite gate**. Land it first, alone, on its own branch. Subsequent refactor PRs run against this test suite.

## Design

### Outcome

The `ReviewHandlerDeps` interface and the `ReviewResult` / `EvaluationOutputSchema` contracts are mechanically locked: any drift fails a fast unit test in CI, before code review, before e2e, before flight.

### Approach

**Solution**: One vitest unit test file alongside `review-handler.ts`. Constructs a fake `ReviewHandlerDeps` (in-memory implementations of all six dependencies). Exercises three scenarios against the real handler:

1. **Happy path** — fake `gatherEvidence` returns a known PR; fake `executor.runGraph` returns a fixed structured output conforming to `EvaluationOutputSchema`; fake `readRepoSpec` / `readRuleFile` return canned yaml with one ai-rule gate. Assert: handler calls `createCheckRun` once with status `pass`, calls `postPrComment` once, returns a `ReviewResult` whose `gateResults[].metrics` round-trip the LLM scores.
2. **Gate failure aggregation** — same setup but executor returns scores below `success_criteria` thresholds. Assert: `conclusion: "fail"`, check run summary contains the failing metric, PR comment posts.
3. **Adapter contract surface** — assert that every method on `ReviewHandlerDeps` is invoked at least once across the two scenarios. This is the antifragile bit: removing or renaming a dep method breaks the test before it breaks production.

No GitHub. No LLM. No Octokit. No filesystem. Pure dependency injection against the existing handler signature.

**Reuses**:

- Existing `ReviewHandlerDeps` interface (review-handler.ts:38-73) — already a port shape, just needs to be exercised
- Existing `EvaluationOutputSchema` Zod schema (ai-rule.ts:29-38) — fakes use it to build fixture LLM outputs
- Existing `ReviewResult` / `GateResult` types (types.ts:17-31) — assertions reference these directly
- vitest patterns from `gate-orchestrator.test.ts` (already next to the handler, same fake-deps style)

**Rejected**:

- _Mocking Octokit at the SDK level_ — defeats the purpose. The point is to test the seam, not the implementation behind it.
- _Spinning up a fake GitHub server (msw, nock)_ — adds a layer the handler doesn't see anyway. Wrong altitude.
- _Adding contract tests for each adapter individually_ (check-run, pr-comment, evidence-gatherer) — those are GitHub-specific I/O; their failure modes are GitHub API drift, not interface drift. Out of scope for this task; covered by the e2e test which exercises real GitHub.
- _Bundling this with the per-node scoping refactor in one PR_ — defeats the lock. The test must land first, on green main, so the refactor runs against a known-good gate.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **REVIEWER_PORT_LOCKED**: Every method on `ReviewHandlerDeps` (review-handler.ts:38-73) must be invoked by the test suite. Adding/removing/renaming a method requires updating this test.
- [ ] **VERDICT_CONTRACT_LOCKED**: Test assertions reference `ReviewResult` and `EvaluationOutputSchema` by import — schema drift breaks the test (spec: vcs-integration).
- [ ] **NO_REAL_IO**: Test must not import Octokit, hit network, read filesystem outside of vitest fixtures, or invoke a real LLM. Pure DI fakes.
- [ ] **SIMPLE_SOLUTION**: One test file. No new abstractions, no new ports, no helper packages. Reuses existing types verbatim.
- [ ] **ARCHITECTURE_ALIGNMENT**: Test lives next to the handler (`nodes/operator/app/src/features/review/services/review-handler.test.ts`), matching the co-located test convention used by `gate-orchestrator.test.ts` (spec: architecture).
- [ ] **GATE_BEFORE_REFACTOR**: This task ships alone, on `test/task-reviewer-adapter-contract`, before any per-node scoping change. Subsequent PRs run against the locked gate.

### Files

<!-- High-level scope -->

- Create: `nodes/operator/app/src/features/review/services/review-handler.test.ts` — fake-deps contract test, three scenarios, ~150 lines. The whole task.
- Modify: none. (No production code changes. No spec changes — tonight's cut locks the contract; it does not change it.)

### Out of scope (follow-on tasks)

These are the planned next moves, **not in this task**:

1. `review-adapter.factory.ts` takes `nodeBasePath` parameter; resolution helper `nodeId → repo-spec.nodes[].path → join(repoRoot, path, ".cogni")` with fallback to `repoRoot/.cogni`.
2. `PrReviewWorkflowInput.nodeId` threads through activity payload to handler dep construction.
3. `DEFAULT_REVIEW_MODEL` becomes a fallback; per-node repo-spec gets optional `review.model:` field.
4. L4 convention test: every node in root repo-spec registry has a resolvable `.cogni/` or explicit `review: inherit`.
5. `docs/spec/vcs-integration.md` update to document the per-node rule scoping behavior (only after #1 lands).

Each of those is a separate task. None blocks the others once this contract test is green. **`docs/spec/node-ci-cd-contract.md` is NOT updated by any of this work** — that spec covers CI workflows and merge gates, not the operator's review pipeline. The review pipeline architecture lives in `docs/spec/vcs-integration.md`.

## Validation

```yaml
exercise: |
  cd nodes/operator/app && pnpm vitest run src/features/review/services/review-handler.test.ts
observability: |
  Test output shows three passing scenarios. Coverage report confirms every method on
  ReviewHandlerDeps is invoked at least once. CI unit job (`pnpm test:ci`) includes the
  new test on PR.
```
