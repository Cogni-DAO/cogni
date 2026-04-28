---
id: task.0416
type: task
title: "Operator recovery from merge-queue cancellation: find + re-PR + re-queue dropped PRs"
status: needs_design
priority: 3
rank: 95
estimate: 2
summary: "When a repo admin cancels the merge queue (whole queue, not a single entry), GitHub closes every queued PR with no further action. Today there is no recovery — the dropped PRs are forgotten unless someone notices. The operator should detect this event, find the affected PRs, reopen them, and use judgement to decide whether to re-queue or hand back to author."
outcome: |
  - On a `merge_queue` cancellation event (or detected drop in queue depth without corresponding merges), operator enumerates PRs that were queued and are now closed-without-merge with merge_group activity in the recent past.
  - For each such PR: reopen it (`gh pr reopen`) and post a comment explaining what happened.
  - Per-PR judgement: re-enqueue automatically iff (a) PR was originally enqueued by an agent (operator can re-do that decision), (b) CI on PR head is still green, (c) no new commits to base since enqueue. Otherwise: leave reopened with the comment and let the author decide.
  - This runs as a low-priority operator task; not on the critical-path agentic loop. It's a recovery skill, not a primary capability.
spec_refs:
  - docs/spec/merge-queue-config.md
  - docs/spec/agentic-contribution-loop.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-28
updated: 2026-04-28
labels: [cicd, operator, merge-queue, recovery]
external_refs:
  - work/items/task.0391.enable-merge-queue.md
---

# task.0415 — Operator recovery from merge-queue cancellation

## Problem

When a repo admin cancels the merge queue on a branch (Settings → Branches → uncheck "Require merge queue", OR the whole-queue "Cancel" action), GitHub does the following:

- Every PR currently in the queue is **dropped** (state goes from queued back to open, OR the PR may be closed without merging depending on which UI action was used).
- No automatic notification to PR authors or to the operator.
- No retry semantics — the queue forgets the entries entirely.

This event happened during the merge-queue rollout (task.0391, PR #1083) — Derek cancelled the queue on `Cogni-DAO/test-repo` mid-experiment to clear stuck state. PR #53 had to be manually reopened. In a multi-PR steady state with external contributors, this would silently lose work.

## Outcome

The operator owns a recovery skill for "merge-queue cancellation events":

1. **Detect**: webhook listener (or polling) on `merge_queue` events, OR diff between expected queue depth (from operator's own enqueue records) and actual queue depth.
2. **Enumerate dropped PRs**: GraphQL `mergeQueue` history if available, otherwise correlate (a) recent `merge_group` workflow runs that didn't precede a `push:main`, with (b) PRs in `closed` or `open` state whose `headRefOid` matches.
3. **Reopen + comment**: `gh pr reopen` for any PRs found in `closed-without-merge` state. Comment template: "Operator detected merge-queue cancellation at <ts>. This PR was in the queue and got dropped. Reopened. Re-enqueue if appropriate."
4. **Re-queue with judgement**: enqueue iff:
   - The PR was originally enqueued by an agent (operator has the audit trail).
   - CI on the PR head is still green.
   - No new commits to base since the original enqueue (queue would re-rebase anyway, but spec'd as a sanity guard).
   - Otherwise: leave reopened with the comment, let the human / original agent decide.

## Why low-priority

- Merge-queue cancellation is rare (operator action, not a routine event).
- When it happens, there is usually a reason (admin debugging, infrastructure change, security incident) and auto-recovery may not be desired.
- A reopen + comment with a runbook link is most of the value; the auto-re-queue judgement is a v1.

## Out of scope

- Recovery from a single PR being kicked out of the queue (test failure on rebased candidate). That's normal queue behavior — the PR's checks fail, author/agent re-enqueues after fix. Different flow.
- Recovery from the queue being misconfigured (required check with no producing workflow). That's a configuration bug; covered by drift detection in `infra/github/README.md`.

## Validation

- exercise: cancel the merge queue on `Cogni-DAO/test-repo` while a PR is queued. Operator should detect within 5 minutes, reopen the PR, and post the recovery comment. If the PR's CI is still green and the PR was agent-enqueued, operator re-enqueues; otherwise leaves it open.
- observability: structured log event `merge_queue.cancellation.detected`, `merge_queue.cancellation.recovered` with PR numbers + decisions. Loki query: `{namespace="cogni-candidate-a"} | json | event=~"merge_queue.cancellation.*"`.

## PR / Links

- Filed on PR #1096 (chore/drop-stack-test-from-required) as a ride-along since the cancellation pattern was observed during that PR's rollout.
- Reference: [`docs/spec/merge-queue-config.md`](../../docs/spec/merge-queue-config.md) — the merge-queue policy this recovery skill defends.
