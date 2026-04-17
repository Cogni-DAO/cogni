---
id: task.0317
type: task
title: "Per-node LangGraph catalogs — factory library + node-owned catalog registry"
status: needs_design
priority: 2
estimate: 3
rank: 5
summary: "Refactor the graph catalog model so each node's @cogni/<node>-graphs package owns its own single-source-of-truth catalog, while @cogni/langgraph-graphs becomes a shared factory library (graph creation functions, inproc runner, types). Removes the POLY_MERGED_CATALOG hack shipped in PR #887, collapses the 4-provider hand-swap boilerplate each new node currently needs, and aligns the graph layer with the sovereign-node model + agent-registry invariants."
outcome: "@cogni/langgraph-graphs exports factories/runtime/types but no global catalog. Each node's graphs package owns its own NODE_CATALOG const as the single source of truth for that node. The 4 provider files in each node's app import from the node's graphs package only — never from @cogni/langgraph-graphs directly. A dep-cruiser rule prevents that regression. Adding a node-specific graph is one edit in one package."
spec_refs:
  - agent-registry
assignees: derekg1729
created: 2026-04-16
updated: 2026-04-16
labels: [langgraph, graphs, refactor, architecture, sovereign-node]
external_refs:
  - https://github.com/Cogni-DAO/node-template/pull/887
---

# Per-node LangGraph Catalogs

> Follows PR #887 (fix/poly-brain-catalog-registration) — a hotfix that exposed the architectural gap this task closes.

## Context

PR #887 shipped `POLY_MERGED_CATALOG` inside the poly app (`nodes/poly/app/src/adapters/server/ai/langgraph/poly-catalog.ts`) as the minimum unblock for poly-brain's 404 on canary. The fix is correct but the shape is wrong — it plants the same trap for every future node:

- `@cogni/langgraph-graphs/src/catalog.ts:88` declares `LANGGRAPH_CATALOG` as a hardcoded `as const` literal with an invariant (`CATALOG_SINGLE_SOURCE_OF_TRUTH`) that assumes every graph lives in this one package.
- `@cogni/node-template-graphs` and `@cogni/resy-graphs` are currently stub re-exports of the generic catalog — they add nothing, but the scaffolding exists.
- `@cogni/poly-graphs` is the only one with node-specific graphs (`POLY_LANGGRAPH_CATALOG`), and until PR #887 nothing actually read it.
- `@cogni/operator-graphs` does not exist; operator uses the generic catalog directly.
- Each node's app duplicates four provider files (`inproc.provider.ts`, `inproc-agent-catalog.provider.ts`, `dev/provider.ts`, `bootstrap/graph-executor.factory.ts`) with hardcoded `import { LANGGRAPH_CATALOG } from "@cogni/langgraph-graphs"`.

Net effect: "single source of truth" is a lie as soon as any node adds one custom graph. poly proved it. resy and operator will hit the same wall.

## Goal

Collapse the hotfix into a principled layout:

- `@cogni/langgraph-graphs` = **factory library**. Exports graph factories (`createBrainGraph`, `createPoetGraph`, …), the inproc runner, runtime types, MCP utilities. No exported catalog.
- `@cogni/<node>-graphs` = **catalog owner for that node**. Exports a single `NODE_CATALOG` const (still frozen, still typed) that composes whichever generic factories the node wants + any node-specific graphs. This is the only catalog the node's app ever reads.
- Providers in each node's app import only from the node's graphs package. Never from `@cogni/langgraph-graphs` directly.
- A dep-cruiser rule enforces the boundary so the regression can't creep back.

## Why this shape

