---
id: bug.0319
type: bug
title: "Move node-only ai-tools into nodes/<X>/packages/ai-tools to satisfy SINGLE_DOMAIN_HARD_FAIL; kill the global TOOL_CATALOG closed-world iteration"
status: needs_merge
branch: fix/per-node-ai-tools-design
pr: https://github.com/Cogni-DAO/node-template/pull/1080
priority: 1
rank: 50
estimate: 5
created: 2026-04-18
updated: 2026-04-27
summary: "The shared `@cogni/ai-tools` `TOOL_CATALOG` is a closed-world set: `createBoundToolSource` (in every node's bootstrap) iterates the global catalog and throws if any tool is missing a binding. So every new poly-only tool must be stub-bound in operator/, resy/, and node-template/ tool-bindings.ts. Beyond ceremony, this now structurally violates the new SINGLE_DOMAIN_HARD_FAIL invariant in spec.node-ci-cd-contract: a poly-only research tool PR (e.g. #1033) had to touch nodes/operator/, nodes/resy/, nodes/node-template/, AND packages/ai-tools/ — four domains in one PR. The `single-node-scope` job will reject every future poly-tool PR until tools live inside the node that owns them."
outcome: "Adding a new poly-only tool touches files only under `nodes/poly/**`. `single-node-scope` job passes. `nodes/operator/`, `nodes/resy/`, `nodes/node-template/` bootstrap files contain zero references to poly-only tool IDs, no stub imports, no stub bindings. The TOOL_CATALOG closed-world iteration is replaced with an open-world pattern: each node's bootstrap composes its own tool list from `@cogni/ai-tools` (core) + `@cogni/<node>-ai-tools` (node-owned). Bonus: container bootstrap for poly FAILS LOUD when poly-trade env is incomplete instead of silently registering a stub."
spec_refs:
  - spec.node-ci-cd-contract
  - spec.tool-use
assignees: []
project: proj.tool-use-evolution
related:
  - task.0315
  - task.0386
  - bug.0317
labels: [refactor, ai-tools, tech-debt, architecture, single-domain, ci-cd]
---

# bug.0319 — Move node-only ai-tools into the node that owns them

## Why this is now P1 (not just tech-debt)

