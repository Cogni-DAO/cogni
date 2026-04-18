---
id: bug.0319
type: bug
title: "Split @cogni/ai-tools into per-node packages; kill the shared TOOL_CATALOG stub dance"
status: needs_triage
priority: 2
rank: 99
estimate: 5
created: 2026-04-18
updated: 2026-04-18
summary: "Every time a new tool is added to the shared @cogni/ai-tools TOOL_CATALOG, EVERY node's tool-bindings.ts must register the tool (stub for nodes that don't expose it, real impl for those that do). This is because createBoundToolSource iterates TOOL_CATALOG and throws if any tool is missing a binding. The node-scoped poly-trade capability today ships four extra import lines + stub registrations across operator / resy / node-template / poly just to satisfy the iteration — pure ceremony. Mirror the @cogni/<node>-graphs split: per-node ai-tools packages that declare only the tools that node actually exposes, then drop the shared catalog's closed-world assumption."
outcome: "Poly-only tools (core__poly_place_trade, core__poly_list_orders, core__wallet_top_traders, core__market_list) live in @cogni/poly-ai-tools and are only imported by nodes/poly. Operator / resy / node-template bootstrap no longer import any of these, no stub file exists for them, and adding a new poly tool touches zero files outside nodes/poly. Additionally: when a node's poly-trade capability env is incomplete, container bootstrap FAILS LOUD instead of registering a stub — 'capability optional in poly' is not a valid runtime state."
spec_refs: []
assignees: []
project: proj.cicd-services-gitops
related:
  - task.0315
labels: [refactor, ai-tools, tech-debt, architecture]
---

# bug.0319 — Split @cogni/ai-tools into per-node packages

## Evidence of the pain

Every new poly-only tool requires edits in these files BEFORE it functions:

```
packages/ai-tools/src/tools/<new-tool>.ts                       (new file — OK)
packages/ai-tools/src/catalog.ts                                (register in TOOL_CATALOG)
packages/ai-tools/src/index.ts                                  (barrel export)
nodes/poly/app/src/bootstrap/ai/tool-bindings.ts                (real impl or stub)
nodes/operator/app/src/bootstrap/ai/tool-bindings.ts            (STUB — only to not throw)
nodes/resy/app/src/bootstrap/ai/tool-bindings.ts                (STUB — only to not throw)
nodes/node-template/app/src/bootstrap/ai/tool-bindings.ts       (STUB — only to not throw)
nodes/poly/graphs/src/graphs/poly-brain/tools.ts                (add to POLY_BRAIN_TOOL_IDS)
```

3 of those 8 files exist only to satisfy the closed-world iteration. The comment on each stub registration literally says:

```ts
// Poly list-orders: poly-only tool. Stub here so the shared TOOL_CATALOG
// iteration in createBoundToolSource does not throw.
[POLY_LIST_ORDERS_NAME]:
  polyListOrdersStubImplementation as AnyToolImplementation,
```

That is not architecture, it is ceremony.

## Target shape

```
packages/ai-tools/                   core tools shared by every node (get_current_time, web_search, work_item_*, knowledge_*, repo_*, schedule_*, vcs_*, metrics_query)

packages/poly-ai-tools/              poly-only tools:
                                       core__poly_place_trade
                                       core__poly_list_orders
                                       core__wallet_top_traders
                                       core__market_list

packages/operator-ai-tools/          operator-only tools (if any; otherwise leave empty)
packages/resy-ai-tools/              resy-only tools
```

Each node's bootstrap imports its own scoped package(s) + the shared core. `createBoundToolSource` takes the node's union of bound tools as input, not a global catalog; iteration scope = node scope.

## Why not "just make iteration tolerant of missing bindings"

That's a band-aid: it removes the throw but leaves the global catalog entry visible to every node, wastes bundle size, and keeps the cross-node import cycle intact. Scoping is the real fix.

## Secondary cleanup that falls out of the split

Once per-node packages exist, the degenerate state "poly boots but polyTradeCapability is undefined so the tool stubs itself" stops being necessary. Container bootstrap for poly should FAIL LOUD if POLY*PROTO*_ + POLY*CLOB*_ are not all set — not paper over the gap with a stub that throws at invocation time. See task.0315 CP4.25 where the stub pattern silently booted a non-functional pod on candidate-a until someone tried to trade.

## Validation

Fixed when: adding a new poly-only tool touches zero files under `nodes/operator/`, `nodes/resy/`, `nodes/node-template/`, or `packages/ai-tools/`. CI test asserts `packages/ai-tools/src/catalog.ts` contains no entries that are registered as stubs in more than one node.

## Related

- [task.0315](./task.0315.poly-copy-trade-prototype.md) — CP4.25 introduced the fifth `POLY_PLACE_TRADE_NAME` stub ceremony; adding CP4.3's read tool required a sixth.
- [bug.0317](./bug.0317.candidate-flight-infra-hardcoded-main.md) — related CI/CD plumbing cleanup from the same flight.
