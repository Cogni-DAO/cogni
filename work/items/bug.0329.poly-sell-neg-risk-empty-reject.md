---
id: bug.0329
type: bug
title: "Polymarket CLOB adapter SELL on neg_risk markets returns empty error — positions unclosable"
status: needs_triage
priority: 1
rank: 50
estimate: 2
created: 2026-04-19
updated: 2026-04-19
summary: 'SELL orders on Polymarket neg_risk markets fail with `success=undefined, orderID=<missing>, errorMsg=""` despite all approvals in place, valid tick size, and valid notional. Blocks every close-position flow on neg_risk markets — positions become roach-motel. BUY path works fine on the same markets. Cancel path (pre-fill) works fine. Only post-fill SELL fails, and only on neg_risk.'
outcome: "A SELL via `core__poly_close_position` (or the `scripts/experiments/privy-polymarket-order.ts place --side SELL` reproducer) on a neg_risk market lands and receives a normal CLOB receipt. Regression test covers the neg_risk SELL path."
spec_refs:
  - architecture
assignees: []
project: proj.poly-copy-trading
labels: [poly, polymarket, adapter, bug, neg-risk]
---

# bug.0329 — Polymarket CLOB adapter SELL on neg_risk returns empty error

> Surfaced during task.0315 preview validation on 2026-04-19. Two orphan positions (LeBron 500 YES / $3.25 MTM, Iran 5 YES / $0.78 MTM) sit on the operator wallet because neither can be closed. See [task.0315 handoff](../handoffs/task.0315.handoff.md).

## Symptom

- `PolymarketClobAdapter.placeOrder` with `side: "SELL"` against a neg_risk market returns an empty-error response from CLOB:
  - `success = undefined`
  - `orderID = <missing>`
  - `errorMsg = ""`
- Same signing path, same wallet, same session — a BUY on the same market succeeds.
- Cancel on a BUY that hasn't filled yet works fine. Only post-fill SELL is broken.
- Verified:
  - ✅ USDC.e `approve(exchange, MaxUint256)` for Exchange + Neg-Risk Exchange + Neg-Risk Adapter
  - ✅ CTF ERC-1155 `setApprovalForAll(exchange, true)` for Exchange + Neg-Risk Exchange
  - ✅ Tick size valid (price is a multiple of the market's tick)
  - ✅ Notional above `min_order_size_usdc`
  - ✅ Operator holds the CTF shares being sold (Data-API `/positions` confirms)
- Normal (non-neg_risk) markets: SELL works.
- Agent-invoked via `core__poly_close_position` AND script-invoked via `scripts/experiments/privy-polymarket-order.ts place --side SELL --token-id <asset> --size <usdc> --price <below-bid> --yes-real-money` both fail identically.

## Reproducer

```bash
cd /Users/derek/dev/cogni-template
pnpm tsx scripts/experiments/privy-polymarket-order.ts place \
  --side SELL \
  --token-id 66220987961735552196466691015858089081800260773293728636067671373854023769796 \
  --size 2.5 \
  --price 0.005 \
  --yes-real-money
# Expect (today): `Response: {success: undefined, errorMsg: ''}`
# Expect (after fix): normal orderID receipt
```

LeBron 2028 YES token id in the handoff's §Pointers works as a stable reproducer; Iran resolves 2026-04-22 so it may disappear soon.

## Suspected root cause

Likely in the EIP-712 domain or verifyingContract selection on the SELL signing path. `@polymarket/clob-client`'s order construction picks the exchange contract based on `market.negRisk`. A mis-selection (neg-risk market routed through the standard Exchange contract, or vice versa) would produce a signature that CLOB rejects silently with empty error.

**Files to inspect first:**

- `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts` L180–230 — SELL signing + order-post path
- Look for where the adapter decides between `Exchange (0x4bFb…982E)` and `Neg-Risk Exchange (0xC5d5…f80a)` as `verifyingContract`
- Check if the CTF vs Neg-Risk Adapter (`0xd91E…5296`) distinction is applied on SELL the same way as BUY

Related clues:

- `@polymarket/clob-client` has a `negRisk` / `negRiskExchange` flag on market objects; confirm the adapter reads it and picks the signing domain accordingly
- `Neg-Risk Adapter` (0xd91E…5296) handles CTF operations for neg-risk markets — SELL may need to route through the adapter, not the exchange directly

## Fix criteria

- [ ] Trace raw CLOB response (not just the adapter-returned wrapper) on a neg_risk SELL — capture with a `--trace` flag on the reproducer script, or with `console.log` in the adapter's `post-order` call
- [ ] Identify the signing-domain / verifyingContract mismatch
- [ ] Fix the SELL path to select the correct domain based on market neg_risk flag
- [ ] Add a regression test: mock CLOB `post-order` endpoint, assert the domain field on a neg_risk SELL vs a normal SELL
- [ ] Smoke-validate: run the reproducer against the Iran or LeBron orphan — successful SELL
- [ ] If Iran has resolved by then, validate the CTF-redemption path instead (different adapter call)

## Validation

Fixed when the reproducer command in §Reproducer returns a normal orderID receipt instead of the empty-error response, AND the regression test described in §Fix criteria covers the neg_risk SELL signing path.

## Blast radius

- Every position opened via `core__poly_place_trade` or `core__poly_close_position` or the autonomous mirror on a neg_risk market becomes stuck until resolution or an equivalent cross-order is found.
- Approx 40%+ of Polymarket volume is in neg_risk markets (election winner / sports-champion style). Current orphan dust ($4.03) is small; scale with mirror activity.

## Pointers

- [task.0315 handoff](../handoffs/task.0315.handoff.md) — where this surfaced
- `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts` — adapter file
- `scripts/experiments/privy-polymarket-order.ts` — CLI reproducer
- `.claude/skills/poly-auth-wallets/SKILL.md` — wallet roles + approvals runbook (CTF standard + neg-risk `setApprovalForAll`)
- [poly-copy-trade-candidates research](../../docs/research/polymarket-copy-trade-candidates.md) — neg-risk vs regular market distribution
