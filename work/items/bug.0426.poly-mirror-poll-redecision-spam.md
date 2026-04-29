---
id: bug.0426
type: bug
title: "Mirror poll re-decisions every fill 11–12× per hour — no cursor on data-api `/trades` poll"
status: needs_triage
priority: 2
rank: 20
estimate: 2
summary: "Each unique target fill_id flows through `poly.mirror.decision` 11–12 times per hour on production. CLOB-level idempotency works correctly (the same `client_order_id` is never placed twice), but the data-api `/trades` poll has no cursor — every 30s tick re-fetches the same trade window, the pipeline runs `mirror.decision` on every fill, hits the DB to check `INSERT_BEFORE_PLACE`, and skips. The `placed/skipped/error` ratio in 1h on production was 92 / 998 / 2474 — i.e. for every real placement we do ~10 redundant decision-cycle round-trips. Wastes Postgres roundtrips, log volume, and pipeline CPU. Will get worse linearly with target count and the planned shared-poller fan-out (task.0332)."
outcome: "Mirror poll cursors past the most-recent processed fill_id (per target) so the same fill is decisioned at most once. `mirror.decision outcome=skipped reason=already_placed` rate drops by ~10× on production. CLOB calls and DB rows unchanged (idempotency was already working). Specifically out of scope: changing fill_id semantics, changing the at-most-once guarantee, changing FOK/limit choice."
spec_refs:
  - poly-copy-trade-phase1
assignees: []
project: proj.poly-copy-trading
created: 2026-04-29
updated: 2026-04-29
labels: [poly, copy-trading, polling, observability, performance]
external_refs:
  - work/items/task.0332.poly-mirror-shared-poller.md
  - work/items/task.0424.poly-bet-sizer-per-position-cap.md
  - nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts
  - nodes/poly/app/src/features/copy-trade/wallet-watch.ts
---

# bug.0426 — Mirror poll re-decisions every fill many times

## Symptom

Production (last 1h, after V2 cutover, single tenant, 2 active copy-trade targets):

| `mirror.decision` outcome      | count |
| ------------------------------ | ----: |
| `error placement_failed`       |  2474 |
| `skipped already_placed`       |   998 |
| `placed ok`                    |    92 |

Per-fill_id breakdown: each unique `fill_id` shows up in `mirror.decision` 11–12 times. First time → real placement attempt (logged once as `error` if CLOB rejects, or `placed ok` on accept). Subsequent 10–11 polls → `skipped already_placed`.

## Why this happens

`INSERT_BEFORE_PLACE` correctly prevents double-placement at the COID layer — that's the at-most-once guarantee, working as designed. But the **decision pipeline runs upstream** of the COID check:

1. Wallet-watch poll fires every 30s.
2. Polymarket data-api `/trades?user=<target>` returns the last N fills (no cursor support agent-side; we just request the window).
3. Each returned fill is fed into `mirror.decision`.
4. The decision derives `client_order_id`, queries `poly_copy_trade_orders` for an existing row.
5. Existing row → log `skipped already_placed` and exit.

Steps 3–5 run for every fill in the window every 30s, even fills processed an hour ago. The `/trades` window is wider than the poll period, so each fill is "in scope" for 11–12 successive ticks before it falls off.

This is wasted DB load and log cardinality, not an at-most-once bug. CLOB sees exactly one placement per fill_id.

## Why it's worth fixing now (not later)

- **Linear in target count.** Every new target multiplies the wasted work. task.0332 (shared poller) will fan-out target count significantly.
- **Pollutes observability.** 998 `skipped already_placed` lines per hour for one tenant drowns out the signal in `mirror.decision` queries. With 10 targets that's 10K/h.
- **Cheap to fix.** A per-target cursor (last processed `fill_id` or `lastFilledTimestamp`) caps re-decisions at the natural poll-overlap window (1–2 ticks).

## Scope

**Per-target cursor.** Add a `last_processed_fill_ts` (or `last_processed_fill_id`) column to whatever table tracks per-target poll state — likely an extension of the wallet-watch state, not a new table. After each poll batch, advance the cursor to the latest fill's timestamp. Subsequent polls filter to `ts > cursor` before feeding the decision pipeline.

Choose timestamp over fill_id because fill_id contains a target-side tx that doesn't sort cleanly across markets; timestamps from data-api are monotonic per-target and that's the actual property we need.

**Idempotency invariant unchanged.** The COID-level guard stays exactly as is. This bug is purely a "don't do redundant work upstream of an already-correct guard."

## Out of scope

- Migrating from data-api poll → CLOB websocket (task.0322 / Phase 4).
- Changing fill_id semantics (`FILL_ID_FROZEN` per the phase-1 spec).
- Reducing FOK rejection rate (separate concern; that's bug.0405's domain — design choice, not a bug here).
- Caching market metadata reads (different shape).

## Files to touch

- `nodes/poly/app/src/features/copy-trade/wallet-watch.ts` — read cursor before fetching, pass cursor as filter, advance after batch processed.
- Wherever per-target poll state lives (likely in `poly_copy_trade_targets` or a sibling table) — add `last_processed_fill_ts NULLABLE`. Migration that defaults to NULL means first poll after deploy still hydrates from the full window once.
- Tests: replay a fixture where the same fills appear in two consecutive poll responses; assert the second batch yields zero `mirror.decision` calls.

## Validation

**exercise:** with at least one active target on candidate-a, watch two successive poll cycles. The second should produce zero `skipped already_placed` log lines for fill_ids covered by the first.

**observability:**

```logql
sum(count_over_time({env="candidate-a", service="app"}
  | json
  | event="poly.mirror.decision"
  | reason="already_placed" [5m]))
```

Pre-fix baseline on production: ~85/min for single tenant + 2 targets. Post-fix expectation: <5/min (only the natural overlap ticks).
