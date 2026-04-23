# node-contracts · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @Cogni-DAO
- **Status:** draft

## Purpose

Shared Zod route contracts and HTTP router definitions for all node apps. PURE_LIBRARY — no env vars, no process lifecycle, no framework deps. Contains operation contracts (Zod input/output schemas), ts-rest HTTP router, and OpenAPI generation.

## Pointers

- [Packages Architecture](../../docs/spec/packages-architecture.md)
- [Architecture — Contracts Layer](../../docs/spec/architecture.md)

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

All contract files re-exported via `src/index.ts`. Selective re-export for `ai.chat.v1.contract` to avoid `ChatMessage` name collision with `ai.completions.v1.contract`.

**Internal scheduler-worker → node-app contracts (task.0280):**

- `graphs.run.internal.v1.contract` — `POST /api/internal/graphs/{graphId}/runs` (executeGraphActivity)
- `graph-runs.create.internal.v1.contract` — `POST /api/internal/graph-runs` (createGraphRunActivity)
- `graph-runs.update.internal.v1.contract` — `PATCH /api/internal/graph-runs/{runId}` (updateGraphRunActivity)
- `grants.validate.internal.v1.contract` — `POST /api/internal/grants/{grantId}/validate` (validateGrantActivity)

All require `Authorization: Bearer ${SCHEDULER_API_TOKEN}`.

**Poly copy-trade contracts:**

- `poly.copy-trade.orders.v1.contract` — `GET /api/v1/poly/copy-trade/orders`; response rows include `synced_at: string | null` + `staleness_ms: number | null` (task.0328 CP3). `polymarket_profile_url` is always `null` post-Stage-4 purge (operator EOA removed).
- `poly.copy-trade.targets.v1.contract` — three operations over the calling user's tracked wallets, all RLS-scoped per docs/spec/poly-multi-tenant-auth.md: `polyCopyTradeTargetsOperation` (`GET`), `polyCopyTradeTargetCreateOperation` (`POST` body `{target_wallet}`), `polyCopyTradeTargetDeleteOperation` (`DELETE /:id`). `max_daily_usdc` + `max_fills_per_hour` dropped from the target schema (task.0318 Phase B3) — caps are per-grant now, not per-target.
- `poly.wallet.connection.v1.contract` — per-tenant Privy-backed trading wallet CRUD. `POST` body carries `custodialConsentAcceptedAt` + `defaultGrant { perOrderUsdcCap (0.5–20), dailyUsdcCap (2–200) }` with `dailyUsdcCap >= perOrderUsdcCap` refinement; server issues the wallet + the default `poly_wallet_grants` row atomically via `PrivyPolyTraderWalletAdapter.provisionWithGrant` (task.0318 Phase B3). `hourlyFillsCap` is server-side only.
- `poly.wallet.overview.v1.contract` — `GET /api/v1/poly/wallet/overview`; current tenant wallet snapshot for the dashboard plus interval-scoped Polymarket-native P/L history.
- `poly.sync-health.v1.contract` — `GET /api/v1/poly/internal/sync-health`; returns `{oldest_synced_row_age_ms, rows_stale_over_60s, rows_never_synced, reconciler_last_tick_at}` (task.0328 CP4)

## Responsibilities

- This directory **does**: Define Zod schemas for API request/response shapes, HTTP router contracts, OpenAPI specs
- This directory **does not**: Make I/O calls, read env vars, contain business logic, define ports or adapters

## Dependencies

- **Internal:** `@cogni/ai-core`, `@cogni/aragon-osx`, `@cogni/node-core`
- **External:** `zod`, `@ts-rest/core`

## Notes

- Extracted from `apps/operator/src/contracts/` (task.0248 Phase 1)
- `ChatMessage` exported from `ai.completions.v1.contract` (OpenAI-compatible format); chat contract's `ChatMessage` excluded from barrel to avoid TS2308
