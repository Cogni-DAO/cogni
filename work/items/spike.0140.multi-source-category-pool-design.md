---
id: spike.0140
type: spike
title: "Multi-source category pool design — pool splitting, cross-category governance, and on-chain budget interaction"
status: needs_research
priority: 1
rank: 15
estimate: 3
summary: "Design how the epoch budget splits across source categories (engineering, community, ops) before per-source allocation runs. Covers repo-spec schema, governance voting on category shares, cross-category receipts, interaction with budget policy (task.0130), credit:token ratio (task.0135), and quarterly retro (spike.0119)."
outcome: "A research document with: (1) repo-spec schema for category pool shares, (2) allocation flow showing category split before per-source scoring, (3) interaction model with budget policy and on-chain settlement, (4) worked example with 2+ sources. Ready for spec and implementation."
spec_refs: tokenomics-spec, attribution-pipeline-overview-spec, financial-ledger-spec
assignees: derekg1729
credit:
project: proj.transparent-credit-payouts
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-07
updated: 2026-03-07
labels: [governance, tokenomics, attribution, multi-source]
external_refs:
---

# Multi-Source Category Pool Design

> Prerequisite research for multi-source attribution. Blocks task.0105 (allocation algo expansion) and task.0141/task.0142.

## Problem

The current pipeline dumps all receipts from all sources into one flat pool with one weight config. Weights serve double duty: ranking work within a domain AND allocating across domains. These are fundamentally different governance decisions being smashed into one number.

When source #2 ships (Discord, X/Twitter, funding adapter), the flat pool breaks:

1. **Adding a source dilutes everyone else.** 50 Discord events at weight 300 compete against GitHub's pool. Engineers' share drops not because their work changed, but because a new adapter was plugged in.
2. **Cross-domain weight ratios are ungovernable.** "How many Discord messages equal one merged PR?" is unanswerable. Governance can't reason about `discord:message_sent: 50` vs `github:pr_merged: 1000`.
3. **Volume variance between sources.** GitHub might produce 20 receipts/week, Discord 200. Even with lower per-event weights, Discord dominates by volume.

## Research Questions

### 1. Category pool schema in repo-spec

How should category shares be declared?

```yaml
# Option A: percentage-based
budget_policy:
  budget_total: "520000"
  accrual_per_epoch: "10000"
  category_pools:
    engineering: 60    # percent of epoch pool
    community: 25
    operations: 15

# Option B: fixed amounts
budget_policy:
  budget_total: "520000"
  accrual_per_epoch: "10000"
  category_pools:
    engineering: "6000"  # credits per epoch
    community: "2500"
    operations: "1500"

# Option C: source → category mapping + shares
budget_policy:
  categories:
    engineering:
      share_pct: 60
      sources: [github]
    community:
      share_pct: 25
      sources: [discord, twitter]
    operations:
      share_pct: 15
      sources: [ops_events]
```

Questions:

- Percentages or fixed amounts? Percentages are governance-friendly but require rounding. Fixed amounts are simpler but must sum to `accrual_per_epoch`.
- Is source → category a 1:1 mapping, or can one source feed multiple categories?
- How are category shares governed? repo-spec change = PR review, or on-chain vote?

### 2. Allocation flow with category split

Current flow:

```
epoch_pool → all receipts → weight-sum-v0 → proportional credits
```

Proposed flow:

```
epoch_pool → category split → per-category receipts → per-category weight-sum → per-category credits → sum per claimant
```

Questions:

- Does the category split happen before or after enrichment?
- Does each category have its own weight config, or one global config with source-prefixed keys?
- How are receipts assigned to categories? By source? By event type? By explicit tagging?
- What happens to cross-category receipts (a GitHub PR that's also an ops task)?

### 3. Interaction with budget policy (task.0130)

The budget policy computes `epoch_pool = min(accrual_per_epoch, remaining)`. With categories:

- Is `remaining` tracked per-category or globally?
- If one category has zero activity, does its share go unspent (wasted) or redistribute?
- Does the budget_bank_ledger need per-category entries?

### 4. Interaction with on-chain settlement (task.0135)

The credit:token ratio and emissions holder design affect category pools:

- If 1 credit = 1 token, category shares directly determine token distribution ratios.
- If credits are just proportional shares, the category split is purely an accounting concern.
- Does the MerkleDistributor need to know about categories, or just final per-claimant totals?

### 5. Interaction with quarterly retro (spike.0119)

- Does the quarterly retro pool also split by category?
- Or is quarterly retro the mechanism for correcting the category split itself? ("Engineering got 60% but community drove more value this quarter.")
- If cross-category, quarterly retro becomes the only place where cross-domain value comparison happens — is that the right design?

### 6. Per-event value stabilization

Fixed pool + variable activity = random per-event value. With categories this is amplified:

- A quiet engineering week with 1 PR gives one engineer the full 60% category pool.
- Should categories have minimum activity thresholds?
- Should unspent category budget carry over within the category?
- Does the carry-over decision in task.0130 need to be category-aware?

### 7. Interaction with work-item budgets (task.0114)

task.0114 introduces per-work-item fixed budgets. With category pools:

- Does `SUM(work_item_budgets)` have to equal the category pool?
- What happens when it exceeds or falls short of the category pool?
- Are work items assigned to categories, or are they orthogonal?

## Prior Art

- [tokenomics spec](../../docs/spec/tokenomics.md) — budget policy, single-pool model
- [attribution-pipeline-overview](../../docs/spec/attribution-pipeline-overview.md) — current single-source flow
- [task.0105](task.0105.allocation-algo-expansion.md) — multi-source algo expansion (needs this spike)
- [task.0114](task.0114.work-item-budget-allocation.md) — work-item budget allocation
- [task.0130](task.0130.tokenomics-crawl-budget-bank.md) — budget policy implementation
- [task.0135](task.0135.rewards-ready-token-formation.md) — token formation + credit:token ratio
- [spike.0119](spike.0119.quarterly-retro-attribution-review.md) — quarterly retro design

## Validation

Research spike is complete when:

- [ ] Category pool schema defined for repo-spec (with worked example config)
- [ ] Allocation flow documented showing category split → per-category scoring → claimant summation
- [ ] Interaction with budget policy, on-chain settlement, quarterly retro, and work-item budgets addressed
- [ ] Per-event value stabilization strategy chosen (threshold, carry-over, or accept variance)
- [ ] Cross-category receipt handling specified
- [ ] Worked example with 2+ sources showing full flow from repo-spec to signed statement
- [ ] Document written in `docs/research/` and linked from project roadmap
