---
id: task.0356
type: task
title: "Poly — automated E2E suite: wallet onboarding + trading execution"
status: needs_triage
priority: 2
rank: 30
estimate: 5
created: 2026-04-22
updated: 2026-04-22
summary: "Deferred from [task.0355](./task.0355.poly-trading-wallet-enable-trading.md) implementation review (PR #992): add an automated test ladder that exercises the full per-tenant path — connect + default grant, balances/status, `POST /api/v1/poly/wallet/enable-trading` (idempotent + insufficient-POL + partial failure), `trading_ready` / `authorizeIntent` ordering (`trading_not_ready` vs caps), copy-trade target registration, and at least one mirror `placeOrder` happy path — using the repo's stack-test and/or Playwright layers per [Testing Strategy](../../docs/guides/testing.md). Closes the gap where `ensureTradingApprovals` on-chain logic is only covered manually on candidate-a."
outcome: "CI blocks regressions on the money path that [bug.0335](./bug.0335.poly-clob-buy-empty-reject-candidate-a.md) class of failures fixed: missing approvals, wrong `authorizeIntent` ordering, or broken HTTP contracts. New code touching `PrivyPolyTraderWalletAdapter.ensureTradingApprovals`, wallet routes, or trade executor wiring must fail a deterministic test before merge."
spec_refs:
  - docs/guides/testing.md
  - docs/spec/poly-trader-wallet-port.md
  - docs/spec/poly-multi-tenant-auth.md
assignees: []
credit:
  project: proj.poly-copy-trading
branch:
pr:
reviewer:
revision: 0
blocked_by: []
labels:
  [
    poly,
    testing,
    e2e,
    stack-test,
    wallet,
    onboarding,
    trade-execution,
    deferred,
  ]
---

# task.0356 — Poly wallet onboarding + trading E2E test suite

## Problem

[task.0355](./task.0355.poly-trading-wallet-enable-trading.md) (PR #992) productized Enable Trading and `APPROVALS_BEFORE_PLACE`, but **no automated tests call `ensureTradingApprovals`** or run the **HTTP → adapter → stamp** path. `authorizeIntent` is covered for `trading_not_ready` via DB fixture in `privy-poly-trader-wallet.adapter.int.test.ts`; the **five-step on-chain ceremony** (mocked RPC + Privy) is not. Stack tests for `POST /enable-trading` and Playwright/RTL for Money-page states were listed in the 0355 work item and **explicitly deferred** here so 0355 could ship for `deploy_verified` flight.

Without this suite, the highest-risk surface (fresh tenant → CLOB) relies on manual candidate-a exercise only.

## Scope

In:

**Layer A — Adapter (component / testcontainers)**

- `ensureTradingApprovals` matrix against **mocked** Polygon `readContract` / `writeContract` + Privy signer: all five already satisfied (zero txs + stamp), mixed partial, full cold path, `polBalance < ENABLE_TRADING_MIN_POL` (`skipped` + `insufficient_pol_gas`, no txs), one mid-sequence revert (partial steps + **no** `trading_approvals_ready_at`), optional RPC read flake if a cheap pattern exists.
- Reuse or extend `nodes/poly/app/tests/component/wallet/privy-poly-trader-wallet.adapter.int.test.ts` (or a sibling file) — follow [test-expert](../../.claude/skills/test-expert/SKILL.md) for layer choice.

**Layer B — HTTP stack**

- `POST /api/v1/poly/wallet/enable-trading` and `GET /api/v1/poly/wallet/status` with fake adapter or seeded DB + contract response parsing (`polyWalletEnableTradingOperation.output`).
- Idempotent double-POST behavior if not already covered at adapter boundary.

**Layer C — UI (optional v1.5)**

- Playwright or RTL: Money `/credits` — disabled Enable when POL below min; success path mocks; align with whatever stack-test already starts (`pnpm dev:stack:test`).

**Observability (optional in same PR or tiny follow-up)**

- If [task.0355](./task.0355.poly-trading-wallet-enable-trading.md) Prometheus counter `poly_wallet_trading_enabled_total` is still absent, either add it here or file a one-line sub-item in this task's closeout.

Out:

- **Full Grafana/Loki assertion automation** — keep human validation on candidate-a per [Development Lifecycle](../../docs/spec/development-lifecycle.md); tests assert HTTP + adapter + DB only.
- **Live-money candidate-a as CI gate** — never; use fakes + test DB.

## Validation

- **exercise:** `pnpm test:component` (or scoped vitest) runs the new `ensureTradingApprovals` cases green; `pnpm test:stack:dev` (or CI stack job) runs new route-level tests green.
- **observability:** N/A for CI; link the PR check names in closeout.

## Dependencies

- **Soft:** [task.0355](./task.0355.poly-trading-wallet-enable-trading.md) merged first (tests assert current contracts + column). Can start on a branch stacked on #992 if needed.
- **Project:** [proj.poly-copy-trading](../projects/proj.poly-copy-trading.md).

## Notes

- This task **does not** change production trading logic unless tests reveal a bug — primary deliverable is **tests + fixtures**.
- Link PR bodies back here for traceability from 0355 review **REQUEST CHANGES** (test gap) resolution.
