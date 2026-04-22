---
id: task.0347
type: task
title: "Poly wallet — per-tenant preferences + copy-trade sizing config"
status: needs_design
priority: 2
rank: 19
estimate: 3
summary: "Replace the hardcoded v0 wallet funding suggestions and mirror-size caps with per-tenant preferences. Honest `requires_funding`/balance reads on `/connect` + `/status` driven by a live Polygon RPC call, tenant-owned funding + sizing config persisted in Postgres, mirror-coordinator reads sizing from config instead of env + constants."
outcome: "A tenant can configure (a) the USDC.e + MATIC amounts the UI suggests for initial funding, (b) how much of each mirrored target trade to size (fixed USDC or ratio of target size), and (c) per-order / daily / hourly caps. `/connect` and `/status` report real on-chain balances, so a re-hit against an already-funded wallet returns `requires_funding: false`. The mirror-coordinator reads each tenant's sizing row at decision time; no preferences row = safe defaults matching today's hardcoded constants."
spec_refs:
  - poly-trader-wallet-port
  - poly-multi-tenant-auth
  - poly-copy-trade-phase1
assignees: []
project: proj.poly-copy-trading
pr:
created: 2026-04-21
updated: 2026-04-21
labels: [poly, polymarket, wallets, copy-trade, config, rls, multi-tenant]
external_refs:
  - work/items/task.0318.poly-wallet-multi-tenant-auth.md
  - docs/spec/poly-trader-wallet-port.md
  - docs/spec/poly-copy-trade-phase1.md
  - nodes/poly/app/src/app/api/v1/poly/wallet/connect/route.ts
  - nodes/poly/packages/db-schema/src/copy-trade.ts
---

# task.0347 — Per-tenant wallet preferences + copy-trade sizing config

> Spun out of the task.0318 Phase B review (revision 6) on 2026-04-21. The v0 connect/status/mirror path ships with hardcoded funding suggestions and hardcoded live-money caps. That is fine to ship, not fine to stay.

## Context

Three specific v0 shortcuts that a single, scoped follow-up can retire:

1. **`/api/v1/poly/wallet/connect` hardcodes the funding response.**
   [`route.ts:137-143`](../../nodes/poly/app/src/app/api/v1/poly/wallet/connect/route.ts)
   returns `requires_funding: true`, `suggested_usdc: 5`, `suggested_matic: 0.1` on **every**
   call — including idempotent re-hits against a wallet that already holds USDC.e + MATIC.
   There is no Polygon RPC read in the path, so the API lies to the UI about whether funding
   is actually needed.

2. **`/api/v1/poly/wallet/status` does not surface balances.**
   `connected: true` only proves the signing context can be resolved. The `/profile` page
   still has to guess whether the wallet is usable for trading (has MATIC gas + USDC.e
   principal) and cannot render honest "ready / underfunded" state.

3. **Copy-trade live-money caps are hardcoded in code and env.**
   `proj.poly-copy-trading` locks caps at `$1/trade, $10/day, 5 fills/hr`. Any lift requires
   code change + redeploy. `poly_copy_trade_config` exists per-tenant
   ([`copy-trade.ts:153`](../../nodes/poly/packages/db-schema/src/copy-trade.ts)) but only
   holds `enabled`. There is no per-tenant sizing (ratio vs fixed USDC, per-order cap, daily
   cap, hourly-fill cap) — the mirror-coordinator reads constants.

These three are a single user-visible concept — **"what this tenant wants their wallet to do"** —
so they belong in one work item rather than three scattered tweaks.

## Goal

Turn the hardcoded wallet-adjacent knobs into per-tenant, RLS-scoped config that the UI can
read + write, and that the mirror-coordinator reads at decision time.

### Deliverables

- **Schema**: extend `poly_copy_trade_config` (preferred — reuses existing tenant row + RLS)
  or add a sibling `poly_wallet_preferences` table (decide in `/design`). Fields:
  - `preferred_initial_usdc` (numeric, default 5)
  - `preferred_initial_matic` (numeric, default 0.1)
  - `mirror_size_mode` (text enum: `'fixed_usdc' | 'ratio'`, default `'fixed_usdc'`)
  - `mirror_size_usdc` (numeric, used when mode=fixed, default 1)
  - `mirror_size_ratio` (numeric 0..1, used when mode=ratio, default 1.0)
  - `cap_per_order_usdc` (numeric, default 1)
  - `cap_daily_usdc` (numeric, default 10)
  - `cap_hourly_fills` (integer, default 5)
- **Migration**: additive columns with `DEFAULT` matching today's constants, so existing
  tenants keep v0 behaviour on rollout. No data-class change; same RLS policy.
- **Contract**: `poly.wallet.preferences.v1` Zod contract (`GET` + `PUT`). Numeric
  ranges enforced at the wire boundary.
- **Routes**: `GET /api/v1/poly/wallet/preferences` + `PUT /api/v1/poly/wallet/preferences`,
  tenant-scoped via appDb + session.
- **Balance read**: one small Polygon RPC adapter (USDC.e ERC-20 `balanceOf` + native
  MATIC balance) behind a port. Used by:
  - `/api/v1/poly/wallet/status` to return `{ usdc_balance, matic_balance, funded }`
  - `/api/v1/poly/wallet/connect` to compute honest `requires_funding` on idempotent re-hit
