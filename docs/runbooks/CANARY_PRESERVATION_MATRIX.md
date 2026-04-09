---
id: canary-preservation-matrix
type: guide
title: Canary Preservation Matrix
status: active
trust: draft
summary: Snapshot of deployment health, dangling canary PRs, and local workspace preservation lanes during the 2026-04 canary stabilization window.
read_when: Freezing canary, preserving local work, or deciding what can safely merge after incident recovery.
owner: derekg1729
created: 2026-04-09
verified: 2026-04-09
tags: [canary, preservation, ci-cd, incident]
---

# Canary Preservation Matrix

This runbook captures the preservation state after the operator-canary rollback and before any further feature movement. It is intended to stop loss of work while keeping the branch and deployment lanes understandable.

## Deployment Matrix

| Surface | Current line | Status | Notes |
| --- | --- | --- | --- |
| Canary operator | `deploy/canary` @ `853a5bf7` | Recovering | Operator-only rollback to prod-stable app digest on top of canary deploy state |
| Canary poly | `deploy/canary` @ `853a5bf7` | Healthy | Intentionally unchanged during operator rollback |
| Canary resy | `deploy/canary` @ `853a5bf7` | Healthy | Intentionally unchanged during operator rollback |
| Preview operator | `deploy/preview` @ `fd02e2e5` | Broken for chat | Same promoted app line as canary, but env behavior still degraded |
| Preview poly | `deploy/preview` @ `fd02e2e5` | Broken for chat | Needs separate env/debug lane |
| Preview resy | `deploy/preview` @ `fd02e2e5` | Broken for chat | Needs separate env/debug lane |
| Production operator | `deploy/production` @ `fb50cc59` | Healthy | Trusted operator baseline during recovery |
| Production poly | `deploy/production` @ `fb50cc59` | Broken for chat | Do not use as health baseline |
| Production resy | `deploy/production` @ `fb50cc59` | Broken for chat | Do not use as health baseline |

## Deploy Branch Heads

| Branch | Head | Meaning |
| --- | --- | --- |
| `deploy/canary` | `853a5bf7` | Operator-only rollback to prod-stable digest |
| `deploy/preview` | `fd02e2e5` | Preview promoted to `6d901954` |
| `deploy/production` | `fb50cc59` | Production overlay follow-up on top of `be0a187f` promote line |

Recent deploy-state history:

```text
deploy/canary     853a5bf7 rollback: canary operator to prod-stable digest
deploy/canary     5b549d30 ops: bump canary operator memory limit 512Mi → 1Gi
deploy/canary     fd8d2dfe promote: canary 6d901954

deploy/preview    fd02e2e5 promote: preview 6d901954
deploy/preview    b11bdf61 ops: bump preview operator memory limit 512Mi → 1Gi

deploy/production fb50cc59 fix(k8s): remove migration stubs — poly/resy get real migrations
deploy/production 3600a857 promote: production be0a187f
```

## Canary PR Freeze List

The following PRs are still open against `canary` and should remain frozen until the preservation lanes are extracted or explicitly re-approved:

| PR | Branch | Title | Last updated | Preservation action |
| --- | --- | --- | --- | --- |
| [#838](https://github.com/Cogni-DAO/node-template/pull/838) | `feat/agent-failsafe` | `feat(agent-api): failsafe routes + agent discovery endpoints` | 2026-04-08 | Keep isolated in worktree only |
| [#836](https://github.com/Cogni-DAO/node-template/pull/836) | `fix/dry-local-ci-lint` | `fix(ci): align local check:fast with CI workspace lint` | 2026-04-08 | Hold until canary merge lane reopens |
| [#827](https://github.com/Cogni-DAO/node-template/pull/827) | `ui/operator-homepage-v3` | `feat(ui): operator homepage v3 — organic roots, emerald center, tighter trees` | 2026-04-08 | Treat as unrelated UI lane |
| [#810](https://github.com/Cogni-DAO/node-template/pull/810) | `fix/doltgres-provision-v2` | `fix(doltgres): pg_isready wait loop + idempotent dolt_commit + root dep` | 2026-04-07 | Preserve but do not merge during incident recovery |
| [#808](https://github.com/Cogni-DAO/node-template/pull/808) | `worktree-task-agent-api-keys` | `design(auth): agent API key auth — task.0300` | 2026-04-06 | Separate auth/design lane |
| [#805](https://github.com/Cogni-DAO/node-template/pull/805) | `bug/0300-codex-core-tool-bridge` | `fix(ai): P0 — Codex executor drops all core__ tools (bug.0300)` | 2026-04-07 | Preserve as independent bug lane |
| [#793](https://github.com/Cogni-DAO/node-template/pull/793) | `feat/sandbox-coding-agents` | `feat(sandbox): aider + opencode coding agent containers` | 2026-04-06 | Frozen during canary stabilization |
| [#772](https://github.com/Cogni-DAO/node-template/pull/772) | `feat/canary-doltgres` | `feat(infra): doltgres for canary — compose service + k8s bridge` | 2026-04-06 | Frozen during canary stabilization |

## Local Workspace Preservation Map

The local primary workspace is not safe to keep using for new implementation work.

| Area | State | Preservation action |
| --- | --- | --- |
| Current branch | `feat/agent-first-api-canary` ahead 9 / behind 4 vs `origin/canary` | Do not develop further here |
| Dirty tracked files | `.claude/skills/devops-expert/SKILL.md`, `.gitignore`, `e2e/AGENTS.md`, `playwright.config.ts`, `work/projects/proj.cicd-services-gitops.md`, deleted `e2e/tests/smoke/chat-model-selection.spec.ts` | Extract by lane; do not mix into deploy recovery |
| Dirty untracked files | `docs/guides/pr-screenshots.md`, `e2e/tests/full/chat-model-selection.spec.ts`, `work/handoffs/deploy-infra-ordering.handoff.md`, `work/items/bug.0306.github-oauth-multi-node-callback-mismatch.md`, `.pnpm-store/` | Preserve docs/work items; ignore local cache |
| Local preservation lane | `docs/e2e` | Needs its own draft PR from clean branch |
| Local preservation lane | `bug.0306-auth` | Needs its own draft PR from `main` |
| Local-only junk | `.pnpm-store/`, Python `__pycache__`, local ignore changes | Keep out of preservation PRs |

## Active Worktrees

These worktrees currently hold meaningful or reviewable work and should not be assumed merged:

| Worktree | Branch | Meaning |
| --- | --- | --- |
| `.worktrees/canary-operator-rollback` | `deploy-canary-operator-rollback` | Operator-only rollback lane already pushed to `deploy/canary` |
| `.worktrees/agent-failsafe` | `feat/agent-failsafe` | Open canary PR #838 |
| `.worktrees/dry-local-ci-lint` | `fix/dry-local-ci-lint` | Open canary PR #836 |
| `.worktrees/pr-828` | `pr-828` | Preserved review lane |
| `/private/tmp/worktree-docs` | `docs/ci-cd-spec-update` | Existing docs lane not yet merged |

## Preservation Rules

1. Do not merge unrelated canary PRs while canary recovery is still being validated.
2. Preserve important work in reviewable branches or PRs, not only in dirty local markdown files.
3. Treat `bug.0306` as its own branch and PR from `main`, not from canary.
4. Keep deploy-state edits on `deploy/*` branches separate from app-code branches.
