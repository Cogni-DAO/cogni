---
id: bug.0422
type: bug
title: "Redeemed positions show $0.00 P/L in History card — cost basis lost"
status: needs_triage
priority: 2
rank: 1
estimate: 1
summary: "On `/dashboard` `ExecutionActivityCard` History tab, every position with `lifecycleState: redeemed` renders P/L as `$0.00` and P/L% as `0.00%`, even though the user originally paid USDC for the shares. The displayed loss is wrong: a redeemed position should show realized payout minus original buy cost basis."
outcome: "Redeemed positions in the History tab show their actual realized P/L (winning_shares * 1.0 USDC payout − original buy USDC). Pre-existing positions with truncated trade history surface a clear `—` instead of a fake `$0.00` so users can tell missing-data from real-zero."
spec_refs:
assignees: [derekg1729]
project: proj.poly-prediction-bot
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-29
updated: 2026-04-29
labels: [poly, dashboard, data-quality]
---

# Redeemed positions show $0.00 P/L in History card

## Symptoms

Surfaced during validation of task.0426 (`Resolves` column experiment) on candidate-a. History tab rows with the green `Redeemed` lifecycle pill all show `$0.00` and `0.00%`. Examples: Bruins vs. Sabres, Will Cruzeiro EC win on 2026-04-28?, Saint-Malo, Mauthausen, Pistons O/U 214.5, Pistons O/U 213.5, Flyers vs. Penguins.

## Root cause (suspected)

`packages/market-provider/src/analysis/position-timelines.ts → mapExecutionPositions`:

```ts
const pnlUsd =
  snapshot && status !== "closed"
    ? snapshot.cashPnl
    : sellUsdc + currentValue - buyUsdc;
```

For redeemed positions:

- `status === "closed"` → falls into the else branch
- No `snapshot` (Polymarket Data API `/positions` returns OPEN positions only)
- `currentValue = 0` (closed)
- `sellUsdc = 0` (redeemed positions had no SELL trade — they were claimed via `redeemPositions`)
- `buyUsdc = sum of historical BUY trade USDC`

If the trade history pull doesn't include the original BUY rows (Data API window, archived data, etc.), `buyUsdc = 0` → `pnlUsd = 0`. The redemption payout (`winning_shares * 1.0`) is also missing because we don't fetch the redeem activity.

## Suggested fixes

1. **Use `realizedPnl` from the Polymarket position payload** when the position transitioned to `redeemable` — capture and persist it before the snapshot disappears (closed positions aren't returned by `/positions`).
2. **Or** join with `poly_redeem_jobs` (Cogni-side) which already records the redemption transaction and payout USDC, exposed via the redeem-worker.
3. **Display fallback** — when `buyUsdc === 0` AND `sellUsdc === 0` AND `currentValue === 0`, render `—` not `$0.00`. Honest "missing" beats fake "zero".

## Validation

exercise:

- `https://poly-test.cognidao.org/dashboard` → History tab → at least one redeemed row shows positive P/L matching the position's BUY cost basis × payout.
- Rows with truly missing trade history show `—`, not `$0.00`.

observability:

- DB check on `poly_redeem_jobs` for the row's `condition_id` confirms the redemption USDC matches the displayed payout.
