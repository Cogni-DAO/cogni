---
id: on-chain-settlement
type: spec
title: "On-Chain Settlement: Signed Statements to Merkle Claims"
status: draft
spec_state: draft
trust: draft
summary: "Settlement pipeline that transforms finalized AttributionStatements into funded, claimable MerkleDistributor instances. Pure functions for recipient resolution and Uniswap-compatible Merkle tree generation. Settlement manifests provide the audit trail. V0: per-epoch distributor, single governance token, trusted Safe-reviewed funding."
read_when: Working on settlement artifacts, Merkle tree generation, recipient resolution, settlement manifests, the SettleEpochWorkflow, claim UI, or any code that turns attribution credits into on-chain tokens.
implements: proj.on-chain-distributions
owner: derekg1729
created: 2026-03-16
verified:
tags: [governance, web3, settlement, merkle]
---

# On-Chain Settlement: Signed Statements to Merkle Claims

> Transforms a finalized, EIP-712-signed `AttributionStatement` into a funded `MerkleDistributor` contract that contributors can claim governance tokens from. Every step is deterministic and auditable. No custom Solidity.

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

### Pipeline

```
 AttributionStatement (EIP-712 signed, from attribution-ledger)
 ┌──────────────────────────────────────────────────────────────┐
 │  epochId, nodeId, scopeId, finalAllocationSetHash,          │
 │  poolTotalCredits, statementLines[]:                         │
 │    { claimantKey, claimant, creditAmount, finalUnits, ... }  │
 └──────────────────────────┬───────────────────────────────────┘
                            │
                            ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  1. resolveRecipients(statement, bindings, policy)           │
 │                                                              │
 │  For each statementLine:                                     │
 │    claimant.kind == "user"                                   │
 │      → users.wallet_address OR user_bindings(wallet)         │
 │    claimant.kind == "identity"                               │
 │      → user_bindings(provider, externalId) → userId → wallet │
 │                                                              │
 │  Resolved → { index, claimantKey, wallet, tokenAmount }      │
 │  Unresolved → suspended (parked, not in tree)                │
 │                                                              │
 │  tokenAmount = creditAmount × policy.creditTokenRatio        │
 │  (V0: 1:1 — 1 credit = 1 token unit at 18 decimals)         │
 └──────────────────────────┬───────────────────────────────────┘
                            │
              ┌─────────────┴──────────────┐
              │                            │
        ResolvedEntitlement[]       SuspendedEntitlement[]
              │                            │
              ▼                     (stay in emissions holder;
 ┌──────────────────────────┐       follow-up settlement later)
 │  2. computeMerkleTree()  │
 │                          │
 │  leaf[i] = keccak256(    │
 │    abi.encodePacked(     │
 │      uint256(index),     │
 │      address(wallet),    │
 │      uint256(amount)     │
 │    )                     │
 │  )                       │
 │                          │
 │  ⚠ Uniswap encoding:    │
 │    encodePacked, NOT     │
 │    OZ StandardMerkleTree │
 │    double-hash           │
 │                          │
 │  → MerkleSettlement {    │
 │      root, totalAmount,  │
 │      leaves[] w/ proofs  │
 │    }                     │
 └──────────┬───────────────┘
            │
            ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  3. computeSettlementId()                                    │
 │                                                              │
 │  keccak256(abi.encode(                                       │
 │    statementHash,  — SHA-256 of canonical statement          │
 │    nodeId,                                                   │
 │    scopeId,                                                  │
 │    chainId,                                                  │
 │    tokenAddress,                                             │
 │    policyHash,     — SHA-256 of canonical settlement policy  │
 │    programType,    — "primary" or "suspense_followup"        │
 │    sequence        — 0 for primary, 1+ for follow-ups       │
 │  ))                                                          │
 │                                                              │
 │  Deterministic. Same inputs → same ID. Off-chain key now,   │
 │  on-chain key in Run phase (EmissionsController).            │
 └──────────┬───────────────────────────────────────────────────┘
            │
            ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  4. Persist manifest (settlement_manifests table)            │
 │                                                              │
 │  status: published → funded → swept                          │
 │  UNIQUE(node_id, scope_id, epoch_id, settlement_sequence)    │
 └──────────┬───────────────────────────────────────────────────┘
            │
    (Safe signer review — human verifies manifest)
            │
            ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  5. Fund distributor (Walk — on-chain)                       │
 │                                                              │
 │  a. Deploy MerkleDistributor(token, root)                    │
 │  b. token.transfer(emissionsHolder → distributor, total)     │
 │  c. Record funding_tx_hash + distributor_address on manifest │
 └──────────┬───────────────────────────────────────────────────┘
            │
            ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  6. Claim (Walk — user-initiated on-chain tx)                │
 │                                                              │
 │  distributor.claim(index, account, amount, proof)            │
 │  Tokens transfer to claimant wallet.                         │
 └──────────────────────────────────────────────────────────────┘
```

