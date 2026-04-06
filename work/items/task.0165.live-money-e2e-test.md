---
id: task.0165
type: task
title: Live money e2e test — full OpenRouter top-up chain on Base mainnet
status: needs_closeout
priority: 1
rank: 25
estimate: 2
summary: Build an external:money test that creates a payment intent, sends real USDC on Base via the on-chain payment path (intents → submit → poll CONFIRMED), then asserts correctness in TigerBeetle, Postgres, and OpenRouter credits balance. Prerequisite — dev:stack running.
outcome: A single test validates the entire payment-to-provider pipeline with real money on Base mainnet. TigerBeetle balances, Postgres funding rows, and OpenRouter credit balance all asserted. Runs via `pnpm test:external:money`. Never in CI.
spec_refs: web3-openrouter-payments, financial-ledger-spec, operator-wallet
assignees: derekg1729
credit:
project: proj.ai-operator-wallet
branch: feat/operator-wallet-e2e
pr:
reviewer:
revision: 2
blocked_by: task.0086
deploy_verified: false
created: 2026-03-14
updated: 2026-03-14
labels: [testing, wallet, web3, billing]
external_refs:
---

# Live money e2e test — full OpenRouter top-up chain on Base mainnet

## Requirements

- New vitest config `apps/operator/vitest.external-money.config.mts` — follows the external test pattern but does NOT use testcontainers. Expects the full `dev:stack` to be running (Postgres, TigerBeetle, app server)
- New pnpm script `test:external:money` — runs the money test suite; never part of CI or `check:full`
- Env requirements in `.env.test`: `DATABASE_SERVICE_URL`, `TIGERBEETLE_ADDRESS`, `OPENROUTER_API_KEY`, `TEST_WALLET_PRIVATE_KEY`
- Test is black-box against the running app — sends USDC via viem, authenticates via SIWE, calls HTTP API, then queries DB/TB/OpenRouter for assertions
- Test file `tests/external/money/openrouter-topup-e2e.external.money.test.ts` validates the full chain:
  1. **Seed user + SIWE login** — create test user in Postgres, authenticate via SIWE against the running app
  2. **Send USDC to Split** — real on-chain USDC transfer from test wallet to Split address
  3. **POST /api/v1/payments/credits/confirm** — triggers the full orchestration chain in the running app
  4. **Assert Postgres** — `provider_funding_attempts` row exists with `status = 'funded'` and valid `funding_tx_hash`
  5. **Assert TigerBeetle** — account balances: Treasury debited, OperatorFloat credited+debited, ProviderFloat credited
  6. **Assert OpenRouter** — GET `/api/v1/credits`, verify credit balance increased
  7. **Assert idempotency** — second call with same clientPaymentId does not double-charge
- Minimum test amount: `amountUsdCents = 110` ($1.10)
- Test timeout: 60s
- Cleanup: delete test user via FK cascade

## Allowed Changes

- `apps/operator/vitest.external-money.config.mts` (new)
- `apps/operator/tests/external/money/openrouter-topup-e2e.external.money.test.ts` (new)
- `package.json` (add `test:external:money` script)

## Validation

**Prerequisite:** Full dev stack running (`pnpm dev:stack`)

**Command:**

```bash
pnpm test:external:money
```

**Cost per run:** ~$1.10 USDC + ~$0.001 gas

## Review Checklist

- [ ] **Work Item:** `task.0165` linked in PR body
- [ ] **Spec:** DETERMINISTIC_IDS, DURABLE_FUNDING_ROW, DOUBLE_ENTRY_CANONICAL, MARGIN_PRESERVED all asserted
- [ ] **Tests:** test passes with real money on Base mainnet
- [ ] **CI safety:** `test:external:money` is NOT added to `check:full` or any CI workflow
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Depends on: task.0086 (OpenRouter top-up orchestration — must be merged first)
- Branch: `feat/operator-wallet-e2e`

## Attribution

-
