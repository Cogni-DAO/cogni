# operator-wallet · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft

## Purpose

Standalone workspace package (`@cogni/operator-wallet`) providing Privy-managed operator wallet custody — submits typed intents to Privy HSM for on-chain signing. No raw key material in the app process.

## Pointers

- [Operator Wallet Spec](../../docs/spec/operator-wallet.md) — lifecycle, custody, access control
- [Web3 OpenRouter Payments Spec](../../docs/spec/web3-openrouter-payments.md) — top-up economics and flow
- [Spike: full-chain.ts](../../scripts/experiments/full-chain.ts) — proof-of-concept for approve + transfer

## Boundaries

```json
{
  "layer": "packages",
  "may_import": [],
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

**External deps:** `viem` (ABI encoding, address utils), `@privy-io/node` (HSM wallet SDK), `@0xsplits/splits-sdk` (Split ABI).

## Public Surface

- **Exports:** `OperatorWalletPort`, `TransferIntent`, `Eip712TypedData`, `PrivyOperatorWalletAdapter`, `PrivyOperatorWalletConfig`, `calculateSplitAllocations`, `SPLIT_TOTAL_ALLOCATION`, `OPENROUTER_CRYPTO_FEE_PPM`
- **Routes:** none
- **Env/Config keys:** `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY`, `OPERATOR_MAX_TOPUP_USD` (consumed by `apps/operator` bootstrap, not by this package directly)

## Ports

- **Uses ports:** none (this package _is_ the adapter)
- **Implements ports:** `OperatorWalletPort`

## Responsibilities

- This directory **does**: implement `distributeSplit()` and `fundOpenRouterTopUp()` via Privy HSM on Base; implement `signPolymarketOrder()` on Polygon (EIP-712 typed-data signing, scoped to the Polymarket CLOB domain); validate signing gates (SENDER_MATCH, DESTINATION_ALLOWLIST, CHAIN_MISMATCH, MIN_TOPUP, MAX_TOPUP_CAP); encode ERC-20 approve + Coinbase Commerce `transferTokenPreApproved` calldata.
- This directory **does not**: hold raw key material, manage env vars, orchestrate charge creation, persist state, interact with databases, or expose a generic `signTypedData`/`signMessage` surface (NO_GENERIC_SIGNING — every signing method is named for its use-case).

## Notes

- `fundOpenRouterTopUp` validates 5 gates before submitting any transaction — all BigInt arithmetic.
- `signPolymarketOrder` on the port is **dead surface as of task.0315 P1 CP2 (rev 4)** — retained as a CP1 stub to avoid scope creep, scheduled for deletion in CP3. CLOB order signing flows through `@privy-io/node/viem`'s `createViemAccount` (returns a viem `LocalAccount`) wired directly into `@polymarket/clob-client`, not through this adapter. Existing Base methods remain pinned to `BASE_CAIP2` — the adapter is chain-parameterized per use-case for transfers only.
- CP2 evidence: `scripts/experiments/sign-polymarket-order.ts` — proves the Privy-HSM → clob-client signing seam on Polygon (chainId 137) with zero hand-rolled translation, zero shim, zero on-chain activity. `@polymarket/clob-client` is a root devDependency (only the experiment script consumes it); it will move to `packages/market-provider` as an optional peerDep in CP3.
- SIMULATE_BEFORE_BROADCAST deferred to Privy infrastructure (SDK has no pre-sign simulation hook).
- Transfers ABI in `src/domain/transfers-abi.ts` matches deployed contract `0x03059433BCdB6144624cC2443159D9445C32b7a8` on Base.
