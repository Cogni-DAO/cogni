# market-provider · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Standalone workspace package (`@cogni/poly-market-provider`) providing a typed port for prediction market platforms (Polymarket, Kalshi). Covers the full provider lifecycle: read markets (Crawl) and submit orders (Run — Polymarket only). Adapters use constructor-injected credentials aligned with the tenant-connections spec. The CLOB adapter takes a viem `LocalAccount` (from `@privy-io/node/viem#createViemAccount`) via constructor — no custom signer port (see task.0315 CP3.1.5).

## Pointers

- [task.0230](../../../../work/items/task.0230.market-data-package.md) — implementation work item
- [Monitoring Engine Spec](../../../../docs/spec/monitoring-engine.md) — observation pipeline
- [proj.poly-prediction-bot](../../../../work/projects/proj.poly-prediction-bot.md) — parent project

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

**Root barrel** (`@cogni/poly-market-provider`):

- Types: `MarketProviderPort`, `MarketCredentials`, `MarketProviderConfig`, `NormalizedMarket`, `MarketProvider`, `ListMarketsParams`, `MarketOutcome`, `OrderIntent`, `OrderReceipt`, `OrderStatus`, `OrderSide`, `Fill`, `FillSource`, `GetOrderResult`
- Schemas: `NormalizedMarketSchema`, `MarketProviderSchema`, `ListMarketsParamsSchema`, `MarketOutcomeSchema`, `OrderIntentSchema`, `OrderReceiptSchema`, `OrderStatusSchema`, `OrderSideSchema`, `FillSchema`, `FillSourceSchema`
- Errors: `OrderNotSupportedError`
- Pure fns: `normalizePolymarketMarket()`, `normalizeKalshiMarket()`

**Subpath** (`@cogni/market-provider/adapters/polymarket`):

- `PolymarketAdapter`, `PolymarketAdapterConfig` (Gamma reads; Run methods throw `OrderNotSupportedError` in CP1 baseline; CP3 lands the CLOB surface)

**Subpath** (`@cogni/market-provider/adapters/kalshi`):

- `KalshiAdapter`, `KalshiAdapterConfig` (read-only by design; Run methods always throw)

**Subpath** (`@cogni/market-provider/adapters/paper`):

- `PaperAdapter`, `PaperAdapterConfig` (Phase-1 stub; body lands in Phase 3 per task.0315)

## Ports

- **Implements:** `MarketProviderPort`
- **Uses:** none

## Responsibilities

- This directory **does**: define port interface, Zod domain schemas (Crawl + Run), pure normalizers, and platform REST adapters.
- This directory **does not**: load env vars, manage lifecycle, persist to DB, hold key material, or know about Privy / any specific wallet backend.

## Notes

- `MarketProviderPort` now carries Run methods (`placeOrder`, `cancelOrder`, `getOrder`). Adapters that do not implement trading (Kalshi, paper stub pre-P3, baseline Polymarket Gamma reader) throw `OrderNotSupportedError` — they satisfy the port at compile time without risking accidental order placement.
- KalshiAdapter is READ-ONLY. It NEVER calls POST/PUT endpoints. The Kalshi API key may have real money — no order placement.
- Baseline `PolymarketAdapter` uses only public Gamma API — no wallet operations. `PolymarketClobAdapter` (task.0315 CP3.2) is the trade-only Run-phase companion: constructor takes `ClobSigner` (viem `WalletClient`) + `ApiKeyCreds` + funder EOA; `listMarkets` throws (use the Gamma adapter for reads). `@polymarket/clob-client` + `viem` are optional peerDeps on this package — install them in any node that consumes the CLOB adapter.
- CLOB failures classify into a stable `PolyClobErrorCode` enum (`POLY_CLOB_ERROR_CODES`, re-exported from `adapters/polymarket`): `insufficient_balance`, `insufficient_allowance`, `stale_api_key`, `invalid_signature`, `invalid_price_or_tick`, `empty_response`, `http_error`, `unknown`. Rejections throw `ClobRejectionError` carrying `ClobFailureDetails` so callers / tests can branch on the class without string-matching. Pure helpers `classifyClobFailure(response)` and `classifyClientError(err)` are exported for reuse on any CLOB call path (extend the enum when a new signature appears in Loki and we decide it's worth alerting on).
- Walk phase will add `getPrices()`, `getOrderbook()` methods when the pipeline needs them.
- PollAdapter (Walk) delegates to this port for HTTP calls — one client per platform, not two.
- `PolymarketDataApiClient` (subpath `adapters/polymarket`) wraps the public Data-API + Gamma surface needed by the poly research agent (task.0386): `listTopTraders`, `listUserActivity`, `listUserTrades`, `listUserPositions`, `listActivity` (distinct from `/trades`), `getValue`, `getHolders`, `listMarketTrades`, and `resolveUsername` (hits `gamma-api.polymarket.com/public-search`, override via `gammaBaseUrl`). New-method responses run through `.safeParse()` → typed `PolyDataApiValidationError` (`code="VALIDATION_FAILED"`) at the boundary so schema drift is distinct from HTTP failure. Default request timeout is 5000 ms; the Data API is silently Cloudflare-throttled at ~60 rpm. Note: `/traded-events` endpoint does not exist on data-api.polymarket.com — `listTradedEvents` was removed after live-fire on candidate-a returned 404s.
