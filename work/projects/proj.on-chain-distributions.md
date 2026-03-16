---
id: proj.on-chain-distributions
type: project
primary_charter:
title: "On-Chain Distributions — Entitlement Accrual + Token Claim Rail"
state: Active
priority: 1
estimate: 5
summary: "Governance token claim rail. Attribution credits accrue automatically via proj.transparent-credit-payouts. This project makes those entitlements claimable as on-chain GovernanceERC20 tokens. The app balance (signed statements) is truth; the chain is the delivery rail. Periodic system publication creates Merkle roots; users claim when ready."
outcome: "Contributors see accumulated governance token entitlements in-app. Linked-wallet users can claim tokens on-chain at any time. Unlinked users accumulate entitlements until they link a wallet. Every claim is traceable to a signed attribution statement."
assignees: derekg1729
created: 2026-03-16
updated: 2026-03-16
labels: [governance, web3, settlement, attribution]
---

# On-Chain Distributions — Entitlement Accrual + Token Claim Rail

## Goal

Make attribution credits claimable as real on-chain governance tokens. The attribution pipeline already answers "who earned what" — this project answers "how do those credits become tokens in a wallet?"

The model: **automatic accrual, periodic publication, user-initiated claims.**

1. **Accrual** (already works): Attribution pipeline finalizes epochs → signed statements with `creditAmount` per claimant. `composeHoldings()` aggregates across epochs. Users see their balance in-app.
2. **Publication** (this project): System periodically publishes Merkle roots from accumulated entitlements. This is a mechanical step, not a governance checkpoint — the attribution statement is the reviewed artifact.
3. **Claim** (this project): Users with linked wallets claim tokens on-chain whenever they choose. Unlinked users accumulate entitlements until they link.

### Relationship to Adjacent Projects

| Project                         | Owns                                                                  | This project consumes/produces                                                               |
| ------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| proj.transparent-credit-payouts | Attribution pipeline: activity → signed statement with `creditAmount` | Consumes: finalized statements. These are the entitlement authority.                         |
| proj.financial-ledger           | TigerBeetle double-entry accounting                                   | Produces: financial events (distributor funding, token claims) that financial-ledger records |
| proj.node-formation-ui          | DAO formation wizard + GovernanceERC20                                | Depends on: rewards-ready token formation (task.0135)                                        |

### What Already Exists (Not New Work)

- `AttributionStatement` with `creditAmount` per claimant (signed, deterministic)
- `composeHoldings()` — aggregates entitlements across epochs into cumulative ownership view
- `readOwnershipSummary()` — per-user view of finalized + pending units
- `user_bindings` — identity resolution: `(provider, external_id) → user_id`
- `users.wallet_address` — wallet from SIWE auth
- TigerBeetle COGNI ledger (ID 100) with `Assets:EmissionsVault:COGNI`, `Liability:UnclaimedEquity:COGNI` accounts (defined in financial-ledger spec, being wired in task.0145)

## Roadmap

### Crawl (P0) — Ownership Model + Settlement Artifacts

**Goal:** Define how credits become tokens (`ownership_model` in repo-spec). Build the pure functions that produce Merkle trees from entitlements. Persist settlement manifests as audit trail. No on-chain dependencies — artifacts only.

| Deliverable                                                                                                                                    | Status      | Est | Work Item         |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | ----------------- |
| `ownership_model` section in repo-spec schema + YAML — V0 template: `attribution-1to1-v0` (1 credit = 1 token, no configurable weights)        | Not Started | 1   | (create at start) |
| Resolve token decimal convention: `tokenAmount = creditAmount × 10^tokenDecimals` (standard ERC-20 scaling)                                    | Not Started | 0.5 | (create at start) |
| `packages/settlement/` package scaffolding — pure package, no Next.js/Drizzle deps                                                             | Not Started | 0.5 | (create at start) |
| `computeStatementHash()` — canonical hash of full AttributionStatement (add to `@cogni/attribution-ledger/hashing`)                            | Not Started | 0.5 | (create at start) |
| `resolveRecipients(statementLines, walletLookup, policy)` pure function — claimantKey → wallet, partitions into claimable vs not-yet-claimable | Not Started | 1.5 | (create at start) |
| `computeMerkleTree(entitlements)` pure function — Uniswap-compatible leaf encoding, sorted-pair tree, proofs                                   | Not Started | 2   | (create at start) |
| `computeSettlementId()` — deterministic canonical ID for each publication                                                                      | Not Started | 0.5 | (create at start) |
| Merkle encoding compatibility tests — verify leaves against Uniswap MerkleDistributor Solidity verify logic                                    | Not Started | 1   | (create at start) |
| `settlement_manifests` DB table + Drizzle adapter — audit trail for publications                                                               | Not Started | 1.5 | (create at start) |
| Settlement spec: invariants, schema, encoding, ownership model templates                                                                       | Not Started | 2   | (create at start) |

### Walk (P1) — First Live Token Claims

**Goal:** Tokens actually move. Rewards-ready formation creates token supply. System periodically publishes roots. Users claim from the app.

