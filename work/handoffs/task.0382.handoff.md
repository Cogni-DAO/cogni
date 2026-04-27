---
id: task.0382.handoff
type: handoff
work_item_id: task.0382
status: active
created: 2026-04-25
updated: 2026-04-25
branch: feat/task-0382-extract-owning-node-resolver
last_commit: d3b0dc275
---

# Handoff: `extractOwningNode` Resolver (task.0382)

## Context

- **P0** load-bearing function for the per-node AI reviewer. Given a `RepoSpec` and a list of changed file paths, return which node owns the PR. Discriminated union over four outcomes: `single | operator-infra | conflict | miss`.
- **Inverse direction of task.0380's `extractNodePath`** (which is `nodeId → path`). 0380 shipped on main as part of PR #1055; this task is the symmetric `paths → nodeId` resolver.
- Lives in `@cogni/repo-spec` alongside `extractNodes` and `extractNodePath` — pure accessor, same shape.
- **Why the operator runtime needs this in TS**: the AI reviewer fires from a webhook inside Next.js / Temporal — it cannot shell out to `turbo ls --affected`. Same policy as task.0381 (CI-side bash gate), expressed in code that runs where the reviewer lives.
- **Pairs with task.0381**: same policy at two layers. CI hard-fails cross-node PRs at merge time; the reviewer routes per-node rules at review time and gracefully refuses on conflict with a diagnostic comment. Both must agree on a fixed PR diff — a contract-parity test is filed as a follow-on once both implementations exist.
- The reviewer cannot route to per-node `.cogni/rules/` without this function — `extractNodePath` is currently unconsumed because the consumer (factory parameterization) has no way to compute its `nodeId` argument from runtime PR data.

## Current State

- Status: `needs_design` (full /design block already on the work item, including 10 test scenarios; design pass should be critique, not net-new).
- No code yet on the branch — fresh off `origin/main` at `d3b0dc275`.
- task.0380 (sibling) merged on main; `extractNodePath` and `@cogni/repo-spec/testing` fixtures (`buildTestRepoSpec`, `TEST_NODE_IDS`, `TEST_NODE_ENTRIES`) are available — **consume them, do not re-derive**.
- task.0381 (CI-side counterpart) is independent — neither blocks the other.
- The reviewer factory parameterization (`createReviewAdapterDeps` accepts `nodeBasePath`) and the `nodeId` workflow threading are downstream consumers — they ride on top of this resolver in a follow-on task.

## Decisions Made

- **Discriminated union, not `string | null`**. `null` collapses three meaningful outcomes (conflict / miss / infra) into one — caller would need a sentinel. See `## Rejected` in the work item.
- **No throwing on conflict**. Conflict is a _result_, not an error condition. Reviewer dispatches on it.
- **"Infra" is structural, not nominal**. A path is infra iff no registered node owns it — does not depend on which `node_id` the operator's own entry uses. Stays correct if the operator's registry entry shape changes.
- **Longest-prefix-wins for path matching**. Required if the registry ever gets fine-grained nested paths.
- **Mixed infra + single sovereign node = single**. Infra rides along, does not trigger conflict. Matches task.0381's exemption logic exactly.
- **Lives in `@cogni/repo-spec`**, not `nodes/operator/app/`. Multi-runtime consumer (review handler today; scope router, scheduler routing, attribution tomorrow).

## Next Actions

- [ ] Run `/design` on task.0382 (critical pass on the existing design block)
- [ ] Implement `extractOwningNode` in `packages/repo-spec/src/accessors.ts` (~40 lines body + TSDoc)
- [ ] Export from `packages/repo-spec/src/index.ts` (sibling to `extractNodePath`)
- [ ] Add `describe("extractOwningNode", …)` to `tests/unit/packages/repo-spec/accessors.test.ts` covering all 10 scenarios in the work item — **use `@cogni/repo-spec/testing` fixtures** (`buildTestRepoSpec`, `TEST_NODE_IDS`, `TEST_NODE_ENTRIES`), do not redefine UUIDs
- [ ] Update `packages/repo-spec/AGENTS.md` Public Surface section (sibling line under `extractNodePath`)
- [ ] Run `pnpm -F @cogni/repo-spec build` after editing source — the accessors file is consumed via `dist/`, tests will fail with "is not a function" if you forget. (This bit task.0380; documented gotcha.)

