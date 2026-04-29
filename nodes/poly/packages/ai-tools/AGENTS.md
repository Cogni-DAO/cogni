# poly-ai-tools · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Status:** draft

## Purpose

Poly-only AI tool definitions for the Polymarket node. Hosts all tool contracts,
implementations, and capability interfaces that belong exclusively to the poly node
domain. Mirrors the `nodes/poly/packages/knowledge/` shape.

## Pointers

- [Tool Use Spec](../../../../../../docs/spec/tool-use.md)
- [Bug 0319](../../../../../../work/items/bug.0319.ai-tools-per-node-packages.md)

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

**External deps:** `zod`. Imports `@cogni/ai-tools` for shared `BoundTool`/`ToolContract`/`ToolImplementation`/`CatalogBoundTool` types. NO LangChain.

## Public Surface

- **POLY_TOOL_BUNDLE** — `readonly CatalogBoundTool[]` for poly node composition
- `marketListBoundTool`, `MARKET_LIST_NAME`, `MarketCapability`, `createMarketListImplementation`, `marketListStubImplementation` — market listing tool
- `walletTopTradersBoundTool`, `WALLET_TOP_TRADERS_NAME`, `WalletCapability`, `createWalletTopTradersImplementation`, `walletTopTradersStubImplementation` — wallet scoreboard tool
- `polyPlaceTradeBoundTool`, `POLY_PLACE_TRADE_NAME`, `PolyTradeCapability`, `createPolyPlaceTradeImplementation`, `polyPlaceTradeStubImplementation` — trade placement tool
- `polyListOrdersBoundTool`, `POLY_LIST_ORDERS_NAME`, `createPolyListOrdersImplementation`, `polyListOrdersStubImplementation` — order listing tool
- `polyCancelOrderBoundTool`, `POLY_CANCEL_ORDER_NAME`, `createPolyCancelOrderImplementation`, `polyCancelOrderStubImplementation` — order cancellation tool
- `polyClosePositionBoundTool`, `POLY_CLOSE_POSITION_NAME`, `createPolyClosePositionImplementation`, `polyClosePositionStubImplementation` — position close tool (not in POLY_TOOL_BUNDLE — internal use only via copy-trade reconciler)
- `PolyDataCapability` + 8 `polyData*` tools (activity, help, holders, positions, resolve-username, trades-market, value, **user-pnl-summary**) — Polymarket Data-API research tools. `user-pnl-summary` is the canonical AI snapshot — sparkline + curve metrics + chr.poly-wallet-research verdict + score, 24h-cached via `KnowledgeCapability`. Backed by the poly-internal `analysis/pnl-curve-metrics` pure module (intentional v0 duplication of `packages/market-provider/src/analysis/pnl-curve-metrics.ts` — collapses post-PR-#1120-merge).

## Ports

- **Uses ports:** none (pure library — no env loading, no process lifecycle)
- **Implements ports:** none

## Responsibilities

- This directory **does**: Define pure tool contracts and implementations for poly-only tools
- This directory **does not**: Read env vars, load adapters, import LangChain, import from `src/`

## Usage

```bash
pnpm --filter @cogni/poly-ai-tools typecheck
pnpm --filter @cogni/poly-ai-tools build
```

## Dependencies

- **Internal:** `@cogni/ai-tools` (BoundTool/ToolContract/ToolImplementation/CatalogBoundTool types)
- **External:** `zod`

## Notes

Created in `bug.0319` Checkpoint 2 to satisfy SINGLE_DOMAIN_HARD_FAIL — every poly-only tool now lives inside the poly node's domain. Future poly-tool PRs touch only `nodes/poly/**`.
