---
id: task.0318.phase-b3.handoff
type: handoff
work_item_id: task.0318
status: active
created: 2026-04-22
updated: 2026-04-22
branch: feat/task-0318-phase-b3-trade-execution
last_commit: 00237c0cc
---

# Handoff: task.0318 Phase B3 — per-tenant trade execution + single-operator purge

## Context

- Phase B2 (PR #968, merged) landed the per-tenant wallet **connection** flow: a user visits `/profile`, provisions a Privy-backed trading wallet under the dedicated user-wallets Privy app, and the row lands in `poly_wallet_connections` AEAD-encrypted per tenant. **No trade execution went through it** — the autonomous mirror poll still placed from the shared `POLY_PROTO_WALLET_ADDRESS` operator wallet.
- Phase B3 (this PR) closes that loop. Every trade placement — autonomous mirror poll and (vnext) agent-API — must now resolve a tenant's wallet through `PolyTraderWalletPort.authorizeIntent` and route through a per-tenant `PolyTradeExecutor`. No shared single-operator path remains.
- The user explicitly chose `full_cutover` + `purge_no_bridge` during design. Implication: the single-operator Privy wallet + its CLOB L2 creds live in a **different Privy app** than the new user-wallets app, so data migration was never viable. The prototype wallet balance is recoverable by the operator manually out-of-band; code-wise it's gone.

## Current State

This PR lands Stages 1–4 of the Phase B3 design in four commits on branch `feat/task-0318-phase-b3-trade-execution`:

- **Stage 1 — authorization primitive.** Migration `0031_poly_wallet_grants.sql` + Drizzle `poly_wallet_grants` table (RLS-scoped on `billing_account_id`, halt-future-only revoke semantics). `PrivyPolyTraderWalletAdapter.authorizeIntent` implements scope + per-trade cap + per-day cap + grant-revoke checks on the hot path; `provisionWithGrant` creates wallet + default grant in a single transaction.
- **Stage 2 — consent surface.** `poly.wallet.connection.v1` contract gains a `defaultGrant` block. `/api/v1/poly/wallet/connect` returns the newly issued grant alongside the connection row. `/profile` renders two horizontal sliders (**Max per trade**, **Max per day**) against live grant data, round-tripped through `PATCH /api/v1/poly/wallet/grants/default`.
- **Stage 3 — per-tenant executor.** `PolyTradeExecutor` (per-tenant) + `PolyTradeExecutorFactory.getPolyTradeExecutorFor(billing_account_id)` (process-level cache keyed by tenant). Every `placeIntent` / `closePosition` wraps through `authorizeIntent` before hitting `@polymarket/clob-client`. Copy-trade renames landed inline: `decide → planMirrorFromFill`, `mirror-coordinator → mirror-pipeline`. `listAllActive` in the target source now joins `poly_wallet_connections` + `poly_wallet_grants`, so only tenants with both an active connection **and** an un-revoked grant participate in the mirror poll.
- **Stage 4 — purge (`purge_no_bridge`).** `createPolyTradeCapability` + `PolyTradeBundle` + `FakePolymarketClobAdapter` deleted. `container.ts` gates the mirror poll + order-reconciler on `polyTradeExecutorFactory !== undefined` instead of the old `polyTradeBundle`. `operator-extras.ts` deleted; `getBalanceSlice` no longer takes a `fetchOperatorExtras` DI param. `/api/v1/poly/wallet/balance` is now a tombstone (`operator_wallet_removed_use_money_page`); `OperatorWalletCard` renders the dormant empty state until the Money-page rework replaces it. `POLY_PROTO_PRIVY_{APP_ID,APP_SECRET,SIGNING_KEY}`, `POLY_CLOB_API_KEY/API_SECRET/PASSPHRASE`, `POLY_PROTO_WALLET_ADDRESS` fully dropped from `server-env.ts`, `.env.local.example`, `scripts/setup-secrets.ts`, `scripts/ci/deploy-infra.sh`, `promote-and-deploy.yml`, `candidate-flight-infra.yml`.

Verification on branch HEAD (`00237c0cc`):

- `tsc -p tsconfig.app.json --noEmit` — clean.
- `pnpm -F @cogni/poly-app test` on targeted suites (`tests/unit/bootstrap`, `tests/unit/features/{wallet-analysis,copy-trade,trading}`) — 103/103 green.
- `biome check` — clean on all touched files.
- `pnpm -w run arch:check` — 1952 modules cruised, no violations.

## Decisions Made

- [Stage 1 `authorizeIntent` owns scope + cap + grant-revoke checks on the hot path; `planMirrorFromFill` stays pure and cap-free](../../docs/spec/poly-tenant-and-collateral.md)
- [`purge_no_bridge` Stage 4 — Privy app boundary makes prototype data migration impossible; operator recovers balance manually](../items/task.0318.poly-wallet-multi-tenant-auth.md#phase-b-stage-4-rollout)
- [Agent-tool surface accepts v0 regression: `polyTradeCapability` binding removed from `createToolBindings`; agent tools return "not configured" until per-tenant agent auth lands in B4](../../docs/spec/poly-tenant-and-collateral.md)
- [Rename audit landed inline with staging: `decide → planMirrorFromFill`, `mirror-coordinator → mirror-pipeline`, `PolyTradeBundle → PolyTradeExecutor`. Naming rationale captured in the design review.](../../docs/spec/poly-tenant-and-collateral.md)
- [Test fixtures — all new unit tests use `COGNI_SYSTEM_BILLING_ACCOUNT_ID` + `TEST_USER_ID_1` from `@tests/_fakes` instead of hardcoded UUID strings](../../.claude/skills/test-expert/SKILL.md)

## Next Actions

- [ ] Post-merge → `candidate-flight-infra.yml` → complete the Phase B3 Validation exercise: provision-with-grant round-trip, slider round-trip, funded tenant → mirror pipeline places through `PolyTradeExecutor`, Loki confirms `mirror_pipeline.placed` logs with `billing_account_id` + `executor_source="per_tenant"` + non-null `order_id`. Flip `deploy_verified: true` on this work item when green.
- [ ] Organization-level cleanup: after this PR merges, the now-orphaned GitHub secrets (`POLY_PROTO_PRIVY_APP_ID`, `POLY_PROTO_PRIVY_APP_SECRET`, `POLY_PROTO_PRIVY_SIGNING_KEY`, `POLY_CLOB_API_KEY`, `POLY_CLOB_API_SECRET`, `POLY_CLOB_PASSPHRASE`, `POLY_PROTO_WALLET_ADDRESS`) can be deleted at the org level — no runtime reads them anymore.
- [ ] Recover balance from the old prototype wallet (owner-manual; unrelated to code).
- [ ] **vnext — Money page.** Replace the dormant `OperatorWalletCard` + `/api/v1/poly/wallet/balance` tombstone with a per-user `/money` page that reads balance + positions + grant limits from the per-tenant executor. Until then the legacy dashboard card renders its empty state — acceptable v0 regression.
- [ ] **vnext — agent API path.** Phase B4 re-enables the agent-tool surface by threading the caller's `billing_account_id` through the agent-auth layer into `getPolyTradeExecutorFor`. Until then, agent tools return the stable "not configured" stub.

## Risks / Gotchas

- **Tenant DI on the order-reconciler is critical.** `LedgerRow.billing_account_id` is the dispatch key — `OrderReconcilerDeps.getOrderForTenant(billing_account_id, client_order_id)` looks up the per-tenant executor via the factory. If a ledger row ever lands without a `billing_account_id`, the reconciler will skip it and the order will stay in `pending` forever. Enforced by the zod contract on the feature boundary, but watch for new writer paths.
- **Privy app boundary is invisible in code.** `PRIVY_USER_WALLETS_*` goes to a different Privy tenant than the purged `POLY_PROTO_PRIVY_*`. There is no automated test that distinguishes them — rely on runbook + the `SEPARATE_PRIVY_APP` invariant comment in `server-env.ts`.
- **`readLockedNotional` is stubbed, not deleted.** `operator-extras.ts` is gone, but the `balance/route.ts` tombstone still shape-compatible-returns `usdc_locked: 0`. If the Money page re-adds a locked-notional signal, route it through the per-tenant `PolyTradeExecutor.listOpenOrders` — not through a new operator-only helper.
- **`deploy_verified: true` was already set** by Phase B2's candidate-a flight. This PR resets it to `false` because Phase B3 is new code on the trade-execution hot path and needs its own flight validation.

## Pointers

| File / Resource                                                                                              | Why it matters                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| [work/items/task.0318.poly-wallet-multi-tenant-auth.md](../items/task.0318.poly-wallet-multi-tenant-auth.md) | Lifecycle carrier; Phase B3 Validation block                                                            |
| [work/handoffs/task.0318.handoff.md](./task.0318.handoff.md)                                                 | Phase B2 handoff (merged)                                                                               |
| [docs/spec/poly-tenant-and-collateral.md](../../docs/spec/poly-tenant-and-collateral.md)                           | Port contract — `authorizeIntent` scope + cap semantics                                                 |
| `packages/poly-wallet/src/port/poly-trader-wallet.port.ts`                                                   | Port interface — branded `AuthorizedSigningContext` for compile-time scope bypass protection            |
| `nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts`                              | `authorizeIntent` + `provisionWithGrant` + `revoke` implementation                                      |
| `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`                                           | `PolyTradeExecutor` + `PolyTradeExecutorFactory` — sole app-local `@polymarket/clob-client` import seam |
| `nodes/poly/app/src/bootstrap/capabilities/AGENTS.md`                                                        | Capability surface doc — updated to reflect the purge                                                   |
| `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts`                                                  | Renamed from `mirror-coordinator`; calls `planMirrorFromFill` + `placeIntentForTenant`                  |
| `nodes/poly/app/src/features/copy-trade/target-source.ts`                                                    | `listAllActive` now joins connections + grants                                                          |
| `nodes/poly/app/src/features/trading/order-reconciler.ts`                                                    | Per-tenant dispatch via `getOrderForTenant(billing_account_id, ...)`                                    |
| `nodes/poly/packages/db-schema/src/wallet-grants.ts`                                                         | Drizzle schema for `poly_wallet_grants`                                                                 |
| `nodes/poly/app/src/adapters/server/db/migrations/0031_poly_wallet_grants.sql`                               | Migration + RLS                                                                                         |
