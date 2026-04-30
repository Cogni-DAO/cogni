---
id: poly-collateral-currency-spec
type: spec
title: "Poly trading currency — USDC.e ↔ pUSD lifecycle on Polymarket V2"
status: active
spec_state: as-built
trust: reviewed
summary: "Visual reference for which token does what in our Polymarket V2 trade path. USDC.e is the public Polygon stablecoin used for wallet deposits and withdrawals; pUSD is Polymarket's protocol-internal 1:1 wrapper that V2 exchanges spend. CollateralOnramp is the 1:1 airlock between them. V2 cutover (2026-04-28) introduced pUSD-collateralized markets alongside the legacy V1 USDC.e markets — both vintages coexist on Polygon CTF, and the per-position collateralToken is pinned at mint time. Enable Trading wraps a wallet's full USDC.e balance to pUSD on click; redeem path picks vintage via chain probe (bug.0428)."
read_when: Reasoning about user funds on Polymarket, debugging insufficient_balance errors, designing UI that shows trading balance, adding new trade or deposit code paths, onboarding a new env's operator wallet.
owner: derekg1729
created: 2026-04-28
verified: 2026-04-30
tags: [poly, polymarket, v2, collateral, pUSD, USDC, onboarding]
---

# Polymarket V2 collateral lifecycle

## Goal

Single visual reference for which token does what in our Polymarket V2 trade path. Anyone touching trade-currency code (trade execution, balance display, deposit flow, withdraw flow, Enable Trading) can read this once and know whether to reach for USDC.e or pUSD without having to read SDK source.

## Non-Goals

