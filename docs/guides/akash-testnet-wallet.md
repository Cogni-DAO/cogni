---
id: akash-testnet-wallet-guide
type: guide
title: Akash Testnet Wallet Setup
status: draft
trust: draft
summary: Create a Cosmos wallet via Keplr, fund it from the Akash testnet faucet, and connect to Akash Console.
read_when: Setting up an Akash testnet account for the first time.
owner: derekg1729
created: 2026-03-27
verified:
tags: [akash, wallet, testnet]
---

# Akash Testnet Wallet Setup

> ~5 minutes. No CLI needed. All browser-based.

## Why Not MetaMask?

Akash is a Cosmos SDK chain, not EVM. MetaMask only works with Ethereum-compatible chains. For Cosmos chains (Akash, Cosmos Hub, Osmosis), use **Keplr** — the Cosmos equivalent of MetaMask.

## Step 1: Install Keplr

1. Go to [keplr.app](https://www.keplr.app/) and install the **browser extension** (Chrome/Brave/Firefox)
2. Click **Create a new wallet**
3. Write down your 12-word seed phrase (store it safely — this is your private key)
4. Set a password for the extension
5. Confirm the seed phrase

Your wallet is now created. Keplr supports Akash by default.

## Step 2: Get Your Akash Address

1. Open Keplr extension
2. Search for "Akash" in the chain list (or it may already be visible)
3. Your address starts with `akash1...` — copy it

## Step 3: Fund from Testnet Faucet

1. Go to [console.akash.network](https://console.akash.network/)
2. Click the **network selector** (pencil/edit icon) and switch to **Sandbox**
3. Connect your Keplr wallet
4. The console will prompt you to fund via the testnet faucet
5. Alternatively, join the [Akash Discord](https://discord.akash.network/) and request tokens in the `#testnet-faucet` channel

You need **~5 AKT minimum** (enough for one deployment + gas fees). The faucet gives 25 AKT.

## Step 4: Verify

1. In Akash Console (sandbox network), you should see your AKT balance
2. Try a test deployment: Console → Deploy → use any template → confirm it works

## What We Need from This

For the `akash-deployer` service to deploy programmatically, we need:

- The **mnemonic** (12-word seed phrase) — set as `COSMOS_MNEMONIC` env var
- Or a **keyfile** exported from Keplr

For v0 testing, the mnemonic approach is simplest. Store it in `.env.local` (gitignored), never commit it.

```bash
# .env.local (services/akash-deployer/)
COSMOS_MNEMONIC="word1 word2 word3 ... word12"
AKASH_CHAIN_ID=sandbox-01
AKASH_NODE=https://rpc.sandbox-01.aksh.pw:443
```

## Sources

- [Keplr Wallet Setup — Akash Docs](https://docs.akash.network/tokens-and-wallets/keplr)
- [Akash Console — Get Started](https://console.akash.network/get-started/wallet)
- [Create Account via CLI (alternative)](https://docs.akash.network/command-line/wallet)
