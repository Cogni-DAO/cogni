---
id: task.0374
type: task
title: "Node base-path resolver — `extractNodePath(spec, nodeId)` accessor + unit tests"
status: needs_implement
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
pr:
reviewer:
revision: 0
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
 * Returns null if the registry has no entry for nodeId (caller decides fallback policy).
 * Empty/missing nodes[] → always null.
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
5. **Operator self-match** — registry includes the operator's own `node_id` with `path: "nodes/operator"`; resolver returns `"nodes/operator"` (does NOT special-case the operator). Caller decides whether to map that to `repoRoot/.cogni` or `nodes/operator/.cogni`.
6. **Fallback composition** — assert the documented usage pattern `extractNodePath(spec, missingId) ?? "."` evaluates to `"."`. Locks the intended composition without baking the fallback into the function itself.

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
- [ ] **NULL_ON_MISS**: Returns `null` (not `"."`, not `""`, not `undefined`) when no registry entry matches. Locked by test scenarios 2, 3, 4.
- [ ] **NO_OPERATOR_SPECIAL_CASE**: The function does not treat the operator's own `node_id` differently from any other node. If the operator is in the registry with `path: "nodes/operator"`, that's what comes back. Locked by scenario 5.
- [ ] **REGISTRY_IS_AUTHORITATIVE**: Resolution uses only `spec.nodes[]`. Does not read `spec.node_id` (which identifies _the spec's owner_, not a child).
- [ ] **SHARED_PACKAGE_HOME**: Lives in `packages/repo-spec/src/accessors.ts` next to `extractNodes`, exported via `packages/repo-spec/src/index.ts` (spec: packages-architecture).
- [ ] **GATE_BEFORE_CONSUMER**: This PR ships alone — no factory change, no workflow change, no review-handler change. The next task (factory + workflow threading) consumes the function.

### Files

<!-- High-level scope -->

- Modify: `packages/repo-spec/src/accessors.ts` — add `extractNodePath` function (~6 lines body + TSDoc).
- Modify: `packages/repo-spec/src/index.ts` — export `extractNodePath`.
- Modify: `tests/unit/packages/repo-spec/accessors.test.ts` — add `describe("extractNodePath", …)` block with 6 scenarios (~80 lines).
- Modify: none in `nodes/operator/app/`. (No consumer change.)
- No spec changes. `docs/spec/vcs-integration.md` updates land with the consumer task that actually changes review-handler behavior.

### Follow-on work

The factory parameterization (`createReviewAdapterDeps` accepts `nodeBasePath`), the `PrReviewWorkflowInput.nodeId` threading through the activity payload, the per-node `review.model` field, and the L4 convention test all land as separate `task.*` items at `needs_design` after this gate is green. Each consumes `extractNodePath` directly; none re-derive registry lookup logic.

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
