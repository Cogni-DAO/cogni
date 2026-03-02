---
id: task.0130
type: task
title: "Tokenomics Crawl: BudgetBank + kill Score UI"
status: needs_implement
priority: 1
rank: 25
estimate: 3
project: proj.transparent-credit-payouts
branch: fix/epochs-v0
summary: "Replace magic pool_config with BudgetBank (vault_total + accrual + carry cap). Remove 'Score' column from UI — show 'Credits Earned' only. Add budget_bank_ledger table. Pure functions, no contracts."
outcome: "Epoch pools are finite (hard-capped vault), deterministic (policy function), and carry over. Users see one number ('credits earned'), not two. No more arbitrary inflation."
assignees: derekg1729
created: 2026-03-02
updated: 2026-03-02
labels: [governance, tokenomics, attribution]
---

# Tokenomics Crawl: BudgetBank + Kill Score UI

> Spec: [tokenomics](../../docs/spec/tokenomics.md) (Crawl section)

## Design

### Outcome

Epoch credit pools have a hard cap and deterministic sizing via BudgetBank policy. Users see one number in the UI.

### Approach

**Solution**: BudgetBank pure functions + repo-spec `budget_policy` + UI cleanup

**Reuses**: Existing `pool.ts` framework, existing `PoolComponentEstimate` type, existing epoch lifecycle

**Rejected**:

- Token deployment now — premature, adds contract risk before economics are proven
- Admin-settable epoch_pool — undermines determinism and trust
- Halvening now — adds complexity; flat accrual proves the model first

### Invariants

- [ ] BUDGET_HARD_CAP: `SUM(all epoch_pools) ≤ vault_total` (spec: tokenomics)
- [ ] EPOCH_POOL_DETERMINISTIC: policy function, not admin choice (spec: tokenomics)
- [ ] ONE_USER_FACING_UNIT: UI shows credits only, no "score" (spec: tokenomics)
- [ ] BUDGET_BANK_APPEND_ONLY: ledger entries immutable (spec: tokenomics)
- [ ] POOL_REPRODUCIBLE: each component stores algo + inputs + amount (spec: attribution-ledger)
- [ ] ALL_MATH_BIGINT: no floating point (spec: attribution-ledger)

### Files

**New:**

- `packages/attribution-ledger/src/budget-bank.ts` — `BudgetBankState`, `accrue()`, `spend()`, `canSpend()` pure functions
- DB migration: `budget_bank_ledger` table `(id, scope_id, epoch_id, entry_type, amount, balance_after, remaining_after, created_at)`. Append-only.

**Modify:**

- `packages/repo-spec/src/schema.ts` — add `budgetPolicySchema` (vault_total, accrual_per_epoch, max_carry_epochs)
- `packages/repo-spec/src/accessors.ts` — add `getBudgetPolicy()` accessor
- `packages/attribution-ledger/src/pool.ts` — add `computeEpochBudget(bankState, policy)` returning `PoolComponentEstimate`
- `.cogni/repo-spec.yaml` — replace `pool_config` with `budget_policy`
- `services/scheduler-worker/src/activities/ledger.ts` — read bank state, compute pool via `computeEpochBudget`
- `src/features/governance/components/EpochDetail.tsx` — remove "Score" column header + `totalScore` computation
- `src/features/governance/components/ContributionRow.tsx` — remove score display

**Test:**

- `packages/attribution-ledger/src/__tests__/budget-bank.test.ts` — unit tests for accrual, spend, carry cap, vault exhaustion, zero-activity epochs
- `packages/attribution-ledger/src/__tests__/pool.test.ts` — extend with `computeEpochBudget` tests

## Validation

- [ ] `pnpm check` passes
- [ ] Budget bank unit tests cover: accrual, spend, carry cap, vault exhaustion, zero-activity epoch
- [ ] UI shows "Credits Earned" column, no "Score" column
- [ ] `repo-spec.yaml` uses `budget_policy` instead of `pool_config`
- [ ] Existing finalized epochs are unaffected (backward compat)
