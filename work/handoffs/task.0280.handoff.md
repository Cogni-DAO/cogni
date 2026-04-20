---
id: handoff.task.0280
type: handoff
work_item_id: task.0280
status: active
created: 2026-04-19
updated: 2026-04-19
branch: worktree-task.0280-preview-handoff
last_commit: 27db31327ed5fb6aace76550f8d9b1fb4854ccff
---

# Handoff: task.0280 — scheduler-worker HTTP delegation

## Context

- PR #922 merged to `main` as `27db31327` at 2026-04-19 06:22Z. Closes [bug.0322](../items/bug.0322.cross-node-runs-visibility.md) and the related "chat is dead on poly/resy" symptom by removing the scheduler-worker's direct-DB write path and routing graph_runs/grants persistence through each node's internal HTTP API (plus per-node Temporal queues for failure isolation). See [task.0280 body](../items/task.0280.per-node-worker-db-isolation.md) for the design.
- Validated green end-to-end on candidate-a: bug.0322 regression closed at both API and DB layers, real LLM content on operator + poly, zero cross-contamination. See [PR #922 flight validation comment](https://github.com/Cogni-DAO/node-template/pull/922#issuecomment-4275333351).
- User reports chat is "still broken" on preview after merge. Investigation (below) shows **preview has not actually rolled task.0280 yet**. The fix is likely in-flight, not missing.

## Current State

- **Preview live revision**: `.promote-state/current-sha = c644f177` (2026-04-18, pre-merge of task.0280). Pods are 6h49m old, from the last successful promote on 2026-04-19 09:04Z.
- **task.0280 is NOT in that revision**: `git merge-base --is-ancestor 27db31327 c644f177` → false.
- **In-progress right now**: GitHub Actions `Promote and Deploy` workflow run [24633902426](https://github.com/Cogni-DAO/node-template/actions/runs/24633902426) dispatched at 16:36Z for `b24922b6` (main HEAD). `b24922b6` **does** include task.0280.
- **Recent pipeline failures** (explain why preview fell behind): Flight Preview failed on 2026-04-19 07:41Z (#918) and 08:52Z (bug.0328 fix) before recovering at 09:01Z. Those failures meant several main commits, including task.0280, never auto-dispatched to preview until the current manual promote.
- Preview Argo apps are `OutOfSync, Healthy` — same baseline drift as candidate-a; not a blocker.
- task.0280 work item is `status: needs_merge` (pre-merge state carried over into handoff); should flip to `done` + `deploy_verified: true` once preview validation passes.

## Decisions Made

- HTTP delegation via Option B, not N-DSN — see [task.0280 body §1–3](../items/task.0280.per-node-worker-db-isolation.md).
- Per-node Temporal queues + legacy drain; initContainer deleted — see [task.0280 body "Phase 2"](../items/task.0280.per-node-worker-db-isolation.md).
- Invariants codified in [docs/spec/multi-node-tenancy.md](../../docs/spec/multi-node-tenancy.md): `RUN_VISIBILITY_FOLLOWS_ORIGIN`, `SHARED_COMPUTE_HOLDS_NO_DB_CREDS`, `QUEUE_PER_NODE_ISOLATION`.
- bug.0322 defect #2 (cross-node bearer acceptance) intentionally deferred to a separate follow-up — data-plane isolation closes the actual leak; bearer-scope is orthogonal.

## Next Actions

- [ ] Monitor [Promote and Deploy run 24633902426](https://github.com/Cogni-DAO/node-template/actions/runs/24633902426) to completion; if it fails, read logs + file a bug.
- [ ] After deploy success, verify preview pods rolled: `kubectl -n cogni-preview get pods` → all < 10 min age, 0 restarts, running the new digest.
- [ ] Re-run the bug.0322 regression against preview (same script as candidate-a):
  - register machine agent on `poly-preview.cognidao.org`, fire chat, sleep 3, assert poly `/agent/runs` contains the run AND operator `/agent/runs` does not. See [scripts/ci/smoke-candidate.sh](../../scripts/ci/smoke-candidate.sh) for the exact flow.
- [ ] On validation: flip `task.0280.status: done` + `deploy_verified: true`, update `updated:` date, regenerate `work/items/_index.md` via `pnpm work:index`.
- [ ] File a CI/CD follow-up bug tracking the "failed flight-preview runs silently skip SHAs" class (bug.0328 was a related fix — check if this particular gap is still open).
- [ ] When follow-up capacity allows, pick up [task.0326](../items/task.0326.ledger-worker-db-isolation.md) (rename ledger `DATABASE_URL` → `LEDGER_DATABASE_URL`) and [task.0327](../items/task.0327.queue-drain-and-circuit-breaker.md) (legacy-queue drain + per-node HTTP circuit breaker).

## Risks / Gotchas

- **Don't re-validate chat on preview until after the in-progress promote completes.** Pods are old; they're still on `c644f177` which lacks the fix. "Chat is broken" right now is expected for that revision.
- **Worker still has `DATABASE_URL` in its Secret** pointing at `cogni_operator`. After this change the scheduler path ignores it; only the (dormant on preview) ledger path reads it. Not a bug, not a blocker — just noise until task.0326 renames the key.
- **Temporal workflow history-shape change**: `nodeId` was added to `createGraphRunActivity` / `updateGraphRunActivity` / `validateGrantActivity` inputs. Preview had 0 running workflows at pre-flight check, so cutover replay risk is effectively zero — but post-deploy, run `temporal workflow list --query 'ExecutionStatus="Failed" AND CloseTime > <cutover-ts>'` on preview to confirm no unexpected casualties.
- **Resy machine-agent register returns 401** — pre-existing, not caused by task.0280. Regression tests should skip resy or wait for resy auth to be wired.
- **Argo `OutOfSync` baseline drift** on preview exists independently of this PR. Don't let it mask a real sync failure after the promote lands — confirm `status.sync.revision` matches the expected `b24922b6`.

## Pointers

| File / Resource                                                                                                                    | Why it matters                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [PR #922](https://github.com/Cogni-DAO/node-template/pull/922)                                                                     | Merge commit `27db31327`. Full diff + validation comment.                   |
| [task.0280 body](../items/task.0280.per-node-worker-db-isolation.md)                                                               | Design: Option B, per-node queues, rollout semantics.                       |
| [bug.0322](../items/bug.0322.cross-node-runs-visibility.md)                                                                        | Symptom this closes.                                                        |
| [services/scheduler-worker/src/worker.ts](../../services/scheduler-worker/src/worker.ts)                                           | N+1 Worker spin-up; UUID filter; legacy drain.                              |
| [services/scheduler-worker/src/adapters/run-http.ts](../../services/scheduler-worker/src/adapters/run-http.ts)                     | HTTP adapters + retryable-status taxonomy.                                  |
| [services/scheduler-worker/src/activities/index.ts](../../services/scheduler-worker/src/activities/index.ts)                       | `translateHttpError`: 4xx permanent vs transient.                           |
| [nodes/\*/app/src/app/api/internal/graph-runs/](../../nodes/)                                                                      | New node-side internal endpoints (×4 nodes).                                |
| [docs/spec/multi-node-tenancy.md](../../docs/spec/multi-node-tenancy.md)                                                           | Invariants added in this PR.                                                |
| [docs/spec/scheduler.md](../../docs/spec/scheduler.md)                                                                             | Updated for HTTP delegation + per-node queues.                              |
| [scripts/ci/smoke-candidate.sh](../../scripts/ci/smoke-candidate.sh)                                                               | bug.0322 regression check (copy to preview smoke if not already symlinked). |
| `/Users/derek/dev/cogni-template/.local/preview-vm-key` + `…-ip`                                                                   | SSH access to preview VM (84.32.110.92) for read-only validation.           |
| [GH Actions run 24633902426](https://github.com/Cogni-DAO/node-template/actions/runs/24633902426)                                  | The in-progress promote that should land task.0280 on preview.              |
| [task.0326](../items/task.0326.ledger-worker-db-isolation.md) / [task.0327](../items/task.0327.queue-drain-and-circuit-breaker.md) | Follow-ups: ledger env rename, queue drain + circuit breaker.               |
