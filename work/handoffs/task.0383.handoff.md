---
id: task.0383.handoff
type: handoff
work_item_id: task.0383
status: active
created: 2026-04-26
updated: 2026-04-26
branch: chore/cicd-followups-merge-queue
last_commit: edd3b9af5
---

# Handoff: task.0383 — Enable GitHub Merge Queue on main

## Context

- Today's prod promote of #1070 surfaced a real ordering bug: #1033 squash-merged at a PR-head SHA whose last main-rebase predated #1070, silently rolling back #1070's race guards in `deploy/preview-poly` until #1072 (rebased on top of everything) landed. ~30 min of preview drift; almost shipped to prod without #1070.
- This is at least the second instance — see memory note on PR #924 stale-build for the prior occurrence. Branch protection's `Require branches to be up-to-date` toggle was previously evaluated and rejected: it creates rebase thrash that's hostile to external contributors (every merge invalidates every open PR's up-to-date status). Empowering external contributors is the project's stated next milestone.
- GitHub Merge Queue is the same defense without the manual-rebase tax: contributors push to a queue, GH auto-rebases on top of current main, re-runs required checks against the rebased commit, merges in order on green.
- Work item filed on PR [#1076](https://github.com/Cogni-DAO/node-template/pull/1076) (chore/cicd-followups-merge-queue branch). Task body has the full reasoning + recommended required-check set.
- The MVP-stage memory note explicitly cautions against "platform-grade" infra like Merge Queue. That note was written before the bug class repeated. Today's incident moved Merge Queue from aspirational to fixing-a-problem-we-have. Task body documents the pivot.

## Current State

- `task.0383` work item exists in main at `work/items/task.0383.enable-merge-queue.md` after #1076 merges.
- No code work started.
- `bug.0382` (deploy-infra ordering race) filed on the same PR for separate triage — not blocking task.0383, lower priority.
- Today's CICD shape on main: per-node matrix flights (#1062), Axiom 19 + 20 enforcement (resolve-cell-state.sh, aggregate-decide-outcome.sh), wait-for-in-cluster-services.sh scoped to PROMOTED_APPS (#1073). All ~131s/cell on real rollouts. Stable enough to layer Merge Queue on top of.

## Decisions Made

- **Merge Queue chosen over `Require up-to-date branches`** — external contributor experience is the deciding factor. Validated via lived friction.
- **Required-check set: fast subset of `pnpm check:fast`** (typecheck + lint + format + unit) **plus `pr-build` matrix manifest**. NOT the full `pnpm check:full` (~20min). Rationale in `work/items/task.0383.enable-merge-queue.md` outcome section.
- **Branch-protection config exported to git** at the time of enablement (e.g. `infra/github/branch-protection.yaml` via `gh api repos/<owner>/<repo>/branches/main/protection`). Today's config is GH-UI-only — one wrong admin click and it's gone.
- **No interaction with candidate-flight / flight-preview** — those run post-merge; Merge Queue is pre-merge.

## Next Actions

- [ ] Wait for #1076 to merge (the work item file lands on main).
- [ ] Confirm with Derek which fast-check subset to declare as required-status. Default proposal in the task body — pushback welcome before locking in.
- [ ] Configure GitHub Merge Queue on `main` via repo Settings → Branches → branch protection rule. Document the exact toggle path in the contributor-flow doc.
- [ ] Export current branch-protection config: `gh api repos/Cogni-DAO/node-template/branches/main/protection > infra/github/branch-protection.yaml` (or chosen path). Commit as part of this PR so the config is git-tracked.
- [ ] Write `docs/guides/contributor-flow.md` (or extend `developer-setup.md`) — describe the queue path: open PR → reviewers approve → "Merge when ready" → GH handles rebase + re-test. ≤30 lines.
- [ ] Live test: open a no-op docs PR, merge via queue, confirm GH auto-rebases + re-runs required checks. Open a second PR while the first is queued, confirm serialization works.
- [ ] Update `work/items/task.0383.enable-merge-queue.md` `## Validation` block with the actual exercise + observability output post-enablement.

## Risks / Gotchas

- **Required-status definition is the load-bearing decision.** If the fast-subset misses a regression class (e.g. stack-test catching a contract drift), regressions land on main. Watch the first 1-2 weeks of merge-queue traffic; tighten if needed. Don't pre-tune.
- **GH branch-protection is admin-only.** The actual toggle requires repo admin. Agent cannot self-serve — escalate to Derek when ready to flip.
- **Existing PRs in flight at enablement time** will need a one-shot rebase to participate in the queue. Not a blocker; flag in the contributor doc.
- **`Cogni-DAO` org plan must include Merge Queue.** Free for public repos; included in Team/Enterprise plans for private. Verify before scheduling enablement.
- **Don't enable Merge Queue and `Require up-to-date branches` at the same time** — they conflict. Pick Merge Queue; document why in the branch-protection yaml comment.

## Pointers

| File / Resource                                                                                                                                                              | Why it matters                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [work/items/task.0383.enable-merge-queue.md](../items/task.0383.enable-merge-queue.md)                                                                                       | Outcome contract — review against this, don't invent extra requirements                |
| [PR #1076](https://github.com/Cogni-DAO/node-template/pull/1076)                                                                                                             | Work item filing PR (this branch); merge before starting impl                          |
| [Memory note: MVP-Stage Reality](~/.claude/projects/-Users-derek-dev-cogni-template/memory/feedback_mvp_stage_first.md)                                                      | Why platform-grade infra is normally rejected — and why this case is the exception     |
| [docs/spec/ci-cd.md](../../docs/spec/ci-cd.md)                                                                                                                               | Pipeline contract; Axioms 18-20 for context on what's already in place                 |
| [GitHub Merge Queue docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) | Authoritative on config + status-check semantics                                       |
| `gh api repos/Cogni-DAO/node-template/branches/main/protection`                                                                                                              | Source of truth for current branch-protection config — export before changing anything |
| [PR #924 stale-build incident note](~/.claude/projects/-Users-derek-dev-cogni-template/memory/project_pr924_stale_build.md)                                                  | First instance of the bug class; today is the second                                   |
