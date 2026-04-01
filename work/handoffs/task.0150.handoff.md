---
id: task.0150.handoff
type: handoff
work_item_id: task.0150
status: active
created: 2026-03-11
updated: 2026-03-11
branch: feat/task.0150-operator-wallet-e2e
last_commit: 2418b237
---

# Handoff: Operator Wallet E2E — Finish Pipeline Validation

## Context

- The operator wallet payment pipeline lets users pay USDC to a Split contract, which distributes funds to the operator wallet (92.1%) and DAO treasury (7.9%)
- Privy credentials are provisioned, Split is deployed on Base mainnet, and `distributeSplit()` is proven to work via external tests
- The remaining gap: nobody has done a credit purchase through the web UI to prove the full flow fires end-to-end (credit confirm → treasury settlement → on-chain distribute)
- task.0086 (OpenRouter top-up) is blocked until this validation is done — that's where operator funds get forwarded to OpenRouter
- PR #553 targets `feat/operator-wallet-e2e` (not staging)

## Current State

- **Privy wallet provisioned:** `0xdCCa8D85603C2CC47dc6974a790dF846f8695056` — funded with ~$0.02 ETH on Base for gas
- **Split deployed on Base:** `0xd92EEc51C471CcF76996f0163Fd3cB6A61798f9C` — 92.1% operator / 7.9% DAO
- **repo-spec updated:** real addresses for `operator_wallet.address` and `payments_in.credits_topup.receiving_address`
- **External tests pass (3/3):** `getAddress()`, `getSplitAddress()`, `distributeSplit(USDC)` — real txs on Base
- **Adapter bug fixed:** address checksum validation added at construction (`getAddress()` from viem)
- **NOT done:** dev:stack boot with Privy env vars, web UI credit purchase test, Basescan verification
- **NOT in scope:** `fundOpenRouterTopUp()` (task.0086), setup wizard (future)

## Decisions Made

- [Operator wallet spec](../../docs/spec/operator-wallet.md) — Privy HSM custody, port abstraction
- [Setup guide](../../docs/guides/operator-wallet-setup.md) — step-by-step Privy + Split setup
- Signing key is a P-256 authorization key from Privy dashboard (Settings → Authorization → New key), NOT the app secret
- IPv6 DNS timeout fix: `execArgv: ["--dns-result-order=ipv4first"]` in vitest external config
- `distributeSplit()` with 0 USDC is a no-op (not a revert) — safe to call without seeding funds

## Next Actions

- [ ] Boot `pnpm dev:stack` with Privy env vars in `.env.local` — confirm logs show real adapter init
- [ ] Do a credit purchase via web UI — confirm `distributeSplit()` tx appears in structured logs
- [ ] Verify Split contract on Basescan: recipients, allocations, distribute tx history
- [ ] Update task.0086 to unblock once validation passes
- [ ] After task.0150 merges: implement `fundOpenRouterTopUp()` in task.0086 (OpenRouter charge → ERC-20 approve → transferTokenPreApproved)
- [ ] Future: move one-off scripts to `src/features/setup/daoFormation/` pattern (setup wizard)

## Risks / Gotchas

- **Container wiring is all-or-nothing:** requires `PRIVY_APP_ID` + `PRIVY_APP_SECRET` + `PRIVY_SIGNING_KEY` + valid `operator_wallet.address` in repo-spec + `cogni_dao.dao_contract`. Any missing → adapter is `undefined`, settlement silently no-ops
- **IPv6 timeout:** Privy API (Cloudflare-fronted) times out on IPv6. External tests handle this via vitest config. Scripts may need `node --dns-result-order=ipv4first`
- **Gas costs:** each `distributeSplit()` call costs gas on Base mainnet (~$0.0003). The Privy wallet has limited ETH
- **`deploy-split.ts` requires `pnpm packages:build` first** — imports from built `@cogni/operator-wallet`
- **Signing key format:** `wallet-auth:MIGHAgEA...` (SDK strips `wallet-auth:` prefix internally). NOT a PEM-formatted key

## Pointers

| File / Resource                                                                   | Why it matters                                     |
| --------------------------------------------------------------------------------- | -------------------------------------------------- |
| `work/items/task.0150.web3-scripts-to-package-and-setup-dao.md`                   | Work item with checkpoint checklists               |
| `work/items/task.0086.openrouter-topup-integration.md`                            | Next task — OpenRouter top-up (blocked by this)    |
| `docs/guides/operator-wallet-setup.md`                                            | Setup guide — Privy credentials + Split deployment |
| `packages/operator-wallet/src/adapters/privy/privy-operator-wallet.adapter.ts`    | Real adapter — `distributeSplit()` impl            |
| `apps/operator/tests/external/operator-wallet/operator-wallet.external.test.ts`   | External test suite — 3 tests, real Base txs       |
| `apps/operator/src/bootstrap/container.ts:401-437`                                | Container wiring — decides Fake vs Real adapter    |
| `apps/operator/src/features/payments/application/confirmCreditsPurchase.ts`       | Orchestrator — credits + treasury settlement       |
| `apps/operator/src/adapters/server/treasury/split-treasury-settlement.adapter.ts` | Settlement adapter — calls `distributeSplit()`     |
| `.cogni/repo-spec.yaml`                                                           | Real addresses for operator wallet + Split         |
| `scripts/experiments/full-chain.ts`                                               | Spike.0090 reference — proven e2e chain            |
