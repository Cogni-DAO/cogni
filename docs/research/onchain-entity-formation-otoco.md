---
id: onchain-entity-formation-otoco
type: research
title: "On-Chain Entity Formation (OtoCo & Alternatives)"
status: draft
trust: draft
summary: Research into OtoCo and alternatives for on-chain legal entity formation for Cogni Nodes
read_when: Working on legal entity formation, LLC wrappers, or Node Formation wizard
owner: derekg1729
created: 2026-03-09
verified:
tags: [web3, formation, legal, research]
---

# Research: On-Chain Entity Formation (OtoCo & Alternatives)

> spike: (ad-hoc research) | date: 2026-03-09

## Question

How much of OtoCo's on-chain entity formation is OSS? What can/should CogniDAO adopt so that each individual Node can be a registered on-chain legal entity? What's the crawl-walk-run path that maximizes OSS and minimizes custom engineering?

## Context

CogniDAO Nodes are sovereign DAO+app instances deployed via the Node Formation wizard (see [node-formation spec](../spec/node-formation.md)). Today, formation deploys an Aragon DAO (GovernanceERC20 + TokenVoting) and a CogniSignal contract — but the resulting entity has **no legal personality**. It can't sign contracts, open bank accounts, or limit member liability.

OtoCo (otoco.io) is an on-chain entity formation platform that creates real-world LLCs (Delaware, Wyoming) and associations (Swiss, DUNA) directly from a wallet. The user asked: how much is OSS, and can we integrate it into Node Formation?

### What exists today in this repo

- **Node Formation Wizard** (`src/features/setup/`) — 2-tx wallet flow: `createDao` + `deployCogniSignal`, server-side receipt verification
- **Aragon OSx package** (`packages/aragon-osx/`) — encoding, receipt decoders, address constants (Base + Sepolia)
- **Operator Wallet** (`src/adapters/server/wallet/`) — Privy-managed server wallet for outbound payments
- **Splits integration** — revenue sharing between operator wallet and DAO treasury

## Findings

### Option A: OtoCo Integration (Recommended for P0)

**What**: OtoCo provides instant on-chain LLC formation via smart contracts. User calls `createSeries()` on OtoCoMaster, which mints an ERC-721 NFT representing entity ownership. Plugins attach governance tokens, multisig, ENS, etc.

**OSS Status**:

- **Smart contracts: YES, open source** — [github.com/otoco-io/SmartContract](https://github.com/otoco-io/SmartContract) (15 stars, 10 forks, last updated Jan 2026)
- **Frontend: partially open** — WebClient_ERC20 and ClientWebApp repos exist but are outdated (2023)
- **Documentation: YES** — [otoco-wiki](https://github.com/otoco-io/otoco-wiki) (GPL-3.0, 19 stars)
- **Subgraph: YES** — [OtoCo-Subgraph](https://github.com/otoco-io/OtoCo-Subgraph) (TypeScript)
- **Audit: YES** — Coinspect audit May 2022, issues resolved

**Key contracts**:

- `OtoCoMaster.sol` — entity creation, ERC-721 ownership tracking, fee management
- `OtoCoJurisdiction.sol` — jurisdiction-specific naming rules (Delaware, Wyoming, etc.)
- `OtoCoPlugin.sol` — extensible plugin architecture (Token, Multisig, ENS, etc.)
- Key function: `createSeries(uint16 jurisdiction, address controller, string name)`

**Supported chains**: Ethereum, Polygon, Base (confirmed on otoco.io — Base is listed)

**Pricing**: $99/year (Delaware LLC), $99/year (Wyoming LLC), $299/year (Swiss Association), $499/year (DUNA)

**Aragon integration**: OtoCo has [documented integration with Aragon DAOs](https://legacy-docs.aragon.org/products/aragon-client/things-to-do-after-youve-started-a-dao/legal-integration-with-otoco) — connect wallet → form LLC → attach DAO token → token holders become LLC members. This is directly relevant since we already use Aragon OSx.

**Pros**:

- Smart contracts are OSS and audited
- Already deployed on Base (our target chain)
- Aragon integration documented
- Real-world legal entities (Delaware LLC = actual liability protection)
- Plugin architecture aligns with our composable approach
- NFT-based ownership = portable, on-chain provable
- $99/year is trivially cheap
- No custom smart contracts to write or audit

**Cons**:

- Annual service fee (not purely decentralized — OtoCo is the registered agent)
- OtoCo frontend is NOT well-maintained OSS (would need our own UI)
- Smart contracts are OSS but OtoCo controls deployed instances (we'd call their deployed contracts, not deploy our own)
- If OtoCo goes down, entity maintenance (renewals, compliance) requires manual intervention
- Smart contract repo has only 15 stars — small community
- Contracts are upgradeable (OtoCo controls the proxy)

**Fit with our system**: HIGH. Same chain (Base), same wallet flow (wagmi), same pattern (2-tx wizard). Could be TX 3 in formation flow or a post-formation "Incorporate" step.

### Option B: KaliDAO (Alternative OSS)

**What**: KaliDAO is a DAO-native governance protocol with built-in LLC formation via Delaware Series LLC. Comp-style token voting with legal wrapper integration.

**OSS Status**:

- **Smart contracts: YES** — [github.com/kalidao/kali-contracts](https://github.com/kalidao/kali-contracts) (AGPL-3.0, 60 stars, 214 commits)
- **Legal templates: YES** — [github.com/kalidao/kali-legal](https://github.com/kalidao/kali-legal) (Delaware OA templates in markdown)
- **Documentation: YES** — [github.com/kalidao/kali-docs](https://github.com/kalidao/kali-docs)

**Key features**: 11 proposal types, meta-transaction support, NFT vault, gas-optimized (Solmate patterns)

**Pros**:

- More stars (60 vs 15), AGPL license
- Built-in governance (but we already have Aragon)
- Legal templates are OSS
- LexDAO network for legal support

**Cons**:

- Governance model conflicts with Aragon (we'd have two governance systems)
- Only documented on Rinkeby testnet (deprecated)
- Unclear if actively deployed on Base
- Would require replacing our Aragon stack, which is already working
- LLC formation is via LexDAO/Tally partnership, not purely on-chain

**Fit with our system**: LOW. We'd be replacing Aragon with Kali for governance, which is backwards. The legal templates are useful reference material though.

### Option C: MIDAO (Marshall Islands DAO LLC)

**What**: Government-authorized DAO LLC registration in the Marshall Islands. On-chain governance recognized by actual government.

**Pros**:

- Government-recognized DAO LLC
- Smart contract governance officially valid
- No US nexus requirements

**Cons**:

- Not open source — MIDAO is a private PPP with the Marshall Islands government
- Requires working through MIDAO Directory Services
- No smart contract integration we can call
- International jurisdiction adds complexity

**Fit with our system**: LOW for P0. Could be a jurisdiction option in the future.

### Option D: DIY Legal Formation + On-Chain Record

**What**: Use traditional formation services (e.g., doola, Stripe Atlas) and record the entity on-chain ourselves.

**Pros**:

- No dependency on crypto-native formation services
- Well-understood legal process

**Cons**:

- Manual, not wallet-native
- No on-chain composability
- Defeats the purpose of "instant on-chain entity"

**Fit with our system**: FALLBACK only.

## Recommendation

**OtoCo for P0, with a clean integration boundary.**

### Why OtoCo

1. **Already on Base** — same chain as our Aragon deployment
2. **Aragon integration is documented** — OtoCo was literally designed to work with Aragon DAOs
3. **Smart contracts are OSS and audited** — we can read, verify, and fork if needed
4. **$99/year is negligible** — the convenience of instant LLC formation is worth it
5. **No custom contracts** — we call OtoCo's deployed `createSeries()`, not deploy our own
6. **NFT = proof of entity** — ownership is on-chain, transferable, composable

### Crawl-Walk-Run

**Crawl (P0)**: Add OtoCo LLC formation as an optional step in Node Formation wizard. After DAO creation (TX 1) and CogniSignal deployment (TX 2), offer "Incorporate as LLC" (TX 3 — calls OtoCo `createSeries`). Then TX 4 — attach Aragon token to OtoCo entity. Server verifies OtoCo receipt + stores entity NFT token ID in repo-spec. Total: 4 wallet txs.

**Walk (P1)**: Add OtoCo entity management to Node dashboard — renewal reminders, member management via token holder sync, document library integration. Record entity details in `repo-spec.yaml` (`legal_entity.type`, `legal_entity.jurisdiction`, `legal_entity.otoco_token_id`).

**Run (P2)**: Evaluate whether to fork OtoCo contracts for self-deployment (remove service dependency) or integrate alternative jurisdictions (DUNA, Swiss). Consider KaliDAO's OSS legal templates for custom operating agreements.

### Trade-offs Accepted

- **Service dependency on OtoCo** — they maintain the registered agent relationship. If OtoCo disappears, the LLC still exists but renewals require manual filing. Acceptable for P0.
- **Upgradeable proxy risk** — OtoCo controls the master contract. Mitigated by: (a) entity NFT is in your wallet regardless, (b) LLC exists in state records independently of smart contract, (c) we verify on-chain state server-side.
- **$99/year ongoing cost** — trivial for any real organization. Free formation, annual fee for registered agent.

## Open Questions

- [ ] Are OtoCo's contracts deployed on Base Sepolia (testnet)? Need this for dev/test flow.
- [ ] What events does `createSeries()` emit? Need for server-side receipt verification (same pattern as Aragon receipt decoders).
- [ ] Can OtoCo's `attachToken()` plugin work with Aragon's GovernanceERC20, or only standard ERC-20?
- [ ] What happens to the LLC if the OtoCo NFT is burned or transferred? Does the legal entity transfer?
- [ ] Is the $99/year paid on-chain or off-chain? If on-chain, can we automate renewal from the operator wallet?

## Proposed Layout

### Project

This would extend the existing **Node Formation** project scope, not warrant a new project. Add an "Entity Formation" phase to the node-formation project.

### Specs

1. **Update `node-formation.md`** — Add entity formation as optional TX 3+4 in the wizard flow. New invariants:
   - `ENTITY_OPTIONAL`: Legal entity formation is opt-in, never required for Node operation
   - `ENTITY_SERVER_VERIFIED`: Server derives OtoCo entity details from receipt (same trust boundary as DAO verification)
   - `ENTITY_IN_REPO_SPEC`: Entity details recorded in `repo-spec.yaml` under `legal_entity` key

2. **New section in `node-formation.md`** (not a separate spec) — OtoCo integration details:
   - OtoCo contract addresses per chain
   - `createSeries()` call parameters
   - Receipt decoder for entity creation events
   - Token attachment flow

### Tasks (rough sequence)

1. **spike: OtoCo testnet validation** — Verify OtoCo contracts on Base Sepolia, document `createSeries()` events, test `attachToken()` with GovernanceERC20
2. **task: OtoCo ABI + receipt decoder** — Add OtoCo ABIs to `packages/aragon-osx/` (or new `packages/entity-formation/`), implement receipt decoders for entity creation events
3. **task: Formation wizard TX 3+4** — Add optional "Incorporate" step to wizard UI, state machine extension (DEPLOYING_SIGNAL → FORMING_ENTITY → ATTACHING_TOKEN → VERIFYING)
4. **task: Server verification for entity** — Extend verify endpoint to handle OtoCo receipt verification, add `legal_entity` to repo-spec YAML output
5. **task: repo-spec schema extension** — Add `legal_entity` fields to repo-spec schema and validation

## Sources

- [OtoCo Platform](https://otoco.io/)
- [OtoCo Smart Contracts (GitHub)](https://github.com/otoco-io/SmartContract)
- [OtoCo Wiki (GitHub)](https://github.com/otoco-io/otoco-wiki)
- [OtoCo Documentation](https://otoco.gitbook.io/otoco/the-master-smart-contracts)
- [Aragon + OtoCo Integration Guide](https://legacy-docs.aragon.org/products/aragon-client/things-to-do-after-youve-started-a-dao/legal-integration-with-otoco)
- [KaliDAO Contracts (GitHub)](https://github.com/kalidao/kali-contracts)
- [KaliDAO Legal Templates (GitHub)](https://github.com/kalidao/kali-legal)
- [MIDAO](https://midao.org/)
- [The Accountant Quits — OtoCo Review](https://www.theaccountantquits.com/tools/otoco)
- [DAO Legal Wrappers Guide (Aragon)](https://www.aragon.org/how-to/choose-a-legal-wrapper-for-your-dao)
- [DAO LLC Formation Guide (Astraea)](https://astraea.law/insights/dao-llc-formation-wyoming-duna-guide-2025)
