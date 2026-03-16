---
id: on-chain-settlement
type: spec
title: "On-Chain Settlement: Entitlement Accrual + Merkle Claim Rail"
status: draft
spec_state: draft
trust: draft
summary: "Settlement pipeline: signed attribution statements accrue governance token entitlements automatically. System periodically publishes Merkle roots. Users claim tokens on-chain when ready. The app balance is truth; the chain is the delivery rail. V0 ownership model: attribution-1to1-v0 (1 credit = 1 token at 18 decimals)."
read_when: Working on settlement artifacts, Merkle tree generation, recipient resolution, settlement manifests, ownership model templates, claim UI, or any code that turns attribution credits into on-chain tokens.
implements: proj.on-chain-distributions
owner: derekg1729
created: 2026-03-16
verified:
tags: [governance, web3, settlement, merkle]
---

# On-Chain Settlement: Entitlement Accrual + Merkle Claim Rail

> Signed attribution statements automatically accrue governance token entitlements. The system periodically publishes Merkle roots from accumulated entitlements. Users claim tokens on-chain when ready. The attribution ledger is the source of truth; the chain is the delivery rail.

### Key References

|              |                                                                                   |                                               |
| ------------ | --------------------------------------------------------------------------------- | --------------------------------------------- |
| **Project**  | [proj.on-chain-distributions](../../work/projects/proj.on-chain-distributions.md) | Roadmap, phases, deliverables                 |
| **Spec**     | [Attribution Ledger](./attribution-ledger.md)                                     | Upstream: statement schema, claimant types    |
| **Spec**     | [Financial Ledger](./financial-ledger.md)                                         | Downstream: accounting events from settlement |
| **Spec**     | [Tokenomics](./tokenomics.md)                                                     | Budget policy, credit:token handoff           |
| **Spec**     | [Node Formation](./node-formation.md)                                             | GovernanceERC20 deployment                    |
| **External** | [Uniswap MerkleDistributor](https://github.com/Uniswap/merkle-distributor)        | On-chain claim contract (stock, unmodified)   |

## Design

### Conceptual Model

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  ENTITLEMENT AUTHORITY (already exists)                         │
 │                                                                 │
 │  AttributionStatement (EIP-712 signed, per epoch)               │
 │    → claimantKey, creditAmount per contributor                  │
 │                                                                 │
 │  composeHoldings() aggregates across epochs                     │
 │    → cumulative ownership view (read model)                     │
 │                                                                 │
 │  Source of truth: signed statements                             │
 │  NOT composeHoldings (that's a projection)                      │
 │  NOT the chain (that's the delivery rail)                       │
 └─────────────────────────────┬───────────────────────────────────┘
                               │
           ┌───────────────────┴───────────────────┐
           │                                       │
     Linked wallet                          No wallet linked
     (user_bindings + users.walletAddress)  (identity claimant)
           │                                       │
           ▼                                       ▼
 ┌─────────────────────┐               ┌─────────────────────────┐
 │  CLAIMABLE           │               │  ACCRUING                │
 │                      │               │                          │
 │  Included in next    │               │  Entitlement visible     │
 │  Merkle publication  │               │  in-app. Not in tree.    │
 │                      │               │  "Link wallet to claim"  │
 │  User claims when    │               │                          │
 │  ready via tx.       │               │  When wallet linked →    │
 │                      │               │  claimable in next       │
 └─────────────────────┘               │  publication cycle.      │
                                        └─────────────────────────┘
```

### Publication Pipeline

```
 PublishSettlementWorkflow (Temporal cron — periodic, e.g. weekly)
 │
 ├── activity: loadFinalizedStatements(nodeId, scopeId)
 │   → all finalized AttributionStatements not yet fully settled
 │
 ├── activity: loadWalletLookup(claimantKeys)
 │   → Map<claimantKey, walletAddress> from users + user_bindings
 │   → Pre-loaded from DB, passed as plain data to pure functions
 │
 ├── activity: resolveRecipients(statementLines, walletLookup, policy)
 │   → claimable: { index, claimantKey, wallet, tokenAmount }[]
 │   → notYetClaimable: { claimantKey, creditAmount }[]
 │   │
 │   │  tokenAmount = creditAmount × 10^policy.tokenDecimals
 │   │  (V0 attribution-1to1-v0: 1 credit = 1 token)
 │   │
 │   │  notYetClaimable = claimants with no wallet binding
 │   │  NOT dropped, NOT "suspended" — just not in this tree.
 │   │  Included in next publication when wallet is linked.
 │
 ├── activity: computeAndPersistManifest(claimable, notYetClaimable, ...)
 │   │
 │   ├── computeMerkleTree(claimable)
 │   │   │
 │   │   │  leaf[i] = keccak256(encodePacked(
 │   │   │    uint256(index), address(wallet), uint256(amount)
 │   │   │  ))
 │   │   │
 │   │   │  ⚠ UNISWAP ENCODING — NOT OZ StandardMerkleTree
 │   │   │
 │   │   └── → { root, totalAmount, leaves[] with proofs }
 │   │
 │   ├── computeSettlementId(...)
 │   │   → deterministic canonical ID
 │   │
 │   └── INSERT settlement_manifests (status='published')
 │       → proofs stored as JSONB for claim UI
 │
 └── (workflow completes — funding is a separate Operator Port action)


 Fund Distributor (Operator Port / Safe — after publication)
 │
 ├── Deploy MerkleDistributor(token, root)
 ├── token.transfer(emissionsHolder → distributor, totalAmount)
 └── Update manifest: status='funded', funding_tx_hash, distributor_address


 User Claim (user-initiated on-chain tx)
 │
 ├── User sees entitlement in app → clicks "Claim tokens"
 ├── App provides proof from manifest proofs_json
 ├── distributor.claim(index, account, amount, proof)
 └── Tokens transfer to user wallet
```

### Recipient Resolution

Resolution uses existing identity infrastructure — no new tables:

```
claimant.kind == "user"
  → users.wallet_address (from SIWE auth)
  → fallback: user_bindings WHERE provider='wallet' AND user_id=claimant.userId

claimant.kind == "identity"
  → user_bindings WHERE provider=claimant.provider AND external_id=claimant.externalId
  → resolved userId → users.wallet_address
  → if no binding or no wallet → not-yet-claimable (accrues, included in next publication when linked)
```

The `resolveRecipients()` function takes a pre-loaded wallet lookup (plain `Map<claimantKey, Address>`), not a DB connection. The Temporal activity loads the lookup; the pure function consumes it.

### Leaf Encoding — Uniswap Compatibility

The Uniswap `MerkleDistributor` contract verifies claims with:

```solidity
// From Uniswap MerkleDistributor.sol
bytes32 node = keccak256(abi.encodePacked(index, account, amount));
require(MerkleProof.verify(merkleProof, merkleRoot, node), "Invalid proof.");
```

The off-chain tree generator MUST produce leaves in exactly this format:

```typescript
// packages/settlement/src/merkle.ts
import { keccak256, encodePacked } from "viem";

function computeLeaf(index: bigint, wallet: Address, amount: bigint): Hex {
  return keccak256(
    encodePacked(["uint256", "address", "uint256"], [index, wallet, amount])
  );
}
```

**Do NOT use `@openzeppelin/merkle-tree`** (`StandardMerkleTree`). OZ uses `keccak256(keccak256(abi.encode(...)))` — double-hash, ABI-encoded, no index. Incompatible with Uniswap's contract. A tree generated with OZ's library will produce proofs that the distributor rejects.

Tree construction: sorted-pair hashing (same as Uniswap/OZ `MerkleProof.verify()`):

```typescript
function hashPair(a: Hex, b: Hex): Hex {
  return a < b ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}
```

### Ownership Model Templates (repo-spec)

```yaml
# .cogni/repo-spec.yaml
ownership_model:
  template: attribution-1to1-v0 # V0: only option, not configurable
  token_decimals: 18 # GovernanceERC20 standard
  claim_window_days: 90 # unclaimed tokens swept after this
```

**V0 template: `attribution-1to1-v0`**

- 1 attribution credit = 1 governance token (at `10^tokenDecimals` smallest units)
- No category weights, no vesting, no multi-instrument
- Token is the Aragon `GovernanceERC20` from node formation
- Settlement token address comes from `cogni_dao.token_contract` in repo-spec (added by task.0135)

Future templates (Run phase) are new implementations, not config switches:

| Template              | Behavior                                                                            |
| --------------------- | ----------------------------------------------------------------------------------- |
| `attribution-1to1-v0` | 1 credit = 1 token. Default.                                                        |
| `weighted-council-v0` | Category weights (code 60%, review 25%, community 15%) applied before token mapping |
| `vesting-v0`          | Token claims subject to vesting schedule (cliff + linear)                           |

The `ownership_model.template` field selects which `resolveRecipients()` + `computeTokenAmount()` implementation is used. Each template is a code path, not a config permutation.

## Goal

Enable governance token claims from attribution entitlements. Contributors earn credits through the attribution pipeline (automatic). The system publishes Merkle roots periodically (mechanical). Contributors claim tokens when ready (user-initiated). Unlinked users accumulate entitlements visible in-app until they link a wallet.

## Non-Goals

- Custom Solidity contracts (use stock Uniswap MerkleDistributor)
- On-chain enforcement of emission caps (Run phase — `EmissionsController`)
- Multi-instrument settlement (Run: USDC, vesting, streaming)
- Human review of settlement artifacts (the attribution statement IS the reviewed artifact)
- Auto-pushing tokens to wallets (user-initiated claims only)
- Modifying the attribution pipeline or statement schema
- Token deployment or formation (owned by node-formation spec + task.0135)
- Persistent/cumulative distributor (per-epoch is sufficient at <50 epochs/year)

## Invariants

| Rule                            | Constraint                                                                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STATEMENTS_ARE_TRUTH            | Signed attribution statements are the entitlement authority. `composeHoldings()` is a read-model projection. The chain is a delivery rail. Neither is the source of truth.                           |
| PUBLICATION_NOT_APPROVAL        | Publishing a Merkle root is a mechanical system action (Temporal cron), not a governance checkpoint. The only reviewed artifact is the attribution statement.                                        |
| LEAF_ENCODING_UNISWAP           | Merkle leaf = `keccak256(abi.encodePacked(uint256 index, address account, uint256 amount))`. No double-hashing. No ABI-encode. Must match Uniswap `MerkleDistributor.claim()` exactly.               |
| TREE_SORTED_PAIR                | Internal tree nodes use sorted-pair hashing: `a < b ? H(a‖b) : H(b‖a)`. Matches Uniswap/OZ `MerkleProof.verify()`.                                                                                   |
| SETTLEMENT_ID_DETERMINISTIC     | `settlement_id = keccak256(abi.encode(statementHash, nodeId, scopeId, chainId, tokenAddress, policyHash, programType, sequence))`. Same inputs always produce the same ID.                           |
| MANIFEST_UNIQUE_PER_PUBLICATION | `UNIQUE(node_id, scope_id, epoch_id, settlement_sequence)` on `settlement_manifests`. One primary publication per epoch.                                                                             |
| RESOLUTION_READS_EXISTING       | `resolveRecipients()` is a pure function consuming a pre-loaded wallet lookup. No DB queries inside the function. No new tables.                                                                     |
| UNLINKED_ACCRUE_NOT_DROP        | Claimants without linked wallets are excluded from the Merkle tree but NOT from the entitlement record. Their credits remain in the attribution ledger and become claimable when they link a wallet. |
| TOKEN_AMOUNT_INTEGER_SCALED     | `tokenAmount = creditAmount × 10^tokenDecimals`. V0: 1 credit at 18 decimals = `1 × 10^18` token smallest units. No floating point.                                                                  |
| ARTIFACT_BEFORE_FUNDING         | Manifest must exist with `status='published'` before any funding transaction.                                                                                                                        |
| FUNDING_RECORDS_TX              | Every funded manifest records `funding_tx_hash`, `distributor_address`, and `funded_at`.                                                                                                             |
| OWNERSHIP_MODEL_FROM_REPO_SPEC  | `ownership_model.template` in repo-spec selects the credit→token mapping. V0: `attribution-1to1-v0` only.                                                                                            |
| ALL_MATH_BIGINT                 | No floating point in token amount calculations.                                                                                                                                                      |
| PURE_PACKAGE                    | `packages/settlement/` has no Next.js, no Drizzle, no DB adapter dependencies. Pure functions + types only.                                                                                          |
| WALK_IDEMPOTENCY_OPERATIONAL    | Walk-phase duplicate prevention: DB unique constraint + finite emissions balance + Safe signer review. NOT cryptographic single-execution. Run phase adds on-chain guard.                            |

### Schema

**Table:** `settlement_manifests`

| Column                     | Type        | Constraints                   | Description                                                          |
| -------------------------- | ----------- | ----------------------------- | -------------------------------------------------------------------- |
| `id`                       | UUID        | PK, DEFAULT gen_random_uuid() | Row ID                                                               |
| `settlement_id`            | TEXT        | NOT NULL                      | Deterministic ID from `computeSettlementId()`                        |
| `node_id`                  | TEXT        | NOT NULL                      | Node identity                                                        |
| `scope_id`                 | TEXT        | NOT NULL                      | Governance scope                                                     |
| `epoch_id`                 | BIGINT      | NOT NULL                      | Epoch this manifest settles                                          |
| `settlement_sequence`      | INTEGER     | NOT NULL, DEFAULT 0           | 0=primary, 1+=follow-up (when newly-linked wallets become claimable) |
| `statement_hash`           | TEXT        | NOT NULL                      | SHA-256 of the canonical `AttributionStatement`                      |
| `merkle_root`              | TEXT        | NOT NULL                      | Hex-encoded Merkle root                                              |
| `total_amount`             | BIGINT      | NOT NULL                      | Token units in this tree                                             |
| `claimant_count`           | INTEGER     | NOT NULL                      | Number of leaves in tree                                             |
| `not_yet_claimable_amount` | BIGINT      | NOT NULL, DEFAULT 0           | Token units for unlinked claimants (not in tree)                     |
| `not_yet_claimable_count`  | INTEGER     | NOT NULL, DEFAULT 0           | Number of unlinked claimants                                         |
| `proofs_json`              | JSONB       | NOT NULL                      | Full proof set: `{ index, wallet, amount, proof[] }[]`               |
| `policy_hash`              | TEXT        | NOT NULL                      | SHA-256 of canonical ownership model used                            |
| `status`                   | TEXT        | NOT NULL, DEFAULT 'published' | `published → funded → swept`                                         |
| `distributor_address`      | TEXT        |                               | Per-epoch MerkleDistributor contract address                         |
| `funding_tx_hash`          | TEXT        |                               | On-chain tx that funded the distributor                              |
| `publisher`                | TEXT        | NOT NULL                      | System/wallet that published this manifest                           |
| `published_at`             | TIMESTAMPTZ | NOT NULL, DEFAULT now()       |                                                                      |
| `funded_at`                | TIMESTAMPTZ |                               |                                                                      |
| `created_at`               | TIMESTAMPTZ | NOT NULL, DEFAULT now()       |                                                                      |

**Constraints:**

```sql
UNIQUE(node_id, scope_id, epoch_id, settlement_sequence)
CHECK(status IN ('published', 'funded', 'swept'))
CHECK(settlement_sequence >= 0)
CHECK(total_amount >= 0)
```

### Ownership Model Schema (repo-spec addition)

```typescript
// packages/repo-spec/src/schema.ts
export const ownershipModelSchema = z.object({
  /** Template ID — selects credit→token mapping implementation */
  template: z.enum(["attribution-1to1-v0"]),
  /** GovernanceERC20 decimals (standard: 18) */
  token_decimals: z.number().int().min(0).max(18).default(18),
  /** Days after publication before unclaimed tokens are swept */
  claim_window_days: z.number().int().min(1).default(90),
});
```

### Domain Types

```typescript
// packages/settlement/src/types.ts

/** Claimant with resolved wallet — goes into Merkle tree */
interface ClaimableEntitlement {
  index: number;
  claimantKey: string; // "user:abc" or "identity:github:456"
  wallet: Address; // resolved 0x address
  tokenAmount: bigint; // creditAmount × 10^tokenDecimals
}

/** Claimant without wallet — accrues, included in next publication when linked */
interface AccruingEntitlement {
  claimantKey: string;
  claimant: AttributionClaimant;
  creditAmount: bigint;
  reason: "no_binding" | "no_wallet";
}

/** Result of resolveRecipients() */
interface ResolutionResult {
  claimable: ClaimableEntitlement[];
  accruing: AccruingEntitlement[];
  totalClaimable: bigint;
  totalAccruing: bigint;
}

/** Output of computeMerkleTree() */
interface MerkleSettlement {
  root: Hex;
  totalAmount: bigint;
  leaves: MerkleLeaf[];
}

interface MerkleLeaf {
  index: number;
  wallet: Address;
  amount: bigint;
  proof: Hex[];
}

/** Ownership model from repo-spec */
interface OwnershipModel {
  template: "attribution-1to1-v0";
  tokenDecimals: number;
  claimWindowDays: number;
}
```

### File Pointers

| File                                                                     | Purpose                                                                    |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `packages/settlement/src/resolve.ts`                                     | `resolveRecipients()` — pure, takes pre-loaded wallet lookup               |
| `packages/settlement/src/merkle.ts`                                      | `computeMerkleTree()` — Uniswap-compatible encoding, sorted-pair tree      |
| `packages/settlement/src/settlement-id.ts`                               | `computeSettlementId()` — deterministic ID derivation                      |
| `packages/settlement/src/types.ts`                                       | Domain types: `ClaimableEntitlement`, `MerkleSettlement`, `OwnershipModel` |
| `packages/settlement/tests/merkle.test.ts`                               | Unit tests for tree generation                                             |
| `packages/settlement/tests/merkle-encoding.test.ts`                      | Encoding compat: verify against Uniswap Solidity verify logic              |
| `packages/settlement/tests/resolve.test.ts`                              | Resolution + accruing partition tests                                      |
| `packages/attribution-ledger/src/hashing.ts`                             | `computeStatementHash()` — canonical hash of full statement                |
| `packages/repo-spec/src/schema.ts`                                       | `ownershipModelSchema` — Zod schema for repo-spec `ownership_model:`       |
| `packages/repo-spec/src/accessors.ts`                                    | `getOwnershipModel()` accessor                                             |
| `packages/db-schema/src/settlement.ts`                                   | `settlementManifests` Drizzle table definition                             |
| `services/scheduler-worker/src/workflows/publish-settlement.workflow.ts` | `PublishSettlementWorkflow` — Temporal orchestration                       |

### Threat Model

| Threat                                         | Controls                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merkle tree doesn't match distributor encoding | LEAF_ENCODING_UNISWAP invariant + encoding compatibility test suite                                                                                    |
| Duplicate funding for same epoch               | DB unique constraint (Walk) + `EmissionsController.require(!consumed[])` (Run)                                                                         |
| Inflated token amounts                         | `tokenAmount = creditAmount × 10^decimals`. `creditAmount` from signed statement. Token scaling is deterministic integer math.                         |
| Unlinked claimant tokens lost                  | UNLINKED_ACCRUE_NOT_DROP — entitlement stays in attribution ledger, becomes claimable on next publication after wallet link                            |
| Compromised operator publishes wrong root      | Safe signer reviews funding tx. Run: Governor/Timelock authorization.                                                                                  |
| DB wiped, operator re-funds same epoch         | Emissions holder balance is finite (bounded blast radius). Reconciliation recomputes from signed statements + on-chain transfers. Run: on-chain guard. |
| Statement modified after signing               | EIP-712 signed with `finalAllocationSetHash`. Modification invalidates signature.                                                                      |

## Open Questions

- [ ] Publication cadence: weekly (after each epoch finalization) or monthly (batch)? Tradeoff: more frequent = faster claims but more gas for distributor deployments.
- [ ] Should `PublishSettlementWorkflow` auto-trigger as a child of `FinalizeEpochWorkflow`, or run on a separate Temporal schedule?
- [ ] Sweep mechanism: Temporal cron checks claim windows, or manual Safe transaction?

## Related

- [Attribution Ledger](./attribution-ledger.md) — upstream: `AttributionStatement`, `AttributionStatementLineRecord`, claimant types, `composeHoldings()`
- [Financial Ledger](./financial-ledger.md) — downstream: `Expense:ContributorRewards:COGNI`, `Liability:UnclaimedEquity:COGNI` accounting
- [Tokenomics](./tokenomics.md) — budget policy, enforcement progression
- [Node Formation](./node-formation.md) — GovernanceERC20 deployment, task.0135
- [Operator Wallet](./operator-wallet.md) — Operator Port for funding authorization