- **Sovereign-node alignment.** CLAUDE.md frames each node as its own sovereign app; this extends that model to graph catalogs. Today a bug in the generic catalog would simultaneously break poly, resy, operator, and node-template. Per-node catalogs firewall that.
- **Agent-registry invariants** (`docs/spec/agent-registry.md`).
  - `AGENT_ID_STABLE` — `agentId = providerId:graphName`. Per-node catalogs mean each node owns its namespace without cross-node leakage (today operator's `/api/v1/ai/agents` could theoretically expose poly-brain via a bootstrap misfire).
  - `STABLE_CANONICAL_SCHEMA` — the canonical schema is per-node; nothing upstream dictates which graphs each node registers.
  - `SINGLE_IDENTITY_PORT` — only one catalog feeds `AgentIdentityPort.register()` per node; today the provider reads one catalog but the identity port could see a different one if someone forgets.
- **Node-specific menus.** Poly doesn't need `pr-manager` or `git-reviewer`. Operator doesn't need `browser`. Today everyone silently inherits everything. Per-node catalogs let each node opt in.
- **Collapses new-node onboarding.** Adding a node-specific graph today = 6 file touches across 2 packages (graphs package + 4 provider files + app dep). After this task = 1 file touch in the node's graphs package.

## Scope (PR-sized)

**In scope:**

1. Move `LANGGRAPH_CATALOG` assembly out of `@cogni/langgraph-graphs`. Keep the const exported but mark deprecated with a re-export of a `GENERIC_GRAPH_FACTORIES` map (flat: `{ brain: createBrainGraph, poet: createPoetGraph, … }`) so each node assembles from that.
2. In each of `@cogni/node-template-graphs`, `@cogni/resy-graphs`, `@cogni/poly-graphs`: add `NODE_CATALOG` const assembled from the chosen generic factories + any node-specific entries. `poly-graphs` folds in what `POLY_LANGGRAPH_CATALOG` already has.
3. Create `@cogni/operator-graphs` with a `NODE_CATALOG` assembled from the operator-relevant generic factories (`pr-review`, `operating-review`, `pr-manager`, `git-reviewer` per current usage).
4. Update the 4 provider files × 4 nodes to import from their own node-graphs package only. Delete `nodes/poly/app/src/adapters/server/ai/langgraph/poly-catalog.ts`; its job moves into `@cogni/poly-graphs`.
5. Add a dep-cruiser rule: `nodes/*/app` may not import from `@cogni/langgraph-graphs`'s catalog export. Factories + runtime utilities still allowed.
6. Update `CATALOG_SINGLE_SOURCE_OF_TRUTH` invariant phrasing in `packages/langgraph-graphs/src/catalog.ts` and all four provider files to say "single source of truth **per node**" and reference the node's catalog.
7. Update spec: `docs/spec/agent-registry.md` (if it references `LANGGRAPH_CATALOG` as the canonical registry source) or add a short note that per-node catalogs are the `AgentIdentityPort.register()` input.

**Out of scope:**

- No new graphs in this task. Pure refactor.
- No changes to `AgentIdentityPort` or the registry persistence schema.
- No runtime behavior change for existing canary flows.

## Files (approximate)

- **Modify:** `packages/langgraph-graphs/src/catalog.ts`, `packages/langgraph-graphs/src/index.ts` (swap `LANGGRAPH_CATALOG` for `GENERIC_GRAPH_FACTORIES`; deprecate old export).
- **Modify:** `nodes/node-template/graphs/src/index.ts`, `nodes/resy/graphs/src/index.ts`, `nodes/poly/graphs/src/index.ts` (each exports `NODE_CATALOG`).
- **Create:** `nodes/operator/graphs/` package scaffold + `NODE_CATALOG`.
- **Modify:** 4 × `nodes/<node>/app/src/adapters/server/ai/langgraph/inproc.provider.ts`.
- **Modify:** 4 × `nodes/<node>/app/src/adapters/server/ai/langgraph/inproc-agent-catalog.provider.ts`.
- **Modify:** 4 × `nodes/<node>/app/src/adapters/server/ai/langgraph/dev/provider.ts`.
- **Modify:** 4 × `nodes/<node>/app/src/bootstrap/graph-executor.factory.ts`.
- **Delete:** `nodes/poly/app/src/adapters/server/ai/langgraph/poly-catalog.ts` (moved into `@cogni/poly-graphs`).
- **Modify:** `.dep-cruiser.cjs` — new rule blocking app-level `LANGGRAPH_CATALOG` import.
- **Modify:** `nodes/operator/app/package.json` — add `@cogni/operator-graphs`.

## Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] PER_NODE_CATALOG_SOT: every node's graphs package exports exactly one `NODE_CATALOG` and that is the only graph registry its app reads (spec: agent-registry)
- [ ] NO_DIRECT_GENERIC_CATALOG_IMPORT: `nodes/*/app/**` must not import the package-wide catalog export from `@cogni/langgraph-graphs` — enforced via dep-cruiser
- [ ] GENERIC_FACTORIES_STILL_SHARED: graph factory functions and the inproc runner stay in `@cogni/langgraph-graphs` (spec: architecture)
- [ ] AGENT_ID_STABLE: `agentId` format unchanged — `providerId:graphName`, one namespace per node (spec: agent-registry)
- [ ] NO_RUNTIME_BEHAVIOR_CHANGE: existing canary traffic unaffected — `poly-brain` continues to resolve on poly, `brain`/`poet` continue to resolve everywhere that used them pre-refactor
- [ ] SIMPLE_SOLUTION: deletes `poly-catalog.ts`, replaces it with a one-line import per provider file; no new abstractions introduced

## Validation

- [ ] `pnpm typecheck:{poly,node-template,resy}` + operator typecheck — all pass
- [ ] `pnpm --filter @cogni/{poly,node-template,resy,operator}-graphs build` — all pass
- [ ] Existing inproc + dev provider spec suites green (no behavior change expected)
- [ ] Post-deploy: Grafana confirms `poly-brain` still resolves on poly-test, `brain`/`poet` still resolve on other nodes
- [ ] dep-cruiser check fails if a reviewer adds `import { LANGGRAPH_CATALOG } from "@cogni/langgraph-graphs"` to app code
- [ ] `pnpm check:fast` green

## Out of Scope (explicit push-back list)

- Adding new graphs. If a graph needs to change hands between nodes in this refactor, flag and defer.
- `AgentIdentityPort` implementation work (task owned elsewhere, per agent-registry spec P0–P2 checklists).
- ERC-8004 publication path — per-node catalogs make it cleaner later but this task doesn't need to touch it.
- Tool-binding fan-out refactor. `core__wallet_top_traders` still stub-binds in non-poly nodes; that's a separate problem.

## Risks

| Risk                                                                             | Mitigation                                                                                                            |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Silent drop of a generic graph when a node's catalog is assembled                | Snapshot test per node: `expect(Object.keys(NODE_CATALOG).sort())` against a checked-in fixture                       |
| Import boundary violation regresses                                              | dep-cruiser rule + CI                                                                                                 |
| Operator-graphs package creation accidentally shifts operator's available graphs | Mirror current `LANGGRAPH_CATALOG` keys into `operator-graphs` for v1; trim in a follow-up with operator owner review |

## Related

- **PR #887** — fix/poly-brain-catalog-registration, the hotfix this cleans up.
- **docs/spec/agent-registry.md** — drives the per-node SoT posture via `AGENT_ID_STABLE`, `STABLE_CANONICAL_SCHEMA`, `SINGLE_IDENTITY_PORT`.
- **docs/spec/architecture.md** — packages-vs-apps boundary.
- **CLAUDE.md** — sovereign-node model.
