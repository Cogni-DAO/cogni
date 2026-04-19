---
id: bug.0321.handoff
type: handoff
work_item_id: bug.0321
status: archived
created: 2026-04-18
updated: 2026-04-18
branch: fix/flight-preview-queue-visible
last_commit: 395646539
---

> **Archived 2026-04-18.** All four gaps fixed in PR #921 (four commits:
> Fix 1–4 below). See `bug.0321.cicd-silent-green-remaining.md` for the
> as-shipped acceptance checklist. Gap #4 (OutOfSync/readiness race) was
> folded into this bug rather than split out as bug.0322 per user direction.

# Handoff: CICD silent-green — three remaining paths

## Context

- The 2026-04-18 incident surfaced a class of bug: GHA workflows report green while the actual deploy state didn't advance. Five PRs have closed the most-egregious instances this week.
- This handoff covers the **three remaining paths** — all in the same "workflow reports success without verifying state-delta" class, different workflows.
- Pipeline operators and `pr-coordinator-v0` cannot trust green checkmarks until these are closed. Today's poly #920 flight hit gap #1 live; pr-coordinator caught it only because it runs its own Loki buildSha check.
- Work item: [bug.0321](../items/bug.0321.cicd-silent-green-remaining.md) — authoritative for scope, acceptance, validation.

## Current State

- `fix/flight-preview-queue-visible` branch carries PR #921 (flight-preview queue-only → visibly skipped) + bug.0321 filing + handoff + a prettier-format fixup. Tail commit `9ed58908e`.
- Three remaining gaps are NOT yet addressed by any open PR.
- The `devops-expert` and `pr-coordinator-v0` skills have been updated with the three-outcome contract, new authoritative gate scripts, and new anti-patterns. Read those first — they describe the working mental model.
- Preview is currently pinned at `c644f177` in `reviewing` state with stale pods (operator/poly on `66ea27978`, resy on `79dd9eb72`). Orthogonal operational catch-up; not part of this bug.

## Decisions Made

- Three gaps tracked under **one bug** (not split) because they share a failure class and benefit from one coherent review. See [bug.0321 §Remaining gaps](../items/bug.0321.cicd-silent-green-remaining.md#remaining-gaps).
- Precedent patterns already in-tree to reuse:
  - `scripts/ci/flight-preview.sh` exit-code + `$GITHUB_OUTPUT` contract — pattern for gap #2.
  - `scripts/ci/wait-for-argocd.sh` — already exists, used by `promote-and-deploy.yml`; gap #1 is wiring it into `candidate-flight.yml`.
  - `scripts/ci/verify-buildsha.sh` — preview-only today; gap #3 is the cross-PR variant.
- Status + summary emission belongs in `scripts/ci/*.sh`, never in YAML. Enforced anti-pattern in `devops-expert` skill.

## Next Actions

- [ ] Gap #1: emit `promoted_apps` from `scripts/ci/promote-build-payload.sh` to `$GITHUB_OUTPUT` (same pattern as `flight-preview.sh` helpers). Wire `scripts/ci/wait-for-argocd.sh` into `.github/workflows/candidate-flight.yml` between `Reconcile AppSet` and `Wait for candidate readiness`, scoped to `PROMOTED_APPS`.
- [ ] Gap #2: in `.github/workflows/promote-and-deploy.yml`, split the preview path. `promote-k8s` emits `status=promoted|no-op`. A new `deploy-preview-verified` downstream job is gated on `status == 'promoted'`. Decide: does `lock-preview-on-success` still write `current-sha` on a no-op? Lease semantics need a design note in `docs/spec/ci-cd.md` before coding.
- [ ] Gap #3: design cross-PR verifier. Preferred sketch in bug body: `promote-to-production.sh` writes `.promote-state/source-sha-by-app.json` (operator→shaA, poly→shaB, ...). Production verifier reads it, curls each endpoint, asserts per-node. File the design before coding.
- [ ] Each gap closed via its own PR; cross-link under bug.0321 in the PR body.
- [ ] When all three are merged, close bug.0321 with a short evidence note (run link showing the outcome being visible).

## Risks / Gotchas

- **Gap #1 race with Argo**: `wait-for-argocd.sh` passes `EXPECTED_SHA` as the deploy-branch tip SHA (what promote-k8s just pushed), NOT the source-app SHA. Read the script header before wiring — the comment there describes the exact footgun. `EXPECTED_SHA=deploy_branch_sha` in `promote-and-deploy.yml`; do the same in `candidate-flight.yml`.
- **Gap #2 lease semantics**: writing `current-sha` on a no-op run may be the right call (advances preview's marker to reflect "this SHA is considered reviewed") OR wrong (we never actually validated those images). Check `docs/spec/ci-cd.md#preview-review-lock` + `task.0293` before changing. Don't guess.
- **Gap #3 digest→BUILD_SHA mapping**: no in-tree tool reads the OCI label from an image digest. The per-node source-sha map approach in `promote-to-production.sh` avoids that problem entirely. Prefer it over any "inspect the digest's label" scheme.
- **Skill drift**: `devops-expert` and `pr-coordinator-v0` skills are now part of the CICD source of truth. When you close a gap, update the skill too. Don't let them drift back into lying.
- **No force-push on `fix/flight-preview-queue-visible`** — PR #921 history must stay intact for audit. Start gap PRs off `main` after #921 merges.

## Pointers

| File / Resource                                              | Why it matters                                                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `work/items/bug.0321.cicd-silent-green-remaining.md`         | Canonical scope, acceptance, per-gap fix sketches.                                                               |
| `docs/spec/ci-cd.md`                                         | Trunk-based axioms. Lease model in `#preview-review-lock`. Don't design around it, design with it.               |
| `.claude/skills/devops-expert/SKILL.md`                      | Flight-preview outcome contract + the three anti-patterns you must not re-introduce.                             |
| `.claude/skills/pr-coordinator-v0/SKILL.md`                  | Checks-list outcome matrix (flight ✓ / deploy-preview ⊘ etc). Mirror this mental model when reading CI.          |
| `.github/workflows/flight-preview.yml`                       | Reference implementation of the split-job outcome pattern. Copy the shape for gap #2.                            |
| `scripts/ci/flight-preview.sh`                               | Reference implementation of the `emit_status`/`emit_summary` helpers gated on `$GITHUB_OUTPUT`. Copy for gap #1. |
| `scripts/ci/wait-for-argocd.sh`                              | Already exists; read the header for `EXPECTED_SHA` contract before wiring into candidate-flight.                 |
| `scripts/ci/promote-build-payload.sh`                        | Needs `promoted_apps` output added for gap #1.                                                                   |
| `scripts/ci/verify-buildsha.sh`                              | Preview-only today. Pattern to extend to per-node verification for gap #3.                                       |
| `scripts/ci/promote-to-production.sh`                        | Where the per-node source-sha map would be written for gap #3.                                                   |
| PR #921 (this branch)                                        | Merge before starting the gap PRs — gap fixes build on top.                                                      |
| [task.0293](../items/task.0293.main-preview-flight-lease.md) | Lease model history. Read before touching `lock-preview-on-success` for gap #2.                                  |
