---
id: tokenomics-spec
type: spec
title: "Tokenomics: Budget Policy + Settlement Templates"
status: draft
spec_state: active
trust: draft
summary: "Crawl-walk-run tokenomics design. Crawl: rename units, add BudgetBank accrual with hard cap, deterministic epoch_pool policy. Walk: ERC-20 token + MerkleDistributor settlement. Run: halvening eras, governance/reward split, template system for node operators."
read_when: Understanding credit economics, pool sizing, emission schedules, or settlement design.
implements: proj.transparent-credit-payouts
owner: derekg1729
created: 2026-03-02
verified: 2026-03-02
tags: [governance, tokenomics, attribution]
---

# Tokenomics: Budget Policy + Settlement Templates

> The attribution pipeline answers "who did what." This spec answers "how much is the pool, where does it come from, and what do the numbers mean to the user."

## Goal

Replace arbitrary, inflationary credit issuance with principled tokenomics:

1. **One user-facing unit** — kill the score/credits split
2. **Hard-capped supply** — finite pool, no infinite minting
3. **Deterministic epoch pools** — policy function, not admin discretion
4. **Carry-over budget** — quiet weeks bank up, busy weeks draw down
5. **Separation of concerns** — attribution (governance truth) vs. settlement (financial truth) vs. governance (voting power)

## Non-Goals

- Deploying smart contracts (Crawl phase is off-chain only)
- Token trading, liquidity pools, or price discovery
- Multi-token architecture in Crawl
- Changing the attribution pipeline math (weights, enrichers, allocators stay as-is)

## Problems with Status Quo

| Problem                     | Evidence                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Infinite inflation**      | `base_issuance_credits: "10000"` mints 10K every epoch forever. No cap.                                   |
| **Two meaningless numbers** | UI shows "Score" (`units/1000`) AND "Credits" (`proportional share × pool`). Neither has intrinsic value. |
| **Magic pool size**         | `estimatePoolComponentsV0()` returns config value unchanged. `algorithmVersion: "config-constant-v0"`.    |
| **No scarcity signal**      | Credits accumulate without bound. No reason to value them.                                                |
| **Admin discretion risk**   | If admin could set `epoch_pool` arbitrarily, trust breaks.                                                |

## Invariants

| Rule                     | Constraint                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUDGET_HARD_CAP          | `SUM(all epoch_pools ever) ≤ vault_total`. Enforced by BudgetBank balance check.                                                                                        |
| EPOCH_POOL_DETERMINISTIC | `epoch_pool = min(accrued_this_period, bank_balance)`. Policy function, not admin choice. Admin can reduce (exclude receipts, zero-weight), never inflate above policy. |
| ONE_USER_FACING_UNIT     | Users see one number in one denomination. Internal milli-units are never displayed.                                                                                     |
| BUDGET_BANK_APPEND_ONLY  | Bank accrual and spend are append-only ledger entries. No retroactive edits.                                                                                            |
| SETTLEMENT_DECOUPLED     | Attribution statements are governance commitments. Settlement (how entitlements become claims) is a separate, pluggable layer.                                          |
| GOVERNANCE_NOT_REWARD    | Voting power and contributor rewards are separate concerns. May use the same token (Walk) or different tokens (Run), but the pipeline never conflates them.             |

## Design

---

### Crawl — Fix the Economics (Off-Chain, No Token)

**Ship first. No contracts. No token. Just correct the math and the UI.**

#### C1. Kill "Score" — One Number, One Name

| Before                                    | After                                                            |
| ----------------------------------------- | ---------------------------------------------------------------- |
| UI: "Score" column = `units/1000`         | **Gone.**                                                        |
| UI: "Credits" = proportional share × pool | **"Credits Earned"** — the only number shown.                    |
| `creditAmount` in DB                      | Unchanged — still BIGINT, still the output of allocation math.   |
| `units` / `finalUnits` in DB              | Unchanged — still internal pipeline state. Never shown to users. |

The UI shows: **"You earned 3,420 credits this epoch (34.2% of pool)"**

"Credits" remain the unit. They are off-chain ledger entries — signed governance commitments. What they're _worth_ is a settlement concern (Walk phase).

**Files changed:**

- `src/features/governance/components/EpochDetail.tsx` — remove "Score" column, keep "Share" + "Credits Earned"
- `src/features/governance/components/ContributionRow.tsx` — remove score display, show weight as tooltip only

#### C2. BudgetBank — Finite Supply + Carry-Over

Replace the magic `base_issuance_credits: "10000"` with a vault + accrual model.

