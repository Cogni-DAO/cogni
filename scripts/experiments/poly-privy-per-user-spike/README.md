# Privy-per-user Polymarket spike (task.0318 B1)

**Goal**: prove a freshly-created Privy embedded wallet (distinct from the shared operator wallet) can place a Polymarket CLOB BUY + SELL autonomously, using the exact same code path Phase A uses for the operator wallet.

**Why a spike before B2**: every piece (Privy SDK, `createViemAccount`, CLOB adapter, allowance script) is already proven in the repo for the operator wallet. What's unproven is the _per-user_ flow end-to-end: createWallet → fund → approve → derive L2 creds → place orders against a funder that is NOT the operator.

**Time-box**: ~1 day. If anything breaks it will be mechanical (Privy API surface, CLOB signature type), not strategic.

## Prerequisites

- Env: `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_SIGNING_KEY` (reuse existing values in `.env.local`).
- ~$5 USDC.e + ~0.2 MATIC on Polygon to fund the new wallet.
- `pnpm install` at repo root (the spike uses workspace deps; no local `package.json`).

## Steps — each is a pointer to an existing, proven script, with the per-user wallet swap

### 1. Create a NEW Privy wallet

```bash
tsx scripts/experiments/poly-privy-per-user-spike/1-create-wallet.ts
```

Copies `scripts/provision-operator-wallet.ts` verbatim but prints the address/walletId as "per-user wallet candidate." Record both in `evidence/wallet-provision.md`.

### 2. Fund the new wallet (manual)

Send ~$5 USDC.e + ~0.2 MATIC on Polygon to the address printed in step 1. Record tx hashes in `evidence/wallet-provision.md`.

### 3. Approvals — reuse `approve-polymarket-allowances.ts`

```bash
POLY_PROTO_WALLET_ADDRESS=<new-wallet-address> \
PRIVY_WALLET_ID=<new-wallet-id> \
tsx scripts/experiments/approve-polymarket-allowances.ts
```

The existing script reads the wallet from env; swapping in the new wallet's address + walletId runs allowances against the new funder. Commit receipts to `evidence/approvals-tx.json`.

### 4. Derive CLOB L2 creds — reuse `derive-polymarket-api-keys.ts`

```bash
POLY_PROTO_WALLET_ADDRESS=<new-wallet-address> \
PRIVY_WALLET_ID=<new-wallet-id> \
tsx scripts/experiments/derive-polymarket-api-keys.ts
```

Produces canonical clob-client credentials `{ key, secret, passphrase }` signed by the NEW wallet. Save to a gitignored note, NOT committed. Confirm the signer recovered from the API key matches step 1's address.

### 5. Place BUY — reuse `privy-polymarket-order.ts`

```bash
POLY_PROTO_WALLET_ADDRESS=<new-wallet-address> \
PRIVY_WALLET_ID=<new-wallet-id> \
POLY_CLOB_API_KEY=<step-4-key> \
POLY_CLOB_API_SECRET=<step-4-secret> \
POLY_CLOB_PASSPHRASE=<step-4-passphrase> \
ORDER_SIDE=BUY \
ORDER_USDC=1 \
tsx scripts/experiments/privy-polymarket-order.ts
```

Commit the CLOB response to `evidence/buy-receipt.json`. Verify the order's `maker` field equals the new wallet's address (not the operator's).

### 6. Place SELL — same as step 5 with `ORDER_SIDE=SELL`

Commit to `evidence/sell-receipt.json`.

## Pass criteria (`evidence/verdict.md`)

| #   | Criterion                                                                                         | Evidence file                            |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | `walletApi.create` returns a walletId distinct from the operator wallet's                         | `wallet-provision.md`                    |
| 2   | `createViemAccount` + `createWalletClient` produce a working viem LocalAccount for the new wallet | step 3 runs clean                        |
| 3   | USDC + CTF allowances land idempotently against the NEW funder address                            | `approvals-tx.json`                      |
| 4   | CLOB L2 creds are signed by the NEW wallet (not operator)                                         | step-4 signature recovery                |
| 5   | BUY + SELL acks with `maker == new-wallet-address`                                                | `buy-receipt.json` + `sell-receipt.json` |

If all 5 pass: commit to B2 (`poly_wallet_connections` + credential broker).

If any fail: the per-user flow has a mechanical issue; document it in `verdict.md` and fix before B2 lands. The design direction does not change.

## What this spike deliberately does NOT cover (B2+ scope)

- `poly_wallet_connections` table schema, migration, drizzle wiring
- AEAD encryption of CLOB creds at rest
- `resolvePolySigningContext(billingAccountId)` broker + tenant defense-in-depth
- Dashboard "set up your wallet" UX
- `poly_wallet_grants` (caps / scopes / expiry)
- `mirror-coordinator` per-tenant rewiring

Those are B2-B6. The spike's job is to kill the "can we even do this end-to-end" risk cheaply.
