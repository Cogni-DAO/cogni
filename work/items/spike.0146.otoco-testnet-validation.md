---
id: spike.0146
type: spike
title: "OtoCo testnet validation — verify Base Sepolia contracts, createSeries events, GovernanceERC20 token attachment"
status: needs_triage
priority: 2
rank: 99
estimate: 2
summary: "Validate OtoCo smart contracts on Base Sepolia testnet. Document createSeries() events for server-side receipt verification. Test attachToken() plugin with Aragon GovernanceERC20. Determine if annual fee is on-chain or off-chain."
outcome: "A research document confirming: (1) OtoCo testnet contract addresses on Base Sepolia, (2) createSeries() event ABI for receipt decoding, (3) GovernanceERC20 compatibility with OtoCo token plugin, (4) fee payment mechanism. Ready for implementation tasks."
spec_refs: node-formation-spec
assignees: derekg1729
credit:
project: proj.node-formation-ui
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
claimed_by_run:
claimed_at:
last_command:
created: 2026-03-09
updated: 2026-03-09
labels: [web3, formation, legal]
external_refs:
  - docs/research/onchain-entity-formation-otoco.md
---

# OtoCo Testnet Validation

## Context

Research ([onchain-entity-formation-otoco.md](../../docs/research/onchain-entity-formation-otoco.md)) identified OtoCo as the best-fit OSS on-chain entity formation platform for Cogni Nodes. Before implementation, we need to validate the integration on testnet.

## Questions to Answer

1. Are OtoCo contracts deployed on Base Sepolia? If not, which testnet?
2. What events does `createSeries(uint16 jurisdiction, address controller, string name)` emit? Need exact event signatures for receipt decoders.
3. Can `attachToken()` plugin work with Aragon's GovernanceERC20 token, or only standard ERC-20?
4. Is the $99/year fee paid on-chain (automatable from operator wallet) or off-chain?
5. What happens to the LLC if the OtoCo NFT is transferred or burned?

## Validation

- [ ] Testnet contract addresses documented
- [ ] `createSeries()` called successfully on testnet with a wallet
- [ ] Event ABI captured and receipt decoder sketched
- [ ] `attachToken()` tested with an ERC-20 (preferably GovernanceERC20)
- [ ] Fee mechanism documented
