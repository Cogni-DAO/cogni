# Canary DAO Formation — Runbook

> Owner: derekg1729
> Last verified: 2026-04-20 (scaffold)
> Tracks: [task.0339](../../work/items/task.0339.canary-dao-formation.md), [proj.cogni-canary](../../work/projects/proj.cogni-canary.md)

## When to run

You (Derek) are bringing the Cogni Canary node online after its scaffold PR merges. The canary needs its own DAO, its own operator wallet, and its own payments rail before any scheduled 4o-mini brain can legally route funds.

**Prerequisites:**

- [ ] Scaffold PR merged to `main` (contains `nodes/canary/`, `infra/catalog/canary.yaml`, `.cogni/repo-spec.yaml` entry)
- [ ] task.0338 merged (CI wiring + k8s overlays + Caddy + DNS) — so `canary-candidate-a.cognidao.org` resolves and has a running pod
- [ ] Your wallet (`0x070075F1...`) has ~$5 ETH on Base mainnet for gas (2 formation txs + applyUpdate tx + Split deploy tx ≈ 4 txs total)
- [ ] RainbowKit connected in the running app and switched to **Base mainnet (8453)**

## Wallet model

Two signers will be configured on the canary DAO:

| Signer                | Role                  | Address source                                                                |
| --------------------- | --------------------- | ----------------------------------------------------------------------------- |
| Derek EOA             | Co-sign authority     | Your existing wallet (`0x070075F1389Ae1182aBac722B36CA12285d0c949` or current) |
| Canary Privy wallet   | Autonomous initiator  | Provisioned in Step 1 below; canary-owned, Privy-custodied                     |

Neither signer can unilaterally move treasury — any tx against the canary DAO requires the other's co-sign. This is the minimum that gives the canary initiator-level autonomy while keeping a human approval gate.

## Procedure

### Step 1 — Provision canary Privy wallet

Options, in order of preference:

**A. Use the existing Privy app (fastest, reuses operator infra)**

