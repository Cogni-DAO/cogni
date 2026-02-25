---
id: spike.0090.handoff
type: handoff
work_item_id: spike.0090
status: active
created: 2026-02-26
updated: 2026-02-26
branch: worktree-operator-wallet
last_commit: 329d8749
---

# Handoff: Validate Operator Wallet Payment Chain

## Context

- **spike.0090** is the first step of [proj.ai-operator-wallet](../projects/proj.ai-operator-wallet.md) — validate the full USDC → Split → OpenRouter credits payment chain on Base mainnet before building abstractions
- Three experiment scripts prove each building block independently, then end-to-end
- Budget is ~$3 total (Base L2 gas < $0.001/tx; OpenRouter $1 min attempted)
- Key unknowns to resolve: which Coinbase Commerce function OpenRouter returns (ETH vs USDC input), Splits works with Base USDC, full chain timing
- Findings feed directly into task.0084 (wallet provisioning) and task.0085 (Splits deployment)

## Current State

- **Scripts written and parse-verified** — all 3 experiments + shared setup + docs created
- **Not yet executed** — needs env vars: `OPENROUTER_API_KEY`, `OPERATOR_PRIVATE_KEY`, `TREASURY_ADDRESS`
- **`@0xsplits/splits-sdk@6.4.1`** added as workspace devDep (provides ABIs + factory addresses)
- **Coinbase Transfers ABI** inlined in `shared.ts` (TODO to extract to `packages/vendor-contracts`)
- Push Split V2o2 factory used (CREATE2, same address all chains): `0x8E8eB0cC6AE34A38B67D5Cf91ACa38f60bc3Ecf4`

## Decisions Made

- **Push Split V2o2** (not Pull) — funds go directly to recipients on `distribute()`, no warehouse withdrawal step
- **swapAndTransferUniswapV3Native** as default function (ETH input) per [OpenRouter docs](https://openrouter.ai/docs/guides/guides/crypto-api) — `transferTokenPreApproved` ABI also included as fallback
- **0xSplits SDK** over direct ABI vendoring — SDK provides all ABIs + addresses, viem peer dep matches
- **Coinbase Transfers ABI inlined** with `TODO(task.0084)` — no npm package exists; extract to `packages/vendor-contracts` when building the real adapter
- **CDP Wallets noted as Privy alternative** — design note added to project doc on `feat/ledger-identity-resolution` branch ([see note](../projects/proj.ai-operator-wallet.md))

## Next Actions

- [ ] Create `.env` from `.env.example` with real credentials
- [ ] Run experiment 1: `pnpm tsx scripts/experiments/openrouter-topup.ts` — log the function_name and contract_address
- [ ] Run experiment 2: `pnpm tsx scripts/experiments/splits-deploy.ts` — save SPLIT_ADDRESS output
- [ ] Add `SPLIT_ADDRESS` to `.env`, run experiment 3: `pnpm tsx scripts/experiments/full-chain.ts`
- [ ] Write findings back to `docs/spec/web3-openrouter-payments.md` (resolve open questions)
- [ ] Update spike.0090 status → `done`
- [ ] Unblock task.0084 — update design based on ETH vs USDC finding

## Risks / Gotchas

- OpenRouter may reject `amount: 1` (spec says $5 minimum but API docs don't enforce it) — bump to 5 if needed
- `swapAndTransferUniswapV3Native` requires ETH in the wallet (not just USDC) — the `value` field must cover `recipientAmount + feeAmount + slippage`
- Pool fee tier hardcoded to `3000` (0.3% Uniswap standard) — may need `500` (0.05%) or `10000` (1%) depending on the pair
- Split recipients must be sorted by address ascending — scripts handle this, but production code must too
- Coinbase Transfers ABI was extracted from GitHub source, not a verified npm package — cross-check against BaseScan verified ABI if needed

## Pointers

| File / Resource                                                   | Why it matters                                                             |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `scripts/experiments/shared.ts`                                   | Viem clients, env setup, Coinbase Transfers ABI, ERC-20 helpers            |
| `scripts/experiments/openrouter-topup.ts`                         | Exp 1: OpenRouter charge → Coinbase Commerce tx → credit verification      |
| `scripts/experiments/splits-deploy.ts`                            | Exp 2: Push Split V2o2 deploy → USDC transfer → distribute → verify shares |
| `scripts/experiments/full-chain.ts`                               | Exp 3: End-to-end chain proof                                              |
| `scripts/experiments/README.md`                                   | Run instructions + post-spike checklist                                    |
| `work/items/spike.0090.validate-operator-wallet-payment-chain.md` | Work item with acceptance criteria                                         |
| `docs/spec/web3-openrouter-payments.md`                           | Spec with open questions this spike resolves                               |
| `work/projects/proj.ai-operator-wallet.md`                        | Project roadmap (Crawl/Walk/Run phases)                                    |
| `src/shared/web3/chain.ts`                                        | Canonical chain constants reused by scripts                                |