### Recipient Resolution

Resolution uses existing identity infrastructure:

```
claimant.kind == "user"
  → users.wallet_address (direct, from SIWE auth)
  → fallback: user_bindings WHERE provider='wallet' AND user_id=claimant.userId

claimant.kind == "identity"
  → user_bindings WHERE provider=claimant.provider AND external_id=claimant.externalId
  → resolved userId → users.wallet_address
  → if no binding or no wallet: SUSPENDED
```

Resolution is a read-only query against existing tables. No new schema needed for resolution itself.

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

**Do NOT use `@openzeppelin/merkle-tree`** (`StandardMerkleTree`). OZ uses `keccak256(keccak256(abi.encode(...)))` (double-hash, ABI-encoded, no index). These formats are incompatible. A tree generated with OZ's library will produce proofs that the Uniswap contract rejects.

Tree construction uses sorted-pair hashing (same as Uniswap):

```typescript
function hashPair(a: Hex, b: Hex): Hex {
  return a < b ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}
```

### Suspense Model

When `resolveRecipients()` encounters unresolved claimants:

1. **Resolved** claimants → included in Merkle tree → primary manifest (sequence=0)
2. **Suspended** claimants → recorded in manifest metadata, NOT in tree
3. Suspended token amounts stay in emissions holder (not transferred to distributor)
4. When identity resolves later → follow-up manifest (same epoch, sequence=1+)
5. Follow-up has its own `settlement_id` (different `sequence` input)

This avoids both failure modes: stalling epochs forever on unresolved identities, and silently dropping unresolved contributors.

### SettleEpochWorkflow (Temporal)

```
SettleEpochWorkflow(epochId, nodeId, scopeId)
  │
  ├── activity: loadFinalizedStatement(epochId)
  │   → AttributionStatement (from attribution-ledger store)
  │
  ├── activity: loadSettlementPolicy(nodeId, scopeId)
  │   → SettlementPolicy (from repo-spec)
  │
  ├── activity: resolveRecipients(statement, policy)
  │   → { resolved: ResolvedEntitlement[], suspended: SuspendedEntitlement[] }
  │
  ├── activity: computeAndPersistManifest(resolved, suspended, statement, policy)
  │   → computeMerkleTree(resolved)
  │   → computeSettlementId(...)
  │   → INSERT settlement_manifests (status='published')
  │   → return manifestId
  │
  └── (workflow completes — funding is a separate, human-triggered action)
```

The workflow produces an artifact only. No tokens move. Funding is a separate action gated by Safe signer review.

## Goal

Enable deterministic, auditable settlement of attribution credits into on-chain governance token claims. The system takes a signed `AttributionStatement` and produces a settlement manifest with Merkle root and proofs that, when funded, allow contributors to claim tokens from a stock Uniswap `MerkleDistributor`.

## Non-Goals

