---
id: task.0380
type: task
title: "Node base-path resolver — `extractNodePath(spec, nodeId)` accessor + unit tests"
status: needs_merge
priority: 1
rank: 1
estimate: 1
summary: "Add a pure `extractNodePath(spec: RepoSpec, nodeId: string): string | null` accessor to `@cogni/repo-spec` that maps a node UUID to its registered relative path (e.g., `nodes/poly`) using the operator's `nodes[]` registry. Returns null on miss; caller decides fallback policy. Locked by unit tests. Prerequisite for the per-node review rule scoping refactor."
outcome: "When the review-adapter factory parameterization lands (next task), it has a pure, locked function to call: `extractNodePath(rootRepoSpec, nodeId) ?? '.'` produces the directory whose `.cogni/` should be read for a given PR's owning node. The factory + workflow threading become trivial plumbing; the resolution logic is already proven."
spec_refs:
  - vcs-integration
assignees: []
project: proj.vcs-integration
branch: feat/task-0374-node-base-path-resolver
pr: https://github.com/Cogni-DAO/node-template/pull/1055
reviewer:
revision: 2
blocked_by:
deploy_verified: false
created: 2026-04-25
updated: 2026-04-25
labels: [vcs, review, repo-spec, accessor]
---

# Node Base-Path Resolver

## Problem

The AI PR reviewer reads `<repoRoot>/.cogni/repo-spec.yaml` and `<repoRoot>/.cogni/rules/<file>.yaml` from a single hardcoded location (`review-adapter.factory.ts:62-65`). To support per-node review rules, the factory must be parameterized with a node-specific base path. But before parameterizing the factory, we need the **resolution function itself**: given a `nodeId` and the operator's root repo-spec, return the relative path of that node's directory (e.g., `nodes/poly`).

This logic is small (~10 lines) but load-bearing. The right home is `@cogni/repo-spec`, alongside `extractNodes`, `extractDaoConfig`, `extractGatesConfig` — same pure-accessor-on-`RepoSpec` shape. Locking it as its own pure function first means:

- **Independently testable** — no factory, no I/O, no Octokit, just `(RepoSpec, string) → string | null`.
- **Reusable** — review pipeline today; scope router, scheduler routing, attribution, anything that asks "given a nodeId, where does that node live?" tomorrow.
- **Locked before the consumer lands** — the next task (factory parameterization + `nodeId` threading through the workflow) becomes trivial plumbing because the resolution logic is already proven.

Same gate-ladder discipline as task.0368: build the test before the refactor.

## Design

### Outcome

`@cogni/repo-spec` exports a pure function `extractNodePath(spec, nodeId): string | null` that resolves a node UUID to its registry-declared path. Future per-node consumers compose it as `extractNodePath(rootSpec, nodeId) ?? "."` to get a base path with operator-fallback semantics.

### Approach

**Solution**: One new exported function in `packages/repo-spec/src/accessors.ts`, sibling to `extractNodes`. Test cases added to the existing `tests/unit/packages/repo-spec/accessors.test.ts` (new `describe("extractNodePath", …)` block). Not a new file, not a new abstraction — same pattern as the four accessors already there.

```ts
/**
 * Resolve a node UUID to its relative path declared in the operator's nodes[] registry.
 *
 * Returns null if the registry has no entry for nodeId (caller decides fallback policy).
 * Empty/missing nodes[] → always null.
 *
 * Duplicate-tolerance: if multiple entries share the same node_id, the first match wins
 * (registry uniqueness is not this function's job; tighten via schema refinement upstream).
 *
 * Path safety: returns the path string from the registry verbatim — no normalization,
 * no traversal sanitization. The caller MUST validate before joining to a filesystem
 * root (e.g., reject paths containing "..", absolute paths, or null bytes).
 */
export function extractNodePath(spec: RepoSpec, nodeId: string): string | null {
  const entry = (spec.nodes ?? []).find((n) => n.node_id === nodeId);
  return entry?.path ?? null;
}
```

That's the whole production change. ~6 lines + the existing `NodeRegistryEntry` schema validation that already runs at `parseRepoSpec()` time.

**Test scenarios** (all pure, no I/O):

