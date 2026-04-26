---
id: task.0383
type: task
title: "Enable GitHub Merge Queue on main — prevent stale-branch merge order bugs without blocking external contributors"
status: needs_design
priority: 1
rank: 35
estimate: 2
summary: "Today's #1033/#1070 ordering bug — #1033 squash-merged at a SHA whose build predated #1070, silently rolling back #1070's race guards in preview-poly — is structurally what GitHub Merge Queue prevents. Branch protection's `Require branches to be up-to-date` toggle solves the same bug class but creates rebase thrash that's hostile to external contributors (every merge invalidates every open PR's up-to-date status). Merge Queue is the same defense without the manual-rebase tax: contributors push to a queue, GH auto-rebases on top of current main, re-runs required checks on the rebased commit, merges in order on green."
outcome: |
  - GitHub Merge Queue enabled on `main` via branch protection.
  - Required-status set declared explicitly: the fast subset of `pnpm check:fast` (typecheck + lint + format + unit) plus the affected-only `pr-build` matrix manifest. NOT the full `pnpm check:full` (~20min) — at expected throughput (~1-2 PRs/day) the queue depth stays at 0-1, but a 20min gate caps to 3 merges/hr if it ever spikes. The fast subset is the right mid-point.
  - Documentation: `docs/guides/contributor-flow.md` (or extend developer-setup.md) describes the queue path — "click 'Merge when ready' → walks away → green or red". External contributor experience: no manual rebase, no chasing main.
  - Branch protection delta committed somewhere git-tracked (the GH branch-protection API can be exported via `gh api` to a yaml; capture in `infra/github/branch-protection.yaml` or similar so the config isn't lost on next admin change).
  - candidate-flight + flight-preview unchanged (they run post-merge; merge queue is pre-merge). No interaction.
spec_refs:
  - docs/spec/ci-cd.md
assignees: []
project: proj.cicd-services-gitops
created: 2026-04-26
updated: 2026-04-26
labels: [cicd, branch-protection, contributor-experience]
external_refs:
  - work/items/task.0376.preview-production-matrix-cutover.md
---

# task.0383 — Enable GitHub Merge Queue on main

## Problem

PRs to `main` currently merge without enforced rebase. Today's incident:

1. #1070 (poly redeem-sweep race guards) merged.
2. #1062 (cicd matrix cutover) merged. AppSet flipped Argo from `deploy/preview` → `deploy/preview-{node}`.
3. #1033 (poly agent wallet research) squash-merged at a PR-head SHA whose last main-rebase predated #1070. The squash-merge image content didn't include #1070.
4. #1033's matrix promote pushed that pre-#1070 image digest to `deploy/preview-poly`. Argo reconciled poly **backwards** to no-#1070 code.

Preview poly served code without #1070's race guards for ~30min until #1072 (rebased on top of all of {#1062, #1070, #1073}) merged and a fresh poly build promoted.

## Two structural fixes considered

### Option A — branch protection: `Require branches to be up-to-date`

One-checkbox fix. Greys out merge button until PR is rebased on current main. Author rebases manually before merge.

**Why rejected:** validated this in the past; creates rebase thrash. Every merge to main invalidates every open PR's up-to-date status. With ≥2 PRs in flight, contributors burn cycles re-rebasing. Especially hostile to **external contributors** whose flow is "open PR, wait for review" — they don't want to chase a moving main. (See user feedback: "decentralized circus of updates" experienced firsthand.)

### Option B — GitHub Merge Queue (chosen)

Author marks PR "Merge when ready" → GH queues it → auto-rebases on top of current main → re-runs required checks against the rebased commit → merges in order on green. Author doesn't touch the PR.

Same defense as A; no rebase tax on contributors.

## Outcome

- Merge Queue enabled on `main` via branch protection.
- Required-status set: fast subset of `pnpm check:fast` (typecheck + lint + format + unit) + affected `pr-build` matrix manifest. ~5-8min total. NOT the full `pnpm check:full` (~20min) — caps queue throughput unnecessarily for a single-dev MVP repo.
- `docs/guides/contributor-flow.md` describes the queue path. Contributor flow: open PR → reviewers approve → click "Merge when ready" → walk away → email when green/red.
- Branch protection config exported and committed (e.g. `infra/github/branch-protection.yaml` via `gh api repos/<owner>/<repo>/branches/main/protection`). Today's config lives in GH UI only; one wrong admin click and it's gone.
- candidate-flight and flight-preview unchanged. They trigger on `push` to `main` after merge; merge queue is the pre-merge gate, no interaction.

## Why this is appropriate at MVP stage

User feedback note explicitly cautions against platform-stage abstractions before MVP validation. The relevant question: _is this aspirational infra solving a problem we don't yet have, or fixing a problem we do have?_ Today's incident is the second time this exact bug class has surfaced (also see PR #924 stale-build incident in memory). The infra fixes a real, repeated problem — not a theoretical one. The lighter-weight alternative (option A) was tried and rejected on contributor-experience grounds. Merge Queue is the right level of investment.

## Out of scope

- **Required-status definition refactor.** The fast-subset choice for required checks is the v0 pick. If signal proves insufficient (e.g. queue merges introduce regressions that `pnpm check:full` would have caught), tighten incrementally. Don't pre-tune.
- **Merge Queue for non-main branches.** `deploy/*` branches are machine-written; PRs into them are a separate question (and currently disallowed by repo conventions).
- **CodeOwners-driven auto-approve.** Separate task if/when contributor volume justifies it.

## Validation

- exercise: open a PR, click "Merge when ready", confirm GH queues it. Push a second PR while the first is queued — confirm the second waits, auto-rebases on the first's merge, re-runs checks, merges.
- observability: GH branch-protection event log shows queue activity. Branch-protection config matches the committed yaml (`gh api ... | diff`).

## PR / Links

- Handoff: [handoff](../handoffs/task.0383.handoff.md)
