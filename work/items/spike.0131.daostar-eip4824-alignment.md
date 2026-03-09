---
id: spike.0131
type: spike
title: "Research DAOstar / EIP-4824 alignment for Financial Ledger"
status: done
priority: 1
estimate: 1
summary: "Research whether Cogni should adopt DAOstar standards (EIP-4824, DAOIPs) as the metadata/identity layer for the Financial Ledger project. Evaluate OSS alternatives to custom builds."
outcome: "Recommend lightweight EIP-4824 daoURI adoption (thin API endpoint) alongside planned MerkleDistributor + Beancount settlement. Don't reinvent DAO metadata — adopt the standard. Don't adopt DAOIP-4/5 yet (poor fit for automated attribution)."
spec_refs:
assignees: derekg1729
credit:
project: proj.financial-ledger
branch: fix/epoch-finalization
pr:
reviewer:
created: 2026-03-03
updated: 2026-03-03
labels: [dao, standards, treasury, web3]
external_refs:
  - docs/research/daostar-eip4824-alignment.md
revision: 0
blocked_by:
deploy_verified: false
rank: 99
---

# Spike: DAOstar / EIP-4824 Alignment for Financial Ledger

## Research Question

Should Cogni adopt DAOstar standards (EIP-4824, DAOIPs) for DAO metadata, identity, and interoperability? What OSS can replace custom builds in the Financial Ledger project?

## Key Findings

1. **EIP-4824 is a metadata layer, not settlement infrastructure** — complementary to our Financial Ledger plan, not competing.
2. **Cogni already has ~80% of the data EIP-4824 requires** — the gap is standardized export format, not missing data.
3. **daoURI endpoint is ~1 day of work** — thin JSON-LD export from repo-spec.yaml + DB queries.
4. **bgd-labs/merkle-distributor-v2** may eliminate need for custom ReusableMerkleDistributor contract.
5. **Beancount v3** is correct tool but needs TypeScript bridge research (subprocess, microservice, or WASM).
6. **DAOIP-4/5** (proposal types, grants schema) are poor fit for automated attribution — revisit at P1.

## Recommendation

**Option D: Lightweight EIP-4824 + Ship Settlement.** Add daoURI as cheap metadata layer. Proceed with MerkleDistributor + Beancount as planned. Don't adopt DAOIP-4/5 yet.

## Validation

- [x] Research document published: `docs/research/daostar-eip4824-alignment.md`
- [x] Options evaluated with pros/cons/OSS tools
- [x] Recommendation provided with concrete next tasks
- [x] Open questions documented

## Follow-up Items Created

- Research doc: [daostar-eip4824-alignment.md](../../docs/research/daostar-eip4824-alignment.md)
- Proposed tasks documented in research doc (not yet created as work items — needs triage)
