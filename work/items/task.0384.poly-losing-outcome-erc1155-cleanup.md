---
id: task.0384
type: task
title: poly losing-outcome ERC1155 cleanup — decide what to do with stuck loser tokens
status: needs_triage
priority: 2
rank: 1
estimate: 2
branch:
summary: After bug.0383, losing-outcome ERC1155 tokens accumulate on the operator funder forever. Decide whether to safeTransferFrom them to 0xdead, leave them, or sell into CLOB at $0. Not gas-burning anymore, just clutter.
outcome: A documented decision (and one-line implementation if action is taken) for what the poly node does with ERC1155 balances on resolved-losing positions. Either the dust stays and we accept the visual noise, or it's swept once on a schedule.
spec_refs:
assignees: []
credit:
project: proj.poly-web3-security-hardening
pr:
reviewer:
revision: 1
blocked_by: bug.0383
deploy_verified: false
created: 2026-04-25
updated: 2026-04-25
labels: [poly, ctf, cleanup, low-priority]
external_refs:
---

# poly losing-outcome ERC1155 cleanup

## Requirements

### Observed

After bug.0383 ships, the redeem sweep correctly skips losing-outcome
positions (`payoutNumerator(heldIdx) == 0`). But the ERC1155 balance for
those tokens stays on the funder forever — `redeemPositions` doesn't burn
losers, and we don't do anything else with them.

Snapshot 2026-04-25 on `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134`:
14 of 16 held positions are losers (per
`tests/fixtures/poly-ctf-redeem/expected-decisions.snapshot-2026-04-25.json`).
Each position carries an ERC1155 balance ranging from 5M to 60M (units;
6-decimal token = $5–$60 worth at original purchase, $0 worth now).

### Expected

A decision on one of:

1. **Leave dust.** Document the design choice. Funder accumulates worthless
   ERC1155 balances forever; visible in `balanceOfBatch` calls and the
   Polymarket UI but otherwise harmless.
2. **Burn dust.** `safeTransferFrom(funder, 0x000…dead, positionId, balance, "")`
   for every loser. One-time gas cost ~50k per token; 14 positions = ~$0.30
   of gas at current Polygon prices.
3. **Sell dust at $0 into CLOB.** Place a sell order at the minimum tick
   ($0.01) for each loser; if anyone buys, we get something; if not, the
   token sits in the order book. Costs nothing on-chain (CLOB is off-chain
   signed).

### Reproduction

After bug.0383 ships, query `balanceOfBatch` against the funder for every
positionId in the captured fixture. All 14 loser positionIds will return
non-zero balances indefinitely.

### Impact

- **Severity: priority 2.** Not gas-burning. Not blocking any flow.
  Cosmetic + slight Data-API noise (`/positions` returns the dust
  unless `sizeThreshold` filters it out).

## Design

(Out of scope for triage — pick one of the three options above based on
operator preference + product noise tolerance.)

## Validation

```yaml
exercise: |
  # Set during /design once an option is picked.

observability: |
  # Set during /design once an option is picked.

smoke_cmd: |
  # Set during /design once an option is picked.
```
