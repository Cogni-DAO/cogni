# poly-node-contracts · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Status:** draft

## Purpose

Poly-node-scoped Zod route contracts. Carved out of shared `@cogni/node-contracts` so future poly contract changes are pure poly-domain in `single-node-scope` (see task.0421). Same shape rules as the shared package — PURE_LIBRARY, no env vars, no process lifecycle, no framework deps.

## Pointers

- [Node CI/CD Contract](../../../../docs/spec/node-ci-cd-contract.md)
- [Node Operator Contract](../../../../docs/spec/node-operator-contract.md)
- [Packages Architecture](../../../../docs/spec/packages-architecture.md)
- [task.0421 — Per-node package carve-out standard](../../../../work/items/task.0421.per-node-package-carveout-standard.md)

## Boundaries

```json
{
  "layer": "packages",
  "may_import": ["packages"],
  "must_not_import": [
    "app",
    "features",
    "ports",
    "core",
    "adapters",
    "shared",
    "services"
  ]
}
```

## Public Surface

The `poly.*.v1.contract.ts` files re-exported via `src/index.ts`:

- `poly.copy-trade.orders.v1.contract`
- `poly.copy-trade.targets.v1.contract`
- `poly.research-trader-comparison.v1.contract` — `GET /api/v1/poly/research/trader-comparison`; up to three research wallets with Polymarket-native windowed P/L plus saved-observation fill count/notional for the research comparison board.
- `poly.research-report.v1.contract`
- `poly.sync-health.v1.contract`
- `poly.wallet.balance.v1.contract`
- `poly.wallet.balances.v1.contract`
- `poly.wallet.connection.v1.contract`
- `poly.wallet.enable-trading.v1.contract`
- `poly.wallet.execution.v1.contract`
- `poly.wallet.grants.v1.contract`
- `poly.wallet.overview.v1.contract`
- `poly.wallet.position-actions.v1.contract`
- `poly.wallet-analysis.v1.contract` — `GET /api/v1/poly/wallets/[addr]?include=…`; slice-scoped wallet research (`snapshot`, `trades`, `balance`, `pnl`, `distributions`). The `distributions` slice ships order-flow histograms — DCA depth, trade size, entry price, DCA window, hour-of-day (per-fill, won/lost/pending split) plus flat event clustering — gated by `?distributionMode=live|historical` (D1 = live only).

## Responsibilities

- This directory **does**: Define Zod schemas for poly-only API request/response shapes consumed by `nodes/poly/app/**`.
- This directory **does not**: Define cross-node shapes (those stay in `@cogni/node-contracts`); make I/O calls; read env vars; contain business logic; define ports or adapters.

## Dependencies

- **Internal:** `@cogni/ai-core`, `@cogni/aragon-osx`, `@cogni/node-core`, `@cogni/node-contracts` (for shared base shapes; one-way only — shared must not depend on this package)
- **External:** `zod`, `@ts-rest/core`

## Notes

- Carved out of `@cogni/node-contracts` in task.0421 (PR introducing the node-owned-packages standard).
- Convention: `@cogni/<node>-<bare-name>` package name; folder is the bare name.
- If a contract here turns out to be cross-node, move it back to `@cogni/node-contracts` rather than re-exporting it from there.
