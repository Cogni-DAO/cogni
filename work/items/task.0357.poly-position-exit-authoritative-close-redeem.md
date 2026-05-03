---
id: task.0357
type: task
title: "Poly position exits — authoritative close/redeem semantics + live approval readiness"
status: needs_merge
priority: 1
rank: 2
estimate: 3
created: 2026-04-23
updated: 2026-05-02
summary: "Fix the user exit path so Polymarket close/redeem flows are driven by authoritative provider and chain state instead of stale DB/Data-API hints. This PR ships the Phase 1 correctness fixes: live approval repair, provider balance/allowance refresh, market close, bounded reconciliation, and dashboard cache invalidation. The typed exit contract and readonly-first position-state surface are explicitly defined as follow-on design."
outcome: "A user can click Close or Redeem and the system does not strand funds behind our own caps, stale `tradingApprovalsReadyAt` stamps, stale provider cache, one-shot lagging `/positions` reads, or stale execution-cache rows. The next design step is a readonly-first split between `live_positions`, `closed_positions`, and `pending_actions` for HTTP and MCP consumers."
spec_refs:
  - poly-trader-wallet-port
  - architecture-spec
  - poly-position-exit
assignees: []
credit:
project: proj.poly-copy-trading
branch: derekg1729/fix-position-close
pr: https://github.com/Cogni-DAO/node-template/pull/1201
reviewer:
revision: 0
blocked_by:
deploy_verified: false
labels: [poly, exit, wallet, polymarket, integration, correctness]
external_refs:
---

# task.0357 — Poly position exits

## Requirements

- User-driven `POST /api/v1/poly/wallet/positions/close` must never be blocked by grant caps (`perOrderUsdcCap`, daily cap, hourly fills cap).
- Exit readiness must be validated against the live pinned approval target set before a close attempt; the DB readiness stamp is a cache/UI hint, not authoritative truth.
- After live approvals are good on-chain, the close path must refresh Polymarket's own `/balance-allowance` view before market SELL. Candidate-a proved the provider can still reject with `allowance: 0` while our direct chain reads say the spender is approved.
- A successful or accepted Polymarket market-sell response must never be turned into a 502 solely because one immediate public Data API `/positions` reread still shows the old balance.
- After a successful close or redeem, the dashboard's next refetch must not reuse a stale wallet-analysis execution snapshot from the process TTL cache.
- Exit execution must use types that match the provider's execution units. Share-based market exits must not be forced through a USDC-notional `OrderReceipt` abstraction without explicit normalization.
- Redeem must remain uncapped and move toward chain-authoritative eligibility; the system should not strand redeemable funds behind our own policy gates or a lagging advisory read model.

## Allowed Changes

- `packages/node-contracts/src/poly.wallet.position-actions.v1.contract.ts`
- `packages/market-provider/src/domain/*`
- `packages/market-provider/src/port/*`
- `packages/market-provider/src/adapters/polymarket/*`
- `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts`
- `nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts`
- `nodes/poly/app/src/app/api/v1/poly/wallet/positions/*`
- `nodes/poly/app/src/app/(app)/dashboard/_api/*`
- `nodes/poly/app/tests/**`
- `packages/market-provider/tests/**`
- `docs/spec/poly-position-exit.md`

## Design

### Outcome

Users can systematically exit or redeem their own positions without our code fabricating failures from stale readiness stamps or lagging read models.

### Approach

**Solution**: Treat Polygon, the Polymarket write path, and Polymarket's own balance/allowance cache as the write-path authorities, and treat the public Data API plus DB stamps as lagging read models.

**Reuses**:

- `PrivyPolyTraderWalletAdapter.ensureTradingApprovals(...)` for the pinned 6-approval ceremony
- `PolymarketClobAdapter.sellPositionAtMarket(...)` as the market-sell primitive
- `MarketProviderPort.getOrder(...)` and existing CLOB logging/metrics surface
- Existing route/auth/container wiring for tenant-scoped wallet actions
- Existing `polymarket.ctf.redeem.ts` / `redeemPositions` flow for on-chain redemption

