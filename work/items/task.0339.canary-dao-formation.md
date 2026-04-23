---
id: task.0339
type: task
title: "Canary — fresh DAO formation with Derek + Privy-owned operator wallet"
status: needs_implement
priority: 1
estimate: 2
rank: 3
summary: "Create the canary's own DAO on-chain. Two signers: Derek's wallet and a new Privy-managed operator wallet owned by the canary. Paste resulting addresses into `nodes/canary/.cogni/repo-spec.yaml`. Fund with $20 USDC cushion."
outcome: "`nodes/canary/.cogni/repo-spec.yaml` has real `cogni_dao.dao_contract`, `plugin_contract`, `signal_contract`, `operator_wallet.address`, and `payments_in.credits_topup.receiving_address` values. On-chain DAO is signable by both Derek and the canary Privy wallet. Runbook at `docs/runbooks/CANARY_DAO_FORMATION.md` is the authoritative procedure."
spec_refs:
  - canary
  - node-formation
  - operator-wallet
assignees: derekg1729
project: proj.cogni-canary
created: 2026-04-20
updated: 2026-04-20
labels: [canary, dao, web3, privy]
external_refs:
  - docs/guides/node-formation-guide.md
  - docs/guides/operator-wallet-setup.md
  - docs/runbooks/CANARY_DAO_FORMATION.md
---

# Canary DAO formation

## Context

Every other node inherits the cogni-template parent DAO. The canary gets its own DAO so that revenue, governance, and blast radius are cleanly separable from the operator DAO. Two signers is the minimum that gives the canary transactional autonomy (its Privy wallet can initiate) while keeping Derek in the approval loop (co-sign required).

## Procedure (Derek-executed)

Full steps in `docs/runbooks/CANARY_DAO_FORMATION.md`. Short form:

1. Provision a Privy-managed wallet via the operator's `/setup/dao/payments` flow (or manually via Privy console). Record the address.
2. Fund the Privy wallet with ~$5 ETH on Base mainnet (gas cushion for formation txs + ongoing ops).
3. Navigate to `/setup/dao` on preview or locally. Run the formation wizard with:
   - `initialHolder` = Derek's wallet (to satisfy 1e18 balance invariant)
   - After formation, upgrade plugin settings to include the Privy wallet as a second signer (requires `PluginSetupProcessor.applyUpdate` call; not in wizard yet — manual for v0)
4. Copy server-returned `repoSpecYaml` block into `nodes/canary/.cogni/repo-spec.yaml`.
5. Deploy a Split contract via `/setup/dao/payments` with split = 100% canary wallet (no operator share — canary is its own economic actor).
6. Fund canary Privy wallet with $20 USDC on Base for operating cushion.
7. Commit the updated `repo-spec.yaml` as a follow-up PR.

## Deliverables

- [x] `docs/runbooks/CANARY_DAO_FORMATION.md` — runbook (this PR)
- [ ] Privy wallet created + address captured (Derek)
- [ ] DAO deployed on Base mainnet (Derek)
- [ ] Second-signer added via `PluginSetupProcessor.applyUpdate` (Derek)
- [ ] Split contract deployed, 100% canary wallet (Derek)
- [ ] `nodes/canary/.cogni/repo-spec.yaml` populated (Derek — follow-up PR)
- [ ] Canary wallet funded with $20 USDC (Derek)

## Validation

- `exercise:` — `balanceOf(derek.address)` on canary token == `1e18`; `CogniSignal.DAO()` matches deployed DAO; `TokenVoting.supportsInterface(IMembership)` returns true and membership includes both Derek and the Privy wallet.
- `observability:` — Aragon app for Base shows the canary DAO with 2 listed members.

## Non-goals

- Upgrading past 2 signers (gated on CP5)
- Migrating existing operator/poly/resy nodes to this pattern
