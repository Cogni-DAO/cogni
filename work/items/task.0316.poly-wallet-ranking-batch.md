---
id: task.0316
type: task
title: "Poly wallet-ranking batch job + poly_tracked_wallets table"
status: needs_design
priority: 2
estimate: 2
rank: 5
summary: "Weekly job scores candidate Polymarket wallets by risk-adjusted PnL, win-rate, and category specialization, with a minimum resolved-market floor to guard against survivorship bias. Upserts ranked roster into a new poly_tracked_wallets table in the awareness-plane Postgres. This roster feeds the live poller in task.0317."
outcome: "A poly_tracked_wallets table exists in the poly awareness Postgres, populated weekly with ~20–50 ranked wallets per market category. Adapter methods from task.0315 are the sole data source in v0. Rank persistence and category scoping are testable and reversible."
spec_refs:
  - monitoring-engine
assignees: derekg1729
project: proj.poly-prediction-bot
blocked_by: task.0315
created: 2026-04-16
updated: 2026-04-16
labels: [poly, polymarket, follow-wallet, ranking, awareness]
external_refs:
  - docs/research/poly-copy-trading-wallets.md
---

# Poly Wallet-Ranking Batch Job

> Research: [poly-copy-trading-wallets](../../docs/research/poly-copy-trading-wallets.md)
> Project: [proj.poly-prediction-bot](../projects/proj.poly-prediction-bot.md)
> Follows: [spike.0314](./spike.0314.poly-copy-trading-wallets.md), [task.0315](./task.0315.poly-data-api-wallet-reads.md)

## Context

Once the Data-API read methods ship (task.0315), we need a scheduled job that turns leaderboard + user-activity data into a ranked roster of watched wallets. This is Tier 1 of the three-tier pipeline described in the research doc. Belongs to the **awareness** plane (Postgres), not knowledge (Dolt).

## Design

### New table (awareness plane, `cogni_poly` Postgres)

```
poly_tracked_wallets (
  wallet        TEXT,
  category      TEXT,   -- sports | politics | crypto | macro | other
  score         NUMERIC,
  win_rate      NUMERIC,
  resolved_n    INTEGER,
  pnl_usd       NUMERIC,
  ranked_at     TIMESTAMPTZ,
  PRIMARY KEY (wallet, category)
)
```

### Ranking rules

- Require `resolved_n >= 30` per category before a wallet is eligible — survivorship guard.
- `score = pnl_usd / stdev(trade_pnl)` (Sharpe-like), capped to prevent whale dominance.
- Per-category ranking; a wallet can appear in multiple categories.
- Top K per category written each run (K = 10–20).

### Scheduling

Weekly via `@cogni/scheduler-core` (or Temporal cron if the worker is already deployed — pick whichever is shipped on the poly node). Idempotent on `(wallet, category)` with `ranked_at` bumped.

## Invariants

- [ ] AWARENESS_PLANE: new table is in Postgres `cogni_poly`, not Doltgres `knowledge_poly`
- [ ] MIN_RESOLVED_FLOOR: ranking rejects wallets with `resolved_n < 30` in the scoped category
- [ ] IDEMPOTENT_UPSERT: re-running the job produces no duplicates
- [ ] NO_EXECUTION: this task persists rankings only — no order placement, no Observation events

## Validation

- [ ] Migration creates `poly_tracked_wallets` idempotently
- [ ] Running the job twice produces zero duplicate rows (PK upsert)
- [ ] Wallets with `resolved_n < 30` never appear in the output — covered by a unit test
- [ ] One full run populates ≥10 wallets per major category against live data
- [ ] `pnpm check` passes

## Out of Scope

- Live per-wallet polling → belongs to task.0317
- Signal edge measurement → spike.0318
- Any mirror-execution logic
- UI for the roster
