---
id: task.0167
type: task
title: "Settlement Package: Pure Functions + Domain Types + Ownership Model"
status: done
priority: 1
rank: 5
estimate: 3
summary: "Scaffold @cogni/settlement package with pure Merkle tree generation, recipient resolution, settlement ID computation, statement hashing, and ownership model schema. No DB, no Temporal, no runtime deps."
outcome: "Pure settlement functions exist with full test coverage: computeMerkleTree (Uniswap-compatible), resolveRecipients (claimable vs accruing partition), computeSettlementId (deterministic), computeStatementHash (canonical). ownershipModelSchema added to repo-spec. All functions are importable from @cogni/settlement."
spec_refs: on-chain-settlement
assignees: derekg1729
credit:
project: proj.on-chain-distributions
branch: claude/review-settlement-design-UcjlF
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-16
updated: 2026-03-17
labels: [governance, web3, settlement, merkle]
external_refs:
---

# Settlement Package: Pure Functions + Domain Types + Ownership Model

## Requirements

- `packages/settlement/` exists as a pure ESM package (`@cogni/settlement`) with no Next.js, Drizzle, or runtime infrastructure dependencies. Only `viem` (for keccak256/encodePacked) as a production dependency. Per PURE_PACKAGE.
- Domain types exported: `ClaimableEntitlement`, `AccruingEntitlement`, `ResolutionResult`, `MerkleSettlement`, `MerkleLeaf`, `OwnershipModel` — matching the spec's Domain Types section.
- `computeMerkleTree(entitlements)` produces Uniswap-compatible Merkle trees:
  - Leaf encoding: `keccak256(abi.encodePacked(uint256 index, address account, uint256 amount))`. Per LEAF_ENCODING_UNISWAP.
  - Tree construction: sorted-pair hashing (`a < b ? H(a‖b) : H(b‖a)`). Per TREE_SORTED_PAIR.
  - Returns `{ root, totalAmount, leaves[] with proofs }`.
  - Do NOT use `@openzeppelin/merkle-tree` — it uses incompatible double-hash ABI-encode.
- `resolveRecipients(statementLines, walletLookup, policy)` is a pure function:
  - Takes a pre-loaded `Map<claimantKey, Address>` — no DB queries. Per RESOLUTION_READS_EXISTING.
  - Partitions into `claimable` (wallet found) and `accruing` (no wallet). Per UNLINKED_ACCRUE_NOT_DROP.
  - Computes `tokenAmount = creditAmount × 10^policy.tokenDecimals`. Per TOKEN_AMOUNT_INTEGER_SCALED.
  - All math uses bigint. Per ALL_MATH_BIGINT.
- `computeSettlementId(statementHash, nodeId, scopeId, chainId, tokenAddress, policyHash, programType, sequence)` returns a deterministic keccak256 hash. Per SETTLEMENT_ID_DETERMINISTIC.
- `computeStatementHash(statement)` added to `packages/attribution-ledger/src/hashing.ts`:
  - New function (does NOT replace `computeFinalClaimantAllocationSetHash`).
  - Hashes `{ epochId, nodeId, scopeId, finalAllocationSetHash, poolTotalCredits }` via existing `canonicalJsonStringify` + `sha256Hex`.
  - `poolShare` is NOT included (derived display value). Statement lines are NOT included directly (captured by `finalAllocationSetHash`).
- `ownershipModelSchema` added to `packages/repo-spec/src/schema.ts`:
  - Zod schema: `{ template: z.enum(["attribution-1to1-v0"]), token_decimals: z.number().int().min(0).max(18).default(18), claim_window_days: z.number().int().min(1).default(90) }`. Per OWNERSHIP_MODEL_FROM_REPO_SPEC.
  - `getOwnershipModel()` accessor added to `packages/repo-spec/src/accessors.ts`.
- Merkle encoding compatibility test: generate a tree, verify leaf encoding matches Uniswap's Solidity `keccak256(abi.encodePacked(index, account, amount))` using known test vectors.
- `pnpm check` passes (lint + type + format).
- `pnpm packages:build` succeeds with `@cogni/settlement` included.

