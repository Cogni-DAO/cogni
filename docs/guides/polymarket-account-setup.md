---
id: polymarket-account-setup-guide
type: guide
title: Polymarket Account Setup (Operator Wallet, EOA Path)
status: draft
trust: draft
summary: One-time onboarding to enable the Cogni operator Privy wallet to trade on Polymarket's CLOB via the direct-EOA path — no browser, no Safe proxy, no manual ToS click. Verified 2026-04-17 against wallet 0xdCCa...5056.
read_when: Provisioning a new Cogni-controlled Privy wallet for Polymarket trading, or rotating the operator wallet for an existing node.
owner: derekg1729
created: 2026-04-17
verified: 2026-04-17
tags: [poly, polymarket, operator-wallet, setup]
---

# Polymarket Account Setup (Operator Wallet, EOA Path)

## When to Use This

You are onboarding a Cogni-controlled Privy operator wallet (EOA) to Polymarket for the first time, or rotating wallets. The whole flow is API-first — no browser, no MetaMask, no Polymarket UI.

## Prerequisites

- The operator Privy wallet is provisioned (EOA address known; Privy app credentials in `.env.local`).
- `CP2` has been validated: `pnpm tsx --tsconfig tsconfig.scripts.json scripts/experiments/sign-polymarket-order.ts` prints `PASS`. If it does not, the wallet cannot sign — fix that first.

## Key Facts (what we learned by probing, 2026-04-17)

- **Polymarket supports two account models.** The UI path uses a Gnosis Safe proxy holding USDC.e (the "Magic Link" / "MetaMask login" model). The API path we use is a **direct EOA**: the operator EOA holds USDC.e and signs orders directly. No proxy is deployed, no browser is required.
- **No explicit ToS step.** `createOrDeriveApiKey` succeeds on a cold wallet with no prior polymarket.com interaction. The act of deriving creds is the implicit consent. (Operator is responsible for reading Polymarket's actual ToS and verifying jurisdictional compliance separately.)
- **The creds are idempotent.** Re-running `derive-polymarket-api-keys.ts` returns the same `{ key, secret, passphrase }` as long as the same Privy wallet is used.

## Steps

### 1. Derive L2 API credentials (automated, ~30 s)

```bash
pnpm tsx --tsconfig tsconfig.scripts.json \
  scripts/experiments/derive-polymarket-api-keys.ts
```

Output (last three lines):

```
POLY_CLOB_API_KEY=<uuid>
POLY_CLOB_API_SECRET=<base64>
POLY_CLOB_PASSPHRASE=<hex>
```

Append to `.env.local`. Also store secret + passphrase in 1Password (recoverable via re-derive, but 1Password is custody of record).

### 2. Verify Polymarket knows the account (automated, ~5 s)

```bash
pnpm tsx --tsconfig tsconfig.scripts.json \
  scripts/experiments/probe-polymarket-account.ts
```

Expected:

```
[probe] --- getApiKeys ---
{ "apiKeys": ["<your key>"] }
[probe] --- getBalanceAllowance COLLATERAL (default signatureType=EOA) ---
{
  "balance": "0",
  "allowances": {
    "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E": "0",  // Exchange
    "0xC5d563A36AE78145C45a50134d48A1215220f80a": "0",  // Neg-Risk Exchange
    "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296": "0"   // Neg-Risk Adapter
  }
}
```

Balance 0 and all allowances 0 are normal for a fresh wallet. The fact that Polymarket returns this response (not a 401/403) confirms the EOA is a known, trade-eligible account.

### 3. Fund the EOA with USDC.e on Polygon (manual, ~3 min)

Send USDC.e on Polygon directly to the operator EOA address (`OPERATOR_WALLET_ADDRESS` in `.env.local`). Start small: $10–$20 is plenty for Phase 1 prototype work.

- **Token:** USDC.e at `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` on Polygon (NOT native USDC).
- **Source:** any Polygon wallet, CEX withdrawal (Coinbase → Polygon network), or bridge.
- **Destination:** the EOA itself — no Safe proxy is involved on the API path.

Confirm with step 2: re-run the probe and `balance` should reflect the deposit.

### 4. Approve the three CLOB contracts to spend USDC.e (scripted, lands with CP3)

Before the first trade, the EOA must approve these three contracts to spend its USDC.e:

- Exchange: `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E`
- Neg-Risk Exchange: `0xC5d563A36AE78145C45a50134d48A1215220f80a`
- Neg-Risk Adapter: `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`

Plus the conditional-tokens contract (`0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`) must approve all three as an ERC-1155 operator for SELL orders to work.

This will be scripted as `scripts/experiments/approve-polymarket-allowances.ts` during CP3 (sends four transactions signed by Privy HSM). Not included in CP2 / this guide.

## Persisted env vars

After step 1, `.env.local` contains:

```bash
POLY_CLOB_API_KEY=<uuid>
POLY_CLOB_API_SECRET=<base64>
POLY_CLOB_PASSPHRASE=<hex>
```

These are registered in `scripts/setup-secrets.ts` under the **Polymarket CLOB** category with `source: "agent"` — meaning `setup-secrets.ts` will delegate to the derive script rather than prompt.

## Troubleshooting

| Symptom                                                   | Likely cause                                                                                              | Fix                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `derive-polymarket-api-keys` fails with 403 `Geo-blocked` | Your IP is in a Polymarket-blocked region                                                                 | Run from a permitted region or via a tunnel to a permitted VM       |
| `"Private key not authorized"` in Privy                   | `PRIVY_SIGNING_KEY` missing or stale                                                                      | Re-check `.env.local`; `sign-polymarket-order.ts` should still PASS |
| Probe returns `"balance"` > 0 but allowances still 0      | Normal — approvals are a separate tx (see step 4)                                                         | Nothing broken                                                      |
| You accidentally onboarded via polymarket.com browser too | You now have BOTH an EOA-path account and a Safe-proxy account for the same EOA — they're separate worlds | Decide which to use; guide assumes EOA path                         |

## Long-Term Plan (very brief)

This guide covers the once-per-wallet onboarding. It is one link in a longer chain:

- **Phase 1 (now, PR #890):** First live `order_id` from a hardcoded target wallet via a disposable 30 s poll. CP3 = CLOB adapter + allowance-approval script; CP4 = decide() + executor + wiring.
- **Phase 2:** Click-to-copy UI — operator picks a target on the dashboard; no env editing.
- **Phase 3:** Paper-adapter body + 14-day shadow soak to prove edge survives slippage.
- **Phase 4:** Streaming upgrade (Polymarket WS → Redis → Temporal) gated on Phase 3 evidence.

Future wallet rotations re-run **only step 1**. Steps 3 + 4 are one-time per wallet.

## Related

- Task: `work/items/task.0315.poly-copy-trade-prototype.md`
- Script: `scripts/experiments/sign-polymarket-order.ts` — CP2 signing proof
- Script: `scripts/experiments/derive-polymarket-api-keys.ts` — step 1
- Script: `scripts/experiments/probe-polymarket-account.ts` — step 2
- Script: `scripts/experiments/approve-polymarket-allowances.ts` — step 4 (lands CP3)
- Secret config: `scripts/setup-secrets.ts` — `POLY_CLOB_API_*` entries
- Package: `@cogni/operator-wallet` — Privy HSM signer