- **Mirror-coordinator wiring**: replace hardcoded sizing + cap constants in the decide
  path with a read from the tenant's config row. Falls back to the schema defaults when
  no row exists (no code path change for tenants who haven't opted in).

## Non-goals

- **Wallet grants / authorization scope** — that belongs in task.0318 Phase B4
  (`poly_wallet_grants`). Grants may eventually _enforce_ a subset of these caps, but the
  preferences table is tenant-authored config; grants are a signed authorization envelope.
  Decide in B4 design whether grants read caps from here or carry them inline. This task
  just makes the caps live in a row.
- **UI work** — `/profile` copy changes + the preferences form belong with the
  wallets-dashboard line of work (task.0343 / task.0344). This task only has to guarantee
  the API is honest + configurable.
- **Polygon RPC health / multi-provider failover** — we already depend on `POLYGON_RPC_URL`
  for the executor. This task uses the same env var; production-grade RPC redundancy is its
  own concern.
- **On-chain allowance / approval state** — SELL-path approvals are tracked via
  `bug.0329` + task.0323. This task only reads balances.

## Design questions (resolve in `/design`)

- **Table shape.** Extend `poly_copy_trade_config` (one row per tenant already, RLS
  already set up, "one place for wallet+trade config" is simpler) vs new
  `poly_wallet_preferences` (cleaner separation — wallet-level knobs vs copy-trade-level
  knobs, matters once a tenant has multiple wallet connections). Default recommendation:
  extend the existing table for v0; split later if a second wallet connection per tenant
  ships.
- **Cap enforcement seam.** Today the mirror-coordinator owns cap checks. Once task.0318
  B4 ships `poly_wallet_grants`, caps could move to the signed grant envelope. Which layer
  is authoritative? Leaning: **config is the source of truth, grants are a snapshot** —
  grants signed with a cap get honoured even if config moves, but new grants pull from
  config.
- **Balance cache.** Live RPC read on every `/status` hit is fine at v0 traffic but will
  not scale. A 30s in-memory cache per connection_id is probably enough for v1; out-of-band
  invalidate on fill events in a later task.
- **Ratio mode semantics.** `mirror_size_ratio: 0.5` on a $100 target fill means $50 or
  clamped to `cap_per_order_usdc = $1`? Almost certainly the latter, but spell it out.
- **Precision.** USDC.e is 6 decimals on-chain, but tenant input is likely dollar floats.
  Store as `numeric(18, 6)` or as integer microUSDC? Whichever the existing fills ledger
  uses — match it.

## Validation

### exercise

- `GET /api/v1/poly/wallet/preferences` on a fresh tenant returns the schema defaults
  without requiring a prior `PUT`.
- `PUT /api/v1/poly/wallet/preferences` with `{ mirror_size_mode: "fixed_usdc",
mirror_size_usdc: 2, cap_per_order_usdc: 2 }` succeeds, and a subsequent `GET` echoes
  the written values.
- `GET /api/v1/poly/wallet/status` on a funded wallet returns non-zero `usdc_balance` +
  `matic_balance` and `funded: true`.
- `POST /api/v1/poly/wallet/connect` on a tenant whose wallet is already funded returns
  `requires_funding: false` on the idempotent re-hit, with `suggested_usdc` / `_matic`
  matching the tenant's preferences row (not hardcoded 5 / 0.1).
- On candidate-a, a mirrored trade for a tenant with `mirror_size_usdc: 2` places a $2
  order (not $1). A tenant with no preferences row still places $1 per-order.

### observability

- Pino log line on `poly.wallet.preferences.{read,write}` with `billing_account_id` and
  a delta of changed fields (no values for numeric caps — those are fine to log).
- Pino log line on `poly.wallet.status` with `usdc_balance` / `matic_balance` / `funded`.
  Query Loki at the deployed SHA for `route_id="poly.wallet.status"` and confirm the
  balance fields are present and non-null.
- Pino log line on `poly.copy-trade.decide` already exists; extend it with
  `sizing_mode`, `sizing_value`, `cap_per_order_usdc` so the decision layer is auditable
  against the tenant's config at the time of the decision.

## Risks

- **Schema migration on an RLS-sensitive table.** `poly_copy_trade_config` is tenant-
  scoped. Adding columns with `DEFAULT` is safe, but the RLS policy must continue to
  apply. Migration tests must cover: default-only read (new tenant), write as
  `app_user`, read-after-write.
- **Coordinator regression.** The mirror-coordinator is the only real-money seam. A bug
  that reads a null column and treats it as zero becomes a trade-suppression bug.
  Component-test the fallback path with a null config row before shipping.
- **Lying about balances.** If the Polygon RPC read fails, `/status` must surface
  `balances_unavailable: true` — not silently return zero. Otherwise a healthy tenant
  looks underfunded during an RPC hiccup and the UI pushes them to re-fund.

## Dependencies

- [x] `poly_copy_trade_config` table exists (task.0315 migration 0027)
- [x] Per-tenant RLS already wired on copy-trade tables (task.0318 Phase A)
- [x] `POLYGON_RPC_URL` env var already set on candidate-a (executor path)
- [ ] `@cogni/node-contracts` Zod contracts package accepts the new preferences contract
      (additive, no existing contract change)

## Why separate from task.0318

- task.0318 Phase B is scoped to "provision a per-tenant wallet + use it to place a real
  trade". Adding a config surface blows up that scope.
- The current hardcoded defaults _are safe_ — tenants keep the v0 caps until they opt in.
  Nothing about shipping task.0318 as-is is wrong; this task just removes the scaffolding
  once tenants exist.
- Grants (B4 in task.0318) are signed authorization envelopes; preferences are tenant-
  authored config. Mixing them now would bake a design decision that `/design` on this
  task is meant to answer.
