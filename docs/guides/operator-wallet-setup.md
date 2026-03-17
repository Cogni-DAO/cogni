---
id: operator-wallet-setup-guide
type: guide
title: Payment Activation
status: draft
trust: draft
summary: Activate payment rails for a Cogni node — Privy operator wallet + Split contract on Base.
read_when: Setting up payment infrastructure for a new node after formation.
owner: derekg1729
created: 2026-03-11
---

# Payment Activation

Activate payment rails for a Cogni node. This runs in your own fork after DAO formation.

## Prerequisites

- DAO formation complete (`.cogni/repo-spec.yaml` has `cogni_dao` section)
- Privy account at [privy.io](https://privy.io)
- A funded wallet on Base (~$0.02 ETH for Split deployment gas)

## Quick Start

### 1. Privy Credentials

In the Privy dashboard:

1. **Settings → Basics** — copy the **App ID**
2. **Settings → Basics** — click **New secret**, copy the app secret
3. **Settings → Authorization** — click **New key** (format: `wallet-auth:MIGHAgEA...`)

Add to `.env.local`:

```
PRIVY_APP_ID=<app-id>
PRIVY_APP_SECRET=<app-secret>
PRIVY_SIGNING_KEY=<wallet-auth:...>
DEPLOYER_PRIVATE_KEY=<funded-wallet-private-key>
```

The signing key is NOT the app secret. It's a separate P-256 authorization key for wallet operations.

### 2. Activate Payments

```bash
pnpm dotenv -e .env.local -- pnpm node:activate-payments
```

This single command:

- Provisions an operator wallet via Privy (or finds an existing one)
- Deploys a Split contract on Base (operator + DAO treasury recipients)
- Validates the deployment on-chain
- Writes `operator_wallet`, `payments_in`, and `payments.status: active` to `.cogni/repo-spec.yaml`

### 3. Fund the Operator Wallet

Send ~$0.02 ETH on Base to the operator wallet address (printed by the script). This covers gas for `distributeSplit()` and `fundOpenRouterTopUp()` calls.

### 4. Commit and Deploy

```bash
git add .cogni/repo-spec.yaml
git commit -m "chore: activate payment rails"
```

Remove `DEPLOYER_PRIVATE_KEY` from `.env.local` — it's only needed for this one-time deployment.

## Advanced: Individual Scripts

For recovery or manual control, the underlying primitives are available:

- `scripts/provision-operator-wallet.ts` — create Privy wallet standalone
- `scripts/deploy-split.ts` — deploy Split contract standalone
- `scripts/distribute-split.ts` — trigger Split distribution manually

## Environment Variables

| Variable                   | Required | Purpose                                         |
| -------------------------- | -------- | ----------------------------------------------- |
| `PRIVY_APP_ID`             | Yes      | Privy application identifier                    |
| `PRIVY_APP_SECRET`         | Yes      | Privy application secret                        |
| `PRIVY_SIGNING_KEY`        | Yes      | Privy signed-requests key                       |
| `DEPLOYER_PRIVATE_KEY`     | Yes      | Funded EOA for Split deployment gas             |
| `EVM_RPC_URL`              | No       | Base RPC (defaults to public endpoint)          |
| `SPLIT_CONTROLLER_ADDRESS` | No       | Split admin (defaults to deployer with warning) |
| `OPERATOR_WALLET_ADDRESS`  | No       | Disambiguate when multiple Privy wallets exist  |

## Troubleshooting

**Privy SDK connection timeout:** IPv6 issue with Cloudflare. Run with `node --dns-result-order=ipv4first`.

**"No exports main defined":** Run `pnpm packages:build` first.

**Multiple Privy wallets:** Set `OPERATOR_WALLET_ADDRESS` to the address you want to use.
