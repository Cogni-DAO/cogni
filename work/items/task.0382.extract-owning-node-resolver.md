---
id: task.0382
type: task
title: "`extractOwningNode(spec, paths)` — TS resolver for files-changed → owning nodeId in operator runtime"
status: needs_design
priority: 0
rank: 1
estimate: 1
summary: "Pure TS function in `@cogni/repo-spec` that takes a `RepoSpec` and a list of changed file paths and returns the owning node identity: `{ kind: 'single', nodeId } | { kind: 'operator-infra' } | { kind: 'conflict', nodes } | { kind: 'miss' }`. The load-bearing function for routing AI PR reviews to per-node `.cogni/rules/`. Inverse direction of task.0380's `extractNodePath`. Pairs with task.0381's CI gate (which uses turbo at the shell level); this function provides the same routing inside the operator's review-handler runtime where shelling to turbo is not available."
outcome: "When the AI reviewer fires on a PR webhook, `dispatch.server.ts` can call `extractOwningNode(rootSpec, changedPaths)` and route the review handler to the correct per-node `.cogni/rules/` directory deterministically — or refuse to review (returning a clear status) when the PR violates the single-node-scope policy that task.0381 enforces statically. Same routing logic, two enforcement points (CI for hard fail, reviewer for graceful skip + diagnostic comment)."
spec_refs:
  - vcs-integration
  - node-operator-contract
assignees: []
project: proj.vcs-integration
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-25
updated: 2026-04-25
labels: [vcs, review, repo-spec, accessor, monorepo]
---

# `extractOwningNode` — Files-Changed → Owning Node Resolver

## Problem

The AI reviewer needs to answer: "given the files this PR touches, which node's `.cogni/rules/` should I evaluate against?" Today there is no function that answers this. Task.0380's `extractNodePath` is the inverse direction (`nodeId → path`); `turbo ls --affected` answers it at the shell level, but the operator's review handler runs inside Next.js / Temporal — it cannot shell out to turbo.

Without this function:

- The reviewer cannot route to per-node rules even after task.0380 lands the path resolver. `extractNodePath` is unconsumed.
- The factory parameterization (`createReviewAdapterDeps(installationId, appId, key, nodeBasePath)`) has no way to compute its `nodeBasePath` argument from runtime PR data.
- The reviewer's policy contract — "this PR violates single-node-scope, refusing to review until split" — has no implementation surface. CI (task.0381) catches the violation; the reviewer must too, because reviewer status drives the merge UX.

This is the single largest missing piece in the per-node review pipeline. Building it small + locked + paired with `extractNodePath` is the gate-ladder discipline.

## Design

### Outcome

`@cogni/repo-spec` exports `extractOwningNode(spec, paths): OwningNode` where `OwningNode` is a discriminated union over the four meaningful outcomes:

```ts
type OwningNode =
  | { kind: "single"; nodeId: string; path: string }
  | { kind: "operator-infra" }
  | { kind: "conflict"; nodes: ReadonlyArray<{ nodeId: string; path: string }> }
  | { kind: "miss" };
```

The reviewer dispatches on `kind`:

- `single` → load `nodes/<path>/.cogni/rules/` and review.
- `operator-infra` → load root `.cogni/rules/` and review (operator owns infra-policy rules).
- `conflict` → post a "PR violates single-node-scope, split before review" comment; do not invoke gates.
- `miss` → post "PR touches no recognized scope" diagnostic; neutral check run.

### Approach

**Solution**: One new exported function in `packages/repo-spec/src/accessors.ts`, sibling to `extractNodes` and `extractNodePath`. Pure: no I/O, no env, no globals. Algorithm:

```
1. For each path in `paths`:
   a. Find the longest matching prefix among `spec.nodes[].path` (registry).
   b. Classify: which registry entry owns this path, or "infra" if no node prefix matches.
2. Aggregate the per-path classifications:
   - All paths classified as one node → { kind: "single", nodeId, path }
   - All paths classified as infra → { kind: "operator-infra" }
   - Mix of nodes (or one node + infra mix is allowed if the operator is in the registry) → { kind: "conflict", nodes }
   - All paths fail to classify (path under nodes/ but no registry match) → { kind: "miss" }
```

**Operator-infra recognition**: derived from the registry. The operator's registry entry has `path: "nodes/operator"` (or whatever root declares). Paths that match `packages/**`, `infra/**`, `.github/**`, `docs/**`, `work/**`, `services/**`, `scripts/**`, root configs — i.e., paths that are _not_ under any registered node — are classified as "infra" and silently ignored when computing the owning node. A PR touching only infra paths returns `{ kind: "operator-infra" }`.

**Mixed infra + single-node**: a PR touching `packages/repo-spec/src/foo.ts` AND `nodes/poly/app/bar.ts` returns `{ kind: "single", nodeId: poly }` — the single sovereign node owns the review, with infra changes riding along. This matches task.0381's exemption logic (infra is allowed alongside any other path).

### Path-prefix matching — "longest prefix wins"

Required because registry paths can nest: a hypothetical `path: "nodes/poly/app"` would shadow `path: "nodes/poly"` for files under `app/`. Standard file-system routing semantics. Prevents ambiguity if the registry ever gets fine-grained.

### Reuses

