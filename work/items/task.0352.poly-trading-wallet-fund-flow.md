---
id: task.0352
type: task
title: "Poly trading wallet one-click fund flow (RainbowKit + Polygon)"
status: needs_design
priority: 2
rank: 21
estimate: 3
created: 2026-04-22
updated: 2026-04-22
summary: "Wire a one-click 'Fund trading wallet' flow on the Money page: user triggers a wagmi `useWriteContract` USDC.e transfer (and/or `useSendTransaction` POL send) from their SIWE-connected wallet into their tenant `funder_address` on Polygon. Requires adding Polygon to the wagmi chain config alongside the existing Base SIWE chain, and a repo-spec section for trading-wallet funding so addresses/chains stay as code."
outcome: "A user with a provisioned trading wallet can fund it from their connected Ethereum wallet in one click from `/credits`, with RainbowKit prompting a chain switch to Polygon if needed and the transfer showing up in the tenant's trading-wallet balance within one poll cycle."
spec_refs:
  - docs/spec/poly-trader-wallet-port.md
  - nodes/poly/.cogni/repo-spec.yaml
assignees: []
credit:
project: proj.poly-copy-trading
branch:
pr:
reviewer:
revision: 0
blocked_by:
labels: [poly, wallet, fund, rainbowkit, wagmi, repo-spec, ui]
---

# task.0352 — Poly trading wallet fund flow

## Problem

The Money page v0 (feat/poly-money-page-v0) ships with a copy-the-address fund UX only — users have to paste the address into another wallet app and manually send USDC.e + POL on Polygon. We already have a SIWE-connected wallet via RainbowKit + wagmi on the poly node; the only reasons we can't do a one-click transfer today are:

1. The wagmi config is Base-chain-only (see `chain_id: "8453"` in `nodes/poly/.cogni/repo-spec.yaml` and the payments widget's Base-only chain). Polygon is not in the chain list, so `useWriteContract` will fail until we add it.
2. `repo-spec.yaml` has a `payments_in.credits_topup` section for AI-credit top-ups that's deliberately Base + USDC; there is no parallel section describing the trading-wallet funding chain / token list. We should add one so chain/token allowances stay as code, not hard-coded in React.

## Scope

In:

- `repo-spec.yaml` schema addition (`schema_version` bump): new top-level `trading_wallet_funding` section with `allowed_chains: [Polygon]`, `allowed_tokens: [USDC.e, POL]`. Update the zod repo-spec loader + docs.
- `@cogni/shared/config` helper to read `trading_wallet_funding` server-side; mirrors `getPaymentConfig()`.
- Wagmi config (`app/src/shared/web3/wagmi-config.ts` or equivalent) adds `polygon` to the chain list. RainbowKit will auto-prompt chain switches when the user triggers the fund flow.
- New UI: `FundTradingWalletDialog` on the Trading Wallet panel, replacing the "send USDC + POL to this address" copy-centric banner shipped by v0:
  - User picks token (USDC.e or POL) + enters amount.
  - `useWriteContract` with ERC-20 `transfer(funder_address, amount)` for USDC.e, or `useSendTransaction` for native POL.
  - Reuses `UsdcPaymentFlow` state machine visuals where shape fits; tx hash links to Polygonscan.
- Optional: passive polling of the trading-wallet `/balances` route after a successful fund TX so the panel's balance updates within one poll.

Out:

- Server-side verification of the deposit (unlike AI credit top-ups, there is no ledger to credit — the funds just land in the Privy wallet and the port reads them via RPC).
- Cross-chain bridging (Base USDC → Polygon USDC.e). Users bridge externally for now.
- Fiat on-ramp.
- Non-USDC.e stablecoin support.

## Open Questions

- Do we keep SIWE on Base and let RainbowKit prompt a Polygon chain-switch only when the user triggers funding? Or do we require Polygon as a second chain for SIWE too? Current preference: keep SIWE Base-only, prompt on demand for funding.
- Should the repo-spec's `trading_wallet_funding` auto-derive `funder_address` per-user (not static), or is the address the dynamic field that `/credits` passes into the widget as a prop? Preference: address is a per-user prop; chain/token allowlist is static repo-spec.

## Validation

- **exercise:** on candidate-a, sign in as a user with a provisioned trading wallet, visit `/credits`, click "Fund USDC.e", approve chain switch to Polygon in RainbowKit, approve the ERC-20 transfer, wait for 1 block. The Polygonscan link opens to a real tx; the panel's USDC.e balance reflects the new amount within one refresh.
- **observability:** `{job="poly-node-app",sha="<sha>"}` at the deployed SHA: optional passive log of "fund-flow-initiated" from a write-side event endpoint if we add one; otherwise Polygonscan tx hash matches the user's SIWE wallet as sender and the tenant funder_address as recipient.

## Out of Scope

Server verification of the deposit, cross-chain bridging, fiat on-ramp, non-USDC.e tokens.

## Notes

- Builds on [task.0351](./task.0351.poly-trading-wallet-withdrawal.md) which lands the complementary withdraw path.
- Touching `repo-spec.yaml` is the right call — hard-coding Polygon chain IDs in React is a repeat of the mistake that the payments repo-spec exists to prevent.
- Cross-PR concern: adding Polygon to the wagmi chain list should not break the existing Base-only payments widget; the payments widget filters by `allowed_chains` from `payments_in.credits_topup`, so it should continue to only offer Base. Verify in closeout.
