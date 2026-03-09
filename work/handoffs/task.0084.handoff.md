---
id: task.0084.handoff
type: handoff
work_item_id: task.0084
status: active
created: 2026-02-18
updated: 2026-02-18
branch: feat/dev-lifecycle
last_commit: c1a6e4b9
---

# Handoff: Operator Wallet Provisioning + Wiring

## Context

- **Goal:** Close the financial loop — every user credit purchase automatically provisions OpenRouter credits and sweeps the DAO's margin to treasury. No manual transfers.
- **Custody:** Privy server wallets — no raw key material in the app. Privy HSM signs transactions. App submits typed intents via `OperatorWalletPort`.
- **This task (0084)** is PR 1 of 3: provision wallet via Privy, define `OperatorWalletPort`, wire into existing payment flow. PRs 2-3 (task.0085, task.0086) implement the outbound transfers.
- **Existing payment flow is unchanged** — users still send USDC via the same UI. Only the destination address changes from DAO wallet to operator wallet.
- **Project:** [proj.ai-operator-wallet](../projects/proj.ai-operator-wallet.md) — 3-PR roadmap.

## Current State

- **Done:** Project roadmap rewritten, spec updated (Privy custody, OperatorWalletPort), all 3 tasks updated (task.0084/0085/0086)
- **Not done:** No code written yet. All 3 tasks are `Todo`.
- **Existing infrastructure to reuse:**
  - Payment flow works end-to-end (intent → sign → verify → credits)
  - `OnChainVerifier` port pattern is the template for `OperatorWalletPort`
  - repo-spec already has `payments_in.credits_topup.receiving_address` — just change the value
  - Revenue share constants (`USER_PRICE_MARKUP_FACTOR`, `SYSTEM_TENANT_REVENUE_SHARE`) already in `server-env.ts`

## Decisions Made

- **Privy over keystore** — No raw key material in the app. Privy HSM holds signing keys. `OperatorWalletPort` abstraction makes custody backend swappable (keystore adapter is P1 OSS fallback). See [operator-wallet spec](../../docs/spec/operator-wallet.md#p0-adapter-privy-server-wallet)
- **Port renamed to `OperatorWalletPort`** — not a generic signer, a bounded payments actuator. Methods: `getAddress()`, `sweepUsdcToTreasury()`, `fundOpenRouterTopUp()`. See [operator-wallet spec](../../docs/spec/operator-wallet.md#operatorwalletport-interface)
- **Programmatic setup** — `scripts/provision-operator-wallet.ts` calls Privy API to create wallet. No copy/paste keys. Secrets injected into deploy secret store.
- **receiving_address = operator_wallet.address** — enforced at startup (RECEIVING_ADDRESS_MATCH). See [operator-wallet spec](../../docs/spec/operator-wallet.md#repo-spec-configuration)

## Next Actions

- [ ] Implement task.0084: `OperatorWalletPort` interface, `PrivyOperatorWalletAdapter`, `provision-operator-wallet.ts` script, repo-spec schema update
- [ ] Implement task.0085: `sweepUsdcToTreasury()`, `calculateDaoShare()`, `outbound_transfers` table, dispatch from `creditsConfirm.ts`
- [ ] Implement task.0086: `fundOpenRouterTopUp()`, `calculateOpenRouterTopUp()`, OpenRouter charge creation, Coinbase Commerce encoding, `outbound_topups` table, margin startup check
- [ ] After all 3 PRs: provision real operator wallet via Privy, update repo-spec addresses, fund wallet on Base

## Risks / Gotchas

- **Privy dependency:** Vendor dependency for custody. Mitigated by `OperatorWalletPort` abstraction — keystore adapter can be built as P1 fallback.
- **Non-atomic split:** If app crashes between credit mint and treasury sweep, USDC sits in operator wallet temporarily. Acceptable — `outbound_transfers` table provides retry. Not a fund loss risk.
- **OpenRouter Coinbase Commerce protocol:** Returns `transfer_intent`, NOT raw calldata. Must encode `swapAndTransferUniswapV3Native(intent, poolFeesTier=500)`. Transfers contract on Base: `0xeADE6bE02d043b3550bE19E960504dbA14A14971`.
- **Env vars are optional for PR 1:** `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY` should be optional so existing deployments don't break. Wallet features activate only when all three are set.
- **Dependency-cruiser boundaries:** Port in `src/ports/`, adapter in `src/adapters/server/wallet/`, pure math in `src/core/billing/`. Follow existing `onchain-verifier.port.ts` pattern exactly.

## Pointers

| File / Resource                                                              | Why it matters                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [proj.ai-operator-wallet](../projects/proj.ai-operator-wallet.md)            | 3-PR roadmap, design rationale                                      |
| [operator-wallet spec](../../docs/spec/operator-wallet.md)                   | OperatorWalletPort interface, invariants, Privy adapter             |
| [web3-openrouter-payments spec](../../docs/spec/web3-openrouter-payments.md) | Top-up economics, state machines, Coinbase Commerce flow            |
| [task.0084](../items/task.0084.operator-wallet-generation-wiring.md)         | PR 1 detailed plan                                                  |
| [task.0085](../items/task.0085.dao-treasury-forwarding.md)                   | PR 2 detailed plan                                                  |
| [task.0086](../items/task.0086.openrouter-topup-integration.md)              | PR 3 detailed plan                                                  |
| `src/ports/onchain-verifier.port.ts`                                         | Port pattern to follow                                              |
| `src/shared/config/repoSpec.server.ts`                                       | Where to add `getOperatorWalletConfig()`                            |
| `src/core/billing/pricing.ts`                                                | Where to add `calculateOpenRouterTopUp()` and `calculateDaoShare()` |
| `src/features/payments/services/creditsConfirm.ts`                           | Dispatch point for outbound flows after credit settlement           |
| `src/shared/env/server-env.ts`                                               | Where to add Privy env vars                                         |
| `src/bootstrap/container.ts`                                                 | Where to wire the adapter                                           |