**Rejected**:

- Keep the current route contract and just sleep before rereading `/positions`.
  This is still a stale-read heuristic, not a correctness boundary.
- Retry every failed market exit automatically.
  Unsafe: auth/validation failures are not retry-eligible and can duplicate side effects.
- Continue using `tradingApprovalsReadyAt` as the exit gate.
  Candidate-a proved that a stamped row can coexist with live allowance drift.
- Treat the public Data API as authoritative write acknowledgement.
  It is a read model and can lag a just-accepted/just-filled order.

### Integration Shape

This is a **Port/Adapter** problem under the `third-party-integrator` decision matrix:

- production dependency
- core money movement depends on it
- CI must run without the real service
- provider quirks must be normalized behind a stable boundary

The clean boundary is:

1. `packages/market-provider`
   Add explicit exit-domain types for share-based market exits and typed provider failure taxonomy.
2. `nodes/poly/app` executor
   Orchestrate approval readiness, exit retries/backoff, and route-level response mapping.
3. HTTP contract
   Return typed exit states instead of collapsing provider acceptance + stale reconciliation into `close_failed`.

### Current vs Next Scope

This PR completes the correctness hotfix layer. It does **not** yet ship the fully typed close/redeem response contract from the longer design. What is now true on the branch:

- close is market-based and uncapped
- exit readiness is live and self-healing
- provider balance/allowance cache is refreshed before sell
- provider success is not negated by one stale `/positions` reread
- successful close/redeem invalidates stale wallet-analysis execution cache keys

What remains as next-step work:

- readonly-first position-state split: `live_positions`, `closed_positions`, `pending_actions`
- typed close/redeem states for HTTP and tool consumers
- MCP exposure of that readonly position-state shape once the MCP/tooling projects land the infrastructure

### Close Semantics

1. Discover the candidate position by `token_id` using the existing Data API position list.
2. Run live approval readiness before placing the exit.
   Preferred implementation: call `ensureTradingApprovals(billingAccountId)` on every user close.
   Reason: it already reads the pinned live target matrix first, is idempotent, and self-heals drift.
3. Refresh Polymarket's `/balance-allowance` cache for both collateral and the conditional token being exited.
   Reason: candidate-a showed that the provider can keep returning `allowance: 0` for the neg-risk adapter even after on-chain approvals are repaired.
4. Submit a market `FAK` SELL for the full share balance.
5. Normalize the provider response into a dedicated exit result, e.g.:
   - `state: "exited"` — provider accepted, reconciliation confirms no remaining position
   - `state: "submitted"` — provider accepted/fill observed, but read model is still reconciling
   - `state: "partial"` — provider made progress but a bounded retry window ended with remaining shares
   - `state: "rejected"` — provider rejected with typed reason (`AUTH_FAILED`, `VALIDATION_FAILED`, `PROVIDER_ERROR`, `NETWORK_ERROR`, `INSUFFICIENT_ALLOWANCE`, `NO_BID_LIQUIDITY`, etc.)

6. Reconciliation after placement must be bounded and provider-aware:
   - short backoff polling is allowed to collapse the common case to `exited`
   - a single stale `/positions` read must not fail the request
   - if the write succeeded but read reconciliation is lagging, return a non-error typed state (`submitted`), not `502`

7. A successful close/redeem must evict wallet-scoped execution/read-model caches.
   Reason: candidate-a proved the write can succeed while a warm 30 s process cache still renders the old "open" row.

### Redeem Semantics

- Redeem remains separate from close.
- Grant caps never apply to redeem.
- Immediate implementation can keep the current route shape, but the design target is chain-authoritative eligibility:
  the on-chain redeem path should be the source of truth, while Data API `redeemable` is advisory/discovery only.

### Invariants

