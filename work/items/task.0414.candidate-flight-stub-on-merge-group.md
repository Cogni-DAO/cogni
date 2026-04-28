---
id: task.0414
type: task
title: "Promote candidate-flight to required-on-PR via stub-job pattern (REPORT_OR_DON'T_REQUIRE)"
status: needs_design
priority: 2
rank: 70
estimate: 2
summary: "candidate-flight is the contract gate for external-agent contributions — every PR must dispatch `/vcs/flight` and pass. Today it is NOT in branch protection's required-status set because it would block the merge queue (no `merge_group:` trigger; queue would wait forever). Apply STUB_JOB_FOR_PR_INTENT pattern from `merge-queue-config.md`: add `merge_group:` trigger to candidate-flight.yml + passthrough job that emits success on merge_group, then add `candidate-flight` to required-status-checks."
outcome: |
  - `.github/workflows/candidate-flight.yml` gains a `merge_group:` trigger.
  - A new `candidate-flight` job (or rename one of the existing summary jobs) runs on both events. On `workflow_dispatch` (real flight): runs the existing flight logic and emits success/failure based on actual flight outcome. On `merge_group`: emits success immediately with a log line: "PR-time flight already validated; not re-flighting on queue ref."
  - `infra/github/branch-protection.json` adds `candidate-flight` to `required_status_checks.contexts`. Required set becomes: `unit, component, static, manifest, candidate-flight`.
  - `setup-main-branch.sh` re-applied; verify expected contexts via the README's drift-detection diff.
  - Update `docs/spec/merge-queue-config.md` Pending section: move `candidate-flight` from "Pending — task.0414" to the canonical required-set table, with workflow column noting "stub passthrough on merge_group".
  - `STUB_JOB_FOR_PR_INTENT` invariant gains its first live consumer.
spec_refs:
  - docs/spec/merge-queue-config.md
  - docs/spec/agentic-contribution-loop.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-28
updated: 2026-04-28
labels: [cicd, branch-protection, merge-queue, candidate-flight, stub-job]
external_refs:
  - work/items/task.0391.enable-merge-queue.md
  - work/items/task.0384.vcs-flight-endpoint.md
---

# task.0414 — candidate-flight as required-on-PR via stub-job pattern

## Problem

External-agent contributions are required to flight on candidate-a (`POST /api/v1/vcs/flight`) and pass before merge. This is the contract enforced in `agentic-contribution-loop.md` § Step 7. Today, branch protection does NOT include `candidate-flight` in its required-status-checks set — agents can technically merge without flighting (operator/reviewer enforces it via PR comment, not via gate).

We can't simply add `candidate-flight` to `required_status_checks.contexts` because:

- `candidate-flight.yml` triggers on `workflow_dispatch:` only, not `merge_group:`.
- Per `REPORT_OR_DON'T_REQUIRE` (validated 2026-04-28 on `Cogni-DAO/test-repo` PR #53), GH's merge queue waits forever for required checks whose workflows lack `merge_group:`.
- And we don't WANT to flight the queue's rebased SHA: it differs from the PR head, the candidate-slot lease is single-tenant, re-flighting wastes a deploy.

## Outcome

Apply `STUB_JOB_FOR_PR_INTENT` from `docs/spec/merge-queue-config.md`:

1. Add `merge_group:` trigger to `.github/workflows/candidate-flight.yml`.
2. Restructure: existing flight logic runs on `workflow_dispatch:` only (`if: github.event_name == 'workflow_dispatch'`). New job `candidate-flight` (one job, single context name) runs on both events. On dispatch: the real flight outcome rolls up. On merge_group: passthrough success.
3. Add `candidate-flight` to `infra/github/branch-protection.json` required-status-checks.
4. Re-apply via `setup-main-branch.sh`. Verify via the README diff.
5. Update `merge-queue-config.md`: promote `candidate-flight` from "Pending" to the canonical required-set table; document it as the first live `STUB_JOB_FOR_PR_INTENT` consumer.
6. Add a meta-test (or workflow lint) that pins the invariant: any context in `required_status_checks.contexts` MUST be produced by a workflow with both `pull_request:` (or `workflow_dispatch:` for dispatched-only checks) AND `merge_group:` triggers. Prevents future regressions of the bug observed in PR #1083.

## Out of scope

- Auto-flighting on PR open (today: agent dispatches manually). That's a separate UX question.
- Replacing the candidate-slot single-tenant lease. That's a deeper architectural change.

## Validation

- exercise: open a no-op docs PR. Confirm `candidate-flight` shows as "expected" required check until the agent runs `/vcs/flight`. Confirm flight green → enqueue → queue's `merge_group` event fires the passthrough job → success → queue completes. Compare two SHAs: the PR head SHA (what was actually flighted) vs the merge_group's `github.sha` (what the queue tested). Different SHAs; only the former had a real candidate-a deploy.
- observability: `candidate-flight.yml` run logs on the `merge_group` event show the passthrough message ("PR-time flight already validated; not re-flighting on queue ref") and zero candidate-a-deploy work.

## PR / Links

- Pre-requisite: PR #1096 lands first (introduces `merge-queue-config.md` spec + the STUB_JOB_FOR_PR_INTENT invariant this task implements).
- Related: task.0384 (vcs-flight endpoint), task.0391 (merge-queue rollout).
