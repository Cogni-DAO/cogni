---
id: bug.0421
type: bug
title: "FOK success-with-zero-fill logged as outcome=placed — masks bug.0405 divergence in dashboards"
status: done
priority: 1
rank: 5
estimate: 1
summary: 'When Polymarket CLOB accepts a FOK BUY but matches zero shares (no liquidity at limit_price), the response is `{success: true, orderID, makingAmount: "0"}`. `mapOrderResponseToReceipt` returns a receipt with `filled_size_usdc=0` and the placeOrder success branch logs `phase=ok` — the mirror pipeline records `outcome=placed` for a fill that acquired zero shares. The bug.0405 `fok_no_match` reclassifier only fires on the *empty-response* / thrown-error path; the success-with-zero-fill path was never re-bucketed. Surfaced 2026-04-29 on candidate-a after PR #1118 — first real target signal placed `BUY $4.00 "Celtics" @ 0.80` against thin book, returned a real order_id, matched zero, and was idempotency-locked from any retry. Dashboards showed it as a successful placement.'
outcome: 'Tight 5-line fix in `polymarket.clob.adapter.ts:placeOrder`: after `mapOrderResponseToReceipt`, if `orderTypeUsed === FOK && receipt.filled_size_usdc === 0`, throw `ClobRejectionError({error_code: fokNoMatch, reason: "fok_zero_fill"})`. Existing catch path already handles `fokNoMatch` correctly — log becomes `phase=rejected error_code=fok_no_match reason=fok_zero_fill`, mirror decision becomes `outcome=error reason=fok_no_match`. No downstream changes. Divergence rate is now derivable from Loki: `count_over_time({event="poly.mirror.decision", reason="fok_no_match"} [1h]) / count_over_time({event="poly.mirror.decision"} [1h])`.'
spec_refs:
  - poly-copy-trade-phase1
assignees: [derekg1729]
project: proj.poly-copy-trading
branch: fix/poly-fok-zero-fill-mislabel
created: 2026-04-29
updated: 2026-04-29
deploy_verified: false
labels: [poly, polymarket, clob, fok, observability, mirror-divergence]
external_refs:
  - work/items/bug.0405.poly-clob-sell-fak-generates-dust.md
  - https://github.com/Cogni-DAO/node-template/pull/1118
---

# bug.0421 — FOK zero-fill success masquerades as `outcome=placed`

PR #1118 shipped bug.0405's FOK-on-BUY trade-off: better to skip a signal than land sub-min dust. The `fok_no_match` reclassifier covers the path where CLOB returns `{}` or an empty error body — the SDK throws, the catch block reclassifies, the mirror records `outcome=error reason=fok_no_match`, and the next target signal re-enters cleanly.

But the **success-with-zero-fill** path was never wired through. CLOB also returns `{success: true, orderID: "0x..", makingAmount: "0"}` when the FOK envelope is accepted but no liquidity matches. That goes straight through `mapOrderResponseToReceipt` → `phase=ok` log → mirror records `outcome=placed`. The fill is silently lost; idempotency then blocks retries forever for that `client_order_id`.

## Validation

- exercise: place a FOK BUY on a thin-book Polymarket market where no liquidity exists at the limit_price
- observability: `count_over_time({env="candidate-a", service="app"} | json | event="poly.clob.place" | phase="ok" | filled_size_usdc=0 [10m])` is `0` after deploy; the same conditions log under `phase="rejected"` with `error_code="fok_no_match"`

Verified locally via unit test (`packages/market-provider/tests/polymarket-clob-adapter.test.ts` — `placeOrder reclassifies FOK success-with-zero-fill as fok_no_match`).