- [ ] USER_EXITS_IGNORE_GRANT_CAPS: user close/redeem paths never apply per-order, daily, or hourly grant caps
- [ ] EXIT_READINESS_IS_LIVE: exit readiness is checked against the live pinned approval target set; `tradingApprovalsReadyAt` is never treated as sole truth for exits
- [ ] PROVIDER_BALANCE_ALLOWANCE_CACHE_IS_REAL: on-chain approvals do not by themselves prove Polymarket's live SELL path is ready; exit must refresh `/balance-allowance` before treating allowance errors as final
- [ ] PROVIDER_WRITE_ACK_BEATS_LAGGING_READ_MODEL: one stale `/positions` reread cannot negate an accepted or filled provider write
- [ ] POST_EXIT_REFETCH_SEES_FRESH_STATE: successful close/redeem paths evict wallet-scoped execution/read-model caches so the next dashboard refetch does not reuse stale holdings
- [ ] EXIT_TYPES_MATCH_EXECUTION_UNITS: share-based market exits use explicit share-grounded result types rather than overloading USDC-notional receipts
- [ ] RETRY_ONLY_SAFE_PROVIDER_ERRORS: only network/provider-transient failures are retry-eligible; auth and validation failures are surfaced directly
- [ ] REDEEM_AUTHORITY_IS_CHAIN: redeem correctness is grounded in chain state, not only in Data API advisory flags
- [ ] SIMPLE_SOLUTION: reuse existing approval, CLOB, and route wiring rather than adding new background infrastructure
- [ ] ARCHITECTURE_ALIGNMENT: provider normalization lives at the adapter/port boundary, orchestration in the executor, contracts in `packages/node-contracts`

### Files

- Create: `docs/spec/poly-position-exit.md` — proposed integration contract for close/redeem semantics
- Modify: `packages/node-contracts/src/poly.wallet.position-actions.v1.contract.ts` — typed close/redeem response states
- Modify: `packages/market-provider/src/domain/order.ts` or adjacent exit-domain file — explicit exit result/failure types
- Modify: `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts` — normalize market-exit results and typed failures
- Modify: `nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts` — reusable live approval/readiness helper semantics
- Modify: `nodes/poly/app/src/bootstrap/capabilities/poly-trade-executor.ts` — approval revalidation, reconciliation loop, typed exit mapping
- Modify: `nodes/poly/app/src/app/api/v1/poly/wallet/positions/close/route.ts` — return typed close states instead of generic `502`
- Modify: `nodes/poly/app/src/app/api/v1/poly/wallet/positions/redeem/route.ts` — keep redeem uncapped and align with proposed typed semantics
- Test: `nodes/poly/app/tests/unit/bootstrap/poly-trade-executor.test.ts` — allowance drift, stale Data API, partial exit, accepted-but-pending reconcile
- Test: `packages/market-provider/tests/polymarket-clob-adapter.test.ts` — typed market-exit normalization, provider balance/allowance refresh, and retry eligibility

## Plan

- [ ] Add the proposed exit spec and lock the invariants
- [x] Evict wallet-analysis cache entries after successful close/redeem so the dashboard reflects the new holding state immediately
- [ ] Introduce a dedicated market-exit result type at the provider boundary
- [x] Rework executor close flow to run live approval readiness and bounded reconciliation
- [ ] Update close/redeem HTTP contracts and route responses to typed states
- [x] Add tests for allowance drift, provider cache drift, stale `/positions`, partial fills, and redeem uncapped behavior

## 2026-05-02 Corrective Pass

Production/preview/candidate-a Loki review shows close is still red even after PR #999 merged:

| path                       | candidate-a                                                                               | preview                                                   | production                                                          | rating     |
| -------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- | ---------- |
| UI `POST /positions/close` | 41x `409`, 53x `502`                                                                      | 16x `409`, 6x `502`, 1x `200`                             | 29x `409`, 21x `502`, 1x `403`                                      | red        |
| CLOB close backend         | accepted/rejected/error events all present; stale retry commonly follows an accepted sell | same pattern at lower volume                              | accepted sells followed by `insufficient_balance` / no-match errors | red        |
| manual redeem              | 1x `503`                                                                                  | no route traffic in window                                | 1x `200`, 7x `202`, 9x `409`                                        | yellow     |
| auto redeem                | enqueue/submit/confirm events present, but worker errors remain                           | enqueue/submit/confirm plus worker errors and bleed event | enqueue/submit/confirm plus worker errors and bleed event           | yellow/red |