## Risks / Gotchas

- **`@cogni/repo-spec/testing` is the home for fixtures.** Do not duplicate `buildTestRepoSpec` or stable UUIDs into the test file. If a fixture you need doesn't exist (e.g., a node entry with a nested path for the longest-prefix scenario), extend `packages/repo-spec/src/testing.ts` itself — the subpath is built specifically for this kind of growth.
- **Path matching is string-prefix on `path`** (e.g., `nodes/poly`). Be careful with trailing slashes: a path of `nodes/polymarket/foo.ts` should NOT match a registry entry `path: "nodes/poly"` — guard with explicit `/` boundary check (`path === entry.path || path.startsWith(entry.path + "/")`). Locked by the trailing-slash test scenario.
- **Empty input returns `operator-infra`** (vacuous truth). Edge case; locked by scenario 7.
- **Don't sanitize paths in this function**. No `..` rejection, no absolute-path detection. Pure accessor — caller validates. Same boundary as `extractNodePath`. Document in TSDoc.
- **Build artifact gotcha**: edits to `packages/repo-spec/src/*.ts` need a rebuild before tests pass. `pnpm -F @cogni/repo-spec build` (or `pnpm packages:build` for the full workspace).
- **Don't bundle the consumer wiring** (factory parameterization, `nodeId` workflow threading, dispatch.server.ts changes). Those land in a separate task on top of this one. Same gate-ladder discipline as task.0368 → task.0380.

## Pointers

| File / Resource                                                     | Why it matters                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `work/items/task.0382.extract-owning-node-resolver.md`              | The full design — algorithm, 10 test scenarios, rejected alternatives                                |
| `work/items/task.0381.single-node-scope-ci-gate.md`                 | CI-side counterpart; both must enforce the same policy                                               |
| `work/items/task.0380.node-base-path-resolver.md`                   | Sibling — `nodeId → path` (returns string \| null). Same registry data, opposite direction           |
| `packages/repo-spec/src/accessors.ts`                               | Where `extractNodePath` already lives — `extractOwningNode` sits next to it                          |
| `packages/repo-spec/src/testing.ts`                                 | Reusable fixtures (`buildTestRepoSpec`, `TEST_NODE_IDS`, `TEST_NODE_ENTRIES`); extend here if needed |
| `packages/repo-spec/src/schema.ts:259-272`                          | `nodeRegistryEntrySchema` — the shape `extractOwningNode` reads                                      |
| `tests/unit/packages/repo-spec/accessors.test.ts`                   | Where the new `describe` block lands                                                                 |
| `nodes/operator/app/src/features/review/services/review-handler.ts` | Future consumer (factory parameterization, separate task)                                            |
| `nodes/operator/app/src/app/_facades/review/dispatch.server.ts`     | Future caller — gets PR diff, calls `extractOwningNode`, dispatches by `kind`                        |

```
Worktree:  /Users/derek/dev/cogni-template-worktrees/feat-task-0382-extract-owning-node-resolver
Branch:    feat/task-0382-extract-owning-node-resolver (tracks origin/feat/task-0382-extract-owning-node-resolver, not yet pushed)
Handoff:   work/handoffs/task.0382.handoff.md
Immediate next action: Read work/handoffs/task.0382.handoff.md and work/items/task.0382.extract-owning-node-resolver.md, then run /design task.0382 to critique-and-refine the existing design block. From there you are in charge — implement per the refined design (sibling to extractNodePath in packages/repo-spec/src/accessors.ts, fixture-backed tests in tests/unit/packages/repo-spec/accessors.test.ts), close the loop with `pnpm check`, and the task is ready for /closeout.
```