[`spec.node-ci-cd-contract`](../../docs/spec/node-ci-cd-contract.md#single-domain-scope) introduced **`SINGLE_DOMAIN_HARD_FAIL`**: a PR may touch exactly one node domain. Domains:

```
poly         resy         node-template       operator
nodes/poly/  nodes/resy/  nodes/node-tmpl/    nodes/operator/  ∪  EVERYTHING ELSE
                                              (packages/, .github/, infra/, docs/, …)
```

Per Reading A in the spec: **operator paths are intent, not side-effect; intent doesn't ride along.** `packages/**` is part of the operator domain. The ride-along whitelist is `pnpm-lock.yaml` + `work/items/**` only.

Look at the file footprint of the most recent two poly-tool PRs:

| PR                                      | Files touched (domains)                                                                                 | Verdict under new gate         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------ |
| #1033 (poly-research, 8 Data-API tools) | `packages/ai-tools/**`, `nodes/poly/**`, `nodes/operator/**`, `nodes/resy/**`, `nodes/node-template/**` | **REJECT** — 4 domains touched |
| #1004 (vcs/pr endpoint)                 | `packages/ai-tools/**`, `nodes/operator/**`                                                             | OK (operator only)             |

Every future poly-tool PR is structurally blocked. Every future resy-tool or node-template-tool PR will be too. This is no longer "ceremony" — it's a hard wall.

## Root cause

```ts
// nodes/<X>/app/src/bootstrap/ai/tool-source.factory.ts
export function createBoundToolSource(
  bindings: ToolBindings
): StaticToolSource {
  for (const [toolId, boundTool] of Object.entries(TOOL_CATALOG)) {
    // ← closed-world iteration
    const impl = bindings[toolId];
    if (!impl) {
      throw new Error(
        `TOOL_BINDING_REQUIRED: Missing implementation binding for tool "${toolId}"`
      );
    }
    runtimes.push(contractToRuntime(boundTool.contract, impl));
  }
}
```

`TOOL_CATALOG` is global. Every node iterates the global set. Therefore every node must bind every tool — even tools it never exposes. The fix is **open-world**: each node composes its own `BoundTool[]` and the factory iterates _that_.

## Why "per-package split" (the old proposal) is insufficient

The original bug.0319 proposed `packages/poly-ai-tools/`, `packages/operator-ai-tools/`, etc. That's an improvement on bundle hygiene but **does not satisfy SINGLE_DOMAIN_HARD_FAIL**: `packages/**` is operator domain. A new poly tool would still be a `packages/poly-ai-tools/` (operator) + `nodes/poly/` (poly) PR — still cross-domain, still rejected.

The only layout that aligns with the contract is **node-owned tool packages**: poly-only tools live under `nodes/poly/packages/`, mirroring the existing `nodes/poly/packages/{db-schema, doltgres-schema, knowledge}` capability packages and `nodes/node-template/packages/knowledge`. `pnpm-workspace.yaml` already globs `nodes/*/packages/*`.

## Target shape

```
packages/ai-tools/                          core tools shared by ALL nodes:
                                              core__get_current_time, core__web_search,
                                              core__work_item_*, core__knowledge_*,
                                              core__repo_*, core__schedule_*, core__vcs_*,
                                              core__metrics_query
                                            (operator domain — true cross-cutting infra)

nodes/poly/packages/ai-tools/               poly-only tools:
                                              core__poly_place_trade, core__poly_list_orders,
                                              core__poly_cancel_order, core__poly_close_position,
                                              core__poly_data_* (7 Data-API tools),
                                              core__wallet_top_traders, core__market_list
                                              (decision: move with poly — see "Decision" below)

nodes/poly/packages/{db-schema, …}          (already exists — same shape)
nodes/poly/graphs/                          (already exists)
nodes/resy/packages/ai-tools/               not created until first resy-only tool ships
nodes/node-template/packages/ai-tools/      not created
nodes/operator/packages/ai-tools/           not created (operator imports core directly)
```

Each node's `app/src/bootstrap/ai/tool-bindings.ts` imports only what it exposes:

```ts
// nodes/poly/app/src/bootstrap/ai/tool-bindings.ts
import { createCoreToolBindings } from "@cogni/ai-tools";
import { createPolyToolBindings } from "@cogni/poly-ai-tools";

export function createToolBindings(deps: ToolBindingDeps): ToolBindings {
  return {
    ...createCoreToolBindings(deps),
    ...createPolyToolBindings(deps), // poly-only — operator/resy never see this import
  };
}
```

`createBoundToolSource` becomes open-world:

```ts
export function createBoundToolSource(
  contracts: readonly BoundTool[], // ← node decides which contracts to expose
  bindings: ToolBindings
): StaticToolSource {
  return createStaticToolSource(
    contracts.map(({ contract }) =>
      contractToRuntime(contract, bindings[contract.name])
    )
  );
}
```

## File-level migration plan

### Phase 1 — open-world plumbing (admin-merged substrate PR; touches all 4 nodes)

Lift the closed-world iteration. After this phase, nodes can declare smaller catalogs without reorganizing the package tree.

| File                                                  | Change                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ai-tools/src/catalog.ts`                    | Drop the singleton `TOOL_CATALOG`. Keep `createToolCatalog([...])` helper. Export per-tool `BoundTool` values for composition.           |
| `packages/ai-tools/src/index.ts`                      | Re-export per-tool barrels in groups (core / poly) so consumers pick scoped imports.                                                     |
| `nodes/*/app/src/bootstrap/ai/tool-source.factory.ts` | `createBoundToolSource(contracts, bindings)` — iterate caller-supplied `contracts`, not the global catalog. Identical change ×4.         |
| `nodes/*/app/src/bootstrap/container.ts`              | Pass node's contract list explicitly. Identical change ×4.                                                                               |
| `tests/arch/tool-catalog-no-global-iteration.test.ts` | New — grep that no production code iterates a global `TOOL_CATALOG` after the migration. (Imports of individual `BoundTool`s remain ok.) |

⚠️ **Domain note:** Phase 1 touches `nodes/{poly,operator,resy,node-template}/app/src/bootstrap/**` — 4 distinct node domains. The `single-node-scope` job will reject this PR. **Admin-override required at merge time** (acknowledged in PR body as a one-time substrate change). This is the same justification as Phase 2 and is intrinsic to migrating shared bootstrap code; the alternative would be 4 sequential per-node PRs with a backwards-compat shim in `packages/ai-tools/`, which trades atomicity for review noise.

**Latent dedup signal (out of scope, future cleanup):** `tool-source.factory.ts` is byte-identical across all 4 nodes today. A follow-up could lift it into `@cogni/ai-core`, after which Phase-1-style changes become a single operator-domain PR. Not in scope for this bug — flagged so a future contributor can pick it up.

### Phase 2 — extract `nodes/poly/packages/ai-tools/` (admin-merged substrate PR)

⚠️ **Domain note:** the `git mv` of `packages/ai-tools/src/tools/poly-*.ts` → `nodes/poly/packages/ai-tools/src/tools/` plus the operator/resy/node-template stub-binding deletions touches `packages/`, `nodes/poly/`, `nodes/operator/`, `nodes/resy/`, and `nodes/node-template/` — 4+ domains. The `single-node-scope` job will reject this PR. **Admin-override required at merge time**, declared in the PR body as a one-time substrate migration. After this PR lands, all _future_ poly-tool changes are single-domain (`poly`).

| File                                                                   | Change                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodes/poly/packages/ai-tools/package.json`                            | New package `@cogni/poly-ai-tools`. Mirror shape of `nodes/poly/packages/knowledge/package.json`.                                                                                                                                     |
| `nodes/poly/packages/ai-tools/tsconfig.json` + `tsup.config.ts`        | Mirror existing per-node-package config.                                                                                                                                                                                              |
| `nodes/poly/packages/ai-tools/src/tools/poly-*.ts` (13 files)          | `git mv` from `packages/ai-tools/src/tools/poly-*.ts`.                                                                                                                                                                                |
| `nodes/poly/packages/ai-tools/src/tools/wallet-top-traders.ts`         | `git mv` (see open question — recommend yes).                                                                                                                                                                                         |
| `nodes/poly/packages/ai-tools/src/tools/market-list.ts`                | `git mv` (see open question — recommend yes).                                                                                                                                                                                         |
| `nodes/poly/packages/ai-tools/src/capabilities/poly-data.ts`           | `git mv` PolyDataCapability + types.                                                                                                                                                                                                  |
| `nodes/poly/packages/ai-tools/src/capabilities/wallet.ts`, `market.ts` | `git mv` WalletCapability, MarketCapability if the tools above move.                                                                                                                                                                  |
| `nodes/poly/packages/ai-tools/src/index.ts`                            | Barrel: contracts, impl factories, capability types, `createPolyToolBindings(deps)`.                                                                                                                                                  |
| `packages/ai-tools/src/catalog.ts`                                     | Remove poly imports / catalog entries.                                                                                                                                                                                                |
| `packages/ai-tools/src/index.ts`                                       | Remove poly re-exports.                                                                                                                                                                                                               |
| `packages/ai-tools/package.json`                                       | (Possibly) drop poly-specific deps (`@polymarket/clob-client`, etc.) — confirm by build.                                                                                                                                              |
| `packages/ai-tools/AGENTS.md`                                          | Update Public Surface listing — drop poly-\* exports.                                                                                                                                                                                 |
| `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts`                     | Drop poly-tool imports from `@cogni/ai-tools`; import from `@cogni/poly-ai-tools`. Compose bindings.                                                                                                                                  |
| `nodes/operator/app/src/bootstrap/ai/tool-bindings.ts`                 | Delete every poly-_ import + every poly-_ stub binding entry.                                                                                                                                                                         |
| `nodes/resy/app/src/bootstrap/ai/tool-bindings.ts`                     | Same.                                                                                                                                                                                                                                 |
| `nodes/node-template/app/src/bootstrap/ai/tool-bindings.ts`            | Same.                                                                                                                                                                                                                                 |
| `nodes/poly/graphs/src/graphs/poly-research/tools.ts`                  | Import poly tool name constants from `@cogni/poly-ai-tools`.                                                                                                                                                                          |
| `nodes/poly/graphs/src/graphs/poly-brain/tools.ts`                     | Same.                                                                                                                                                                                                                                 |
| `nodes/poly/graphs/package.json`                                       | Add `@cogni/poly-ai-tools: workspace:*`.                                                                                                                                                                                              |
| `nodes/poly/app/package.json`                                          | Add `@cogni/poly-ai-tools: workspace:*`.                                                                                                                                                                                              |
| `pnpm-workspace.yaml`                                                  | No change — `nodes/*/packages/*` glob already covers it.                                                                                                                                                                              |
| `pnpm-lock.yaml`                                                       | Mechanical (ride-along whitelisted).                                                                                                                                                                                                  |
| `tsconfig*.json` path aliases (per-node)                               | Wire `@cogni/poly-ai-tools` resolution if any node uses path aliases over package exports.                                                                                                                                            |
| `.dependency-cruiser.cjs` (per-node)                                   | Allow `nodes/poly/app` → `@cogni/poly-ai-tools`. Forbid `nodes/{operator,resy,node-template}/app` → `@cogni/poly-ai-tools`. **This is the canonical enforcement of cross-node tool-import isolation — no separate arch test needed.** |
| `nodes/poly/packages/ai-tools/AGENTS.md`                               | New — short orientation, mirrors `nodes/poly/packages/knowledge/AGENTS.md`.                                                                                                                                                           |

**Will NOT touch any future poly-tool PR (proves the split worked):** `nodes/operator/**`, `nodes/resy/**`, `nodes/node-template/**`, `packages/ai-tools/**`.

### Phase 3 — fail-loud poly bootstrap (poly domain, separate PR)

Once poly-\* stubs are gone from operator/resy/node-template, poly's own conditional stub for `polyTradeCapability` becomes a degenerate state. Container bootstrap for poly should throw if `OPERATOR_WALLET_ADDRESS` / `POLY_CLOB_*` / `PRIVY_*` are not all set, instead of registering a runtime-throwing stub. See task.0315 CP4.25 — the stub pattern silently booted a non-functional pod on candidate-a until someone tried to trade.

**Pre-flight check (must pass before this PR merges):** `grep -rE "POLY_CLOB_|PRIVY_|OPERATOR_WALLET_ADDRESS" deploy/poly/ infra/` returns hits for every required var, AND a candidate-a poly pod boots cleanly with the current deploy config. Without this check, Phase 3 hard-breaks the candidate-a deploy on first reconcile.

| File                                                              | Change                                                                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `nodes/poly/app/src/bootstrap/container.ts`                       | Validate poly env on boot; throw with named missing vars; remove the optional `polyTradeCapability?` from `ToolBindingDeps`.     |
| `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts`                | Drop the `polyPlaceTradeStubImplementation` / `polyListOrdersStubImplementation` / `polyCancelOrderStubImplementation` branches. |
| `nodes/poly/packages/ai-tools/src/tools/poly-place-trade.ts` etc. | Optionally delete the `*StubImplementation` exports — no longer needed anywhere.                                                 |

This PR is poly-domain only.

## Decision — `core__market_list` and `core__wallet_top_traders` move with poly

Both tools are consumed only by `nodes/poly/graphs/poly-research` today and are inherently Polymarket-specific (Gamma + Data API). YAGNI: **they move into `nodes/poly/packages/ai-tools/` in Phase 2.** If a second node ever needs market data, hoist them back into `packages/ai-tools/` at that point — that is exactly the substrate-request signal Reading A in spec.node-ci-cd-contract is designed to surface. Locked in to remove an implement-time fight; revisitable if a real second consumer appears.

## Validation

**Acceptance:**

1. `git diff --name-only main...HEAD` for a future "add a new poly-only tool" PR contains paths only under `nodes/poly/**` (plus optionally `pnpm-lock.yaml`, `work/items/**`).
2. `single-node-scope` CI job passes for that PR with `domain = poly`.
3. `grep -r "POLY_PLACE_TRADE_NAME\|POLY_DATA_.*_NAME\|WALLET_TOP_TRADERS_NAME\|polyPlaceTradeStub\|polyListOrdersStub" nodes/operator/ nodes/resy/ nodes/node-template/` returns zero hits.
4. `grep -rn "TOOL_CATALOG" packages/ nodes/ --include="*.ts" | grep -v test | grep -v node_modules` returns no production iteration sites — all consumers use scoped contract lists.
5. Booting poly with intentionally missing `POLY_CLOB_*` env throws at startup (Phase 3), not at first invocation.
6. Pre-Phase-3 deploy-config check: every required poly env var is wired in `deploy/poly/` and a candidate-a poly pod boots cleanly under current config.

**Enforcement strategy:**

- Cross-node import isolation → **dependency-cruiser per-node rules** (canonical, per POLICY_STAYS_LOCAL). One arch test would duplicate what depcruise already does.
- "No global TOOL_CATALOG iteration" → **`tests/arch/tool-catalog-no-global-iteration.test.ts`** (a depcruise rule can't easily express "iterates" vs "imports a single entry").

## Sequencing & risk

- Phase 1 is the highest-risk change (touches every node's `container.ts` and the catalog). Land it isolated and bake on candidate-a for a day before Phase 2.
- Phase 2 requires Phase 1. Without the open-world factory, moving poly tools out of `packages/ai-tools` immediately breaks operator/resy/node-template bootstrap.
- Phase 3 depends on Phase 2 having removed cross-node stub references. Otherwise removing the stub export breaks every other node.

## Design

### Outcome

A poly-only ai-tool PR (e.g. "add `core__poly_data_market_outcomes`") touches files only under `nodes/poly/**`, passes `single-node-scope` with `domain = poly`, and merges without amending operator/resy/node-template bootstrap. Same shape applies to any future node-only tool.

### Approach

**Solution**: Two architectural moves, executed in three sequenced PRs.

1. **Open-world tool source factory** — `createBoundToolSource(contracts, bindings)` iterates a caller-supplied contract list instead of the singleton `TOOL_CATALOG`. Each node composes its own `BoundTool[]` from `@cogni/ai-tools` (core) + zero or more `@cogni/<node>-ai-tools` (node-owned) packages.
2. **Node-owned tool packages at `nodes/<X>/packages/ai-tools/`** — physically relocate poly-only tool files into poly's domain. Mirrors the established `nodes/poly/packages/{db-schema,doltgres-schema,knowledge}` capability-package pattern; no new workspace globs needed.

**Reuses**:

- `nodes/poly/packages/knowledge/` — exact package shape (package.json exports, tsup.config, tsconfig) is copy-paste.
- `nodes/poly/graphs/` — precedent for node-owned langgraph code; tools follow the same boundary logic.
- `pnpm-workspace.yaml` — already globs `nodes/*/packages/*`. Zero workspace plumbing.
- Existing `createStaticToolSource` from `@cogni/ai-core` — open-world primitive; we only change what we feed it.
- Existing dependency-cruiser config per node — extend rules, no new tooling.
- Existing meta-test machinery (`tests/ci-invariants/single-node-scope-meta.spec.ts`) — add one arch test in the same style.

**Rejected**:

- **`packages/<node>-ai-tools/` (the original bug.0319 proposal)** — `packages/**` is operator domain per spec.node-ci-cd-contract. Adding a poly tool would still mean a `packages/poly-ai-tools/` + `nodes/poly/` PR — two domains, rejected by `single-node-scope`. Solves bundle hygiene but not the structural problem.
- **"Just make iteration tolerant of missing bindings"** — band-aid. Removes the throw but leaves the global catalog visible to every node, keeps bundle bloat, and still makes adding a poly tool a `packages/ai-tools/catalog.ts` edit (operator domain) plus `nodes/poly/` (poly domain). Still two domains.
- **Plugin/registry pattern (each tool self-registers via side-effect import)** — adds a runtime registry, fights tree-shaking, breaks ESM purity, and obscures the explicit composition that `tool-bindings.ts` provides today. More moving parts, less clarity.
- **Phase 2a/2b copy-then-delete split** — adds a duplicated-source window (poly tools exist in both places) and two PRs instead of one. Single substrate-migration PR is cleaner; the cross-domain nature is intrinsic to the migration itself and acceptable as a one-time admin-merged change.
- **4 sequential per-node Phase 1 PRs (each single-domain) with backwards-compat shim** — preserves the gate but adds a temporary `legacyToolCatalog` export to `packages/ai-tools/`, four review cycles, and a window where nodes are out of sync. Atomic admin-merged PR is simpler given admin authority is available.
- **Atomic `core__` → `poly__` rename in Phase 2** — touches every name constant, every poly-research/poly-brain `toolIds` array, golden fixtures, and saved `ToolInvocationRecord` payloads in production transcripts. Strictly larger blast radius than the file move alone. Defer until a real name collision appears.

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] **SINGLE_DOMAIN_HARD_FAIL**: every PR after this work touches exactly one node domain (spec: spec.node-ci-cd-contract §Single-Domain Scope)
- [ ] **POLICY_STAYS_LOCAL**: depcruise rules per-node — no shared depcruise config (spec: spec.node-ci-cd-contract §Core Invariants 2)
- [ ] **TOOL_BINDING_REQUIRED → TOOL_BINDING_LOCAL**: bindings still validated, but against the _node's_ contract list, not a global catalog (spec: spec.tool-use)
- [ ] **TOOL_ID_STABILITY**: `core__` prefix unchanged; tool IDs do not change during the move (spec: spec.tool-use)
- [ ] **TOOL_ID_NAMESPACED**: poly-owned tools keep the `core__` prefix for v0. Renaming to `poly__` would change every `*_NAME` constant, every poly-research/poly-brain `toolIds` array, every contract-test fixture, and every saved `ToolInvocationRecord` in production transcripts — strictly larger blast radius than the file move. Defer to a follow-up bug only if a name collision actually appears with a future node tool.
- [ ] **NO_SRC_IMPORTS / NO_SERVICE_IMPORTS**: `nodes/poly/packages/ai-tools/` follows package isolation rules (spec: packages-architecture)
- [ ] **PURE_LIBRARY**: no env loading, no process lifecycle in the new package; capability instances are constructor-injected at the app layer (spec: packages-architecture §7)
- [ ] **NO_STUB_AT_RUNTIME (Phase 3)**: poly env validated at boot; no conditional stub registration (spec: spec.tool-use)
- [ ] **SIMPLE_SOLUTION**: copies the existing `nodes/poly/packages/knowledge` shape; introduces zero new abstractions; deletes more code than it adds in Phases 2 and 3
- [ ] **ARCHITECTURE_ALIGNMENT**: matches the established node-package pattern (spec: architecture, packages-architecture)
- [ ] **REUSE_OVER_REBUILD**: no new factories, no plugin/registry layer, no MCP-style discovery — just relocation + parameter change

### Files

<!-- High-level scope — full per-phase enumeration in the migration plan above -->

**Phase 1 (admin-merged substrate PR — 4 node domains):**

- Modify: `packages/ai-tools/src/catalog.ts` — drop singleton `TOOL_CATALOG`, keep `createToolCatalog()` helper
- Modify: `packages/ai-tools/src/index.ts` — group exports (core / poly), keep individual `BoundTool` exports
- Modify: `nodes/{poly,operator,resy,node-template}/app/src/bootstrap/ai/tool-source.factory.ts` — iterate caller-supplied contracts (identical change ×4)
- Modify: `nodes/{poly,operator,resy,node-template}/app/src/bootstrap/container.ts` — pass node's contract list (identical change ×4)
- Create: `tests/arch/tool-catalog-no-global-iteration.test.ts` — grep production code for `TOOL_CATALOG` iteration

**Phase 2 (admin-merged substrate PR — operator + 4 node domains):**

- Create: `nodes/poly/packages/ai-tools/{package.json, tsconfig.json, tsup.config.ts, AGENTS.md, src/index.ts}` — new package shell
- Move (`git mv`): all poly-\* tool files + `wallet-top-traders.ts` + `market-list.ts` + poly/wallet/market capability interfaces from `packages/ai-tools/src/` → `nodes/poly/packages/ai-tools/src/`
- Modify: `packages/ai-tools/src/{catalog.ts,index.ts}` — remove poly imports/exports
- Modify: `packages/ai-tools/AGENTS.md` — drop poly-\* exports from Public Surface listing
- Modify: `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts` — import from `@cogni/poly-ai-tools`
- Modify: `nodes/{operator,resy,node-template}/app/src/bootstrap/ai/tool-bindings.ts` — delete poly-\* stub bindings + imports
- Modify: `nodes/poly/{app,graphs}/package.json` — add `@cogni/poly-ai-tools` dep
- Modify: `nodes/poly/graphs/src/graphs/{poly-research,poly-brain}/tools.ts` — re-source name constants
- Modify: per-node `.dependency-cruiser.cjs` — allow `nodes/poly/app` → `@cogni/poly-ai-tools`; forbid for other nodes (canonical isolation enforcement)

**Phase 3 (poly domain, separate PR):**

- **Pre-flight (gate):** verify deploy config has every required poly env var; verify a current candidate-a poly pod boots cleanly under it
- Modify: `nodes/poly/app/src/bootstrap/container.ts` — fail-loud env validation
- Modify: `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts` — drop `polyTradeCapability?` optional path
- Modify: `nodes/poly/packages/ai-tools/src/tools/poly-{place-trade,list-orders,cancel-order}.ts` — optionally delete `*StubImplementation` exports

**Tests:**

- `tests/arch/tool-catalog-no-global-iteration.test.ts` (Phase 1) — only arch test added
- Per-node depcruise rules (Phase 2) — canonical cross-node isolation
- Unit tests for moved tools relocate alongside the tool files; poly graphs vitest config already covers `nodes/poly/**`

## Plan (Implementation Checkpoints)

Single PR, multiple checkpoints. Candidate-a flighting happens on this PR after Checkpoint 1.

- [x] **Checkpoint 1 — Phase 1: Open-world tool source factory (back-compat preserved)** ✅ landed (commit `3a225cc03`, validated on candidate-a → 🟢 PASS)
- [x] **Checkpoint 2 — Phase 2: Extract `@cogni/poly-ai-tools`** ✅ landed (commit `05fef38f3` + DRY cleanup `b8d3dd7d9`)
- [x] **Checkpoint 3 — Drop dead poly trade tools from agent surface (Path A)** ✅ landed
  - **Pivot from original Phase 3 design:** discovered during pre-flight that poly's `polyTradeCapability` is intentionally always-undefined post-cutover (single-operator surface was a v0 regression awaiting per-tenant `PolyTradeExecutor` re-wire). Original "fail-loud on missing env" plan didn't apply — env IS set; the surface was deliberately disconnected. Path A removes the dead surface area honestly: drop `polyPlaceTrade`/`polyListOrders`/`polyCancelOrder` from POLY_TOOL_BUNDLE + bindings; drop optional `polyTradeCapability?` from `ToolBindingDeps`. Contracts stay exported from `@cogni/poly-ai-tools` for the future re-wire.
  - Milestone: each node's `container.ts` explicitly passes its full contract list to `createBoundToolSource(contracts, bindings)`. Runtime behavior is byte-identical to today (each node still composes the full set), but the iteration site moves from inside the shared factory to the node's container. Enables Checkpoint 2 to scope per-node bundles without touching the factory again.
  - Invariants: `TOOL_BINDING_REQUIRED → TOOL_BINDING_LOCAL`, `SIMPLE_SOLUTION`, `ARCHITECTURE_ALIGNMENT`
  - Todos:
    - [ ] Add `CORE_TOOL_BUNDLE` and `POLY_TOOL_BUNDLE` (`readonly CatalogBoundTool[]`) to `packages/ai-tools/src/catalog.ts` — composition signal for Phase 2; TOOL_CATALOG itself unchanged (still exported for back-compat with `@cogni/langgraph-graphs` runtime helpers and existing test).
    - [ ] Re-export the bundles from `packages/ai-tools/src/index.ts`.
    - [ ] Modify `nodes/{poly,operator,resy,node-template}/app/src/bootstrap/ai/tool-source.factory.ts` — `createBoundToolSource(contracts: readonly CatalogBoundTool[], bindings: ToolBindings)`; iterate caller-supplied `contracts`.
    - [ ] Modify `nodes/{poly,operator,resy,node-template}/app/src/bootstrap/container.ts` — pass `[...CORE_TOOL_BUNDLE, ...POLY_TOOL_BUNDLE]` (preserves current behavior).
    - [ ] Create `tests/arch/tool-catalog-no-global-iteration.test.ts` — assert no file under `nodes/*/app/src/bootstrap/` iterates `TOOL_CATALOG` (Object.entries / Object.values / Object.keys). `packages/langgraph-graphs/src/runtime/` is explicitly out of scope until a future cleanup; documented in the test file.
    - [ ] Update `packages/ai-tools/AGENTS.md` Public Surface listing — add the two bundle exports.
  - Validation/Testing:
    - [ ] What can now function e2e? Identical to today — each node boots, exposes the same tool set, all existing graphs work. Plus: the new arch test fires if anyone tries to re-iterate TOOL_CATALOG inside a node's bootstrap.
    - Test levels:
      - [ ] unit: `pnpm --filter @cogni/ai-tools test` (catalog test still passes since TOOL_CATALOG unchanged)
      - [ ] arch: `pnpm vitest run tests/arch/tool-catalog-no-global-iteration.test.ts`
      - [ ] check:fast at end of checkpoint (typecheck + lint + unit)

- [ ] **Checkpoint 2 — Phase 2: Extract `@cogni/poly-ai-tools` into `nodes/poly/packages/ai-tools/`**
  - Milestone: all 13 poly-only tool files + `wallet-top-traders` + `market-list` + their capability interfaces live under `nodes/poly/packages/ai-tools/`. `operator/resy/node-template` have zero poly-\* imports or stub bindings. Each node's container passes only the bundles it owns. `single-node-scope` would now pass for any future poly-tool PR.
  - Invariants: `SINGLE_DOMAIN_HARD_FAIL`, `POLICY_STAYS_LOCAL`, `NO_SRC_IMPORTS`, `NO_SERVICE_IMPORTS`, `PURE_LIBRARY`, `TOOL_ID_STABILITY` (no rename), `TOOL_ID_NAMESPACED` (defer `core__` → `poly__`)
  - Todos:
    - [ ] Scaffold `nodes/poly/packages/ai-tools/{package.json, tsconfig.json, tsup.config.ts, AGENTS.md, src/index.ts}` mirroring `nodes/poly/packages/knowledge/`.
    - [ ] `git mv` poly tool files + capability interfaces from `packages/ai-tools/src/` → `nodes/poly/packages/ai-tools/src/`.
    - [ ] Update barrels: remove poly exports from `packages/ai-tools/src/{catalog.ts,index.ts}`; export from new package.
    - [ ] Update `packages/ai-tools/AGENTS.md` Public Surface — drop poly entries.
    - [ ] Update `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts` — import from `@cogni/poly-ai-tools`.
    - [ ] Delete poly stub bindings + imports from `nodes/{operator,resy,node-template}/app/src/bootstrap/ai/tool-bindings.ts`.
    - [ ] Update `nodes/poly/{app,graphs}/package.json` — add `@cogni/poly-ai-tools: workspace:*`.
    - [ ] Update `nodes/poly/graphs/src/graphs/{poly-research,poly-brain}/tools.ts` — re-source name constants.
    - [ ] Update per-node `.dependency-cruiser.cjs` — allow `nodes/poly/app` → `@cogni/poly-ai-tools`; forbid for others.
  - Validation/Testing:
    - [ ] What can now function e2e? Poly node boots and exposes the same tools (now from `@cogni/poly-ai-tools`). Operator/resy/node-template boot with strictly smaller tool sets (poly tools removed entirely). poly-research and poly-brain graphs run with re-sourced constants.
    - Test levels:
      - [ ] unit: `pnpm --filter @cogni/poly-ai-tools test` (relocated tool tests)
      - [ ] unit: `pnpm --filter @cogni/ai-tools test` (catalog test updated for slimmer set)
      - [ ] arch: depcruise per-node — `pnpm --filter <node>-app arch:check`
      - [ ] check:fast at end of checkpoint

- [ ] **Checkpoint 3 — Phase 3: Fail-loud poly bootstrap**
  - Milestone: poly's container throws at startup with named missing vars when `OPERATOR_WALLET_ADDRESS` / `POLY_CLOB_*` / `PRIVY_*` are incomplete. `polyTradeCapability?` optional path is removed. No more `polyPlaceTradeStubImplementation` invocation site.
  - Invariants: `NO_STUB_AT_RUNTIME`
  - Pre-flight gate:
    - [ ] `grep -rE "POLY_CLOB_|PRIVY_|OPERATOR_WALLET_ADDRESS" deploy/poly/ infra/` shows every required var is wired
    - [ ] Current candidate-a poly pod is healthy under existing config (i.e., the env is real, not just declared)
  - Todos:
    - [ ] `nodes/poly/app/src/bootstrap/container.ts` — env validation block; throw with named missing vars; remove conditional construction.
    - [ ] `nodes/poly/app/src/bootstrap/ai/tool-bindings.ts` — drop optional `polyTradeCapability?`; remove stub fallback branches for poly_place_trade / poly_list_orders / poly_cancel_order.
    - [ ] Optionally delete `*StubImplementation` exports from the moved poly tool files in `nodes/poly/packages/ai-tools/`.
  - Validation/Testing:
    - [ ] What can now function e2e? Boot with intentionally missing `POLY_CLOB_*` throws at startup with a clear error. Boot with full env succeeds and trade tools work.
    - Test levels:
      - [ ] unit: `pnpm --filter @cogni/poly-app test` (env validation test)
      - [ ] check:fast at end of checkpoint

## Related

- [spec.node-ci-cd-contract](../../docs/spec/node-ci-cd-contract.md) — SINGLE_DOMAIN_HARD_FAIL invariant; this bug exists because the current ai-tools layout violates it
- [task.0315](./task.0315.poly-copy-trade-prototype.md) — CP4.25 introduced the original `POLY_PLACE_TRADE_NAME` stub ceremony
- [task.0386](./task.0386.poly-agent-wallet-research-v0.md) / PR #1033 — most recent example of a 4-domain poly-tool PR; would be rejected by single-node-scope today
- [bug.0317](./bug.0317.candidate-flight-infra-hardcoded-main.md) — adjacent CI/CD plumbing cleanup
- [proj.tool-use-evolution](../projects/proj.tool-use-evolution.md) — owning project