- Custom Solidity contracts (use stock Uniswap MerkleDistributor unmodified)
- On-chain enforcement of emission caps (Run phase — `EmissionsController`)
- Multi-instrument settlement (Run phase — USDC, vesting, streaming)
- USDC distribution (separate governance vote, not automated by this pipeline)
- Persistent/cumulative distributor (per-epoch is sufficient at <50 epochs/year)
- Modifying the attribution pipeline or statement schema
- Token deployment or formation (owned by node-formation spec)

## Invariants

| Rule                           | Constraint                                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LEAF_ENCODING_UNISWAP          | Merkle leaf = `keccak256(abi.encodePacked(uint256 index, address account, uint256 amount))`. No double-hashing. No ABI-encode. Must match Uniswap `MerkleDistributor.claim()` exactly.  |
| TREE_SORTED_PAIR               | Internal tree nodes use sorted-pair hashing: `a < b ? H(a‖b) : H(b‖a)`. Matches Uniswap/OZ `MerkleProof.verify()`.                                                                      |
| SETTLEMENT_ID_DETERMINISTIC    | `settlement_id = keccak256(abi.encode(statementHash, nodeId, scopeId, chainId, tokenAddress, policyHash, programType, sequence))`. Same inputs always produce the same ID.              |
| MANIFEST_UNIQUE_PER_SETTLEMENT | `UNIQUE(node_id, scope_id, epoch_id, settlement_sequence)` on `settlement_manifests`. One primary (seq=0) and zero or more follow-ups (seq=1+) per epoch.                               |
| RESOLUTION_READS_EXISTING      | `resolveRecipients()` is a read-only query against `users` and `user_bindings`. No new tables. No mutations.                                                                            |
| SUSPENDED_NOT_DROPPED          | Unresolved claimants are recorded in the manifest (`suspended_amount`, `suspended_claimants_json`). Never silently excluded.                                                            |
| SUSPENDED_NOT_IN_TREE          | Suspended claimants are NOT included in the Merkle tree or funded distributor. Their tokens stay in the emissions holder.                                                               |
| ARTIFACT_BEFORE_FUNDING        | Manifest must exist with `status='published'` before any funding transaction. Funding updates `status → 'funded'`.                                                                      |
| FUNDING_RECORDS_TX             | Every funded manifest records `funding_tx_hash`, `distributor_address`, and `funded_at`.                                                                                                |
| STATEMENT_IS_INPUT             | Settlement consumes `AttributionStatement` as-is. Does not modify, re-sign, or produce a secondary signed artifact. The statement IS the entitlement authority.                         |
| CREDIT_TOKEN_RATIO_FROM_POLICY | `tokenAmount = creditAmount × policy.creditTokenRatio`. V0: ratio is 1. The ratio is stored in `settlement_policy` in repo-spec, not hardcoded.                                         |
| ALL_MATH_BIGINT                | No floating point in token amount calculations. Inherited from attribution-ledger.                                                                                                      |
| PURE_PACKAGE                   | `packages/settlement/` has no Next.js, no Drizzle, no DB adapter dependencies. Pure functions + types only. DB adapter lives in app layer.                                              |
| WALK_IDEMPOTENCY_OPERATIONAL   | Walk-phase duplicate prevention is: DB unique constraint + finite emissions balance + Safe signer review. NOT cryptographic single-execution. Spec and docs must state this explicitly. |

### Schema

**Table:** `settlement_manifests`

