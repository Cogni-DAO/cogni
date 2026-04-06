# market-provider · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Standalone workspace package (`@cogni/market-provider`) providing a typed port for prediction market platforms (Polymarket, Kalshi). Covers the full provider lifecycle: read markets (Crawl), trade positions (Run). Adapters use constructor-injected credentials aligned with the tenant-connections spec.

## Pointers

- [task.0230](../../work/items/task.0230.market-data-package.md) — implementation work item
- [Monitoring Engine Spec](../../docs/spec/monitoring-engine.md) — observation pipeline
- [proj.poly-prediction-bot](../../work/projects/proj.poly-prediction-bot.md) — parent project

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

**External deps:** `zod` (schema validation). Node `crypto` (Kalshi RSA-PSS signing — adapter subpath only).

## Public Surface

**Root barrel** (`@cogni/market-provider`):

- Types: `MarketProviderPort`, `MarketCredentials`, `MarketProviderConfig`, `NormalizedMarket`, `MarketProvider`, `ListMarketsParams`, `MarketOutcome`
- Schemas: `NormalizedMarketSchema`, `MarketProviderSchema`, `ListMarketsParamsSchema`, `MarketOutcomeSchema`
- Pure fns: `normalizePolymarketMarket()`, `normalizeKalshiMarket()`

**Subpath** (`@cogni/market-provider/adapters/polymarket`):

- `PolymarketAdapter`, `PolymarketAdapterConfig`

**Subpath** (`@cogni/market-provider/adapters/kalshi`):

- `KalshiAdapter`, `KalshiAdapterConfig`

## Ports

- **Implements:** `MarketProviderPort`
- **Uses:** none

## Responsibilities

- This directory **does**: define port interface, Zod domain schemas, pure normalizers, platform REST adapters (fetch + normalize).
- This directory **does not**: load env vars, manage lifecycle, persist to DB, place trades (Crawl scope — read-only).

## Notes

- KalshiAdapter is READ-ONLY. It NEVER calls POST/PUT endpoints. The Kalshi API key may have real money — no order placement.
- PolymarketAdapter uses only public Gamma API — no wallet operations.
- Walk phase will add `getPrices()`, `getOrderbook()` methods. Run phase will add `placeOrder()`, `getPositions()`.
- PollAdapter (Walk) delegates to this port for HTTP calls — one client per platform, not two.
