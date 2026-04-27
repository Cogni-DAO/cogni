---
id: task.0382
type: task
title: "`extractOwningNode(spec, paths)` — TS resolver for files-changed → owning nodeId in operator runtime"
status: needs_merge
priority: 0
rank: 1
estimate: 1
summary: "Pure TS function in `@cogni/repo-spec` that takes a `RepoSpec` and a list of changed file paths and returns the owning domain: `{ kind: 'single', nodeId, rideAlongApplied? } | { kind: 'conflict', nodes } | { kind: 'miss' }`. The load-bearing function for routing AI PR reviews per-node. Inverse direction of task.0380's `extractNodePath`. Mirrors `tests/ci-invariants/classify.ts` (the CI gate's reference classifier) byte-for-byte; locked by shared-fixture parity test. Operator is a sovereign domain (Reading A per spec § Single-Domain Scope), not an infra exemption."
outcome: "When the AI reviewer fires on a PR webhook, `dispatch.server.ts` can call `extractOwningNode(rootSpec, changedPaths)` and route the review handler to the correct per-node `.cogni/rules/` directory deterministically — or refuse to review (returning a clear status) when the PR violates the single-node-scope policy that task.0381 enforces statically. Same routing logic, two enforcement points (CI for hard fail, reviewer for graceful skip + diagnostic comment)."
spec_refs:
  - vcs-integration
  - node-operator-contract
assignees: []
project: proj.vcs-integration
branch: feat/task-0382-extract-owning-node-resolver
pr: https://github.com/Cogni-DAO/node-template/pull/1057
reviewer: claude-code
revision: 1
blocked_by:
deploy_verified: false
created: 2026-04-25
updated: 2026-04-26
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

`@cogni/repo-spec` exports `extractOwningNode(spec, paths): OwningNode` — three-case discriminated union:

```ts
type OwningNode =
  | {
      kind: "single";
      nodeId: string;
      path: string;
      rideAlongApplied?: true;
    }
  | { kind: "conflict"; nodes: ReadonlyArray<{ nodeId: string; path: string }> }
  | { kind: "miss" };
```

The reviewer dispatches on `kind`:

- `single` → load `nodes/<path>/.cogni/rules/` and review. When `nodeId` is the operator, this is an "operator-only" PR (operator territory: `nodes/operator/**` ∪ `packages/**` ∪ `.github/**` ∪ `docs/**` ∪ root configs).
- `conflict` → post a "PR spans N domains, split before review" comment naming the conflicting nodes and the operator-territory paths; do not invoke gates.
- `miss` → empty diff; neutral no-op check.

### Approach

One new exported function in `packages/repo-spec/src/accessors.ts`, sibling to `extractNodes` and `extractNodePath`. Pure — no I/O, no env, no globals. Mirrors `tests/ci-invariants/classify.ts`.

**Domain classification** — must match `tests/ci-invariants/classify.ts` byte-for-byte (Reading A per `docs/spec/node-ci-cd-contract.md § Single-Domain Scope`):

- `domain(path) = X` if path starts with `nodes/<X>/` for X in non-operator registry entries.
- `domain(path) = operator` otherwise (catches `nodes/operator/**` ∪ `packages/**` ∪ `.github/**` ∪ `docs/**` ∪ `work/**` ∪ root configs).

Operator IS a domain — not an exemption. The operator owns its own node directory, the shared workspace packages, and all repo infra. A non-operator node cannot ride changes to operator territory along with its own code; that's a request into operator's domain and must be a separate, operator-owned PR.

**Mixed sovereign + operator → conflict**: `nodes/poly/foo.ts + nodes/operator/app/bar.ts` returns `{ kind: "conflict", nodes: [operator, poly] }`. Same for `nodes/poly/foo.ts + packages/repo-spec/x.ts` — packages/ is operator territory.

**Ride-along exception** (`RIDE_ALONG`): when domains is exactly `{operator, X}` and the only operator-domain path is `pnpm-lock.yaml`, drop operator → `{ kind: "single", nodeId: X, rideAlongApplied: true }`. Mechanical side-effect of node-level `package.json` bumps; pnpm-lock.yaml only.

### Path matching — flat top-level under `nodes/`