| Column                     | Type        | Constraints                   | Description                                            |
| -------------------------- | ----------- | ----------------------------- | ------------------------------------------------------ |
| `id`                       | UUID        | PK, DEFAULT gen_random_uuid() | Row ID                                                 |
| `settlement_id`            | TEXT        | NOT NULL                      | Deterministic ID from `computeSettlementId()`          |
| `node_id`                  | TEXT        | NOT NULL                      | Node identity                                          |
| `scope_id`                 | TEXT        | NOT NULL                      | Governance scope                                       |
| `epoch_id`                 | BIGINT      | NOT NULL                      | Epoch this manifest settles                            |
| `settlement_sequence`      | INTEGER     | NOT NULL, DEFAULT 0           | 0=primary, 1+=suspense follow-up                       |
| `statement_hash`           | TEXT        | NOT NULL                      | SHA-256 of the canonical `AttributionStatement`        |
| `merkle_root`              | TEXT        | NOT NULL                      | Hex-encoded Merkle root                                |
| `total_amount`             | BIGINT      | NOT NULL                      | Token units in this manifest's tree                    |
| `suspended_amount`         | BIGINT      | NOT NULL, DEFAULT 0           | Token units for unresolved claimants (not in tree)     |
| `claimant_count`           | INTEGER     | NOT NULL                      | Number of leaves in tree                               |
| `suspended_count`          | INTEGER     | NOT NULL, DEFAULT 0           | Number of unresolved claimants                         |
| `proofs_json`              | JSONB       | NOT NULL                      | Full proof set: `{ index, wallet, amount, proof[] }[]` |
| `suspended_claimants_json` | JSONB       | NOT NULL, DEFAULT '[]'        | Unresolved: `{ claimantKey, creditAmount }[]`          |
| `policy_hash`              | TEXT        | NOT NULL                      | SHA-256 of canonical settlement policy used            |
| `status`                   | TEXT        | NOT NULL, DEFAULT 'published' | `published → funded → swept`                           |
| `distributor_address`      | TEXT        |                               | Per-epoch MerkleDistributor contract address           |
| `funding_tx_hash`          | TEXT        |                               | On-chain tx that funded the distributor                |
| `publisher`                | TEXT        | NOT NULL                      | Wallet address that published this manifest            |
| `published_at`             | TIMESTAMPTZ | NOT NULL, DEFAULT now()       |                                                        |
| `funded_at`                | TIMESTAMPTZ |                               |                                                        |
| `created_at`               | TIMESTAMPTZ | NOT NULL, DEFAULT now()       |                                                        |

**Constraints:**

```sql
UNIQUE(node_id, scope_id, epoch_id, settlement_sequence)
CHECK(status IN ('published', 'funded', 'swept'))
CHECK(settlement_sequence >= 0)
CHECK(total_amount >= 0)
CHECK(suspended_amount >= 0)
```

### Settlement Policy (repo-spec.yaml)

```yaml
settlement:
  instrument: "governance_token" # V0: single instrument
  credit_token_ratio: "1" # 1 credit = 1 token unit (bigint string)
  claim_window_days: 90 # unclaimed tokens swept after this
  token_decimals: 18 # GovernanceERC20 decimals
```

Read via `getSettlementPolicy()` accessor in `packages/repo-spec/`. Policy is governance-controlled. `policy_hash = SHA-256(canonicalJsonStringify(policy))` is stored on each manifest for audit trail.

### Domain Types

```typescript
// packages/settlement/src/types.ts

/** Successfully resolved claimant → wallet mapping */
interface ResolvedEntitlement {
  index: number;
  claimantKey: string; // "user:abc" or "identity:github:456"
  wallet: Address; // 0x... resolved wallet
  tokenAmount: bigint; // creditAmount × creditTokenRatio
}

/** Unresolved claimant — parked for follow-up settlement */
interface SuspendedEntitlement {
  claimantKey: string;
  claimant: AttributionClaimant;
  creditAmount: bigint;
  reason: "no_binding" | "no_wallet";
}

/** Result of resolveRecipients() */
interface ResolutionResult {
  resolved: ResolvedEntitlement[];
  suspended: SuspendedEntitlement[];
  totalResolved: bigint;
  totalSuspended: bigint;
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

/** Settlement policy from repo-spec */
interface SettlementPolicy {
  instrument: "governance_token";
  creditTokenRatio: bigint; // V0: 1n
  claimWindowDays: number;
  tokenDecimals: number;
}
```

### File Pointers