1. **Match** — registry has `{ node_id: "<uuid-A>", path: "nodes/poly" }`; `extractNodePath(spec, "<uuid-A>")` returns `"nodes/poly"`.
2. **Miss** — registry has entries but none match the supplied `nodeId`; returns `null`.
3. **Empty registry** — `nodes[]` is `[]`; returns `null` for any `nodeId`.
4. **Missing registry** — `spec.nodes` is undefined (non-operator repo-spec, where the field is optional); returns `null`.
5. **Operator self-match** — registry includes the operator's own `node_id` with `path: "nodes/operator"`; resolver returns `"nodes/operator"` (does NOT special-case the operator).
6. **Empty-string nodeId** — returns `null`. Locks no spurious match against any entry.
7. **Verbatim path return** — registry path is `"nodes/poly"` (no leading slash, no trailing slash); function returns the exact string with no normalization. Locks that this is a thin lookup, not a path normalizer.
8. **Duplicate node_id — first match wins** — registry contains two entries with the same `node_id` but different `path` values; function returns the first entry's path. Locks `Array.find` semantics so future schema-uniqueness refinement is an observable change, not a silent one.

### Boundary placement

Lives in `packages/repo-spec/` (shared package). Per packages-architecture.md:

- **Pure**: `(RepoSpec, string) → string | null`. No I/O, no env, no lifecycle.
- **Multi-runtime**: review handler (operator app), future scope router, future scheduler routing — all consume `@cogni/repo-spec`. > 1 runtime means shared package.
- **Domain accessor**: same shape as `extractNodes`, `extractDaoConfig`. Sits with its peers.

### Reuses

- Existing `RepoSpec` type + Zod schema (`packages/repo-spec/src/schema.ts:259-272` `nodeRegistryEntrySchema`)
- Existing `extractNodes(spec)` accessor (`accessors.ts:285-287`) — same shape, same file
- Existing test conventions in `tests/unit/packages/repo-spec/accessors.test.ts`
- Native `Array.prototype.find` — no library

### Rejected