1. Open the operator app locally (`pnpm dev`) or on preview.
2. Navigate to `/setup/dao/payments`.
3. Click "Provision new Privy wallet" — this creates a fresh EOA custodied by Privy.
4. Copy the returned address. Record it somewhere safe (NOT committed to git yet; you'll paste into `repo-spec.yaml` at Step 6).

**B. Use Privy console directly**

1. Go to https://dashboard.privy.io → your app → Wallets → Create wallet.
2. Select "Server wallet" type, label it `cogni-canary-operator`.
3. Copy the address.

**C. Raw ethers keypair** (fallback — least preferred; no Privy session)

1. `openssl rand -hex 32` → secp256k1 private key.
2. Derive address via `ethers.Wallet(key).address`.
3. Store the private key in the canary Privy vault anyway (use the Privy import flow) so the canary can sign without a raw-PK env var.

### Step 2 — Fund the Privy wallet

Send **~$5 ETH on Base** to the wallet from Step 1 (gas cushion). Use Basescan to confirm balance.

You'll also want **$20 USDC on Base** eventually for the operating cushion, but that can wait until after Step 7.

### Step 3 — Run the formation wizard

1. Navigate to `/setup/dao` in the running app.
2. Wizard fields:
   - `tokenName`: `Canary Governance`
   - `tokenSymbol`: `CANARY`
   - `initialHolder`: **Your wallet address** (NOT the Privy wallet — the wizard mints 1e18 to this address as the initial signer).
3. Sign **TX 1 — createDao**. Deploys DAO + GovernanceERC20 + TokenVoting plugin. Wait for confirmation.
4. Sign **TX 2 — deploy CogniSignal**. Binds CogniSignal to the DAO address.
5. Server verification runs automatically and returns `repoSpecYaml`. COPY THIS BLOCK.

Detailed field-by-field walkthrough: [`docs/guides/node-formation-guide.md`](../guides/node-formation-guide.md).

### Step 4 — Add the second signer (Privy wallet)

The wizard creates a 1-signer DAO (you hold 1e18 of the token). To add the canary Privy wallet as a second signer, you need to call `PluginSetupProcessor.applyUpdate` — the wizard does NOT do this for v0.

Two paths:

**A. Manual via Aragon app (recommended for v0)**

1. Navigate to the Aragon app for Base: https://app.aragon.org/dao/base-mainnet-0x... (replace with your DAO address from Step 3).
2. Open the DAO → Members → "Add members".
3. Propose a new member: the canary Privy wallet address. Token allocation: 1e18 (matches your allocation, giving equal voting weight).
4. Approve the proposal from your wallet (1-of-1 signer at this point means it passes immediately).
5. Wait for execution.

**B. Manual via cast (expert)**

```bash
cast send <PLUGIN_SETUP_PROCESSOR> "applyUpdate(...)" \
  --rpc-url base \
  --private-key $YOUR_KEY \
  ...
```

Only do this if you're comfortable with the PluginSetupProcessor call shape. Aragon UI path is safer.

**Verify:**

```bash
# From any RPC-connected tool:
cast call <DAO_ADDRESS> "balanceOf(address)(uint256)" <DEREK_WALLET>    # should be 1e18
cast call <DAO_ADDRESS> "balanceOf(address)(uint256)" <PRIVY_WALLET>    # should be 1e18 after Step 4
```

### Step 5 — Deploy Split contract

1. Navigate to `/setup/dao/payments` in the app.
2. Configure Split:
   - Recipient 1: **Canary Privy wallet**, share **100%** (no operator share — canary is its own economic actor)
3. Sign the deploy tx.
4. Server returns the Split address + the `payments_in.credits_topup.receiving_address` block. COPY THIS BLOCK.

### Step 6 — Update `nodes/canary/.cogni/repo-spec.yaml`

On a new branch (NOT the canary scaffold branch — this is a follow-up PR):

```bash
git checkout -b feat/canary-dao-addresses main
```

Edit `nodes/canary/.cogni/repo-spec.yaml`:

- Uncomment and fill `cogni_dao.dao_contract`, `plugin_contract`, `signal_contract` with values from Step 3
- Uncomment and fill `operator_wallet.address` with the Privy wallet from Step 1
- Uncomment and fill `payments_in.credits_topup.receiving_address` with the Split address from Step 5
- Change `payments.status: pending_activation` → `payments.status: active`
- Add `activity_ledger.approvers` array with both Derek + Privy addresses
- Uncomment the `governance.schedules` entries (SINGULARITY_SCORE_DAILY, CANARY_BRAIN_LOOP) if task.0340/0341 have merged; otherwise leave commented

Commit:

```bash
git add nodes/canary/.cogni/repo-spec.yaml
git commit -m "chore(canary): populate DAO addresses post-formation (task.0339)"
git push -u origin feat/canary-dao-addresses
```

Open a PR. This PR does NOT need the `ai-only-repo-policy` gate since it's Derek-authored — the gate scope applies only to canary-bot PRs.

### Step 7 — Fund the canary operator wallet

Send **$20 USDC on Base** to the canary Privy wallet from Step 1. This is the operating cushion — covers LiteLLM spend + gas for on-chain calls until the canary earns revenue.

Basescan confirmation: both the Privy wallet and the Split contract should now show non-zero balances.

### Step 8 — Kick the app

After the addresses-update PR merges, Argo CD will re-sync the canary Application with the new config. Verify:

```bash
# From your machine:
curl -s https://canary-candidate-a.cognidao.org/api/v1/singularity | jq
# Expected: { "score": 50, "reasoning": "Placeholder...", "stub": true } — until task.0340 lands
```

In Loki:

```
{app="canary"} |= "dao_contract" | json
```

Should show the canary app logging its own DAO address at startup. If not, repo-spec didn't reload — restart the pod.

## Verification Checklist

- [ ] Aragon app shows the canary DAO on Base with 2 members (Derek + Privy)
- [ ] `balanceOf(Derek) == 1e18` AND `balanceOf(Privy) == 1e18`
- [ ] `CogniSignal.DAO()` returns the DAO address (not zero)
- [ ] Split contract deployed, 100% to Privy wallet
- [ ] Privy wallet funded with ≥$20 USDC on Base
- [ ] `nodes/canary/.cogni/repo-spec.yaml` has real addresses, `payments.status: active`
- [ ] `/api/v1/singularity` returns 200 at `canary-candidate-a.cognidao.org`
- [ ] Task.0339 marked `status: done`, `deploy_verified: true`

## Troubleshooting

### Wizard fails with "Contract not found" at preflight

You're on the wrong chain. Switch RainbowKit to Base mainnet (8453), not Sepolia. The canary targets mainnet from day 0.

### applyUpdate (Step 4) reverts

Likely causes:
- Plugin version mismatch — the wizard's TokenVoting plugin version must match `PluginSetupProcessor.applyUpdate` expectations. Check Aragon's published plugin repo for current version.
- Insufficient voting weight — if the DAO's majority threshold is 50%, 1-of-1 passes. Double-check in the Aragon UI.

### Split deploy reverts with "recipients must sum to 100%"

Splits (0xSplits) require basis points summing to exactly 1,000,000. Recipient 1 at 100% = 1000000. If the wizard is emitting fractional, file a bug against `/setup/dao/payments`.

### Canary pod doesn't pick up new addresses after PR merge

`repo-spec.yaml` is baked into the image at build time (see `nodes/canary/app/Dockerfile` runner stage `COPY --from=builder /app/.cogni ./.cogni`). After the addresses-PR merges, you need a **new image build**, not just an Argo sync. Trigger:

```bash
gh workflow run build-multi-node.yml -f targets=canary
# Wait for push to GHCR, then promote to candidate-a via candidate-flight.yml
```

## Undo

If you need to abandon a formation attempt (e.g., wrong chain, wrong signer):

1. DO NOT try to delete the on-chain DAO — you can't. It's just an unused contract.
2. Revert `nodes/canary/.cogni/repo-spec.yaml` on `main` to the scaffold state (`payments.status: pending_activation`, addresses commented).
3. Pod re-reads scaffold config on next deploy.
4. Start over from Step 1 with new addresses.

## Related

- [Node Formation Spec](../spec/node-formation.md)
- [Node Formation Guide](../guides/node-formation-guide.md) — wizard walkthrough
- [New Node Formation Guide](../guides/new-node-formation.md) — end-to-end node setup
- [Operator Wallet Setup](../guides/operator-wallet-setup.md) — Privy wallet provisioning
- [task.0339](../../work/items/task.0339.canary-dao-formation.md)
