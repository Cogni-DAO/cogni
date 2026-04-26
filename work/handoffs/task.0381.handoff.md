---
id: task.0381.handoff
type: handoff
work_item_id: task.0381
status: active
created: 2026-04-25
updated: 2026-04-25
branch: feat/task-0381-single-node-scope-ci-gate
last_commit: d3b0dc275
---

# Handoff: Single-Node-Scope CI Gate (task.0381)

## Context

- **P0** invariant for the multi-node monorepo: a PR may touch **at most one sovereign node** (`nodes/poly/`, `nodes/resy/`, `nodes/ai-only/`, …). Cross-node PRs are forbidden, full stop.
- **`nodes/operator/**`is infra**, not a sovereign node — operator changes can ride alongside any other path. Same for`infra/`, `packages/`, `services/`, `.github/`, `docs/`, `work/`, `scripts/`, root configs.
- This is the **CI-side** half of a paired policy: task.0382 lands the same policy in TS inside the operator's review-handler runtime (graceful-skip + diagnostic comment); 0381 is the bash + GitHub Actions hard-fail gate that runs before merge regardless of operator availability.
- Closes the policy gap that task.0372's matrix fan-out leaves open — matrix _supports_ multi-cell flights; this gate enforces that PRs are single-node so multi-cell becomes the legitimate exception (operator-infra-only PRs that legitimately fan out to all consumers).
- AI contributors are the primary consumer of this gate. Failure messages must be machine-actionable (split the PR, name the conflicting nodes).

## Current State

- Status: `needs_design` (full /design block already on the work item; design pass should be a critique cycle, not net-new design work).
- No code yet on the branch — fresh off `origin/main` at `d3b0dc275`.
- task.0380 (its sibling — `extractNodePath`) merged on main; task.0382 is the runtime-side counterpart, not a blocker.
- task.0260 / 0320 / 0372 already invest in `turbo ls --affected` for matrix fan-out — reuse the same primitive at the shell level. **Do not write a hand-rolled path-diff parser** when turbo is right there.

## Decisions Made

- **Bash + turbo, not GitHub-API check**. Operator-runtime checks couple policy to operator availability; static CI is independent. See `## Rejected` in the work item.
- **Directory listing is the source of truth for sovereign nodes** — `nodes/*` minus `nodes/operator`. No hand-maintained list. Adding `nodes/ai-only/` automatically extends the gate.
- **Hard fail, not warning**. Single-node-scope is invariant or it isn't.
- **Required status check on `main`**, not informational.
- **Discriminated union return shape** (single / operator-infra / conflict / miss) — paired with task.0382's TS resolver so both layers express the same outcomes.

## Next Actions

- [ ] Run `/design` on task.0381 (critical pass on the existing design block; refine if reviewer flags real gaps)
- [ ] Implement `scripts/ci/check-single-node-scope.sh` (~30 lines) per the algorithm in the work item's `## Approach`
- [ ] Add `tests/ci-invariants/check-single-node-scope.test.sh` (or vitest) covering the 5+ scenarios in the work item
- [ ] Add `single-node-scope` job to `.github/workflows/ci.yaml` static checks set
- [ ] Add `SINGLE_NODE_HARD_FAIL` invariant to `docs/spec/node-ci-cd-contract.md` merge-gate matrix
- [ ] **Manual** (cannot be automated by an agent): add `single-node-scope` as required status check in branch protection for `main` — Derek must do this in the GitHub repo settings UI, or via `gh api` with appropriate token

## Risks / Gotchas

- **Path classification edge cases**: deletes, renames across nodes, symlinks. Tests must cover. `git diff --name-status origin/main...HEAD` gives status flags (A/M/D/R) — handle each.
- **`nodes/*` glob can match `nodes/operator`**. Filter explicitly. Test scenario: PR touches `nodes/operator/` + `nodes/poly/` should pass (operator is infra), but PR touching `nodes/poly/` + `nodes/resy/` should fail.
- **Turbo affected output may miss non-workspace files** (e.g., `nodes/poly/.cogni/repo-spec.yaml` outside the package graph). Use a path-classification _fallback_ that runs alongside turbo, not turbo alone.
- **Don't break fork PRs**. The gate must work without secrets (FORK_FREEDOM invariant in `node-ci-cd-contract.md`). Use only `git diff` against `origin/main`, not GitHub API.
- **Branch protection requires Derek**. The CI job can land via PR; making it _required_ needs human action. Don't claim "done" until that's in place.

## Pointers

| File / Resource                                           | Why it matters                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `work/items/task.0381.single-node-scope-ci-gate.md`       | The full design — invariants, scenarios, rejected alternatives                |
| `work/items/task.0382.extract-owning-node-resolver.md`    | The runtime-side sibling; both must agree on policy                           |
| `work/items/task.0372.candidate-flight-matrix-cutover.md` | Matrix fan-out — same `turbo --affected` integration this gate consumes       |
| `work/items/task.0260.monorepo-ci-pipeline.md`            | Original Turbo integration spike — context on `turbo ls --affected` semantics |
| `.github/workflows/ci.yaml`                               | Where the new job lands                                                       |
| `docs/spec/node-ci-cd-contract.md`                        | Merge-gate matrix; add `SINGLE_NODE_HARD_FAIL` here                           |
| `docs/spec/architecture.md`                               | Node sovereignty principle — the _why_ behind the gate                        |

```
Worktree:  /Users/derek/dev/cogni-template-worktrees/feat-task-0381-single-node-scope-ci-gate
Branch:    feat/task-0381-single-node-scope-ci-gate (tracks origin/feat/task-0381-single-node-scope-ci-gate, not yet pushed)
Handoff:   work/handoffs/task.0381.handoff.md
Immediate next action: Read work/handoffs/task.0381.handoff.md and work/items/task.0381.single-node-scope-ci-gate.md, then run /design task.0381 to critique-and-refine the existing design block. From there you are in charge — implement per the refined design, then ask Derek to wire the required-check in branch protection (the only manual step).
```
