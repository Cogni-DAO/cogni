# bootstrap/capabilities · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Status:** stable

## Purpose

Capability factories bridging ai-tools interfaces to adapters. Creates environment-aware capability instances.

## Pointers

- [Tool Use Spec](../../../../../docs/spec/tool-use.md)
- [Tools Authoring](../../../../../docs/guides/tools-authoring.md)

## Boundaries

```json
{
  "layer": "bootstrap",
  "may_import": ["adapters/server", "adapters/test", "shared"],
  "must_not_import": ["app", "features", "core"]
}
```

## Public Surface

- **Exports:** `createMetricsCapability()`, `stubMetricsCapability`, `createRepoCapability()`, `stubRepoCapability`, `createWebSearchCapability()`
- **Env/Config keys:** PROMETHEUS_REMOTE_WRITE_URL, PROMETHEUS_QUERY_URL, PROMETHEUS_READ_USERNAME, PROMETHEUS_READ_PASSWORD, COGNI_REPO_PATH, COGNI_REPO_ROOT, TAVILY_API_KEY via ServerEnv
- **Files considered API:** `metrics.ts`, `repo.ts`, `web-search.ts`

**poly-clob-creds.ts** — isolated live CLOB API-key provisioning/rotation boundary. Provisioning intentionally uses `@polymarket/clob-client@5.8.1` with the positional constructor because the manual candidate-a green chain in `docs/guides/poly-wallet-provisioning.md` proves v1 succeeds while `@polymarket/clob-client-v2` fails upstream for L1 API-key creation. Do not move provisioning back to v2 unless that manual chain is green first.

**poly-trade-executor.ts** — `createPolyTradeExecutorFactory(config) → PolyTradeExecutorFactory`. The factory's `getPolyTradeExecutorFor(billingAccountId)` returns a per-tenant `PolyTradeExecutor` that wraps every `placeIntent` / `closePosition` through `PolyTraderWalletPort.authorizeIntent` (scope + cap + grant-revoke checks on the hot path). Surface: `placeIntent`, `closePosition`, `exitPosition`, `listPositions`, `getOrder`, `getMarketConstraints`, `listOpenOrders`, `getPositionShareBalance`, `funderAddress`. `getOrder` returns `GetOrderResult` (typed discriminated union; never null — GETORDER_NEVER_NULL, task.0328 CP1). **Redeem is NOT on this surface** — task.0388 moved CTF redeem to the event-driven pipeline (`@bootstrap/redeem-pipeline`); `redeemResolvedPosition`, `redeemAllRedeemableResolvedPositions`, the in-process cooldown Map, and the sweep mutex are all deleted.

**poly-research.ts** — `createPolyResearchCapability({ dataApiClient }) → PolyDataCapability` (task.0386). Thin shape-mappers over `PolymarketDataApiClient` backing the 7 IO-bound `core__poly_data_*` research tools. Adds `count` + `hasMore` derivation for paginated outputs and maps handle fields to `userName`. Read-only, no auth (public Data API), no DB writes. The eighth tool (`core__poly_data_help`) is static and bypasses this capability.

## Responsibilities

- This directory **does**: Create capability instances, handle test/prod adapter selection
- This directory **does not**: Implement transport, execute tools

## Usage

```bash
# Consumed by container.ts automatically
```

## Standards

- Test mode returns fake adapter-backed capability
- Missing config returns stub that throws

## Dependencies

- **Internal:** adapters/server, adapters/test, shared
- **External:** `@cogni/ai-tools`

## Change Protocol

- Add new capability factory when adding tools requiring I/O

## Notes

- Pattern: test mode uses fake adapter, prod requires env vars or returns stub