- _Putting it in `nodes/operator/app/src/features/review/`_ — couples a generic registry lookup to one consumer. Future scope router, scheduler routing, attribution all want this same function.
- _Bundling the factory parameterization (#1) and `nodeId` workflow threading (#2) into this PR_ — defeats the gate. The resolver lands alone, locked by tests; consumers ride on top with confidence in a separate PR.
- _Returning a default of `"."` instead of `null`_ — bakes a policy ("on miss, fall back to root") into a domain accessor. Different consumers may want different fallbacks (review = root, scope router = throw, attribution = skip). Returning `null` keeps the function decision-free; the documented composition `?? "."` makes the review-side default obvious.
- _Adding a `nodeBasePath` resolver that does the `join(repoRoot, ...)` itself_ — mixes filesystem path composition with registry lookup. Filesystem joining belongs in the factory (which already owns `repoRoot`); registry lookup belongs here.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **PURE_ACCESSOR**: `extractNodePath` performs no I/O, no env reads, no logging. `(RepoSpec, string) → string | null` and nothing else.
- [ ] **NULL_ON_MISS**: Returns `null` (not `"."`, not `""`, not `undefined`) when no registry entry matches. Locked by scenarios 2, 3, 4, 6.
- [ ] **NO_OPERATOR_SPECIAL_CASE**: The function does not treat the operator's own `node_id` differently from any other node. If the operator is in the registry with `path: "nodes/operator"`, that's what comes back. Locked by scenario 5.
- [ ] **VERBATIM_PATH**: No normalization, trimming, or sanitization of the returned path string. Locked by scenario 7. Path-safety is a caller responsibility (see TSDoc).
- [ ] **FIRST_MATCH_WINS**: On duplicate `node_id` entries, returns the first match (`Array.prototype.find` semantics). Locked by scenario 8.
- [ ] **REGISTRY_IS_AUTHORITATIVE**: Resolution uses only `spec.nodes[]`. Does not read `spec.node_id` (which identifies _the spec's owner_, not a child).
- [ ] **SHARED_PACKAGE_HOME**: Lives in `packages/repo-spec/src/accessors.ts` next to `extractNodes`, exported via `packages/repo-spec/src/index.ts` (spec: packages-architecture).
- [ ] **GATE_BEFORE_CONSUMER**: This PR ships alone — no factory change, no workflow change, no review-handler change. The next task (factory + workflow threading) consumes the function.

### Files

<!-- High-level scope -->

- Modify: `packages/repo-spec/src/accessors.ts` — add `extractNodePath` function (~6 lines body + TSDoc).
- Modify: `packages/repo-spec/src/index.ts` — export `extractNodePath`.
- Modify: `tests/unit/packages/repo-spec/accessors.test.ts` — add `describe("extractNodePath", …)` block with 8 scenarios (~100 lines).
- Modify: none in `nodes/operator/app/`. (No consumer change.)
- No spec changes. `docs/spec/vcs-integration.md` updates land with the consumer task that actually changes review-handler behavior.

### Follow-on work

The factory parameterization (`createReviewAdapterDeps` accepts `nodeBasePath`), the `PrReviewWorkflowInput.nodeId` threading through the activity payload, the per-node `review.model` field, and the L4 convention test all land as separate `task.*` items at `needs_design` after this gate is green. Each consumes `extractNodePath` directly; none re-derive registry lookup logic.

**Open questions surfaced for the consumer task** (don't answer here; flag so the next implementer doesn't quietly choose):

- **Operator-PR resolution semantics** — the root `.cogni/repo-spec.yaml` registers the operator with `path: "nodes/operator"`, but operator review-rules currently live at root `.cogni/rules/`, **not** at `nodes/operator/.cogni/rules/` (the latter directory does not exist on main). When the consumer calls `extractNodePath(rootSpec, OPERATOR_NODE_ID)`, it gets `"nodes/operator"` — and resolves to a directory with no rules. The consumer must consciously choose: (a) follow the registry path and require operator rules to move/duplicate to `nodes/operator/.cogni/rules/`, (b) special-case the operator nodeId and fall back to `.` (root), or (c) introduce a `path: "."` registry entry for the operator. This resolver does not pre-empt the choice.
- **Path-safety enforcement** — `nodeRegistryEntrySchema` validates `path: z.string().min(1)`. Nothing prevents `path: "../../../etc"`. The TSDoc note above instructs callers to validate; a stronger fix is a Zod refinement on the schema. File a follow-on task to tighten `nodeRegistryEntrySchema` with a safe-relative-path regex before any consumer uses the path for `fs.readFile`.

## Validation

```yaml
exercise: |
  pnpm test tests/unit/packages/repo-spec/accessors.test.ts
observability: |
  Test output shows six passing scenarios for `extractNodePath`. CI unit job picks up
  the new cases automatically (existing file, existing include glob). `pnpm check`
  green: typecheck (function signature), lint, format, arch:check (shared-package
  rule), check:docs.
```

## Review Feedback — Strategic Alignment (revision 2)

Implementation review against task.0372 multi-node CI/CD plan + the two reviewer-policy requirements. APPROVE for what the PR claims to be (accessor + fixtures, both correct and locked); flagged that this is **necessary-but-not-sufficient** for the per-node reviewer story.

### Gap inventory (what this PR does NOT deliver)

1. **Static single-node-scope CI gate** — "PR can only touch 1 node scope (operator = infra)" is an invariant that requires a CI check, not a TS function. Best implemented as a bash gate over `turbo ls --affected --filter='./nodes/*/...'` (already integrated by task.0372) with an operator-infra path allowlist (`nodes/operator/**`, `infra/**`, `.github/**`, `packages/**`, `docs/**`, `work/**`). File as a separate task.

2. **Files-changed → owning-node TS resolver** — the AI reviewer runs inside the operator runtime where shelling to turbo is not available. Needs a TS sibling to `extractNodePath` with the inverse direction:

   ```ts
   extractOwningNode(spec: RepoSpec, paths: readonly string[]):
     | { kind: "single"; nodeId: string }
     | { kind: "operator-infra" }
     | { kind: "conflict"; nodes: readonly string[] }
     | { kind: "miss" }
   ```

   Path-prefix match against `spec.nodes[].path`, longest-match-wins, with explicit operator-infra recognition. **This is the load-bearing function** for routing reviews to per-node rules. File as a separate task.

3. **Reviewer wiring** — once #2 lands, `dispatch.server.ts` resolves owning node from PR diff, threads `nodeId` through `PrReviewWorkflowInput` (already on the wire, currently unused), and `extractNodePath` (this PR) provides the base path for `createReviewAdapterDeps(installationId, appId, key, nodeBasePath)`.

### Why ship this PR anyway

`extractNodePath` is the third of three composable steps (paths → nodeId → path → factory). Building all three in one PR would conflate concerns; building them separately keeps each gate-locked. Same gate-ladder discipline as task.0368.

### Position relative to task.0372

Task.0372 is **CI-side** matrix fan-out (multi-node PRs supported via parallel cells). The two reviewer-policy requirements above are **policy-side** (single-node-scope is forbidden, not just split). The two are not in conflict but they are not aligned either: task.0372 _can_ fan out across nodes; the policy _requires_ PRs to be single-node. The static gate above (#1) is what closes that policy gap and makes task.0372's matrix mostly degenerate to one cell per PR in practice (operator-infra PRs being the exception that legitimately has no node cells).
