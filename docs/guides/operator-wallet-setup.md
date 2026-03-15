---
id: operator-wallet-setup-guide
type: guide
title: Operator Wallet Setup
status: draft
trust: draft
summary: One-time setup for Privy operator wallet and Split contract deployment on Base.
read_when: Setting up operator wallet infrastructure for the first time.
owner: derekg1729
created: 2026-03-11
---

# Operator Wallet Setup

One-time setup for the Privy operator wallet and Split contract.

## Prerequisites

- Privy account at [privy.io](https://privy.io)
- A wallet with ~$0.02 ETH on Base (for deploying the Split contract)

## 1. Privy Credentials

In the Privy dashboard:

1. **Settings → Basics** — copy the **App ID**
2. **Settings → Basics** — click **New secret**, copy the app secret
3. **Settings → Authorization** — click **New key**. This gives you a **key ID** and a **private key** (format: `wallet-auth:MIGHAgEA...`)

Add to `.env.local`:

```
PRIVY_APP_ID=<app-id>
PRIVY_APP_SECRET=<app-secret>
PRIVY_SIGNING_KEY=<wallet-auth:...>
```

The signing key is NOT the app secret. It's a separate P-256 authorization key used to sign wallet operations (transactions).

## 2. Provision Operator Wallet

```bash
pnpm dotenv -e .env.local -- tsx scripts/provision-operator-wallet.ts
```

Outputs a wallet address + wallet ID. Update `.cogni/repo-spec.yaml`:

```yaml
operator_wallet:
  address: "<wallet address from output>"
```

## 3. Deploy Split Contract

Fund a deployer wallet with ~$0.02 ETH on Base, then:

```bash
OPERATOR_WALLET_ADDRESS=<from step 2> \
DEPLOYER_PRIVATE_KEY=<deployer-private-key> \
pnpm dotenv -e .env.local -- tsx scripts/deploy-split.ts
```

Deploys a Push Split V2o2 on Base (currently 92.1% operator / 7.9% DAO). Update `.cogni/repo-spec.yaml`:

```yaml
payments_in:
  credits_topup:
    receiving_address: "<split address from output>"
```

Delete `DEPLOYER_PRIVATE_KEY` from `.env.local` after — it's only needed for this one deployment.

## 4. Fund the Privy Wallet

Send ~$0.02 ETH on Base to the operator wallet address (from step 2). This covers gas for `distributeSplit()` calls.

## 5. Validate

```bash
pnpm dotenv -e .env.local -- pnpm test:external
```

Validates: Privy wallet verification, Split address lookup, and `distributeSplit(USDC)` as a real transaction on Base.

## Current Limitations

- **No automatic distribution.** `distribute()` must be called manually or via the adapter.
- **`fundOpenRouterTopUp()` is not implemented** — see task.0086.
- **Scripts are one-off CLIs**, not part of the setup wizard (future: `src/features/setup/daoFormation/` pattern).

## Troubleshooting

**Privy SDK connection timeout:** IPv6 issue with Cloudflare. Run with `node --dns-result-order=ipv4first`.

**`deploy-split.ts` "No exports main defined":** Run `pnpm packages:build` first.
