---
id: task.0142
type: task
title: "Epoch pool value stabilization — minimum activity threshold + carry-over policy"
status: needs_design
priority: 1
rank: 22
estimate: 2
summary: "Stabilize per-event credit value across epochs by adding a minimum activity threshold and an opt-in carry-over mechanism. Prevents quiet-week windfalls where 1 receipt earns the full epoch pool, and prevents budget waste when quiet weeks permanently destroy unspent accrual."
outcome: "Near-empty epochs (below threshold) spend zero budget and carry unspent accrual to the next eligible epoch. Per-event value variance is bounded. Budget is not permanently lost to quiet weeks. On-chain settlement can trust that credit amounts reflect comparable per-event value across epochs."
spec_refs: tokenomics-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0130]
deploy_verified: false
created: 2026-03-07
updated: 2026-03-07
labels: [governance, tokenomics, attribution]
external_refs:
---

# Epoch Pool Value Stabilization

> Depends on: [task.0130](task.0130.tokenomics-crawl-budget-bank.md) (budget policy)
> Project: [proj.transparent-credit-payouts](../projects/proj.transparent-credit-payouts.md) (Walk P1)

## Problem

Fixed pool + variable activity = random per-event value.

| Epoch | Receipts | Pool   | Per-receipt value |
| ----- | -------- | ------ | ----------------- |
| A     | 1 PR     | 10,000 | 10,000 credits    |
| B     | 20 PRs   | 10,000 | ~500 credits      |

The PR in epoch A was not 20x more valuable — it happened during a quiet week. In Crawl this is annoying. Once credits map to tokens (Walk), it means one quiet-week PR mints someone 20x more governance power than equivalent work in a busy week. Positive-only rebalancing (V0) means this windfall is permanent.

**With category pools (task.0141), this is amplified.** A quiet engineering week with 1 PR gives one engineer the full engineering category pool while busy community members split their smaller share.

**Budget waste without carry-over.** task.0130 explicitly defers carry-over. But without it, `remaining` decreases by `accrual_per_epoch` every active week regardless of activity volume. Over 52 weeks with ~10% near-empty epochs, ~52K credits of a 520K budget are spent on windfall payouts.

## Design

### Outcome

Per-event value variance is bounded. Near-empty epochs carry budget forward.

### Approach

Two complementary mechanisms:

#### 1. Minimum Activity Threshold

Add `min_receipts_for_payout` to budget policy:

```yaml
budget_policy:
  budget_total: "520000"
  accrual_per_epoch: "10000"
  min_receipts_for_payout: 3 # optional, default 1 (current behavior)
```

Policy function becomes:

```
included_count = count(receipts where included = true)

if included_count < min_receipts_for_payout:
  epoch_pool = 0  # epoch still runs for transparency, no credits distributed
else:
  epoch_pool = min(accrual_per_epoch, remaining)
```

This is the simplest fix for the worst case (1-2 receipts earning the full pool). Activity is still recorded for transparency and future rebalancing.

#### 2. Carry-Over (Bounded)

When `epoch_pool = 0` due to threshold, the unspent `accrual_per_epoch` is not lost. It carries to the next eligible epoch, bounded by a carry cap:

```yaml
budget_policy:
  budget_total: "520000"
  accrual_per_epoch: "10000"
  min_receipts_for_payout: 3
  max_carry_epochs: 2 # optional, default 0 (no carry, current behavior)
```

Policy function:

```
carry = min(accumulated_carry, accrual_per_epoch * max_carry_epochs)
available = accrual_per_epoch + carry

if included_count < min_receipts_for_payout:
  epoch_pool = 0
  accumulated_carry = min(accumulated_carry + accrual_per_epoch, accrual_per_epoch * max_carry_epochs)
else:
  epoch_pool = min(available, remaining)
  accumulated_carry = 0
```

`max_carry_epochs = 0` preserves current no-carry behavior. `max_carry_epochs = 2` means at most 2 skipped weeks' budget can accumulate (caps burst to 3x normal epoch). This prevents a 6-month quiet period from creating a 26x windfall.

#### Interaction with category pools (task.0141)

If category pools ship, thresholds and carry-over should be per-category:

- Engineering category below threshold = engineering pool carries, other categories unaffected
- This prevents a quiet engineering week from zeroing the entire epoch

This interaction is noted here but implementation details depend on spike.0140 findings.

### Invariants

- [ ] BUDGET_HARD_CAP: carry-over does not create credits beyond `budget_total`. `epoch_pool + carry ≤ remaining`.
- [ ] THRESHOLD_TRANSPARENT: below-threshold epochs still record activity and appear in the ledger with `epoch_pool = 0`.
- [ ] CARRY_BOUNDED: `accumulated_carry ≤ accrual_per_epoch * max_carry_epochs`. No unbounded accumulation.
- [ ] BACKWARD_COMPAT: `min_receipts_for_payout = 1` and `max_carry_epochs = 0` reproduces current behavior exactly.
- [ ] CARRY_STATE_AUDITABLE: carry state tracked in `budget_bank_ledger` (append-only entries for carry accrual and spend).
- [ ] ALL_MATH_BIGINT: carry computation uses BigInt.

### Files

**Modify:**

- `packages/repo-spec/src/schema.ts` — add `min_receipts_for_payout` and `max_carry_epochs` to `budgetPolicySchema`
- `packages/repo-spec/src/accessors.ts` — add accessors for new fields
- `packages/attribution-ledger/src/pool.ts` — extend `computeEpochBudget` with threshold check and carry-over logic
- `packages/attribution-ledger/src/budget-bank.ts` — add carry state tracking (read accumulated carry from ledger entries)
- `packages/db-schema/src/attribution.ts` — add `carry_accrual` and `carry_spend` entry types to `budget_bank_ledger`
- `services/scheduler-worker/src/activities/ledger.ts` — pass receipt count and carry state to budget computation
- `.cogni/repo-spec.yaml` — add threshold and carry config (values TBD with governance)

**Test:**

- `packages/attribution-ledger/tests/pool.test.ts` — threshold: below/at/above, carry: accumulation/cap/spend/exhaustion
- `packages/attribution-ledger/tests/budget-bank.test.ts` — carry state auditable from ledger entries

## Validation

- [ ] `pnpm check` passes
- [ ] Below-threshold epochs: `epoch_pool = 0`, activity still recorded, `remaining` unchanged
- [ ] Carry accumulates when threshold not met, bounded by `max_carry_epochs`
- [ ] Carry spends on next eligible epoch, resets to 0
- [ ] `epoch_pool + carry ≤ remaining` always (BUDGET_HARD_CAP upheld)
- [ ] Default config (`min_receipts_for_payout: 1`, `max_carry_epochs: 0`) reproduces current behavior exactly
- [ ] Budget bank ledger entries are append-only and carry state is replayable

## Review Checklist

- [ ] **Work Item:** `task.0142` linked in PR body
- [ ] **Spec:** BUDGET_HARD_CAP, CARRY_BOUNDED, BACKWARD_COMPAT upheld
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
