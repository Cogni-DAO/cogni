---
id: task.0368
type: task
title: "Reviewer adapter-boundary contract test — lock ReviewHandlerDeps before per-node scoping refactor"
status: needs_merge
priority: 1
rank: 1
estimate: 1
summary: "Add a fake-deps unit test against review-handler.ts that exercises all 8 callable members of ReviewHandlerDeps (executor, log, createCheckRun, updateCheckRun, gatherEvidence, postPrComment, readRepoSpec, readRuleFile) across happy-path, threshold-fail, empty-gates, and evidence-error scenarios, asserting the verdict pipeline calls updateCheckRun + postPrComment with the contract-conforming arguments. Locks the adapter boundary before the per-node rule scoping refactor so AI PRs cannot silently break it."
outcome: "When the per-node rule scoping refactor lands (factory takes nodeBasePath, model moves to repo-spec, nodeId threads through), any drift in the ReviewHandlerDeps interface or the ReviewResult/EvaluationOutputSchema contracts fails this test before review. AI-authored PRs touching the reviewer pipeline are mechanically gated on the existing structural contract, not on Derek catching it at self-review."
spec_refs:
  - vcs-integration
assignees: []
project: proj.vcs-integration
branch: test/task-reviewer-adapter-contract
pr: https://github.com/Cogni-DAO/node-template/pull/1052
reviewer:
revision: 2
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

The next planned change to the reviewer is the per-node rule scoping refactor: parameterize `review-adapter.factory.ts:62-65` with `nodeBasePath`, thread `PrReviewWorkflowInput.nodeId` (currently decorative — present at pr-review.workflow.ts:35 but unused) through the activity payload, and _populate_ `ReviewHandlerDeps.reviewModel` (already an optional dep field at review-handler.ts:43, currently unwired) from a per-node repo-spec field. Without a unit-level lock on the adapter boundary, that refactor lands without a regression net — and the AI contributors expected to flow through this pipeline have no machine-readable gate against drifting the interface.

This task is the **prerequisite gate**. Land it first, alone, on its own branch. Subsequent refactor PRs run against this test suite.

## Design

### Outcome

The `ReviewHandlerDeps` interface and the `ReviewResult` / `EvaluationOutputSchema` contracts are mechanically locked: any drift fails a fast unit test in CI, before code review, before e2e, before flight.

### Approach

**Solution**: One vitest unit test file at `nodes/operator/app/tests/unit/features/review/review-handler.test.ts` (centralized layout, sibling to `gate-orchestrator.test.ts`). Constructs a fake `ReviewHandlerDeps` (in-memory implementations covering all 8 callable members: `executor`, `log`, `createCheckRun`, `updateCheckRun`, `gatherEvidence`, `postPrComment`, `readRepoSpec`, `readRuleFile` — plus the data fields `virtualKeyId` and optional `reviewModel`). `handlePrReview` returns `Promise<void>`; the verdict is observable only via the arguments passed to `updateCheckRun(owner, repo, checkRunId, conclusion, summary)` and `postPrComment(...)`. All assertions spy on those call arguments.

Four scenarios against the real handler:

1. **Happy path** — fake `gatherEvidence` returns a known PR; fake `executor.runGraph` returns a `GraphExecutorPort` envelope whose structured output conforms to `EvaluationOutputSchema` with metric scores above `success_criteria` thresholds; fake `readRepoSpec` returns yaml with one ai-rule gate; fake `readRuleFile` returns a rule yaml with `success_criteria`. Assert: `createCheckRun` called once; `updateCheckRun` called once with `conclusion === "pass"` and a summary string built by `formatCheckRunSummary`; `postPrComment` called once with `expectedHeadSha === ctx.headSha`.
2. **Threshold fail** — same setup, scores below `success_criteria`. Assert: `updateCheckRun` called with `conclusion === "fail"`; summary string contains the failing metric name; `postPrComment` called once.
3. **Empty gates short-circuit** (review-handler.ts:118-137) — `readRepoSpec` returns yaml with `gates: []`. Assert: `updateCheckRun` called with `"pass"` + the literal "No review gates configured." string; `executor.runGraph` **never** called; `postPrComment` **never** called; `gatherEvidence` called once (the early return is post-evidence). Locks the empty-config contract.
4. **Evidence-gatherer error path** (review-handler.ts:224-247) — `gatherEvidence` throws. Assert: `updateCheckRun` called with `conclusion === "neutral"` and a summary containing the error message; `postPrComment` **never** called; `executor.runGraph` **never** called. This is the only path that exercises `updateCheckRun(..., "neutral", ...)`, and locks the failure-mode contract.

A fifth assertion at the end of the file: every callable member of `ReviewHandlerDeps` was invoked at least once across the four scenarios. Removing or renaming a dep method breaks this before production. This is the antifragile bit.

No GitHub. No LLM. No Octokit. No filesystem. Pure dependency injection against the existing handler signature.

