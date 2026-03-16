---
id: proj.on-chain-distributions
type: project
primary_charter:
title: "On-Chain Distributions — Signed Statements to Claimable Token Distributions"
state: Active
priority: 1
estimate: 5
summary: "Settlement layer that takes signed attribution statements from proj.transparent-credit-payouts and produces claimable on-chain token distributions. Owns: recipient resolution, Merkle tree generation, settlement manifests, distributor deployment/funding, claim UI. V0 uses stock Uniswap MerkleDistributor with Aragon GovernanceERC20. proj.financial-ledger records the money-movement accounting for these events."
outcome: "Contributors can claim governance tokens on-chain from auditable, deterministic settlement artifacts derived from signed attribution statements. Every distribution is traceable: signed statement → settlement manifest → funded distributor → claimed tokens."
assignees: derekg1729
created: 2026-03-16
updated: 2026-03-16
labels: [governance, web3, settlement, attribution]
---

# On-Chain Distributions — Signed Statements to Claimable Token Distributions

## Goal

Turn signed attribution statements into claimable on-chain token distributions. The attribution pipeline (proj.transparent-credit-payouts) produces the governance truth — who earned what. This project produces the settlement truth — how those entitlements become real tokens in real wallets.

The pipeline: `signed statement → recipient resolution → Merkle tree → settlement manifest → funded distributor → user claim`. Every step is deterministic and auditable. V0 uses boring, stock primitives: Uniswap MerkleDistributor + Aragon GovernanceERC20.

### Relationship to Adjacent Projects

| Project                         | Owns                                                       | This project consumes/produces                                                                                  |
| ------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| proj.transparent-credit-payouts | Attribution pipeline: activity → signed statement          | Consumes: finalized `AttributionStatement` with `creditAmount` per claimant                                     |
| proj.financial-ledger           | TigerBeetle double-entry accounting for all money movement | Produces: financial events (epoch accrual, distributor funding, claim settlement) that financial-ledger records |
| proj.node-formation-ui          | DAO formation wizard + GovernanceERC20 deployment          | Depends on: rewards-ready token formation (task.0135)                                                           |

### Scope Moved Here from proj.financial-ledger

The following deliverables previously listed in proj.financial-ledger Crawl/Walk now live here: `computeMerkleTree`, settlement manifest store, recipient resolution, distributor deployment, claim UI, holdings view, SettleEpochWorkflow. proj.financial-ledger retains TigerBeetle accounting, USDC inbound receipts, and treasury read APIs.

## Roadmap

### Crawl (P0) — Settlement Artifacts + Pure Functions

**Goal:** Produce auditable settlement artifacts from finalized statements. All pure functions, fully tested, zero on-chain dependencies. Human can review a manifest and verify it matches the signed statement before any tokens move.

| Deliverable                                                                                                                             | Status      | Est | Work Item         |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | ----------------- |
| Governance decisions: total supply, emissions holder type, existing DAO reuse                                                           | Not Started | 1   | task.0135         |
| Rewards-ready token formation: mint fixed GovernanceERC20 supply to DAO-controlled emissions holder                                     | Not Started | 2   | task.0135         |
| `packages/settlement` — `resolveRecipients()` pure function: claimantKey → wallet via user_bindings, with suspense for unresolved       | Not Started | 2   | (create at start) |
| `packages/settlement` — `computeMerkleTree()` pure function: Uniswap-compatible leaf encoding                                           | Not Started | 2   | (create at start) |
| Merkle encoding compatibility test: verify tree output against Uniswap MerkleDistributor Solidity verify logic                          | Not Started | 1   | (create at start) |
| `settlement_manifests` DB table + Drizzle adapter: one manifest per (node, scope, epoch) with deterministic `settlement_id`             | Not Started | 2   | (create at start) |
| Settlement policy in repo-spec.yaml: `instrument`, `credit_token_ratio`, `claim_window_days`, `distributor_type`                        | Not Started | 1   | (create at start) |
| `SettleEpochWorkflow` — Temporal: reads finalized statement → resolves → computes tree → publishes manifest (artifact-only, no funding) | Not Started | 2   | (create at start) |
| Settlement spec: invariants, schema, leaf encoding, idempotency model, threat model                                                     | Not Started | 2   | (create at start) |

