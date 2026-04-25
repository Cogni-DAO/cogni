# Poly CTF redeem-sweep test fixtures

Real-data fixtures captured from Polymarket Data-API + Polygon mainnet CTF
contract reads. Pinned to a block so tests are deterministic — no chaotic
drift between runs.

## Files

| File                                      | Source                                                                                        | What it represents                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `positions.data-api.snapshot-<DATE>.json` | `GET https://data-api.polymarket.com/positions?user=0x95e4…5134&sizeThreshold=0.01&limit=200` | Raw Data-API positions response. Validates against the zod `Position` schema.                                                              |
| `ctf-reads.snapshot-<DATE>.json`          | `eth_call` against CTF `0x4D97…6045` at the pinned block                                      | Per-position on-chain reads: `payoutNumerators`, `payoutDenominator`, `getOutcomeSlotCount`, `balanceOf` for both held and opposite asset. |
| `expected-decisions.snapshot-<DATE>.json` | derived from `ctf-reads`                                                                      | Golden decision table: for each position, what `assertOnChainRedeemable` MUST return.                                                      |
| `snapshot.sh`                             | n/a (script)                                                                                  | Re-snapshot all three files at a fresh block. Run when adding scenarios or rotating to a new pinned block.                                 |

## Predicate covered by these fixtures

```
redeem ⇔ balanceOf(funder, positionId) > 0 AND payoutNumerator(conditionId, outcomeIndex) > 0
```

Skip reasons enumerated in `expected.skipReason`:

- `zero_balance` — wallet doesn't hold the position token (already redeemed or never bought).
- `losing_outcome` — market resolved against this outcome; CTF won't pay out.
- `read_failed` — RPC returned no result for one of the two CTF reads (multicall partial failure).

## Scenario coverage in the 2026-04-25 snapshot

Funder `0x95e407fE03996602Ed1BF4289ecb3B5AF88b5134` — the production poly
trading wallet that motivated bug.0383.

- 16 total positions
- 2 winners (redeem) — both neg-risk: Shanghai Haigang ($4.83), Querétaro ($3.39)
- 14 skips (`losing_outcome`) — mix of vanilla and neg-risk losers
- Coverage: vanilla resolved-loser, neg-risk resolved-loser, neg-risk
  resolved-winner, vanilla unresolved (numerator==0, denominator==0),
  neg-risk unresolved (numerator==0, denominator==0)

What the snapshot does NOT cover (extend `snapshot.sh` against a different
funder / block to cover):

- A vanilla CTF winner (this funder happens to have no winning vanilla
  positions at snapshot time)
- `read_failed` scenarios (synthesize in unit test by mocking the multicall)
- `skip_zero_balance` (this funder holds non-zero balance on every
  position above `sizeThreshold=0.01`; synthesize in unit test)
- `skip_missing_outcome_index` (Data-API has not been observed to omit
  `outcomeIndex` for this funder; synthesize by editing a fixture row)

## How tests use these fixtures

`tests/unit/bootstrap/poly-trade-executor.test.ts` loads
`expected-decisions.snapshot-<DATE>.json` and, for each `case`, asserts:

1. `assertOnChainRedeemable(case.conditionId, case.outcomeIndex, BigInt(case.asset))`
   returns `{ ok: case.expected.action === 'redeem', reason: case.expected.skipReason }`
   when fed `case.inputs` via a mocked `publicClient.multicall`.
2. The full `redeemAllRedeemableResolvedPositions` walk over all 16 cases
   produces exactly `summary.byAction.redeem` real `redeemPositions` write
   calls, no more, no less.

## Refreshing the snapshot

```bash
# Set RPC + (optional) override funder
export POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/<key>
# export POLY_TEST_FUNDER=0x...   # defaults to the bug.0383 funder

./snapshot.sh
```

Then update test imports to point at the new dated files. Keep older
snapshots until tests are migrated; they document past chain state and
make regressions auditable.

## Why pinned-block + dated filenames

Polymarket markets resolve continuously, and Data-API state mutates as
positions are sold or redeemed. A test that hits live Data-API drifts daily.
A test against a frozen JSON + pinned block runs the same forever. When the
funder's positions change in a way the predicate must cover, snapshot a new
file (don't mutate the old one) and update the test.