**Fixture surface (don't underestimate)**:

- `readRepoSpec` / `readRuleFile` return strings that must round-trip through the real `parseRepoSpec` / `extractGatesConfig` / `parseRule` Zod parsers from `@cogni/repo-spec` — fixtures are real yaml, not arbitrary text. Lift minimal valid examples from existing operator `.cogni/repo-spec.yaml` and `.cogni/rules/*.yaml`.
- `executor.runGraph` must return the full `GraphExecutorPort.runGraph` envelope, not just the inner structured-output payload. Match the port's actual return type from `@/ports`.
- `log` is a real `pino` Logger (or `pino().child(...)`-compatible stub) — the handler calls `deps.log.child({...})` at line 85.

**Reuses**:

- Existing `ReviewHandlerDeps` interface (review-handler.ts:38-73) — already a port shape, just needs to be exercised
- Existing `EvaluationOutputSchema` Zod schema (ai-rule.ts:29-38) — fakes use it to build fixture LLM outputs
- Existing `ReviewResult` / `GateResult` types (types.ts:17-31) — assertions reference these directly via `formatCheckRunSummary` output
- vitest fake-deps patterns from sibling tests in `tests/unit/features/review/` (`gate-orchestrator.test.ts`, `ai-rule-evaluate.test.ts`, `criteria-evaluator.test.ts`)
- `pnpm test` / `pnpm test:ci` already include this directory; runs in PR CI without config change

**Rejected**:

- _Mocking Octokit at the SDK level_ — defeats the purpose. The point is to test the seam, not the implementation behind it.
- _Spinning up a fake GitHub server (msw, nock)_ — adds a layer the handler doesn't see anyway. Wrong altitude.
- _Adding contract tests for each adapter individually_ (check-run, pr-comment, evidence-gatherer) — those are GitHub-specific I/O; their failure modes are GitHub API drift, not interface drift. Out of scope for this task; covered by the e2e test which exercises real GitHub.
- _Asserting against `handlePrReview`'s return value_ — it returns `Promise<void>`. The verdict only escapes through `updateCheckRun` + `postPrComment` arguments. Spy on those.
- _Bundling this with the per-node scoping refactor in one PR_ — defeats the lock. The test must land first, on green main, so the refactor runs against a known-good gate.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **REVIEWER_PORT_LOCKED**: All 8 callable members of `ReviewHandlerDeps` (review-handler.ts:38-73) — `executor`, `log`, `createCheckRun`, `updateCheckRun`, `gatherEvidence`, `postPrComment`, `readRepoSpec`, `readRuleFile` — must be invoked at least once across the four scenarios. Adding/removing/renaming a method requires updating this test.
- [ ] **VERDICT_CONTRACT_LOCKED**: Test assertions reference `ReviewResult` and `EvaluationOutputSchema` by import — schema drift breaks the test (spec: vcs-integration).
- [ ] **NO_REAL_IO**: Test must not import Octokit, hit network, read filesystem outside of vitest fixtures, or invoke a real LLM. Pure DI fakes.
- [ ] **SIMPLE_SOLUTION**: One test file. No new abstractions, no new ports, no helper packages. Reuses existing types verbatim.
- [ ] **ARCHITECTURE_ALIGNMENT**: Test lives at `nodes/operator/app/tests/unit/features/review/review-handler.test.ts`, matching the centralized test layout used by sibling review tests (`gate-orchestrator.test.ts`, `ai-rule-evaluate.test.ts`, `criteria-evaluator.test.ts`, etc.). `nodes/operator/app/vitest.config.mts` only picks up `tests/unit/**` — co-located tests under `src/` would silently not run (spec: architecture, ref: test-expert skill).
- [ ] **GATE_BEFORE_REFACTOR**: This task ships alone, on `test/task-reviewer-adapter-contract`, before any per-node scoping change. Subsequent PRs run against the locked gate.

### Files

<!-- High-level scope -->

- Create: `nodes/operator/app/tests/unit/features/review/review-handler.test.ts` — fake-deps contract test, four scenarios + dep-invocation assertion, ~200 lines (fixtures push the count above the original 150 estimate). Sits next to existing review unit tests (`gate-orchestrator.test.ts` et al.). The whole task.
- Modify: none. (No production code changes. No spec changes — tonight's cut locks the contract; it does not change it.)

### Follow-on work

The per-node rule scoping refactor and any spec updates land as **separate `task.*` items**, created at `needs_design` after this gate is green. They are intentionally not designed here — embedding their design in this execution item violates content boundaries and prevents independent review. **`docs/spec/node-ci-cd-contract.md` is not the right home** for any of it; the review pipeline architecture lives in `docs/spec/vcs-integration.md`.

## Validation

```yaml
exercise: |
  cd nodes/operator/app && pnpm vitest run tests/unit/features/review/review-handler.test.ts
observability: |
  Test output shows four passing scenarios + the dep-invocation assertion. CI unit job
  (`pnpm test:ci`, wired in `.github/workflows/ci.yaml`) picks the file up automatically
  via the operator vitest `tests/unit/**` include glob — no config change needed.
```