| Deliverable                                                                                                                                                                                               | Status      | Est | Work Item            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Governance decisions + rewards-ready token formation: fixed GovernanceERC20 supply → DAO-controlled emissions holder                                                                                      | Not Started | 2   | task.0135            |
| Publication workflow: `PublishSettlementWorkflow` — Temporal cron reads accumulated entitlements across finalized epochs, resolves wallets, computes tree, persists manifest, signals "ready for funding" | Not Started | 2   | (create at P1 start) |
| Stock per-epoch Uniswap MerkleDistributor ABI + deployment helpers                                                                                                                                        | Not Started | 2   | (create at P1 start) |
| Fund distributor: Operator Port / Safe deploys distributor + transfers tokens from emissions holder                                                                                                       | Not Started | 2   | (create at P1 start) |
| Claim UI: user sees accumulated entitlement in-app, clicks "Claim tokens", submits Merkle proof tx                                                                                                        | Not Started | 2   | (create at P1 start) |
| Not-yet-claimable view: unlinked users see "link a wallet to claim X tokens"                                                                                                                              | Not Started | 1   | (create at P1 start) |
| Epoch sweep: unclaimed tokens return to emissions holder after claim window                                                                                                                               | Not Started | 1   | (create at P1 start) |
| Financial ledger integration: funding + claim events → TigerBeetle transfers                                                                                                                              | Not Started | 2   | (create at P1 start) |

### Run (P2+) — On-Chain Enforcement + Governance Model Templates

**Goal:** On-chain guards. Additional ownership model templates for different node types.

| Deliverable                                                                                                  | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| On-chain `EmissionsController`: `require(!consumed[settlementId])` — hard idempotency                        | Not Started | 3   | (create at P2 start) |
| CREATE2 deterministic distributor addresses using `settlement_id` as salt                                    | Not Started | 1   | (create at P2 start) |
| Ownership model template: `weighted-council-v0` — configurable category weights for multi-source attribution | Not Started | 2   | (create at P2 start) |
| Ownership model template: `vesting-v0` — token vesting schedule per epoch claim                              | Not Started | 2   | (create at P2 start) |
| Multi-instrument settlement: governance tokens + USDC splits per policy                                      | Not Started | 3   | (create at P2 start) |
| Sablier/Superfluid streaming as alternative claim backend                                                    | Not Started | 2   | (create at P2 start) |
| Git-canonical `bundle.v1.json`: statement + settlement + hash chain                                          | Not Started | 3   | (create at P2 start) |

## Constraints

- Signed attribution statements are the entitlement authority — settlement is a derived downstream process, not a second governance checkpoint
- `composeHoldings()` is a read-model/projection — the statements are truth, holdings is a cache
- Publication is a mechanical system action (Temporal cron), not a human review step
- On-chain distribution is a delivery rail, not the source of truth for ownership
- No custom Solidity contracts in Crawl or Walk — stock Uniswap MerkleDistributor only
- Leaf encoding must match the target distributor: Uniswap uses `keccak256(abi.encodePacked(index, account, amount))`, NOT OpenZeppelin `StandardMerkleTree` double-hash
- Walk-phase idempotency is operational (finite supply + Safe review + deterministic recomputation), not cryptographic single-execution
- Unlinked users accumulate entitlements — they see their balance in-app but cannot claim until they link a wallet. No special suspense accounting needed; the attribution ledger already tracks identity claimants.
- `ownership_model` in repo-spec defines the credit→token mapping template. V0 has exactly one template: `attribution-1to1-v0`
- All monetary math uses BIGINT — no floating point
- Operator Port required for funding — never raw private keys
- `packages/settlement/` is a pure package — no Next.js, no Drizzle, testable in isolation

## Dependencies

- [ ] proj.transparent-credit-payouts P0 — finalized signed attribution statements exist
- [ ] task.0135 — rewards-ready token formation (Walk blocker, not Crawl blocker)
- [ ] task.0130 — tokenomics budget policy (Walk blocker — informs total supply)
- [ ] task.0145 — TigerBeetle ledger (Walk: financial event recording)
- [ ] Operator Port operational (Walk: funding flow)

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### Why automatic accrual + user-initiated claims

Auto-distributing every epoch is the wrong default:

- Unlinked users exist — can't push tokens to wallets that don't exist
- Small balances exist — gas costs can exceed token value
- Bad wallet data exists — auto-push is irreversible
- Governance tokens grant on-chain voting power — delayed claim means delayed governance participation, but this is acceptable in MVP with off-chain/trusted governance semantics

The correct model: entitlements accrue automatically in the attribution ledger. System periodically publishes Merkle roots. Users withdraw when they're ready.

### Publication cadence

Publication is NOT "on-demand when a user wants to claim." It's periodic system action:

- Temporal cron (e.g., weekly after epoch finalization, or monthly)
- Publishes a root covering all claimable entitlements for linked-wallet users
- Unlinked users' entitlements are excluded from the tree (they have no wallet to claim to)
- When a user links a wallet, their entitlements become claimable in the NEXT publication

A user cannot claim from thin air — publication creates the on-chain claim program. But publication requires no human approval beyond the attribution finalization that already happened.

### Ownership model templates (repo-spec)

```yaml
ownership_model:
  template: attribution-1to1-v0 # V0: only option
  token_decimals: 18 # GovernanceERC20 standard
  claim_window_days: 90 # unclaimed tokens swept after this
  # Future templates add fields here:
  # template: weighted-council-v0
  #   category_weights: { code: 60, review: 25, community: 15 }
  # template: vesting-v0
  #   vesting_months: 12
  #   cliff_months: 3
```

V0: `attribution-1to1-v0` means `tokenAmount = creditAmount × 10^tokenDecimals`. No configurable weights, no vesting, no multi-instrument. One template, one behavior.

Future templates are new implementations behind the same repo-spec surface — not config strings pretending to be features.

### Why per-epoch distributors

Each publication gets its own MerkleDistributor instance:

- No state management across epochs
- Each distributor maps 1:1 to a settlement manifest and signed statement
- Clean sweep lifecycle (unclaimed → back to emissions holder)
- Different node templates can swap distributor patterns without migration

### Supersedes

**proj.dao-dividends** (Dropped) — Splits-based push distribution replaced by user-initiated Merkle claims.

Settlement deliverables previously in **proj.financial-ledger** Crawl/Walk moved here.

## PR / Links

- (none yet)