- Existing `RepoSpec` type + `nodeRegistryEntrySchema` (`packages/repo-spec/src/schema.ts:259-272`)
- Existing `extractNodes(spec)` accessor (returns the array we iterate)
- task.0380's `extractNodePath` is the _return-side_ sibling — both can compose: `extractNodePath(spec, extractOwningNode(spec, paths).nodeId)` would be redundant, but the same registry data backs both functions.
- Native `Array.prototype.reduce` / `.find` / `.startsWith` — no library

### Rejected

- _Returning `string | null` like `extractNodePath` does_ — collapses three meaningful outcomes (single/conflict/miss/infra) into one. Caller would need a sentinel value or out-of-band signal for conflict. Discriminated union is the honest type.
- _Throwing on conflict_ — exceptions for control flow are wrong here; "conflict" is a _result_, not an error condition. Reviewer wants to dispatch on it, not catch it.
- _Special-casing the operator's registry entry to mean "infra"_ — instead, "infra" is "no registered node owns this path", which is a property of the path set, not of any specific registry entry. This stays consistent if the operator's registry entry changes shape (e.g., to `path: "."`).
- _Putting it in `nodes/operator/app/src/features/review/`_ — couples to one consumer. Future scope router, scheduler routing, attribution may all want this.
- _Bundling it with task.0381's CI gate_ — wrong altitude. Bash + turbo at CI time vs. TS + RepoSpec inside operator runtime. Both implement the same policy from different layers; both belong but separately.
- _Bundling it with the reviewer factory parameterization_ — defeats the gate-ladder. Function locked alone first, consumer rides on top.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **PURE_RESOLVER**: `extractOwningNode` performs no I/O, no env reads, no logging. `(RepoSpec, readonly string[]) → OwningNode` and nothing else.
- [ ] **DISCRIMINATED_UNION**: Return type is the four-case discriminated union. No sentinel strings, no null-as-conflict. Locked by type-level test.
- [ ] **LONGEST_PREFIX_WINS**: When registry has nested paths, the longest matching prefix owns the file. Locked by a scenario fixture.
- [ ] **INFRA_RIDE_ALONG**: A mix of infra paths + a single sovereign node returns `{ kind: "single", nodeId }` — infra rides along, does not trigger conflict. Matches task.0381 exemption logic.
- [ ] **EMPTY_INPUT**: `extractOwningNode(spec, [])` returns `{ kind: "operator-infra" }` (vacuous truth: no paths, no node violations). Edge case, locked by test.
- [ ] **NO_CROSS_VALIDATION**: This function does not validate path safety (no `..`, no absolute paths). Caller responsibility, same as `extractNodePath`. Documented in TSDoc.

### Files

- Modify: `packages/repo-spec/src/accessors.ts` — add `extractOwningNode` function + `OwningNode` type (~40 lines body + TSDoc).
- Modify: `packages/repo-spec/src/index.ts` — export both.
- Modify: `tests/unit/packages/repo-spec/accessors.test.ts` — add `describe("extractOwningNode", …)` block (~10 scenarios, ~150 lines, consuming `@cogni/repo-spec/testing` fixtures from task.0380).
- Modify: `packages/repo-spec/AGENTS.md` — document new export.

### Test scenarios

1. **Single sovereign node** — paths all under `nodes/poly/...` → `{ kind: "single", nodeId: poly, path: "nodes/poly" }`.
2. **All infra** — paths all under `packages/`, `infra/`, `docs/` → `{ kind: "operator-infra" }`.
3. **Mixed sovereign node + infra** — `nodes/poly/foo.ts` + `packages/repo-spec/bar.ts` → `{ kind: "single", nodeId: poly }`.
4. **Conflict — two sovereign nodes** — `nodes/poly/foo.ts` + `nodes/resy/bar.ts` → `{ kind: "conflict", nodes: [poly, resy] }`.
5. **Conflict — three sovereign nodes** → all three named in the conflict result.
6. **Miss** — path under `nodes/unregistered-node/foo.ts` (no registry entry) → `{ kind: "miss" }`.
7. **Empty input** — `[]` → `{ kind: "operator-infra" }`.
8. **Longest-prefix wins** — registry has both `nodes/poly` and `nodes/poly/app`; path under `nodes/poly/app/...` resolves to the more-specific entry.
9. **Operator-as-registry-entry** — registry has operator at `path: "nodes/operator"`; paths under it return `{ kind: "single", nodeId: operator, path: "nodes/operator" }` (NOT auto-classified as infra). Caller (the reviewer) decides whether to treat operator-as-node identically to operator-as-infra.
10. **Trailing-slash and edge paths** — `nodes/poly` (no trailing slash) and `nodes/poly/` both resolve correctly.

### Pairing with task.0381

These two tasks implement the **same policy at two layers**:

- **task.0381** (CI / pre-merge): bash + turbo at GitHub Actions level. Hard fail. Cheap, fast, runs without operator. Required status check.
- **task.0382** (reviewer / runtime): TS + RepoSpec inside operator. Soft fail with diagnostic comment. Runs where the AI reviewer lives.

Both must agree. If they disagree, that's a real bug — captured by a contract test that exercises a fixed PR diff against both implementations. **Defer the contract test to a follow-on**; ship 0381 + 0382 first, then the parity test once both exist.

## Validation

```yaml
exercise: |
  pnpm test tests/unit/packages/repo-spec/accessors.test.ts
observability: |
  Test output shows the new extractOwningNode block (10 scenarios) passing alongside
  extractNodePath (8) + the existing 18 accessor tests = 36 total. CI unit job picks
  up via tests/unit/** glob — no config change.
```
