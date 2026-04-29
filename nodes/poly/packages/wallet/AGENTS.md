# poly-wallet · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derekg1729
- **Status:** draft (port-only; adapter lands in a follow-up B2 slice)

## Purpose

Standalone workspace package (`@cogni/poly-wallet`) providing a per-tenant Polymarket CLOB signing-context port + backend adapters. Issues `AuthorizedSigningContext` values that gate grant-enforced placement at compile time. Separate from `@cogni/operator-wallet` because the operator wallet is a system-role intent-only actuator; this port is a per-tenant credential broker with grant-aware intent authorization + intent-typed withdraw.

## Pointers

- [Poly Trader Wallet Port Spec](../../../../docs/spec/poly-trader-wallet-port.md) — port + adapter contract
- [Poly Multi-Tenant Auth Spec](../../../../docs/spec/poly-multi-tenant-auth.md) — schema (`poly_wallet_connections`, `poly_wallet_grants`) + tenant isolation
- [task.0318 Phase B](../../../../work/items/task.0318.poly-wallet-multi-tenant-auth.md) — lifecycle carrier

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

**External deps (runtime):** `viem` (LocalAccount type). **External deps (adapter-only peer):** `@privy-io/node`.

## Public Surface

- **Port types:** `PolyTraderWalletPort`, `PolyTraderSigningContext`, `AuthorizedSigningContext` (branded), `OrderIntentSummary`, `AuthorizationFailure`, `AuthorizeIntentResult`, `PolyClobApiKeyCreds`
- **Port methods:** `resolve`, `getAddress`, `getBalances` (read-only USDC.e + POL snapshot for UI panels), `provision`, `revoke`, `authorizeIntent`, `withdrawUsdc`, `rotateClobCreds`.
- **Adapters:** `PrivyPolyTraderWalletAdapter` lives in `nodes/poly/app/src/adapters/server/wallet/` (not exported from this package).
- **Env/Config keys:** `PRIVY_USER_WALLETS_APP_ID`, `PRIVY_USER_WALLETS_APP_SECRET`, `PRIVY_USER_WALLETS_SIGNING_KEY` — consumed by `nodes/poly/app` bootstrap, not by this package directly. **MUST NOT** reference `PRIVY_APP_ID` / `PRIVY_APP_SECRET` / `PRIVY_SIGNING_KEY` (those are the operator-wallet system app — `SEPARATE_PRIVY_APP` invariant, enforced via dep-cruiser).

## Ports

- **Uses ports:** none
- **Implements ports:** `PolyTraderWalletPort` (adapter side)

## Responsibilities

- This directory **does**: define the `PolyTraderWalletPort` interface; ship types consumed by `nodes/poly/app` adapters covering `resolve` / `getAddress` / `getBalances` / `provision` (advisory-locked) / `revoke` / `authorizeIntent` / `withdrawUsdc` / `rotateClobCreds` (adapter implementations live under `nodes/poly/app`).
- This directory **does not**: hold raw key material; read system-tenant Privy creds (`PRIVY_APP_*`); expose a generic `signMessage` / `signTransaction` surface; implement on-chain allowance setup (onboarding UX concern); own `mirror-coordinator` wiring (that's `nodes/poly/app`).

## Invariants (code-review criteria)

`TENANT_SCOPED`, `NO_GENERIC_SIGNING`, `KEY_NEVER_IN_APP`, `FAIL_CLOSED_ON_RESOLVE`, `TENANT_DEFENSE_IN_DEPTH`, `CREDS_ENCRYPTED_AT_REST`, `PROVISION_IS_IDEMPOTENT`, `REVOKE_IS_DURABLE`, `SEPARATE_PRIVY_APP`, `AUTHORIZED_SIGNING_ONLY`, `NO_ORPHAN_BACKEND_WALLETS`, `WITHDRAW_BEFORE_REVOKE` (UX), `CUSTODIAL_CONSENT` (UX). Full definitions in the spec.

## Notes

- The branded `AuthorizedSigningContext` makes scope/cap bypass a TypeScript compile error at the `placeOrder` call site, not a discipline problem. See the spec's § Port → "Minimal order-intent summary" block for the brand construction.
- `provision` uses `pg_advisory_xact_lock(hashtext(billing_account_id))` for idempotency under concurrency. Orphaned backend wallets from rolled-back transactions are bounded by the `scripts/ops/sweep-orphan-poly-wallets.ts` reconciler (ships in B2).
- The viem `LocalAccount` coupling in `PolyTraderSigningContext` is intentional — every plausible backend terminates at viem and `@polymarket/clob-client` consumes it natively. Not a leak to pre-abstract.