| File                                                               | Purpose                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `packages/settlement/src/resolve.ts`                               | `resolveRecipients()` — pure function, reads bindings                         |
| `packages/settlement/src/merkle.ts`                                | `computeMerkleTree()` — Uniswap-compatible leaf encoding, sorted-pair tree    |
| `packages/settlement/src/settlement-id.ts`                         | `computeSettlementId()` — deterministic ID derivation                         |
| `packages/settlement/src/types.ts`                                 | Domain types: `ResolvedEntitlement`, `MerkleSettlement`, `SettlementPolicy`   |
| `packages/settlement/tests/merkle.test.ts`                         | Unit tests for tree generation                                                |
| `packages/settlement/tests/merkle-encoding.test.ts`                | Encoding compatibility: verify leaves against Uniswap's Solidity verify logic |
| `packages/settlement/tests/resolve.test.ts`                        | Resolution + suspense tests                                                   |
| `packages/settlement/tests/settlement-id.test.ts`                  | Determinism tests for settlement ID                                           |
| `packages/repo-spec/src/schema.ts`                                 | `settlementPolicySchema` — Zod schema for repo-spec `settlement:` block       |
| `packages/repo-spec/src/accessors.ts`                              | `getSettlementPolicy()` accessor                                              |
| `packages/db-schema/src/settlement.ts`                             | `settlementManifests` Drizzle table definition                                |
| `services/scheduler-worker/src/workflows/settle-epoch.workflow.ts` | `SettleEpochWorkflow` — Temporal orchestration                                |

### Threat Model

| Threat                                                  | Controls                                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Merkle tree doesn't match distributor contract encoding | LEAF_ENCODING_UNISWAP invariant + encoding compatibility test suite                                                                           |
| Duplicate funding for same epoch                        | DB unique constraint (Walk) + `EmissionsController.require(!consumed[])` (Run)                                                                |
| Manifest root doesn't match statement                   | `settlement_id` includes `statementHash` — mismatch changes ID. Manifest stores `statement_hash` for audit.                                   |
| Inflated token amounts                                  | `totalAmount = SUM(resolved entitlements)`. Each entitlement derived from `creditAmount × ratio`. `creditAmount` comes from signed statement. |
| Unresolved claimant tokens lost                         | SUSPENDED_NOT_DROPPED — manifest records suspended amounts. SUSPENDED_NOT_IN_TREE — tokens stay in emissions holder.                          |
| Compromised operator publishes wrong root               | Safe signer review of manifest before funding. Run: Governor/Timelock authorization.                                                          |
| DB wiped, operator re-funds same epoch                  | Emissions holder balance is finite (bounded blast radius). Reconciliation script cross-references on-chain transfers. Run: on-chain guard.    |
| Statement modified after signing                        | Statement is EIP-712 signed with `finalAllocationSetHash`. Any modification invalidates the signature.                                        |

## Open Questions

- [ ] Token decimals handling: does `creditAmount` (currently whole-number bigint) map to token amounts at 18 decimals, or does the ratio absorb the decimal scaling? (Depends on task.0135 governance decisions)
- [ ] Should `SettleEpochWorkflow` trigger automatically on epoch finalization, or require manual trigger? (Temporal child workflow vs. separate schedule)
- [ ] Sweep mechanism: who calls sweep after claim window? Temporal cron? Safe transaction?

## Related

- [Attribution Ledger](./attribution-ledger.md) — upstream: statement schema, `AttributionStatementLineRecord`, claimant types
- [Financial Ledger](./financial-ledger.md) — downstream: `Expense:ContributorRewards:COGNI`, `Liability:UnclaimedEquity:COGNI` accounting
- [Tokenomics](./tokenomics.md) — budget policy, enforcement progression, credit:token handoff
- [Node Formation](./node-formation.md) — GovernanceERC20 deployment, rewards-ready formation (task.0135)
- [Operator Wallet](./operator-wallet.md) — Operator Port for Safe/manual funding authorization
