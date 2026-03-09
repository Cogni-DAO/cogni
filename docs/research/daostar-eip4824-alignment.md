---
id: daostar-eip4824-alignment-research
type: research
title: "DAOstar / EIP-4824 Alignment for Financial Ledger"
status: draft
trust: draft
summary: "Analysis of DAOstar standards (EIP-4824, DAOIPs) for DAO metadata, identity, and interoperability. Recommends lightweight daoURI adoption alongside planned settlement infrastructure."
read_when: Evaluating DAO metadata standards, EIP-4824 adoption, or deciding between standard vs custom builds for treasury/settlement.
owner: derekg1729
created: 2026-03-03
verified:
tags: [dao, standards, treasury, web3, research]
---

# Research: DAOstar / EIP-4824 Alignment for Financial Ledger

> spike: spike.0131 | date: 2026-03-03

## Question

Should Cogni adopt DAOstar standards (EIP-4824, DAOIPs) as the metadata/identity layer for the Financial Ledger project? What existing OSS can we reuse instead of building from scratch? What is the simplest path to standards-compliant DAO treasury + attribution settlement?

## Context

The [Financial Ledger project](../../work/projects/proj.financial-ledger.md) plans: Beancount as canonical double-entry ledger, MerkleDistributor for on-chain equity token claims, Operator Port for treasury signing. The [attribution pipeline](../spec/attribution-pipeline-overview.md) already produces signed credit statements per epoch. The question: how much of the surrounding metadata, identity, and interoperability layer can we adopt from standards vs build bespoke?

### What Cogni Already Has

| Capability                                | Current State       | Standard Mapping                          |
| ----------------------------------------- | ------------------- | ----------------------------------------- |
| DAO contract (Aragon OSx)                 | Deployed on Base    | EIP-4824 `contractsURI`                   |
| Governance token (GovernanceERC20)        | Deployed via Aragon | EIP-4824 `membersURI` (token holders)     |
| Identity system (user_id + user_bindings) | Production          | EIP-4824 `membersURI` (CAIP-10 addresses) |
| Attribution pipeline (signed statements)  | Production          | EIP-4824 `activityLogURI`                 |
| repo-spec.yaml (DAO config)               | Production          | Could generate `daoURI` JSON-LD           |
| Epoch proposals (review + finalize)       | Production          | EIP-4824 `proposalsURI`                   |
| Governance doc (.cogni/ policies)         | Production          | EIP-4824 `governanceURI`                  |

**Key insight:** Cogni already has ~80% of the data that EIP-4824 describes. The gap is standardized export format, not missing data.

## Findings

### Option A: Full EIP-4824 Adoption (daoURI + On-Chain Registration)

**What**: Deploy the EIP-4824 registration contract, publish a `daoURI` pointing to our metadata endpoints, register with DAOstar's on-chain registry.

**Pros**:

- Industry-standard discoverability (200+ DAOs adopted)
- Interoperability with Snapshot, Aragon, Tally, and other governance tools
- `activityLogURI` is a natural home for our attribution statements
- `proposalsURI` can surface epoch finalization proposals
- `contractsURI` already matches our Aragon deployment
- Free indexing by DAOstar and other ecosystem tools

**Cons**:

- EIP-4824 is metadata/discovery layer, not settlement infrastructure — doesn't replace MerkleDistributor or Beancount
- `activityLogURI` schema is proposal-centric (member + proposal pairing), not credit-allocation-centric — our attribution statements are richer
- On-chain registration requires a governance tx (low cost on Base)

**OSS tools**:

- [metagov/daostar](https://github.com/metagov/daostar) — reference implementations, schemas, registration contracts
- [daostar-api](https://github.com/metagov/daostar-api) — API for publishing/hosting daoURI
- Registration factory: `0x2Dac5DBbF1D024c1E0D9c92D3AeDa7618e15aDd7` (Mainnet; check Base deployment)

**Fit with our system**: Excellent. Thin JSON-LD export layer on top of existing data. Does NOT change the financial ledger architecture — it's a metadata/discovery wrapper.

### Option B: DAOIP-4 Proposal Types + DAOIP-5 Grants Schema

**What**: Adopt the DAOIP-4 proposal type taxonomy and DAOIP-5 grants management schema for classifying our attribution epochs as a standardized "grant pool" mechanism.

**Pros**:

- DAOIP-4 covers `treasury/grant` and `treasury/budget` proposal types — maps to our epoch allocations
- DAOIP-5 grants schema (grantPoolsURI, applicationsURI) could wrap our attribution epochs as "automated grant rounds"
- Attestation architecture (DAOIP-3 → EAS) provides standards-compliant verification for our EIP-712 signed statements

**Cons**:

- Our attribution pipeline is significantly more sophisticated than the DAOIP-5 grants model — we'd be shoehorning
- DAOIP-5 is designed for human-submitted applications, not automated activity-based allocation
- Adds complexity for questionable interoperability gain (who would query our grants schema?)

**OSS tools**:

- DAOIP-5 JSON-LD schemas in [metagov/daostar](https://github.com/metagov/daostar/blob/main/DAOIPs/daoip-5.md)
- [daostar-Attestation-List-API](https://github.com/metagov/daostar-Attestation-List-API) — attestation indexer

**Fit with our system**: Poor for attribution; reasonable for future governance-voted USDC distributions (P1). Don't adopt now — revisit when governance proposals are real.

### Option C: Just Ship the Settlement Layer (Status Quo + MerkleDistributor)

**What**: Proceed with the Financial Ledger plan as-is: Beancount + MerkleDistributor + Operator Port. Ignore DAOstar standards entirely. Focus on treasury correctness, not ecosystem interop.

**Pros**:

- Fastest to production
- No standard alignment tax
- Uniswap MerkleDistributor is battle-tested, well-documented
- Beancount is the right tool for double-entry (crypto-native, text-file canonical, Python scripting)

**Cons**:

- Island solution — no discoverability, no interop with DAO tooling
- Miss opportunity to be indexed by DAOstar, Tally, DeepDAO, etc.
- When we want federation (P2), we'll need a standard metadata format anyway

**OSS tools**:

- [Uniswap/merkle-distributor](https://github.com/Uniswap/merkle-distributor) — core claim contract
- [beancount/beancount](https://github.com/beancount/beancount) v3 — canonical ledger
- [bgd-labs/merkle-distributor-v2](https://github.com/bgd-labs/merkle-distributor-v2) — Aave's multi-epoch extension

**Fit with our system**: Already the plan. Works. But leaves metadata/discoverability for later.

### Option D: Lightweight EIP-4824 + Ship Settlement (Recommended)

**What**: Implement EIP-4824 daoURI as a thin read-only API layer NOW (it's cheap). Proceed with MerkleDistributor + Beancount as planned. Don't adopt DAOIP-4/5 yet.

**Pros**:

- daoURI is a read-only metadata export — minimal implementation cost
- Gets Cogni indexed by the DAO ecosystem immediately
- `activityLogURI` publishes our attribution data in a standard format (even if richer than EIP-4824 requires)
- `contractsURI` publishes our Aragon deployment + future MerkleDistributor
- `membersURI` publishes token holders via our existing identity system
- Doesn't delay settlement work — it's an independent parallel task
- Sets up P2 federation properly (other nodes can discover us via daoURI)

**Cons**:

- Small additional task (1-2 days for the API endpoint + JSON-LD generation)
- Need to verify EIP-4824 registration contract exists on Base

**OSS tools**: Same as Option A + Option C combined

**Fit with our system**: Best of both worlds. Settlement architecture unchanged. Metadata layer added cheaply. Federation-ready.

## Recommendation

**Option D: Lightweight EIP-4824 + Ship Settlement.**

The key insight: **EIP-4824 and the Financial Ledger solve different problems.** EIP-4824 is metadata/discoverability ("what is this DAO?"). The Financial Ledger is settlement infrastructure ("where did the money go?"). They're complementary, not competing.

> **Cogni's attribution pipeline is the novel part.** Activity-based allocation with EIP-712 signed statements, LLM-powered enrichment, human review, and Merkle claim trees — no existing standard or OSS tool does this. The standards (EIP-4824) are just the wrapping paper for discoverability. Don't let standards alignment delay the actual product.
>
> Note: The pipeline has deterministic aspects (integer math, canonical hashing, largest-remainder rounding) but also includes LLM-powered enrichment and human review phases — it is NOT fully deterministic end-to-end. The determinism guarantees apply specifically to the allocation-through-statement path.

### What to adopt now:

1. **EIP-4824 daoURI** — Single `GET /api/v1/public/dao/metadata` endpoint returning JSON-LD. Sources from repo-spec.yaml + DB queries. ~1 day of work.
2. **Uniswap MerkleDistributor** — As planned. Consider [bgd-labs/merkle-distributor-v2](https://github.com/bgd-labs/merkle-distributor-v2) for multi-epoch support (avoids building a custom "ReusableMerkleDistributor").
3. **Beancount v3** — As planned. Journal generation from Temporal workflow.
4. **On-chain registration** — Register daoURI via EIP-4824 factory (if deployed on Base) or via Aragon's EIP-4824 integration.

### What to defer:

- DAOIP-4 proposal types — revisit when governance voting is real (P1)
- DAOIP-5 grants schema — doesn't fit automated attribution; revisit for manual grant programs
- DAOIP-3 attestations — our EIP-712 signatures are already stronger; revisit for cross-DAO portability (P2)
- DAOIP-8 security standard — good checklist but not blocking

### Don't reinvent:

| Component              | Use This                                             | Instead Of                   |
| ---------------------- | ---------------------------------------------------- | ---------------------------- |
| On-chain claims        | Uniswap MerkleDistributor (or bgd-labs v2)           | Custom distributor contract  |
| Claim tree computation | `@uniswap/merkle-distributor-sdk` / `merkle-tree.js` | Custom Merkle implementation |
| Canonical ledger       | Beancount v3                                         | Postgres-based ledger        |
| DAO metadata format    | EIP-4824 JSON-LD                                     | Custom metadata schema       |
| Member identity format | CAIP-10 (already used by our identity system)        | Custom identity format       |
| Governance token       | Aragon GovernanceERC20 (already deployed)            | Custom ERC-20                |

## Open Questions

1. **Is EIP-4824 registration contract deployed on Base?** Need to verify. If not, can register via ENS text record or DNS TXT record (DAOIP-6).
2. **bgd-labs/merkle-distributor-v2 vs custom ReusableMerkleDistributor** — The Aave v2 contract supports multi-epoch distribution natively. May eliminate need for our custom "ReusableMerkleDistributor" spec. Needs audit review.
3. **Beancount v3 Python ↔ TypeScript bridge** — Our stack is TypeScript. Beancount is Python. Options: subprocess calls to `bean-check`, Python microservice, or WASM compilation. Research needed.
4. **activityLogURI richness** — EIP-4824 activity schema is `{ id, type, member, proposal }`. Our attribution data is much richer. Publish the standard format AND a custom extension? Or just use the standard fields and link to our full API?
5. **Operator Port design** — Not covered by any DAOstar standard. Still needs custom spec. Consider Safe{Wallet} modules or Gnosis Safe as the signing infrastructure.

## Proposed Layout

### No new project needed

EIP-4824 adoption is a **task within `proj.financial-ledger`** (Crawl phase), not a separate project. It's a metadata export endpoint, not infrastructure.

### Spec updates

| Spec                            | Change                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `docs/spec/financial-ledger.md` | Add "DAO Metadata (EIP-4824)" section: daoURI generation, JSON-LD schema, registration method |
| `.cogni/repo-spec.yaml`         | Add `dao_info: { name, description }` fields (currently missing)                              |

### Proposed tasks (PR-sized)

| Task                                    | Scope                                                                                                                                                                            | Est |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `task.0134.eip4824-daouri-endpoint`     | `GET /api/v1/public/dao/metadata` — JSON-LD from repo-spec + DB. Includes `membersURI`, `proposalsURI` (epochs), `activityLogURI` (attribution), `contractsURI`, `governanceURI` | 1   |
| `task.XXXX.eip4824-registration`        | Register daoURI on-chain (factory or ENS) + verify on DAOstar explorer                                                                                                           | 1   |
| `task.XXXX.merkle-distributor-evaluate` | Evaluate bgd-labs/merkle-distributor-v2 vs custom ReusableMerkleDistributor. Audit contract, test on Base testnet                                                                | 1   |
| `task.XXXX.beancount-bridge-spike`      | Research Beancount v3 ↔ TypeScript integration (subprocess vs microservice vs WASM)                                                                                             | 1   |

### Sequence

```
eip4824-daouri-endpoint (independent, can start now)
  → eip4824-registration (after endpoint ships)

merkle-distributor-evaluate (independent, can start now)
  → informs ReusableMerkleDistributor contract choice for Crawl P0

beancount-bridge-spike (independent, can start now)
  → informs journal generation architecture for Crawl P0
```

All three tracks are independent. daoURI endpoint is the quick win that immediately increases ecosystem visibility.