Close root cause is backend split-brain, not just UI wiring: one request submitted a FAK CLOB sell, immediately re-read lagging public Data API state, retried the same full share sell with the same client order id, and then route-level code marked local ledger rows closed regardless of authoritative refresh/reconciliation.

Corrective scope on `derekg1729/fix-position-close`:

- `PolyTradeExecutor.exitPosition` submits one authorized FAK market sell for the current Data API share balance and returns the provider receipt. It no longer reinterprets a stale immediate `/positions` read as failure or resubmits duplicate close attempts.
- `POST /api/v1/poly/wallet/positions/close` no longer calls `markPositionClosedByAsset(reason: "manual_close")`. The existing wallet refresh/reconcile path remains the owner of terminal local close state via `refresh_no_position`.
- Dashboard optimistic suppression only hides a row after a filled close with positive fill or a redeem response with `tx_hash`; pending/zero-fill results keep the row visible until refresh/reconcile updates it.
- Regression tests pin the one-shot close behavior and ensure the HTTP route does not fabricate terminal ledger state.

## Next Tasks

- [task.0354](./task.0354.poly-trading-hardening-followups.md) — follow-on hardening bucket for executor/read-model cleanup and agent tool surfaces
- [task.0356](./task.0356.poly-wallet-onboarding-trading-e2e-test-suite.md) — automated end-to-end proof for connect → enable trading → open/close/redeem
- [task.0355](./task.0355.poly-trading-wallet-enable-trading.md) — prerequisite approval/readiness surface that this task now relies on
- [proj.agentic-interop](../projects/proj.agentic-interop.md) and [proj.tool-use-evolution](../projects/proj.tool-use-evolution.md) — future MCP/tooling infrastructure for the readonly position-state tool surface

## Validation

- **exercise:** on `candidate-a`, with a tenant wallet that has two live positions and at least one resolved redeemable position:
  1. call `POST /api/v1/poly/wallet/positions/close` on a neg-risk token where allowance drift would previously fail; expect either `state=exited` or `state=submitted`, never `502 close_failed`, and observe the system auto-check approvals plus refresh Polymarket's balance/allowance cache before exit.
  2. call `POST /api/v1/poly/wallet/positions/close` on a non-neg-risk token that previously produced `sellPositionAtMarket: ok` followed by `market exit made no progress`; expect a typed success/pending/partial outcome, never that stale-read 502.
  3. call `POST /api/v1/poly/wallet/positions/redeem` on a resolved winning condition; expect a tx hash and no grant-cap denial.
- **observability:** Loki on the deployed SHA shows `poly.wallet.enable_trading.*`, `poly.clob.balance_allowance.sync`, `poly.exit.place.*`, and `poly.exit.reconcile.*` events for the request; there are no `poly.wallet.positions.close.error` rows whose message contains `market exit made no progress`, and no exit-denial rows caused by grant caps.

## Review Checklist

- [ ] **Work Item:** `task.0357` linked in PR body
- [ ] **Spec:** `poly-trader-wallet-port`, `architecture-spec`, and `poly-position-exit` invariants upheld
- [ ] **Tests:** adapter + executor tests cover allowance drift, stale read-model lag, and typed exit outcomes
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Split from the broader hardening bucket in `task.0354`
- Position-state model and future readonly tool shape: [poly-position-exit](../../docs/spec/poly-position-exit.md)

## Attribution

- Candidate-a Loki review on 2026-04-23 established the three failure classes this task fixes:
  stale approval readiness vs live allowance drift, provider cache drift (`/balance-allowance` stale while chain approvals are good), and provider success negated by lagging `/positions` rereads.