- Not a runbook for re-running Enable Trading per env (that's the bug.0419 doc on the work-item side).
- Not a contract-change tracker — V2 addresses are derived from `@polymarket/clob-client-v2`'s `getContractConfig(137)` at boot, so this doc lists them as ground-truth at write time, not as the code's source of authority.
- Does not cover withdraw / unwrap flow — pUSD → USDC.e is symmetric via the same Onramp but we don't expose it yet; future spec when that ships.

## Design

### Lifecycle diagram

```
       ╭─────────────╮  approve(Onramp, ∞)   ╭──────────────────────╮
       │             │ ────────────────────► │                      │
       │   USDC.e    │                       │  CollateralOnramp    │
       │             │ ◄──── pulls USDC.e ── │   .wrap(USDC.e, you, │
       │   (legacy)  │       ──────────────► │      amount)         │
       │             │                       │   mints pUSD ───────►│
       ╰─────────────╯                       ╰──────────────────────╯
              ▲                                        │
              │                                        │ pUSD
              │ deposit from                           ▼
              │ external wallet                ╭───────────────╮
              │ (Coinbase, bridge, etc.)       │     pUSD      │  ← V2 trade currency
              │                                │               │
              │                                ╰───────┬───────╯
              │                                        │ approve(V2 exchanges, ∞)
              │                                        ▼
              │                                ╭───────────────────────╮
              │                                │  V2 ExchangeV2        │
              │                                │  V2 NegRiskExchangeV2 │  ← trades happen here
              │                                │  NegRiskAdapter       │
              │                                ╰───────────────────────╯
              │                                        │ on fill
              │                                        ▼
              │                                ╭───────────────╮
              │                                │  CTF tokens   │  ← shares (your positions)
              │                                │  (ERC-1155)   │     setApprovalForAll(V2 exch., true)
              │                                ╰───────────────╯
              │
   external incoming —— stays on-chain as USDC.e until next Enable Trading wraps it
```

### Mental model

- **USDC.e** = how money enters/exits a wallet (the public Polygon stablecoin).
- **pUSD** = how money trades inside Polymarket V2 (the protocol-internal stablecoin).
- **CollateralOnramp** = the airlock between them. 1:1 in either direction, no fee.

Pre-V2 there was no airlock — V1 exchanges spent USDC.e directly. V2 introduced pUSD to give Polymarket protocol-level control of the trade collateral (cross-chain, fee mechanics, accounting). The wrap step is a one-time-per-deposit cost, not a per-trade cost.

### V1 vs V2 is a per-POSITION property, not a date

**This is the easiest thing to get wrong.** The 2026-04-28 cutover was when Polymarket _introduced_ V2 (pUSD-collateralized markets); it was not a hard switch that converted existing positions. The two systems coexist on Polygon CTF indefinitely. A wallet can hold a mix of V1-vintage and V2-vintage CTF positions at the same time.

What "vintage" means concretely: the ERC-1155 `positionId` is `keccak256(abi.encodePacked(collateralToken, collectionId))`. So a CTF position is _physically distinct_ depending on whether it was minted with USDC.e or pUSD — different positionIds, different balances, no fungibility between them. Vintage is pinned to the position at mint time and cannot change.

| Property                            | V1-vintage position                                | V2-vintage position             |
| ----------------------------------- | -------------------------------------------------- | ------------------------------- |
| Collateral that minted it           | USDC.e                                             | pUSD                            |
| `positionId` derivation             | `keccak256(USDC.e, collectionId)`                  | `keccak256(pUSD, collectionId)` |
| Redeem dispatch arg                 | `redeemPositions(USDC.e, …)`                       | `redeemPositions(pUSD, …)`      |
| Mismatched dispatch                 | silently zero-burns, no payout                     | silently zero-burns, no payout  |
| Payout currency                     | USDC.e                                             | pUSD                            |
| Required to recycle into next trade | **wrap USDC.e → pUSD** (auto-wrap loop, task.0429) | already pUSD, no extra step     |

How we determine vintage at runtime: chain probe in `nodes/poly/app/src/features/redeem/infer-collateral-token.ts` (bug.0428). It calls `CTF.getCollectionId(zero, conditionId, indexSet)` then `CTF.getPositionId(token, collectionId)` for both candidate tokens (`pUSD`, `USDC.e`) and returns whichever hashes to the funder's known positionId. Falls back to USDC.e on RPC failure or non-match (legacy-safe default).

**Implications for the unattended copy-trade loop:**

- **bug.0428** (per-job collateralToken capture) closes the V2 redeem cycle: V2 wins now correctly redeem to pUSD instead of silently zero-burning against the pre-fix `POLYGON_USDC_E` hardcode.
- **task.0429** (auto-wrap USDC.e → pUSD) closes the V1 redeem cycle: V1 wins pay out USDC.e, which would otherwise sit idle and stall the wallet on the next placement (V2 exchanges only spend pUSD).
- **Both** are required for unattended operation — copy targets historically trade across both vintages, and a wallet that holds a single V1-vintage position to settlement will still need wrap-back even on a system where every new mint is V2.

### Is USDC.e phased out?

**On Polymarket: yes, for trading. As an asset on Polygon: no.**

| Question                                                                           | Answer                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Can V2 exchanges spend USDC.e to fill orders?                                      | **No.** They only spend pUSD.                                                                                                                    |
| Will deposits from outside (Coinbase, bridges, personal wallets) arrive as USDC.e? | **Yes — for the foreseeable future.** USDC.e is the standard Polygon stablecoin; pUSD exists only inside Polymarket's protocol.                  |
| Does our flow still need USDC.e approvals?                                         | **Only one**: `USDC.e.approve(CollateralOnramp, ∞)` so Onramp can pull deposits to mint pUSD. After that, USDC.e is invisible to the trade path. |
| What's the wrap rate?                                                              | **1:1.** pUSD is a deterministic 1:1 wrapper of USDC.e. No fee, no slippage, no peg risk.                                                        |
| Can pUSD be unwrapped back to USDC.e?                                              | **Yes, via the same Onramp.** We don't expose this in our app yet — it's a one-call symmetric op for a future withdraw flow.                     |

### What our app does with each token

| Path                                    | Reads / writes                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Display "trading balance" on Money page | Sum **USDC.e + pUSD** on-chain. Both are 1:1 USD; UI shows the total. (Code: `readPolygonBalances` in the privy adapter reads both and sums to the `usdcE` field name kept for now.) |
| Enable Trading button                   | Wraps **all** USDC.e → pUSD on click. Steady state after one click: USDC.e ≈ 0, pUSD = wallet balance.                                                                               |
| Mirror BUY                              | Spends **pUSD** via the V2 exchange. USDC.e is never touched at trade time.                                                                                                          |
| New deposit lands as USDC.e             | Sits as USDC.e until next Enable Trading run. v0 quirk — UI still shows the correct total because we sum both balances. Operator hits Enable Trading again to wrap the new deposit.  |

### Contract addresses (Polygon mainnet, V2)

Sourced from `@polymarket/clob-client-v2`'s `getContractConfig(137)` plus one hardcode (CollateralOnramp is not in the SDK config):

| Role                | Address                                      | Notes                                                            |
| ------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| `USDC.e`            | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` | Standard Polygon-native USDC, hardcoded in the adapter           |
| `pUSD`              | `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` | SDK config field: `collateral`                                   |
| `CollateralOnramp`  | `0x93070a847efEf7F70739046A929D47a521F5B8ee` | Hardcoded — not in SDK config. Exposes `wrap(asset, to, amount)` |
| `ExchangeV2`        | `0xE111180000d2663C0091e4f400237545B87B996B` | SDK config field: `exchangeV2`                                   |
| `NegRiskExchangeV2` | `0xe2222d279d744050d28e00520010520000310F59` | SDK config field: `negRiskExchangeV2`                            |
| `NegRiskAdapter`    | `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296` | SDK config field: `negRiskAdapter` — unchanged from V1           |
| `CTF` (CTF tokens)  | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` | SDK config field: `conditionalTokens` — unchanged from V1        |

### Enable Trading ceremony — 8 steps

After V2 cutover, the ceremony at `PolyTraderWalletPort.ensureTradingApprovals` is:

1. `USDC.e.approve(CollateralOnramp, MaxUint256)` — lets Onramp pull USDC.e on user's behalf.
2. `CollateralOnramp.wrap(USDC.e, funder, balance)` — mints `balance` pUSD to the funder; consumes the USDC.e.
3. `pUSD.approve(ExchangeV2, MaxUint256)`
4. `pUSD.approve(NegRiskExchangeV2, MaxUint256)`
5. `pUSD.approve(NegRiskAdapter, MaxUint256)` — belt-and-suspenders; adapter target may not always pull pUSD.
6. `CTF.setApprovalForAll(ExchangeV2, true)`
7. `CTF.setApprovalForAll(NegRiskExchangeV2, true)`
8. `CTF.setApprovalForAll(NegRiskAdapter, true)`

Idempotent: each step checks live state and skips when satisfied. Step 2 ("wrap") is the only stateful balance-moving call — runs whenever USDC.e balance > 0.

## Invariants

- **TRADES_SPEND_PUSD** — V2 exchanges (`exchangeV2`, `negRiskExchangeV2`) only pull pUSD from a wallet at fill time. Granting them USDC.e allowance is a no-op and silently fails as `insufficient_balance` at the CLOB.
- **WRAP_IS_1_TO_1** — `CollateralOnramp.wrap(USDC.e, to, n)` mints exactly `n` units of pUSD to `to` and consumes exactly `n` USDC.e from the caller. No fee, no slippage. The reverse (unwrap) is symmetric and held for a future withdraw flow.
- **ONRAMP_NEEDS_USDC_E_ALLOWANCE** — `wrap` pulls USDC.e via `transferFrom`, so the caller MUST first `USDC.e.approve(CollateralOnramp, …)`. Step 1 of the Enable Trading ceremony exists for this reason.
- **APPROVAL_TARGETS_FROM_SDK_CONFIG** — exchange + collateral + CTF + adapter addresses are derived from `clob-client-v2`'s `getContractConfig(137)`. CollateralOnramp is hardcoded because it is not in the SDK config. No env override; misconfigured addresses would authorize an arbitrary spender to drain the wallet.
- **BALANCE_DISPLAY_IS_SUM** — UI / overview-API "trading balance" reads both USDC.e and pUSD on-chain and shows the sum. This makes a pre-wrap deposit visible to the operator without needing to wrap first.
- **ENABLE_TRADING_IS_THE_BRIDGE** — every wallet runs the 8-step ceremony exactly once per env to cross from V1-shaped state to V2-shaped state, plus on-demand whenever new USDC.e arrives that needs wrapping. Idempotent: each step checks live state and skips when already satisfied.

## TL;DR

- USDC.e is **not** phased out as the deposit medium.
- USDC.e **is** phased out from the trade-execution path.
- The Enable Trading button is the bridge — every wallet runs it once per env, wrap-on-click, and from then on every BUY spends pUSD.
- Subsequent USDC.e deposits sit until the next Enable Trading click.
- "Do I need pUSD?" → click Enable Trading; you do now.

## Source-of-truth links

- Adapter: `nodes/poly/app/src/adapters/server/wallet/privy-poly-trader-wallet.adapter.ts` — `readPolygonBalances`, `ensureTradingApprovals`, `submitCollateralWrap`.
- Constants: derived from `@polymarket/clob-client-v2`'s `getContractConfig(137)` plus the hardcoded `COLLATERAL_ONRAMP_POLYGON`.
- Filed bugs: `bug.0418` (V2 envelope), `bug.0419` (V2 approvals + wrap step). Both shipped in PR #1118.