The match key is `path.split("/")[1]` when path starts with `nodes/`. Compare against `entry.path.split("/")[1]` for each non-operator registry entry. No longest-prefix-wins, no nesting — the registry is flat by convention (`nodes/operator`, `nodes/poly`, `nodes/resy`, `nodes/node-template`) and the schema can be tightened to enforce it. Matches `tests/ci-invariants/classify.ts` exactly.

`node-template` is sovereign by this rule (it's under `nodes/`, name is not `operator`). This is the desired behavior: template edits should not ride alongside poly edits.

### Reuses

- Existing `RepoSpec` type + `nodeRegistryEntrySchema` (`packages/repo-spec/src/schema.ts:259-272`)
- Existing `extractNodes(spec)` accessor (returns the array we iterate)
- task.0380's `extractNodePath` is the _return-side_ sibling — both consume the same registry data; composition only makes sense when narrowed (`if (r.kind === "single") extractNodePath(spec, r.nodeId)`).
- Native `Array.prototype.find` / `String.prototype.split` — no library, no regex.

### Rejected

- _Returning `string | null` like `extractNodePath` does_ — collapses three meaningful outcomes (single/conflict/miss/infra) into one. Caller would need a sentinel value or out-of-band signal for conflict. Discriminated union is the honest type.
- _Throwing on conflict_ — exceptions for control flow are wrong here; "conflict" is a _result_, not an error condition. Reviewer wants to dispatch on it, not catch it.
- _Operator-is-infra-exemption (Reading B)_ — earlier draft of this task treated `nodes/operator/**` and `packages/**` as infra that "rides along" any sovereign node PR. Rejected after design review with task.0381: operator paths are intent, not mechanical side-effect, and intent doesn't ride along. Cross-domain mixing returns `conflict` so contributors split the operator change into its own PR. Preserves operator's sovereignty over its territory and surfaces substrate-request friction as productive signal. The lockfile carve-out is the _only_ exception, bounded to `pnpm-lock.yaml` because it is mechanical side-effect of `package.json` intent.
- _Longest-prefix-wins for nested registry paths_ — premature; current registry is flat by convention. Add LPW the day a nested entry appears, not before.
- _Putting it in `nodes/operator/app/src/features/review/`_ — couples to one consumer. Future scope router, scheduler routing, attribution may all want this.
- _Bundling it with task.0381's CI gate_ — wrong altitude. Bash + turbo at CI time vs. TS + RepoSpec inside operator runtime. Both implement the same policy from different layers; both belong but separately.
- _Bundling it with the reviewer factory parameterization_ — defeats the gate-ladder. Function locked alone first, consumer rides on top.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **PURE_RESOLVER**: `extractOwningNode` performs no I/O, no env reads, no logging. `(RepoSpec, readonly string[]) → OwningNode` and nothing else.
- [ ] **DISCRIMINATED_UNION**: Return type is the three-case union (`single | conflict | miss`). No sentinel strings, no null-as-conflict.
- [ ] **OPERATOR_IS_A_DOMAIN**: Operator is a sovereign domain — `nodes/operator/**` ∪ `packages/**` ∪ `.github/**` ∪ `docs/**` ∪ root configs all classify as `operator`. Mixing with another sovereign returns `conflict`. (Was `OPERATOR_IS_INFRA`/exemption — flipped per spec § Single-Domain Scope.)
- [ ] **RIDE_ALONG**: When domains is `{operator, X}` and the only operator path is `pnpm-lock.yaml`, drop operator → `single { X, rideAlongApplied: true }`. The only carve-out from `OPERATOR_IS_A_DOMAIN`.
- [ ] **EMPTY_INPUT**: `extractOwningNode(spec, [])` returns `{ kind: "miss" }`. CI passes; the reviewer surfaces a no-op neutral check.
- [ ] **CONFLICT_ORDERING**: `conflict.nodes` is sorted by `nodeId.localeCompare` — deterministic so reviewer diagnostic comments don't flap.
- [ ] **NO_CROSS_VALIDATION**: This function does not validate path safety (no `..`, no absolute paths). Caller responsibility, same as `extractNodePath`. Documented in TSDoc.
- [ ] **POLICY_PARITY_WITH_0381**: This function and `tests/ci-invariants/classify.ts` produce equivalent verdicts on every shared fixture. Locked by `tests/ci-invariants/single-node-scope-parity.spec.ts` running both implementations against the same 8 fixtures.
- [ ] **REGISTRY_MIRRORS_FILESYSTEM**: Per spec, `spec.nodes` mirrors the `nodes/*` filesystem listing (meta-test enforces both directions). The resolver requires the operator entry to be present; throws with a clear message otherwise.

### Files

- Modify: `packages/repo-spec/src/accessors.ts` — add `extractOwningNode` function + `OwningNode` type (~40 lines body + TSDoc).
- Modify: `packages/repo-spec/src/index.ts` — export both.
- Modify: `tests/unit/packages/repo-spec/accessors.test.ts` — add `describe("extractOwningNode", …)` block (~10 scenarios, ~150 lines, consuming `@cogni/repo-spec/testing` fixtures from task.0380).
- Modify: `packages/repo-spec/AGENTS.md` — document new export.

### Test scenarios

1. **Single sovereign node** — paths all under `nodes/poly/...` → `{ kind: "single", nodeId: poly, path: "nodes/poly" }`.
2. **Operator-only (non-`nodes/` paths)** — `packages/`, `infra/`, `docs/`, `.github/` → `{ kind: "single", nodeId: operator, path: "nodes/operator" }`.
3. **Operator-only (`nodes/operator/**`)** — paths all under `nodes/operator/...`→`{ kind: "single", nodeId: operator, path: "nodes/operator" }`.
4. **Sovereign + non-`nodes/` path → conflict** — `nodes/poly/foo.ts` + `packages/repo-spec/bar.ts` → `{ kind: "conflict", nodes: [operator, poly] }`.
5. **Sovereign + `nodes/operator/**`→ conflict** —`nodes/poly/foo.ts`+`nodes/operator/app/bar.ts`→`{ kind: "conflict", nodes: [operator, poly] }`. (Operator is a domain, not exemption.)
6. **Conflict — two sovereign nodes** — `nodes/poly/foo.ts` + `nodes/resy/bar.ts` → `{ kind: "conflict", nodes: [poly, resy] }` (sorted by nodeId).
7. **Conflict — three sovereign nodes** → all three named in the conflict result, sorted by nodeId.
8. **Unregistered `nodes/<x>/` falls through to operator** — meta-test catches the registry/filesystem drift; resolver classifies as operator (matches bash gate's filesystem-driven default).
9. **Empty input** — `[]` → `{ kind: "miss" }`.
10. **node-template is sovereign** — paths under `nodes/node-template/...` resolve as sovereign when registered.
11. **`RIDE_ALONG`** — `nodes/poly/app/package.json + pnpm-lock.yaml` → `{ kind: "single", nodeId: poly, rideAlongApplied: true }`.
12. **`RIDE_ALONG` bounded** — `nodes/poly + pnpm-lock.yaml + .github/foo.yml` → `{ kind: "conflict", nodes: [operator, poly] }` (any extra operator-domain path defeats the carve-out).
13. **Throws when operator missing from registry on operator-only PR** — `REGISTRY_MIRRORS_FILESYSTEM` invariant enforcement.
14. **Parity with task.0381** — all 8 fixtures in `tests/ci-invariants/fixtures/single-node-scope/` produce identical verdicts when run through `extractOwningNode` (via the `OwningNode → ClassifyResult` translator) and `tests/ci-invariants/classify.ts`. Locked by `tests/ci-invariants/single-node-scope-parity.spec.ts`.

### Pairing with task.0381

These two tasks implement the **same policy at two layers**:

- **task.0381** (CI / pre-merge): bash + turbo at GitHub Actions level. Hard fail. Cheap, fast, runs without operator. Required status check.
- **task.0382** (reviewer / runtime): TS + RepoSpec inside operator. Soft fail with diagnostic comment. Runs where the AI reviewer lives.

Both must agree. If they disagree, that's a real bug — captured by a contract test that exercises a fixed PR diff against both implementations. **Defer the contract test to a follow-on**; ship 0381 + 0382 first, then the parity test once both exist.

## Links

- Handoff: [handoff](../handoffs/task.0382.handoff.md)

## Validation

```yaml
exercise: |
  pnpm test tests/unit/packages/repo-spec/accessors.test.ts
observability: |
  Test output shows the new extractOwningNode block (10 scenarios) passing alongside
  extractNodePath (8) + the existing 18 accessor tests = 36 total. CI unit job picks
  up via tests/unit/** glob — no config change.
```
