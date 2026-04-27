---
id: bug.0386
type: bug
title: "@cogni/node-contracts package leaks node-specific contracts (poly.*, resy.*) into the shared cross-node surface"
status: needs_triage
priority: 2
rank: 12
estimate: 3
summary: "`packages/node-contracts/` is documented as 'Shared Zod route contracts and HTTP router definitions for all node apps' (the node-template's cross-node surface), but in practice 12+ `poly.*` contracts and other node-specific shapes have accumulated there. Node-specific contracts must live with the owning node (e.g. `nodes/poly/packages/contracts/` or `nodes/poly/app/src/contracts/`) so a forked node-template repo can ship without inheriting another node's HTTP shapes. Discovered while shipping task.0389 (poly wallet PnL single-source) — the contract change was made in-place rather than relocating to avoid scope creep."
outcome: "`@cogni/node-contracts` contains only truly cross-node shapes (HTTP envelope, error, internal scheduler-worker contracts, generic billing/grant/run-stream primitives, etc). All `poly.*` contracts move to a poly-owned package or app contracts dir. Same for any other node-specific contracts. Forking node-template into a new node no longer drags in a sibling node's HTTP surface."
spec_refs:
  - packages-architecture
assignees: []
project: proj.poly-copy-trading
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [packages, node-contracts, architecture, multi-node, cleanup, followup]
external_refs:
  - packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts
  - packages/node-contracts/AGENTS.md
  - work/items/task.0389.poly-wallet-pnl-single-source.md
---

# bug.0386 — `@cogni/node-contracts` leaks node-specific contracts

## What happened

`packages/node-contracts/AGENTS.md` declares the package as:

> Shared Zod route contracts and HTTP router definitions for all node apps. PURE_LIBRARY — no env vars, no process lifecycle, no framework deps.

In practice, the package has accumulated **12 poly-specific contracts**:

```
packages/node-contracts/src/
  poly.copy-trade.orders.v1.contract.ts
  poly.copy-trade.targets.v1.contract.ts
  poly.research-report.v1.contract.ts
  poly.sync-health.v1.contract.ts
  poly.wallet-analysis.v1.contract.ts          ← touched by task.0389
  poly.wallet.balance.v1.contract.ts
  poly.wallet.balances.v1.contract.ts
  poly.wallet.connection.v1.contract.ts
  poly.wallet.enable-trading.v1.contract.ts
  poly.wallet.execution.v1.contract.ts
  poly.wallet.overview.v1.contract.ts
  poly.wallet.preferences.v1.contract.ts        (and possibly more — count from current src/)
```

Plus other prefixes that may or may not be cross-node (`resy.*` is not present today, but `poly.*` is the same pattern any future node would also hit).

These contracts are owned by exactly one node (`nodes/poly/`). They have no business in a package described as "for all node apps."

## Why this matters

- **Forking the node-template** into a new node drags in another node's HTTP surface. A `resy/` or `ai-only/` fork inherits `poly.copy-trade.targets.v1.contract.ts` whether it wants it or not.
- **Cross-node coupling** — touching a poly-owned contract requires editing a "shared" package and re-publishing or rebuilding consumers that have nothing to do with poly.
- **AGENTS.md drift** — the package description ("for all node apps") is no longer true. New contributors infer that putting their per-node contract here is the standard pattern, and the drift compounds.
- **Build graph noise** — every node app rebuilds `@cogni/node-contracts` when a poly-only contract changes.

## Discovered during

[task.0389](task.0389.poly-wallet-pnl-single-source.md) shipped a five-field deletion in `poly.wallet-analysis.v1.contract.ts`. The right place for that file is `nodes/poly/packages/contracts/` or `nodes/poly/app/src/contracts/`, not the cross-node package. The change was made in-place to avoid scope creep on a focused PnL fix, with the explicit understanding that this followup would be filed.

## Proposed fix (sketch — confirm in `/design`)

1. **Define the boundary explicitly** in `packages/node-contracts/AGENTS.md`: cross-node contracts only. Per-node contracts live with the node.
2. **Choose a per-node home.** Two options:
   - (a) New per-node contracts package: `nodes/poly/packages/contracts/` with its own `@cogni/poly-contracts` workspace name. Consistent with `nodes/poly/packages/db-schema/`.
   - (b) Per-node app-local contracts dir: `nodes/poly/app/src/contracts/` (already exists). Lower ceremony, but doesn't help if a poly-graphs runtime needs the same shape.
   - Decision likely depends on whether non-app runtimes (`nodes/poly/graphs/`, `nodes/poly/packages/*`) consume any of the contracts. If yes → (a); if no → (b).
3. **Move all `poly.*` contracts** out of `packages/node-contracts/src/`. Update `index.ts` re-exports. Update consumers (route handlers, hooks, tests, agent graph tools).
4. **Audit other prefixes** — anything that's owned by exactly one node moves with the same rule. Anything truly cross-node (e.g. `http.*`, `error.*`, `meta.*`, internal scheduler-worker, billing-ingest, governance) stays.
5. **Update `packages/node-contracts/AGENTS.md`** Public Surface enumeration to drop the moved contracts.
6. **Lint rule (optional, follow-up to the follow-up)**: dep-cruiser or similar to forbid `*.${node}.*.contract.ts` filenames in `packages/node-contracts/`.

## Non-goals

- Renaming `@cogni/node-contracts` itself (e.g. to `@cogni/cross-node-contracts`). Rename is a much larger blast radius; the boundary fix can ship without it.
- Moving `nodes/poly/app/src/contracts/` contents into the new poly contracts package. Out of scope; that dir already lives with the node.
- Touching `packages/node-app/`, `packages/node-core/`, `packages/node-shared/`. Those are different packages with different rules.

## Validation

### exercise

- After move: `grep -rn "^export.*poly\." packages/node-contracts/src/index.ts` returns nothing.
- A fresh checkout of a hypothetical `nodes/resy/` fork that excludes `nodes/poly/` builds `@cogni/node-contracts` without any poly-specific code.
- `pnpm check` green across the monorepo (consumer imports resolve to the new location).

### observability

- No runtime change. Pure repo-organisation fix; nothing to watch in Loki.

## Risks

- **Big import-rewrite churn.** `poly.*` contracts are imported in `nodes/poly/app/src/`, `nodes/poly/graphs/`, route handlers, tests, fixtures, and possibly `apps/operator/`. Migration must be atomic per consumer.
- **Cross-node imports** — if any non-poly code imports a `poly.*` contract, that import must be removed (proper) or the contract genuinely is shared (move differently). Audit before move.
- **Open PRs** that touch poly contracts will conflict. Coordinate the cutover in a quiet window.

## Dependencies

- [ ] Decide between per-node contracts package vs app-local contracts dir.
- [ ] Audit cross-node imports of `poly.*` contracts (should be zero — confirm).
- [ ] Ensure no in-flight PRs are mid-edit on poly contracts at cutover time.
