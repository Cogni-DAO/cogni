---
id: proj.ai-operator-wallet
type: project
primary_charter:
title: AI Operator Wallet
state: Active
priority: 1
estimate: 3
summary: App-controlled operator wallet (Privy-managed) receives user USDC payments via a Splits contract that trustlessly routes DAO share to treasury, then tops up OpenRouter credits autonomously. No custom smart contracts, no raw signing in app.
outcome: Users pay USDC to Split contract → on-chain split routes DAO share to treasury + operator share to wallet → app tops up OpenRouter → credits backed by real LLM spend. Zero manual transfers.
assignees: derekg1729
created: 2026-02-11
updated: 2026-02-20
labels: [wallet, billing, web3]
---

# AI Operator Wallet

> Research: [ai-operator-wallet-budgeted-spending](../../docs/research/ai-operator-wallet-budgeted-spending.md)

## Goal

Close the financial loop so every credit purchase automatically provisions OpenRouter — no manual transfers, no DAO votes per purchase. Users pay USDC to a [Splits](https://splits.org/) contract that trustlessly routes the DAO's share to treasury and the operator's share to a Privy-managed server wallet. After credits mint, the app tops up OpenRouter with the provider cost from the operator wallet.

## Roadmap

### Crawl (P0) — Operator Wallet + Outbound Payments

**Goal:** Validate payment chain experimentally, then: operator wallet via Privy, Splits contract for trustless revenue split, OpenRouter top-up wired.

Spike + 3 atomic PRs, each shippable:

| #   | Deliverable                                   | Status      | Est | Work Item  |
| --- | --------------------------------------------- | ----------- | --- | ---------- |
| 0   | Experimental spike: validate payment chain    | Not Started | 1   | spike.0090 |
| 1   | Operator wallet provisioning + wiring         | Not Started | 2   | task.0084  |
| 2   | Splits contract deployment + payment re-route | Not Started | 1   | task.0085  |
| 3   | OpenRouter top-up integration                 | Not Started | 3   | task.0086  |

**Spike 0 — Validate payment chain (hands-on, before building abstractions):**

Three sub-experiments, run manually from scripts with a real wallet on Base:

1. **OpenRouter crypto top-up** — `POST /api/v1/credits/coinbase` with `{amount: 5, sender, chain_id: "8453"}`. Record exactly what `metadata.function_name` comes back. If `swapAndTransferUniswapV3Native` → operator needs ETH. If `transferTokenPreApproved` or `swapAndTransferUniswapV3TokenPreApproved` → operator can pay with USDC directly. Execute the tx. Confirm credits appear via `GET /api/v1/credits`.
2. **0xSplits deployment** — Deploy a mutable Split on Base via `@0xsplits/splits-sdk`. Two recipients (test wallets). Send USDC to the Split address. Call `distributeERC20()`. Verify both recipients received correct shares.
3. **End-to-end chain** — Send USDC to the Split. Distribute. From the operator-share recipient, execute the OpenRouter top-up from step 1. Prove the full flow: USDC → Split → operator wallet → OpenRouter credits.

**Key unknowns this spike resolves:**

- Does OpenRouter return `Native` or `Token`/`TokenPreApproved` as function_name? (determines ETH vs USDC funding)
- What is `metadata.contract_address`? Is it `0xeADE6...` (Coinbase Transfers) or something else?
- Does Splits `distributeERC20()` work with Base USDC? Gas cost?
- Can the full chain complete in < 2 minutes (user experience)?

**PR 1 — Operator wallet provisioning + wiring:**

- `scripts/provision-operator-wallet.ts` — create wallet via Privy API, output address
- Add `operator_wallet.address` to `.cogni/repo-spec.yaml`
- `OperatorWalletPort` interface in `src/ports/operator-wallet.port.ts`
- Privy adapter: verify Privy-reported address matches repo-spec at startup
- Wire into `src/bootstrap/container.ts`

**PR 2 — Splits contract deployment + payment re-route:**

- Deploy a mutable Split contract on Base via Splits SDK (`@0xsplits/splits-sdk`)
- Recipients: ~92.1% → operator wallet, ~7.9% → DAO treasury (derived from pricing constants)
- Controller: Privy operator wallet (can update percentages if pricing constants change)
- Add `operator_wallet.split_address` to `.cogni/repo-spec.yaml`
- Update `payments_in.credits_topup.receiving_address` → Split contract address
- After credit mint, app calls `SplitMain.distributeERC20()` to trigger USDC distribution
- Existing payment flow works unchanged — users now send USDC to Split instead of DAO wallet
- DAO treasury receives its share trustlessly on-chain — no app-level sweep needed
- No `outbound_transfers` table, no `sweepUsdcToTreasury()`, no `calculateDaoShare()`

**PR 3 — OpenRouter top-up integration:**

- `OperatorWalletPort.fundOpenRouterTopUp(intent)` — typed intent for Coinbase Commerce protocol
- `calculateOpenRouterTopUp()` in `src/core/billing/pricing.ts`
- OpenRouter charge creation → Coinbase Commerce transfer function → submit via Privy
- Function determined by spike: `swapAndTransferUniswapV3Native` (ETH input) or `transferTokenPreApproved` / `swapAndTransferUniswapV3TokenPreApproved` (USDC input)
- Coinbase Transfers contract: `0xeADE6bE02d043b3550bE19E960504dbA14A14971` on Base (confirmed)
- `outbound_topups` table + state machine (CHARGE_PENDING → CHARGE_CREATED → TX_BROADCAST → CONFIRMED)
- Charge receipt logging with `openrouter_topup` reason
- New env vars: `OPENROUTER_CRYPTO_FEE`, `OPERATOR_MAX_TOPUP_USD`
- Margin safety check at startup: `MARKUP × (1 - FEE) > 1 + REVENUE_SHARE`

### Walk (P1) — Monitoring + Hardening

**Goal:** Observability, automated balance checks, optional OSS custody adapter.

| Deliverable                                               | Status      | Est | Work Item            |
| --------------------------------------------------------- | ----------- | --- | -------------------- |
| Grafana alerts: operator balance, top-up failures, margin | Not Started | 2   | (create at P1 start) |
| OpenRouter balance probe (GET /api/v1/credits polling)    | Not Started | 1   | (create at P1 start) |
| Keystore/Vault adapter (OSS fallback for Privy)           | Not Started | 3   | (create at P1 start) |
| Circuit breaker: pause purchases on persistent failures   | Not Started | 2   | (create at P1 start) |
| UI admin panel: trigger manual top-up, view status        | Not Started | 2   | (create at P1 start) |

### Run (P2+) — Autonomous Spending

**Goal:** AI monitors its own balance and tops up within DAO-approved limits.

| Deliverable                                                 | Status      | Est | Work Item            |
| ----------------------------------------------------------- | ----------- | --- | -------------------- |
| Auto top-up: agent monitors credit balance, triggers top-up | Not Started | 2   | (create at P2 start) |
| On-chain spending limits (Zodiac Roles or session keys)     | Not Started | 3   | (create at P2 start) |
| x402 integration for AI-to-service micropayments            | Not Started | 2   | (create at P2 start) |

## Constraints

- Base mainnet (8453) only for P0
- No custom smart contracts — Splits contracts are pre-deployed, audited infrastructure (not ours to maintain)
- No DAO votes per purchase — app handles routing autonomously
- No raw key material in the application — Privy holds signing keys
- Credits mint after on-chain USDC transfer confirmation (existing flow unchanged)
- Operator wallet address is governance-in-git (repo-spec)
- Programmatic setup — secrets injected into deploy secret store, no copy/paste

## Dependencies

- [x] OpenRouter Crypto Payments API supports Base (chain_id 8453)
- [x] `cogni_system` billing account exists (task.0046, merged)
- [x] Revenue share constants exist (`SYSTEM_TENANT_REVENUE_SHARE`, `USER_PRICE_MARKUP_FACTOR`)
- [x] Existing USDC payment flow works end-to-end
- [ ] `EVM_RPC_URL` configured for Base mainnet
- [ ] Privy app created with wallet policies configured
- [ ] Splits protocol verified on Base (chain 8453) — deploy Split contract with correct percentages

## As-Built Specs

- [web3-openrouter-payments](../../docs/spec/web3-openrouter-payments.md) — payment math, top-up state machine (draft)
- [operator-wallet](../../docs/spec/operator-wallet.md) — wallet lifecycle, custody, access control (draft)

## Design Notes

### Why Privy over local keystore?

Local keystores require generating, encrypting, and distributing private key material. The app loads the key into memory, making it a hot wallet with full signing authority. Privy provides:

1. **No key material in app** — HSM-backed signing, private key never leaves Privy infrastructure
2. **Wallet policies** — Privy-side guardrails (chain, contracts, caps) as defense in depth
3. **Signed requests** — `PRIVY_SIGNING_KEY` adds a second auth factor; leaked `APP_SECRET` alone can't sign
4. **Programmatic setup** — API call creates wallet, no keystore files to manage
5. **Portability** — `OperatorWalletPort` abstraction means we can swap to keystore/Vault later (P1)

The tradeoff: vendor dependency on Privy. Mitigated by the port abstraction — a `KeystoreOperatorWalletAdapter` can be built as a P1 OSS fallback.

### Why a Splits contract as receiving address?

The existing payment flow already handles USDC transfers to a configured address, verifies on-chain, and mints credits. A [Splits](https://splits.org/) mutable Split contract replaces app-level sweep logic with trustless on-chain distribution: ~92.1% to operator wallet, ~7.9% to DAO treasury. No custom contracts (Splits is pre-deployed, audited infrastructure — $250M+ distributed, zero protocol fees, non-upgradeable). The controller is the operator wallet, so percentages can be updated if pricing constants change.

After credit mint the app calls `distributeERC20()` — DAO treasury receives its share on-chain without any app-level sweep, `outbound_transfers` table, or retry logic.

### Scope boundary: Layer 1 only

This project covers **operator revenue routing** (user pays → Split → operator + treasury). It does NOT cover distributing treasury funds to DAO token holders or contributors. That is a separate concern:

- **Who earns what**: [proj.transparent-credit-payouts](proj.transparent-credit-payouts.md) — signed receipts, epoch-based payout statements
- **On-chain distribution to holders**: [proj.dao-dividends](proj.dao-dividends.md) — treasury → contributors via a second Splits contract (snapshot-updated or Liquid Split)

### OpenRouter top-up is the Coinbase Commerce protocol

OpenRouter returns a `transfer_intent` (not raw calldata) for the [Coinbase Commerce Onchain Payment Protocol](https://github.com/coinbase/commerce-onchain-payment-protocol). The Transfers contract (`0xeADE6bE02d043b3550bE19E960504dbA14A14971` on Base) supports 16 transfer functions including:

- `swapAndTransferUniswapV3Native(intent, poolFeesTier)` — pays with ETH, swaps to recipient currency
- `transferTokenPreApproved(intent)` — pays with ERC-20 directly (no swap if same token)
- `swapAndTransferUniswapV3TokenPreApproved(intent, tokenIn, maxWillingToPay, poolFeesTier)` — pays with any ERC-20, swaps to recipient currency

Which function OpenRouter's API returns in `metadata.function_name` determines whether the operator wallet needs ETH or can pay with USDC directly. **Spike 0 resolves this.** See [web3-openrouter-payments spec](../../docs/spec/web3-openrouter-payments.md) for full flow.

### Coinbase CDP Wallets / Agentic Wallets as Privy alternative

Coinbase launched [Agentic Wallets](https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets) (Feb 2026) — wallet infrastructure purpose-built for AI agents on Base. TEE-backed signing (<200ms), declarative spending policies (per-tx caps, address allowlists, sanctions screening), and native [x402](https://docs.cdp.coinbase.com/agentic-wallet/welcome) support for machine-to-machine payments. SDKs in TypeScript, Python, Go.

**Why this matters for us:** We're already on Base and topping up via Coinbase Commerce — CDP Wallets would be the same vendor stack end-to-end. Their policy engine (address allowlists + tx caps enforced at enclave layer) is more mature than Privy's wallet policies. Privy was acquired by Stripe (Jun 2025), raising long-term ecosystem drift concerns.

**No architecture change needed.** `OperatorWalletPort` insulates us — a `CdpOperatorWalletAdapter` is a 1-PR swap. 0xSplits still handles revenue splitting (wallet providers don't solve that). Recommendation: spike is wallet-agnostic, evaluate CDP vs Privy stability at PR 1 time.

**x402 for DAO agent autonomy (P2+).** x402 embeds stablecoin payments into HTTP requests — an AI agent with wallet controls can discover and pay for services autonomously. This is the path to giving a DAO agent leader its own spending authority with on-chain guardrails (session caps, contract allowlists) rather than app-level permission checks. CDP's x402 Bazaar already has 50M+ txs. Directly relevant to the P2 "autonomous spending" and "x402 integration" roadmap items.

### Top-up economics (derived from constants)

```
openrouterTopUpUsd = paymentUsd × (1 + REVENUE_SHARE) / (MARKUP × (1 - PROVIDER_FEE))

Defaults: 1.75 / (2.0 × 0.95) = $0.9211 per $1.00 purchase
DAO share: $1.00 - $0.9211 = $0.0789 (7.9% margin)
```

See [web3-openrouter-payments spec](../../docs/spec/web3-openrouter-payments.md) for full derivation.