```
┌─────────────────────────────────────────────────────────────┐
│  BudgetBank (per scope)                                     │
│                                                             │
│  vault_total:  520,000 credits  (hard cap, set once)        │
│  remaining:    520,000          (decremented per epoch)      │
│                                                             │
│  accrual_per_epoch:  10,000     (credits added to bank)     │
│  max_carry:          40,000     (4 epochs of accrual)        │
│  bank_balance:       10,000     (spendable this moment)     │
│                                                             │
│  epoch_pool = min(accrual_per_epoch, bank_balance)          │
│            = min(10000, 10000) = 10,000                     │
│                                                             │
│  After epoch: bank_balance -= epoch_pool                    │
│               remaining    -= epoch_pool                    │
│               bank_balance += accrual_per_epoch (next)      │
│               bank_balance  = min(bank, max_carry)          │
│                                                             │
│  When remaining = 0 → no more credits. Ever.                │
└─────────────────────────────────────────────────────────────┘
```

**Key behaviors:**

- **Normal week**: bank accrues 10K, epoch spends 10K. Net = 0 carry.
- **Quiet week** (no activity): epoch_pool = 0 (no receipts → nothing to distribute). Bank accrues to 20K.
- **Big week after quiet**: epoch_pool = min(10K, 20K) = 10K. Bank drains to 10K. Steady state restores.
- **Max carry hit**: bank capped at 40K. Excess accrual lost (use it or lose it beyond 4 weeks).
- **Vault exhausted**: remaining = 0. No more credits issued. Period. (Governance can vote to extend — that's a new vault, not an edit.)

**Why `epoch_pool` is NOT admin-settable:**
The admin controls _what activity counts_ (include/exclude receipts, weight overrides, identity resolution). The admin does NOT control _how big the pool is_. The pool is a policy function of the BudgetBank state. This prevents inflation attacks while preserving admin curation of attribution quality.

#### C3. repo-spec.yaml Changes (Crawl)

```yaml
activity_ledger:
  epoch_length_days: 7
  approvers: ["0x..."]
  budget_policy:
    vault_total: "520000" # hard cap (credits, not tokens yet)
    accrual_per_epoch: "10000" # credits added to bank each epoch
    max_carry_epochs: 4 # bank caps at 4× accrual
  activity_sources:
    github:
      attribution_pipeline: cogni-v0.0
      source_refs: ["cogni-dao/cogni-template"]
      streams: ["pull_requests", "reviews", "issues"]
```

`pool_config.base_issuance_credits` is **replaced** by `budget_policy`. Migration: existing epochs keep their stored `pool_components`; new epochs use BudgetBank.

#### C4. Code Changes (Crawl)

| File                                             | Change                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `packages/repo-spec/src/schema.ts`               | Add `budgetPolicySchema`. Deprecate `poolConfigSpecSchema`.                                                         |
| `packages/repo-spec/src/accessors.ts`            | Add `getBudgetPolicy()` accessor.                                                                                   |
| `packages/attribution-ledger/src/pool.ts`        | Add `computeEpochBudget(bankState, policy)` pure function. Keep `estimatePoolComponentsV0` for backward compat.     |
| `packages/attribution-ledger/src/budget-bank.ts` | **New.** `BudgetBankState` type, `accrue()`, `spend()`, `canSpend()` pure functions.                                |
| DB migration                                     | Add `budget_bank_ledger` table: `(scope_id, epoch_id, entry_type, amount, balance_after, created_at)`. Append-only. |
| `services/scheduler-worker/`                     | `CollectEpochWorkflow` reads bank state, computes epoch_pool via policy, records pool component.                    |

#### C5. Budget Bank State Machine

```
                    ┌──────────────┐
     epoch start ──►│    ACCRUE     │──► bank += accrual_per_epoch
                    │              │    bank = min(bank, max_carry)
                    └──────┬───────┘    remaining -= 0 (no spend yet)
                           │
                           ▼
                    ┌──────────────┐
     close epoch ──►│    SPEND      │──► epoch_pool = min(accrual, bank)
                    │              │    bank -= epoch_pool
                    └──────┬───────┘    remaining -= epoch_pool
                           │
                           ▼
                    ┌──────────────┐
     finalize    ──►│   FINALIZED   │──► pool_total locked on statement
                    └──────────────┘    (existing POOL_REPRODUCIBLE invariant)
```

If `remaining = 0`, ACCRUE is a no-op and `epoch_pool = 0`. Epoch still runs (activity is recorded for transparency) but no credits are distributed.

---

### Walk + Run — Token + Settlement + Templates

> **These phases are design inputs for [proj.financial-ledger](../../work/projects/proj.financial-ledger.md).** No separate project. The financial ledger project owns token deployment, MerkleDistributor, and all on-chain settlement.

#### Economic Model

Credits distributed by the attribution pipeline represent **equity ownership / governance stake** — not cash compensation. This is the co-op patronage model: contribute work → earn ownership in the org.

```
Attribution credits (off-chain, Crawl)
  → Equity/governance token (on-chain, Walk)
  → Voting power + ownership claim (Run)

USDC payouts are a SEPARATE concern:
  → Not automated by the attribution pipeline
  → Governance vote required to approve any USDC distribution
  → Financial ledger must be capable of tracking both instruments
```

**Why equity-first, not cash-first:**

- Cash payouts require revenue. Early-stage DAOs have none.
- Equity aligns incentives: contributors want the org to succeed.
- Governance tokens give contributors a voice in how the org operates.
- USDC distribution becomes a governance-voted action when the treasury can support it.

#### W1. ERC-20 Equity Token

Deploy a standard OpenZeppelin ERC-20 with fixed supply. Pre-mint entire supply to an `EmissionsVault` contract.

```
Token: COGNI (or operator-chosen symbol)
Total supply: governance decision (e.g., 1,000,000)
Decimals: 18
Initial holder: EmissionsVault contract (100% at mint)
Purpose: equity ownership + governance voting
```

The vault replaces the off-chain `budget_bank_ledger`. `vault_total` becomes the token's `totalSupply`. `accrual_per_epoch` becomes the vault's release rate. The BudgetBank logic (accrual, carry, spend) remains off-chain with the vault as the on-chain funding source.

**The token IS both equity and governance.** Single-token is simpler and sufficient for V0. A GOV/REWARD split is a Run-phase option only if the single-token model proves insufficient.

#### W2. MerkleDistributor Settlement

Use a **reusable** MerkleDistributor (not per-epoch deployment):

```
┌─────────────────────────────────────────────────────────────┐
│  ReusableMerkleDistributor                                  │
│                                                             │
│  setEpochRoot(epochId, merkleRoot, totalAmount)             │
│    • Only callable by vault owner (operator/timelock)       │
│    • Equity tokens transferred from EmissionsVault          │
│    • epochId → root mapping stored                          │
│                                                             │
│  claim(epochId, index, account, amount, proof)              │
│    • Standard Merkle inclusion proof                        │
│    • Marks claimed per (epochId, index)                     │
│    • Transfers equity tokens to claimant                    │
│                                                             │
│  sweep(epochId)                                             │
│    • After claim window (e.g., 90 days)                     │
│    • Unclaimed tokens → treasury                            │
│    • Only callable by owner                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

This is a thin wrapper around Uniswap's MerkleDistributor that supports multiple epochs in one contract. Maps directly to `proj.financial-ledger` P0 deliverables.

#### W3. Credit → Token Denomination

```
1 credit (off-chain) = 1 token unit (on-chain, 18 decimals)
```

Or governance can set a ratio. The attribution pipeline doesn't change — it still outputs `creditAmount` as BIGINT. The settlement layer maps credits to tokens.

#### W4. Settlement Flow

```
Finalized epoch statement (existing)
  → computeMerkleTree(statement.lines) → root + proofs
  → operator calls setEpochRoot(epochId, root, totalTokens)
  → EmissionsVault transfers equity tokens to distributor
  → users call claim() with their proof
  → unclaimed swept after 90 days
```

#### R1. Halvening Emissions

Replace flat `accrual_per_epoch` with era-based decay:

```
era_length_epochs: 52        # ~1 year at weekly epochs
era_0_accrual: 10000         # credits/tokens per epoch in era 0
halvening_factor: 2           # accrual halves each era

Era 0 (epochs 0–51):   10,000/epoch  →  520,000 total
Era 1 (epochs 52–103):  5,000/epoch  →  260,000 total
Era 2 (epochs 104–155): 2,500/epoch  →  130,000 total
...
Geometric sum → max ~1,040,000 total (approaches 2 × era_0 × era_length)
```

The vault is sized to this sum. `computeEpochBudget()` becomes era-aware:

```typescript
function currentAccrual(epochIndex: number, policy: HalveningPolicy): bigint {
  const era = Math.floor(epochIndex / policy.eraLengthEpochs);
  return policy.era0Accrual / BigInt(policy.halveningFactor) ** BigInt(era);
}
```

BudgetBank carry logic unchanged — just the accrual rate decays.

#### R2. USDC Distribution (Governance-Voted)

USDC payouts are **not automated** by the attribution pipeline. They are a separate governance action:

1. Governance proposal: "Distribute X USDC from treasury to token holders pro-rata" (or per attribution statement)
2. Vote passes → operator executes via Operator Port
3. Separate MerkleDistributor instance (or same contract, different token) for USDC claims
4. Financial ledger records: Dr Expense:Distributions:USDC / Cr Assets:Treasury:USDC

This keeps the attribution pipeline clean (it only produces equity allocations) while allowing the DAO to do cash distributions when treasury supports it.

#### R3. Template System

Four orthogonal policy profiles, bundled into curated templates:

```yaml
# repo-spec.yaml (Run phase)
tokenomics_template: "cogni.coop-merkle.v1"
```

Template resolves to:

| Profile                | Crawl (MVP Safe)         | Walk (Vault+Merkle) | Run (Coop)       |
| ---------------------- | ------------------------ | ------------------- | ---------------- |
| **AttributionProfile** | `cogni-v0.0`             | `cogni-v0.1`        | `cogni-v1.0`     |
| **BudgetPolicy**       | `flat-accrual.v0`        | `flat-accrual.v0`   | `halvening.v1`   |
| **SettlementPolicy**   | `off-chain-statement.v0` | `vault-merkle.v1`   | `coop-split.v1`  |
| **GovernancePolicy**   | `safe-multisig.v0`       | `safe-multisig.v0`  | `oz-governor.v1` |

Templates are versioned, immutable definitions shipped with Cogni. Operators pick one at node init. Changing templates requires governance vote (or new node).

**Template IDs** follow the same naming convention as pipeline profiles: `org.name.version`.

#### Edge Cases

| Edge Case               | Resolution                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `total_points = 0`      | Epoch pool accrues to bank. No statement produced. Already handled (empty allocations → empty statement lines).                                         |
| Unresolved claimants    | Already handled by `IdentityClaimant` type. Claimant key is stable (`identity:github:12345`). When identity resolves later, cumulative holdings update. |
| Address changes         | Wallet binding layer (existing `user_bindings`). Statement references `claimantKey`, not wallet address. Claim address resolved at settlement time.     |
| Forked scopes           | Each scope has its own BudgetBank. Fork = new scope = new vault. No cross-contamination.                                                                |
| Root rotation authority | Walk: operator multisig calls `setEpochRoot`. Run: TimelockController gates it.                                                                         |
| Unclaimed tokens        | `sweep(epochId)` after claim window → treasury. Swept amounts are NOT re-emitted.                                                                       |

## Migration Path

### From Current → Crawl

1. Existing finalized epochs: untouched. Their `pool_components` records are immutable.
2. New `budget_bank_ledger` table initialized with `remaining = vault_total`.
3. First epoch under new policy accrues normally.
4. `pool_config.base_issuance_credits` in repo-spec replaced by `budget_policy`.
5. UI: "Score" column removed. "Credits Earned" shown instead.

### From Crawl → Walk

1. Deploy ERC-20 equity token + EmissionsVault + ReusableMerkleDistributor.
2. `vault_total` in repo-spec gains a contract address.
3. Settlement workflow added (Temporal: `SettleEpochWorkflow`).
4. Off-chain `budget_bank_ledger` optionally mirrors on-chain vault balance.

### From Walk → Run

1. Halvening policy replaces flat accrual in repo-spec.
2. Template system replaces individual policy fields.
3. USDC distribution path added as governance-voted action (separate from equity emissions).

## Key Code Paths (New/Modified)

| Component                 | Location                                                 | Change                         |
| ------------------------- | -------------------------------------------------------- | ------------------------------ |
| Budget policy schema      | `packages/repo-spec/src/schema.ts`                       | New `budgetPolicySchema`       |
| Budget policy accessor    | `packages/repo-spec/src/accessors.ts`                    | New `getBudgetPolicy()`        |
| BudgetBank pure functions | `packages/attribution-ledger/src/budget-bank.ts`         | **New file**                   |
| Pool estimation           | `packages/attribution-ledger/src/pool.ts`                | Add `computeEpochBudget()`     |
| DB migration              | `scripts/migrations/`                                    | Add `budget_bank_ledger` table |
| Workflow integration      | `services/scheduler-worker/src/activities/ledger.ts`     | Read bank state, compute pool  |
| UI cleanup                | `src/features/governance/components/EpochDetail.tsx`     | Remove Score column            |
| UI cleanup                | `src/features/governance/components/ContributionRow.tsx` | Remove score display           |

## OSS Building Blocks

| Need                | OSS                                                  | Status                           |
| ------------------- | ---------------------------------------------------- | -------------------------------- |
| ERC-20 token        | OpenZeppelin ERC20                                   | Walk                             |
| Merkle claims       | Uniswap MerkleDistributor (extended for multi-epoch) | Walk                             |
| Governance          | OpenZeppelin Governor + TimelockController           | Run                              |
| Streaming (alt)     | Sablier Lockup / Superfluid                          | Run (optional)                   |
| Double-entry ledger | Beancount                                            | Walk (via proj.financial-ledger) |

## What Does NOT Change

- Epoch lifecycle (open → review → finalized)
- Weight config per event type
- Allocation algorithms (weight-sum-v0, future versions)
- EIP-712 signing flow
- Plugin system (enrichers, allocators)
- Claimant model (user vs identity)
- All 79 attribution-ledger invariants
- BIGINT math, largest-remainder rounding
- Determinism guarantees
