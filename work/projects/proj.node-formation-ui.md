---
id: proj.node-formation-ui
type: project
primary_charter:
title: Node Formation UI & CLI Tooling
state: Active
priority: 2
estimate: 5
summary: Extend DAO formation beyond the initial web wizard — rewards-ready token mint mode, optional legal entity formation (OtoCo LLC), CLI setup tools, federation enrollment, and encoding parity tests
outcome: Complete formation pipeline with rewards-ready GovernanceERC20 setup, optional on-chain LLC incorporation, CLI tooling, federation enrollment, and automated e2e testing
assignees: derekg1729
created: 2026-02-07
updated: 2026-03-09
labels: [web3, setup, cli, legal]
---

# Node Formation UI & CLI Tooling

> Source: docs/spec/node-formation.md

## Goal

Extend the P0 web DAO formation wizard (complete, manually validated on Base mainnet) to cover rewards-ready token mint configuration, optional legal entity formation (OtoCo LLC wrapper), CLI-based setup tooling, automated e2e testing, encoding parity validation, and federation enrollment.

> Research: [On-Chain Entity Formation (OtoCo)](../../docs/research/onchain-entity-formation-otoco.md) — OSS evaluation of OtoCo, KaliDAO, MIDAO for legal entity wrapping. Aragon remains the governance layer; OtoCo is complementary (legal identity only).

## Roadmap

### Crawl (P0) — Remaining P0 Items

**Goal:** Close remaining P0 gaps and make the token setup compatible with real contributor distributions.

| Deliverable                                                                                                                                                                                                                                         | Status      | Est | Work Item   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --- | ----------- |
| Rewards-ready mint mode — fixed `GovernanceERC20` supply minted to a DAO-controlled emissions holder, with server verification of holder + total supply                                                                                             | Not Started | 2   | `task.0135` |
| Automated e2e testing (DAO formation flow with testnet)                                                                                                                                                                                             | Not Started | 2   | —           |
| Encoding parity test: TokenVoting setup encoding must match Foundry exactly (`packages/aragon-osx/src/__tests__/encoding.parity.test.ts`). Fixture generation: Run Foundry script with known inputs, capture encoded bytes, commit as test fixture. | Not Started | 2   | —           |

### Walk (P1) — Legal Entity Formation + Multi-Holder + CLI Setup Tools

**Goal:** Optional on-chain LLC formation via OtoCo, multi-holder support, CLI setup tools, and operator node registry.

| Deliverable                                                                                                     | Status      | Est | Work Item            |
| --------------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| OtoCo testnet validation — verify Base Sepolia contracts, createSeries events, GovernanceERC20 token attachment | Not Started | 2   | `spike.0146`         |
| OtoCo ABI + receipt decoder — add OtoCo ABIs, implement receipt decoders for entity creation events             | Not Started | 2   | (create after spike) |
| Formation wizard TX 3+4 — optional "Incorporate as LLC" step, state machine extension                           | Not Started | 2   | (create after spike) |
| Server verification for OtoCo entity — extend verify endpoint, add `legal_entity` to repo-spec YAML output      | Not Started | 2   | (create after spike) |
| Multi-holder support (multiple initial token recipients)                                                        | Not Started | 2   | (create at P1 start) |
| Create `packages/setup-cli/` with Node adapters (fs, shell, gh, tofu)                                           | Not Started | 3   | (create at P1 start) |
| Implement `pnpm setup local` for contributor workflow                                                           | Not Started | 2   | (create at P1 start) |
| Implement `pnpm setup infra --env preview\|production`                                                          | Not Started | 2   | (create at P1 start) |
| Implement `pnpm setup github --env preview\|production`                                                         | Not Started | 2   | (create at P1 start) |
| Add WalletConnect adapter (CLI wallet signing if proven needed)                                                 | Not Started | 1   | (create at P1 start) |
| Operator-side `node_registry_nodes` table (see Design Notes §Operator Node Registry)                            | Not Started | 2   | (create at P1 start) |