## Allowed Changes

- `packages/settlement/` — **new package** (all files)
- `packages/attribution-ledger/src/hashing.ts` — add `computeStatementHash()`
- `packages/attribution-ledger/tests/` — add test for `computeStatementHash()`
- `packages/repo-spec/src/schema.ts` — add `ownershipModelSchema`
- `packages/repo-spec/src/accessors.ts` — add `getOwnershipModel()`
- `packages/repo-spec/src/index.ts` — export new schema + accessor
- `packages/repo-spec/tests/` — add test for ownership model schema
- `pnpm-workspace.yaml` — add `packages/settlement` if not auto-discovered
- `tsconfig.json` (root) — add project reference for `packages/settlement`
- `package.json` (root) — add `@cogni/settlement` workspace dependency if needed

**Out of scope:** `settlement_manifests` DB table (separate task), Temporal workflows, Drizzle adapters, claim UI, funding flow.

## Plan

- [ ] Scaffold `packages/settlement/` — `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `src/index.ts`
- [ ] Add `viem` as production dependency for keccak256/encodePacked
- [ ] Create `src/types.ts` with domain types from spec
- [ ] Create `src/merkle.ts` — `computeLeaf()`, `hashPair()`, `computeMerkleTree()`
- [ ] Create `src/resolve.ts` — `resolveRecipients()`
- [ ] Create `src/settlement-id.ts` — `computeSettlementId()`
- [ ] Add `computeStatementHash()` to `packages/attribution-ledger/src/hashing.ts`
- [ ] Add `ownershipModelSchema` to `packages/repo-spec/src/schema.ts` and `getOwnershipModel()` to accessors
- [ ] Write `tests/merkle.test.ts` — tree generation, proof verification, edge cases (0 leaves, 1 leaf, power-of-2, non-power-of-2)
- [ ] Write `tests/merkle-encoding.test.ts` — known test vectors matching Uniswap Solidity encoding
- [ ] Write `tests/resolve.test.ts` — claimable/accruing partition, all-linked, all-unlinked, mixed, empty input
- [ ] Write `tests/settlement-id.test.ts` — determinism, different inputs produce different IDs
- [ ] Write `packages/attribution-ledger/tests/statement-hash.test.ts` — canonical ordering, BigInt handling, relation to allocation set hash
- [ ] Write `packages/repo-spec/tests/ownership-model.test.ts` — schema validation, defaults
- [ ] Export everything from `src/index.ts`, verify `pnpm packages:build` succeeds
- [ ] Run `pnpm check` — all lint, type, and format checks pass

## Validation

**Build:**

```bash
pnpm packages:build
```

**Expected:** `@cogni/settlement` builds to `dist/`. No type errors.

**Tests:**

```bash
pnpm vitest run --config packages/settlement/vitest.config.ts
pnpm vitest run packages/attribution-ledger/tests/statement-hash.test.ts
pnpm vitest run packages/repo-spec/tests/ownership-model.test.ts
```

**Expected:** All tests pass. Merkle encoding tests produce known Uniswap-compatible hashes.

**Lint + Types:**

```bash
pnpm check
```

**Expected:** Clean — no lint errors, no type errors, formatting correct.

## Review Checklist

- [ ] **Work Item:** `task.0167` linked in PR body
- [ ] **Spec:** all invariants of on-chain-settlement upheld (PURE_PACKAGE, LEAF_ENCODING_UNISWAP, TREE_SORTED_PAIR, RESOLUTION_READS_EXISTING, UNLINKED_ACCRUE_NOT_DROP, TOKEN_AMOUNT_INTEGER_SCALED, ALL_MATH_BIGINT, SETTLEMENT_ID_DETERMINISTIC)
- [ ] **Tests:** Merkle encoding compat test with known Uniswap vectors
- [ ] **Tests:** resolve partition tests cover all claimant kinds
- [ ] **Tests:** No floating point anywhere in token math
- [ ] **Architecture:** `packages/settlement/` has zero imports from `@/`, `src/`, Next.js, Drizzle, or any app/service code
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
