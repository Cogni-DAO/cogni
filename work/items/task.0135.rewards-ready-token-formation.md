---
id: task.0135
type: task
title: "Rewards-Ready Token Formation: Governance Decisions + Implementation"
status: needs_design
priority: 1
rank: 20
estimate: 3
summary: "Make governance decisions (total supply, emissions holder type, existing DAO reuse) and implement the rewards-ready GovernanceERC20 mint path. Current formation mints 1 token to founder — must become fixed supply to DAO-controlled holder before any settlement work begins."
outcome: "GovernanceERC20 on Base has its final supply minted to a DAO-controlled emissions holder. repo-spec.yaml stores the holder address and total supply. Server verification validates holder + supply. The token setup is not a placeholder."
spec_refs: node-formation-spec, tokenomics-spec, financial-ledger-spec
assignees: derekg1729
credit:
project: proj.financial-ledger
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-03
updated: 2026-03-03
labels: [web3, governance, tokenomics, setup]
---

# Rewards-Ready Token Formation: Governance Decisions + Implementation

> Spec: [node-formation](../../docs/spec/node-formation.md) (invariant #2)
> Project: [proj.financial-ledger](../../work/projects/proj.financial-ledger.md) (Crawl P0)
> Project: [proj.node-formation-ui](../../work/projects/proj.node-formation-ui.md) (Crawl P0)

## Why This Blocks Everything

Every settlement task — `computeMerkleTree`, recipient resolution, MerkleDistributor deployment, claim UI — requires tokens to exist in an emissions holder. The current DAO on Base (`0xF61c...`) has 1e18 tokens minted to the founder's wallet. That is not a distributable supply.

This task must complete before any Walk (P1) work in `proj.financial-ledger` can start.

## Phase 1: Governance Decisions (Required Before Engineering)

These are not engineering choices. They are governance/founder decisions that determine the shape of all downstream work.

### Decision 1: Total Token Supply

| Option | Implication |
|--------|------------|
| 1,000,000 (1M) | Simple. 520K budget = 52% of supply via attribution over ~1 year at 10K/epoch. |
| 10,000,000 (10M) | More granularity. 520K budget = 5.2% of supply. Leaves room for future programs. |
| Match `budget_total` 1:1 | 520K tokens total. All supply goes through attribution. No reserve. |
| Other | Governance picks the number. |

**Related question:** What is the credit:token ratio? V0 spec says 1:1 (1 credit = 1 token unit at 18 decimals). If total supply ≠ `budget_total`, the ratio changes or a reserve exists.

### Decision 2: Emissions Holder Type

| Option | Pros | Cons | IaC Status |
|--------|------|------|------------|
| **DAO contract itself** | Simplest. DAO already exists. Tokens held by the DAO, released via governance proposals. | Weakest controls — any passing proposal can move all tokens. No rate limiting. | No new infra needed. |
| **Safe multisig** (e.g., 2-of-3) | Battle-tested. Explicit human authorization for each release. Visible on safe.global. | Requires Safe creation (manual via UI or Safe SDK). Adds a new address to manage. | No Safe SDK in codebase. Manual creation via safe.global UI is viable. |
| **Dedicated vault contract** | Strongest controls (enforced release caps, epoch timing). | Custom contract = audit burden. Premature for Crawl per reviewer feedback. | No Foundry/Hardhat in repo. Would need external tooling. |

**Recommendation:** Safe multisig is the sweet spot for Walk. For Crawl, the DAO contract itself may be sufficient if the goal is just "token setup is final, not placeholder."

### Decision 3: Can the Existing DAO Mint More Tokens?

**Investigation required.** This determines whether we update the existing DAO or deploy a new one.

| Question | How to Answer |
|----------|---------------|
| Does Aragon GovernanceERC20 have a `mint()` function? | Check the deployed contract on Basescan (`0xF61c...` → token address from plugin). Read the contract ABI. |
| Does the DAO have MINTER permission on the token? | Check Aragon's ACL. The TokenVoting setup plugin may or may not grant mint permission to the DAO. |
| If mintable: can the DAO mint via a governance proposal? | Create an Aragon proposal that calls `token.mint(emissionsHolder, totalSupply - 1e18)`. |
| If NOT mintable: must we deploy a new DAO? | New `createDao()` call with updated MintSettings: `receivers: [emissionsHolder], amounts: [totalSupply]`. Loses current DAO address. |

**Codebase note:** The GovernanceERC20 ABI in the repo (`src/shared/web3/node-formation/aragon-abi.ts`) only exposes `balanceOf()` — it's intentionally minimal. The actual on-chain contract may have more functions. Must check Basescan.

## Phase 2: Implementation (After Decisions)

### If existing DAO can mint (preferred path):

1. Determine the token contract address (call `TokenVoting(plugin).getVotingToken()` on Base)
2. Check if DAO has `MINT_PERMISSION_ID` on the token contract
3. If yes: create an Aragon proposal to mint `totalSupply - 1e18` to the emissions holder
4. Execute the proposal
5. Update `repo-spec.yaml` with `emissions_holder` address and `total_supply`
6. Update server verification to validate holder balance = `totalSupply - 1e18` (founder keeps 1 token)

### If new DAO required:

1. Create emissions holder first (Safe multisig or use a known address)
2. Update `txBuilders.ts` to accept `totalSupply` and `emissionsHolder` params
3. Update `MintSettings`: `receivers: [emissionsHolder, founder], amounts: [totalSupply - 1e18, 1e18]`
4. Run formation on Base mainnet with new params
5. Update `repo-spec.yaml` with all new addresses
6. Update server verification to validate holder + supply
7. Retire old DAO address (or keep for historical reference)

### repo-spec.yaml changes (both paths):

```yaml
cogni_dao:
  chain_id: "8453"
  dao_contract: "0x..."
  plugin_contract: "0x..."
  signal_contract: "0x..."
  token_contract: "0x..."          # NEW: explicit token address
  emissions_holder: "0x..."        # NEW: address holding unreleased supply
  total_supply: "1000000"          # NEW: total token supply (token units)
```

### Files

**Investigate:**

- Basescan: check GovernanceERC20 ABI and DAO permissions on the deployed token

**Modify:**

- `packages/repo-spec/src/schema.ts` — add `token_contract`, `emissions_holder`, `total_supply` to `cogniDaoSchema`
- `packages/repo-spec/src/accessors.ts` — add `getTokenContract()`, `getEmissionsHolder()` accessors
- `.cogni/repo-spec.yaml` — add new fields after formation
- `src/shared/web3/node-formation/aragon-abi.ts` — add `mint()` ABI if minting via existing DAO
- `src/features/setup/daoFormation/txBuilders.ts` — update `MintSettings` if new DAO path
- `src/app/api/setup/verify/route.ts` — validate emissions holder balance + total supply
- `scripts/validate-chain-config.ts` — extend to validate new repo-spec fields

**New (if new DAO path):**

- Formation script or updated wizard flow for rewards-ready mint

## Validation

- [ ] Governance decisions documented (total supply, holder type, DAO reuse)
- [ ] Token contract address stored in `repo-spec.yaml`
- [ ] Emissions holder address stored in `repo-spec.yaml`
- [ ] On-chain: emissions holder holds `totalSupply - founderAllocation` tokens
- [ ] Server verification validates holder balance and total supply
- [ ] `pnpm check` passes
- [ ] No private keys in codebase (all signing via wallet UI or Safe)

## Open Questions

- Should the founder keep 1e18 tokens from the original mint, or should the new setup supersede it entirely?
- If Safe multisig: who are the signers? (founder only in Crawl? multiple in Walk?)
- Should `total_supply` in repo-spec be token units (with 18 decimals) or human-readable (e.g., "1000000")?