### Run (P2+) — npx End-to-End + Federation Enrollment

**Goal:** Full npx-based onboarding and federation enrollment.

| Deliverable                                                                                              | Status      | Est | Work Item            |
| -------------------------------------------------------------------------------------------------------- | ----------- | --- | -------------------- |
| Evaluate P1 adoption before building npx flow                                                            | Not Started | 1   | (create at P2 start) |
| npx-based repo clone + init + DAO formation flow                                                         | Not Started | 3   | (create at P2 start) |
| Node-side persistence — Store formations in local `node_formations` table after verify succeeds          | Not Started | 2   | (create at P2 start) |
| Stable fingerprints — Verify endpoint emits `repo_spec_hash`, `cred_policy_hash`, `template_commit_hash` | Not Started | 2   | (create at P2 start) |
| Signed policy files — `.cogni/cred-policy.json` + `.cogni/cred-policy.sig` (detached signatures)         | Not Started | 2   | (create at P2 start) |
| Operator enrollment API — `POST /api/federation/enroll` with founder signature                           | Not Started | 2   | (create at P2 start) |
| Optional enroll UI — Post-formation button: "Enroll in Cogni Federation"                                 | Not Started | 1   | (create at P2 start) |

## Constraints

- Node Formation is Node-owned tooling — no Operator dependencies
- No private key env vars — all transactions signed via wallet UI
- Server derives ALL addresses from tx receipts (never trusts client)
- Rewards-ready formation must reuse the same `GovernanceERC20` later used for distributions; do not introduce a throwaway bootstrap token path
- Package isolation: `aragon-osx` cannot import `src/`, `services/`, or browser/node-specific APIs
- Import boundaries: `packages/setup-cli` → `packages/aragon-osx` allowed; → `src/*`, `services/*` forbidden
- **Do NOT build npx flow preemptively** — evaluate after P1 adoption

## Dependencies

- [ ] Foundry fixtures for encoding parity test
- [ ] Testnet infrastructure for automated e2e
- [ ] `task.0135` — rewards-ready token formation governance decisions + implementation
- [ ] `spike.0146` — OtoCo testnet validation (P1 entity formation depends on this)
- [ ] P1 adoption metrics before building npx flow

## As-Built Specs

- [node-formation.md](../../docs/spec/node-formation.md) — P0 formation invariants, tech stack, server verification, schemas
- [onchain-entity-formation-otoco.md](../../docs/research/onchain-entity-formation-otoco.md) — OtoCo research: OSS status, alternatives, crawl-walk-run plan

## Design Notes

### Operator Node Registry (P1)

**Purpose:** Operator-side derived index for control-plane functions (entitlements, service routing). Does NOT violate Node sovereignty.

**Source of Truth:** On-chain receipts + Node-authored `repo-spec.yaml`. Operator table is rebuildable from these.

**Table:** `node_registry_nodes` (Operator DB, not Node DB)

| Column              | Type | Notes                                  |
| ------------------- | ---- | -------------------------------------- |
| `node_id`           | UUID | PK, Operator's canonical tenant key    |
| `chain_id`          | INT  | Network identifier                     |
| `dao_address`       | TEXT | From DAORegistered event               |
| `token_address`     | TEXT | From TokenVoting.getVotingToken()      |
| `plugin_address`    | TEXT | From InstallationApplied event         |
| `signal_address`    | TEXT | From CogniSignal deployment receipt    |
| `formation_tx_hash` | TEXT | Auditable reference to on-chain tx     |
| `repo_spec_hash`    | TEXT | Proves Operator consumed Node's policy |
| `status`            | TEXT | pending → confirmed → (reorged if bad) |

**Write Rules:**

- Insert only after server-side receipt verification succeeds
- Upsert on `(chain_id, formation_tx_hash)` to prevent duplicates
- Never delete; mark `reorged` if invalidated

