---
id: akashjs-sdk-deployment-research
type: research
title: "Akash SDK Deployment Lifecycle — chain-sdk + akashjs"
status: draft
trust: draft
summary: "Complete deployment lifecycle using @akashnetwork/chain-sdk and @akashnetwork/akashjs. Covers wallet, certificates, deployment, bids, leases, manifest sending, and endpoint discovery."
read_when: Building the AkashAdapter for ContainerRuntimePort
owner: derekg1729
created: 2026-03-27
verified: 2026-03-27
tags: [akash, sdk, deployment, research]
---

# Research: Akash SDK Deployment Lifecycle

> spike: spike.akashjs-sdk-prototype | date: 2026-03-27

## Question

Can we programmatically deploy containers to Akash Network from a Node.js backend, with zero human interaction? What SDK, what lifecycle steps, what auth model?

## Context

The `ContainerRuntimePort` exists as a shared package with a mock adapter. We need a real `AkashAdapter` that deploys containers to the Akash Network. The user's requirement: "I tell Cogni AI to get an MCP server, and it deploys it with zero human steps."

## Findings

### SDK Status

- **`@akashnetwork/akashjs`** — DEPRECATED but still functional. Contains critical utilities: SDL parser, certificate manager, RPC client, Stargate type registry.
- **`@akashnetwork/chain-sdk`** — The replacement. Provides typed proto messages for chain transactions. Works alongside akashjs for now.
- Both are needed: chain-sdk for proto types, akashjs for SDL parsing + cert management + RPC.

### Deployment Lifecycle (6 steps)

```
1. WALLET     — DirectSecp256k1HdWallet from mnemonic (env var, like Privy HSM)
2. CERTIFICATE — mTLS cert for provider communication (generate once, reuse)
3. DEPLOY TX  — MsgCreateDeployment on-chain (5 AKT deposit)
4. BID POLL   — Poll market.v1beta5.Bids until providers respond (~30s)
5. LEASE TX   — MsgCreateLease accepting cheapest bid
6. MANIFEST   — PUT to provider HTTPS endpoint (mTLS auth) with SDL manifest
   → Provider starts containers
   → Poll lease status for service URIs
```

### Authentication

Two modes exist:

- **mTLS certificates** — the established mode. Generate a cert, broadcast it on-chain, use it for all provider HTTPS calls. The akashjs example uses this.
- **JWT tokens** — newer, simpler. "Recommended method, works even when blockchain is down." Less documented.

For v0: use mTLS (proven, full example exists). Evaluate JWT at P1.

### Key Dependencies

```
@akashnetwork/akashjs     — SDL parser, cert manager, RPC client, type registry
@akashnetwork/chain-sdk   — Proto message types (MsgCreateDeployment, etc.)
@cosmjs/proto-signing     — Wallet from mnemonic
@cosmjs/stargate          — SigningStargateClient for broadcasting transactions
```

### Wallet Model

Same pattern as `OperatorWalletPort` + Privy:

- Mnemonic stored in infrastructure (env var in production, Vault/SOPS in k8s)
- Backend signs transactions server-side
- No browser wallet, no human approval per transaction
- This IS the Cosmos equivalent of Privy HSM — a backend-managed key

### Cost Model

- Deployment deposit: 5 AKT (~$15 at current prices)
- Per-block pricing: ~100-1000 uakt depending on resources
- Minimum viable deployment (0.5 CPU, 512Mi): ~$0.50/day on testnet

### What the Prototype Proves

A standalone script that:

1. Takes a container image + port as input
2. Generates SDL
3. Deploys to Akash sandbox testnet
4. Returns the live URL

If this works, it maps directly to `ContainerRuntimePort.deploy()` → `AkashAdapter`.

## Recommendation

Use both `@akashnetwork/akashjs` (utilities) and `@akashnetwork/chain-sdk` (types) together. Build the prototype as `services/akash-deployer/src/runtime/akash-prototype.ts` — a standalone script that can be run directly. Once proven, refactor into the `AkashAdapter` implementing `ContainerRuntimePort`.

The wallet is a mnemonic from env var. For testnet, create a wallet via `akash keys add` or Keplr, fund from faucet, export mnemonic. For production, this becomes an operator-managed key in secure infrastructure (same pattern as Privy for EVM).

## Open Questions

1. **JWT vs mTLS**: JWT is "recommended" but less documented. Spike on JWT auth at P1.
2. **Certificate lifecycle**: Certs are broadcast on-chain. How long do they last? Renewal strategy?
3. **Provider selection**: Current prototype takes cheapest bid. Should we filter by region, uptime, reputation?
4. **Stable payments**: Akash supports USDC via IBC. Should we use USDC instead of AKT for cost predictability?

## Prototype

See `services/akash-deployer/src/runtime/akash-prototype.ts` — standalone deployment script.

Run with:

```bash
RPC_ENDPOINT=https://rpc.sandbox-01.aksh.pw:443 \
MNEMONIC="your twelve word mnemonic here" \
npx tsx services/akash-deployer/src/runtime/akash-prototype.ts
```

## Sources

- [@akashnetwork/akashjs (deprecated, still needed)](https://github.com/akash-network/akashjs)
- [@akashnetwork/chain-sdk (replacement)](https://www.npmjs.com/package/@akashnetwork/chain-sdk)
- [SDK Examples — Akash Docs](https://akash.network/docs/api-documentation/sdk/examples/)
- [Akash Console (reference impl)](https://github.com/akash-network/console)
- [Manifest Service Docs](https://akash.network/docs/akash-provider-service-and-associated-sub-services/manifest-service/)