### Walk (P1) — First Live Token Claims

**Goal:** Ship the first real on-chain claim rail. Stock Uniswap MerkleDistributor. Safe-reviewed funding. Contributors claim governance tokens from a web UI. Explicitly not hard-idempotent — Walk relies on finite supply + Safe signer review + deterministic recomputation.

| Deliverable                                                                                                                        | Status      | Est | Work Item            |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Stock per-epoch Uniswap MerkleDistributor ABI + deployment helpers in `packages/settlement`                                        | Not Started | 2   | (create at P1 start) |
| Operator Port integration: Safe/manual publish + fund flow with manifest review                                                    | Not Started | 2   | (create at P1 start) |
| Fund distributor: deploy MerkleDistributor(token, root), transfer tokens from emissions holder, record funding_tx_hash on manifest | Not Started | 2   | (create at P1 start) |
| Claim UI: contributor connects wallet, sees unclaimed epochs with proof data, submits Merkle claim tx                              | Not Started | 2   | (create at P1 start) |
| Holdings view: token balance, claim history, claimed/unclaimed epoch status                                                        | Not Started | 2   | (create at P1 start) |
| Suspense follow-up settlement: when previously-unresolved identities resolve, produce follow-up manifest for suspended amounts     | Not Started | 2   | (create at P1 start) |
| Reconciliation script: recompute manifests from signed statements, cross-reference on-chain transfers from emissions holder        | Not Started | 1   | (create at P1 start) |
| Epoch sweep: unclaimed tokens return to emissions holder after claim window expires                                                | Not Started | 1   | (create at P1 start) |
| Financial ledger integration: settlement funding + claim events → TigerBeetle transfers via proj.financial-ledger                  | Not Started | 2   | (create at P1 start) |

### Run (P2+) — On-Chain Enforcement + Multi-Instrument

**Goal:** Harden release integrity with on-chain guards. Add multi-instrument settlement after live usage proves the shape.

| Deliverable                                                                                                  | Status      | Est | Work Item            |
| ------------------------------------------------------------------------------------------------------------ | ----------- | --- | -------------------- |
| On-chain `EmissionsController`: `require(!consumed[settlementId])` + release caps + epoch timing enforcement | Not Started | 3   | (create at P2 start) |
| CREATE2 deterministic distributor addresses using `settlement_id` as salt                                    | Not Started | 1   | (create at P2 start) |
| Statement/root binding on-chain: published roots cryptographically tied to `statementHash`                   | Not Started | 2   | (create at P2 start) |
| Governor/Timelock-native authorization for publish/fund actions                                              | Not Started | 2   | (create at P2 start) |
| Multi-instrument `computeSettlement()`: governance tokens + USDC + vesting streams per settlement policy     | Not Started | 3   | (create at P2 start) |
| Sablier/Superfluid streaming as alternative distributor backend                                              | Not Started | 2   | (create at P2 start) |
| Governance-voted USDC distribution path (proposal → vote → execute)                                          | Not Started | 2   | (create at P2 start) |
| Git-canonical `bundle.v1.json`: statement + settlement + hash chain (`prev_bundle_hash`)                     | Not Started | 3   | (create at P2 start) |
| Federation `upstreams[]`: fork-inheritable credit with portable identity mapping                             | Not Started | 2   | (create at P2 start) |

## Constraints