**Sovereignty Invariants:**

- No private keys stored (addresses + receipts only)
- Node operation does not depend on this table
- Operator can rebuild from on-chain data

> See: [Node vs Operator Contract](../../docs/spec/node-operator-contract.md)

### Federation Enrollment (P2+)

**Goal:** Federation legitimacy requires opt-in enrollment; hostile forks cannot inherit it.

**Build Order:**

1. **Node-side persistence** — Store formations in local `node_formations` table after verify succeeds
2. **Stable fingerprints** — Verify endpoint emits `repo_spec_hash`, `cred_policy_hash`, `template_commit_hash`
3. **Signed policy files** — `.cogni/cred-policy.json` + `.cogni/cred-policy.sig` (detached signatures)
4. **Operator enrollment API** — `POST /api/federation/enroll` with founder signature
5. **Optional enroll UI** — Post-formation button: "Enroll in Cogni Federation"

**Licensing Policy:** Source-available (PolyForm Shield); forks permitted. Federation benefits (badges, payouts, datasets) require enrollment with signed CogniCred config. Non-compliant forks lose federation features, not code access.

> Full spec: [Cred Licensing Policy](../../docs/spec/cred-licensing-policy.md)

**Scope guardrails:** Formation stays Node-owned. No on-chain registry in MVP. No multi-holder prerequisite.

### OtoCo Legal Entity Formation (P1)

> Research: [onchain-entity-formation-otoco.md](../../docs/research/onchain-entity-formation-otoco.md)

**Why OtoCo, not a governance replacement?** Aragon remains our governance layer (GovernanceERC20 + TokenVoting). OtoCo is a **complementary legal identity layer** — it wraps an existing DAO with a real-world LLC. OtoCo has [documented Aragon integration](https://legacy-docs.aragon.org/products/aragon-client/things-to-do-after-youve-started-a-dao/legal-integration-with-otoco). No governance conflict.

**Alternatives evaluated and rejected:**

- **KaliDAO** — has its own governance token + voting system. Would duplicate Aragon. Wrong fit.
- **MIDAO** — not OSS, requires Marshall Islands PPP intermediary. No smart contract integration.
- **DIY formation** — manual, not wallet-native. Defeats the purpose.

**Integration approach:** After DAO creation (TX 1) and CogniSignal deployment (TX 2), the wizard offers an optional "Incorporate as LLC" step:

- TX 3: `OtoCoMaster.createSeries(jurisdiction, controller, name)` — mints ERC-721 entity NFT
- TX 4: `attachToken(entityTokenId, aragonTokenAddress)` — mirrors token holders as LLC members

**Key design decisions:**

- **ENTITY_OPTIONAL**: Legal entity formation is opt-in. Nodes operate fine without it.
- **ENTITY_SERVER_VERIFIED**: Server derives entity details from OtoCo receipt (same trust boundary as DAO verification).
- **ENTITY_IN_REPO_SPEC**: Entity details recorded in `repo-spec.yaml` under `legal_entity` key.
- **NO_CUSTOM_CONTRACTS**: We call OtoCo's deployed contracts, not deploy our own.

**Financial Ledger interaction:** OtoCo's `attachToken()` reads GovernanceERC20 holders for LLC membership mirroring. After `task.0135` (rewards-ready mint), the emissions holder address will appear as a "member." This is cosmetic — OtoCo membership is informational, not governance-binding. Token distribution via MerkleDistributor (`proj.financial-ledger`) is unaffected.

**Pricing:** $99/year Delaware LLC, $99/year Wyoming LLC. Annual fee for registered agent service.

**Risk:** If OtoCo disappears, the LLC still exists in state records but renewals require manual filing. The OtoCo smart contracts are OSS ([github.com/otoco-io/SmartContract](https://github.com/otoco-io/SmartContract)) and audited (Coinspect 2022), so worst case we could fork the frontend.