- Settlement consumes finalized `AttributionStatement` as input — does not redefine attribution semantics
- A signed attribution statement is a governance commitment, not a financial event — financial events occur only when tokens move on-chain
- No custom Solidity contracts in Crawl or Walk — stock Uniswap MerkleDistributor only
- Leaf encoding must match the target distributor contract exactly — Uniswap uses `keccak256(abi.encodePacked(index, account, amount))`, NOT OpenZeppelin's `StandardMerkleTree` double-hash format
- Walk-phase idempotency is operational (finite supply + Safe review + reconciliation), not cryptographic single-execution — docs must be honest about this
- Unresolved claimants do not stall the epoch — resolved claimants settle, suspended amounts stay in emissions holder for follow-up settlement
- Settlement policy is governance-controlled, stored in repo-spec (same pattern as `ledger.approvers`)
- The settlement token is the Aragon `GovernanceERC20` created at node formation — must be ERC20Votes-compatible; token semantics are foundational
- All monetary math uses BIGINT — no floating point
- Operator Port required for treasury signing — never raw private keys
- `settlement_id = hash(statement_hash, node_id, scope_id, chain_id, token, policy_hash, program_type)` — deterministic identity for every settlement artifact; off-chain key in Walk, on-chain key in Run
- One primary settlement per (node, scope, epoch); follow-up settlements for suspended amounts are separate manifests with distinct `settlement_id`
- `packages/settlement` is a pure package — no Next.js deps, no DB adapters, testable in isolation

## Dependencies

- [ ] task.0135 — rewards-ready token formation (total supply, emissions holder, GovernanceERC20 setup) — blocks everything
- [ ] task.0130 — tokenomics Crawl (budget policy) — informs credit:token ratio
- [ ] task.0145 — TigerBeetle ledger + FinancialLedgerPort (Walk: financial event recording)
- [ ] proj.transparent-credit-payouts P0 — finalized signed attribution statements exist
- [ ] Operator Port operational (Walk: funding flow)
- [ ] Stock Uniswap MerkleDistributor deployed on Base (Walk)

## As-Built Specs

- (none yet — specs created when code merges)

## Design Notes

### Why per-epoch distributors, not a persistent multi-epoch contract

Each epoch gets its own MerkleDistributor instance:

- **Simplicity**: No state management across epochs. Each distributor is standalone.
- **Auditability**: Each distributor maps 1:1 to a settlement manifest and signed statement.
- **Sweep**: After claim window, unclaimed tokens return to emissions holder.
- **Template-friendly**: Different node templates can swap distributor patterns without migration.

Alternative considered: Morpho Universal Rewards Distributor (cumulative, single contract, updatable roots). Deferred to Run — adds operational complexity (root updaters, timelocks, cumulative accounting) without value at <10 epochs/year.

### Extensibility lives at the port boundary, not config strings

| What varies                 | Where it plugs in                                            | V0 default                |
| --------------------------- | ------------------------------------------------------------ | ------------------------- |
| Credit:token ratio          | `SettlementPolicy.creditTokenRatio` in `resolveRecipients()` | 1:1                       |
| Distribution mechanism      | `fundDistributor()` port implementation                      | Uniswap MerkleDistributor |
| Token release authorization | Operator Port implementation                                 | Safe/manual               |

A node that wants streaming vesting swaps `fundDistributor()` for a Sablier implementation. A node with no on-chain settlement stops at manifest (step 3). The boundary is the port, not a config enum.

### Idempotency model — honest about Walk vs Run

| Phase | What prevents duplicate distribution?                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crawl | N/A — artifacts only, no tokens move                                                                                                                                                         |
| Walk  | `epoch_id UNIQUE` in DB + finite emissions holder balance + Safe signer review + deterministic recomputation from signed statements. Operational safety, not cryptographic single-execution. |
| Run   | `EmissionsController.require(!consumed[settlementId])` on-chain. Hard idempotency.                                                                                                           |

Walk gap: if DB wiped AND Safe signers approve a duplicate, tokens move twice. Blast radius is bounded (emissions holder depletes), failure is visible, recovery is straightforward. Acceptable for <10 signers and <50 epochs.

### Suspense model for unresolved claimants

1. Resolved claimants → Merkle tree → funded distributor (primary manifest)
2. Suspended claimants → recorded in manifest as `suspended_amount` / `suspended_count`
3. Suspended tokens stay in emissions holder (not transferred)
4. When identity resolves → follow-up manifest references same epoch with distinct `settlement_id`
5. Follow-up manifests have their own `settlement_sequence` number

### Supersedes

**proj.dao-dividends** (Dropped) — Splits-based push distribution replaced by MerkleDistributor claims.

Settlement deliverables previously in **proj.financial-ledger** Crawl/Walk moved here.

## PR / Links

- (none yet)
