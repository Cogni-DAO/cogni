---
id: task.0315.handoff
type: handoff
work_item_id: task.0315
status: active
created: 2026-04-17
updated: 2026-04-17
branch: design/poly-copy-trade-pr-b
worktree: /Users/derek/dev/cogni-template-poly-copy-trade-pr-b
last_commit: 92b10f52b
---

# Handoff: task.0315 Phase 1 — CP3.2+ (CLOB adapter + wiring)

## Where to work

- **Worktree:** `/Users/derek/dev/cogni-template-poly-copy-trade-pr-b` (separate from the main repo clone at `/Users/derek/dev/cogni-template`)
- **Branch:** `design/poly-copy-trade-pr-b` (PR [#890](https://github.com/Cogni-DAO/node-template/pull/890))
- **Env:** `.env.local` is symlinked from the main worktree — required for all `scripts/experiments/*` runs. Do not `cd` into the main worktree to work on this task; stay in the design worktree so commits land on the right branch.

## Context

- **Mission:** Polymarket copy-trade prototype. v0 (PR-A) shipped a top-wallets scoreboard. v0.1 (PR #890, this branch) is a single-wallet shadow/live mirror that ends with one real `order_id` from a hardcoded target.
- **Strategy:** stable-`decide()`-boundary design. Scaffolding (30s poll, dashboard card, env-based target) is intentionally disposable and labeled. Four phases: P1 first live order → P2 click-to-copy UI → P3 paper soak → P4 streaming (gated on P3 evidence).
- **Phase 1 = CP1–CP4 on the design branch.** Each CP is a commit; CPs ≥ 3 split into sub-CPs of ≤½–1 day each.
- **The operator Privy wallet (HSM-custodied EOA `0xdCCa8D85603C2CC47dc6974a790dF846f8695056`) is fully onboarded to Polymarket's CLOB via the direct-EOA path.** No Safe proxy, no browser ToS step. This is non-obvious and was discovered by probing; see the guide.

## Current State

- **Shipped (5 commits on branch):**
  - `8293eb665` — CP1 types + ports (Run-phase `MarketProviderPort`, `OrderIntent`/`OrderReceipt`/`OrderStatus`/`Fill` Zod, `PolymarketOrderSigner` port, `OperatorWalletPort.signPolymarketOrder` stub)
  - `00fea90f9` — CP2 off-chain EIP-712 signing proof via `@privy-io/node/viem`
  - `a018fea4c` — Polymarket-account-setup guide + `derive-polymarket-api-keys` + `probe-polymarket-account` scripts
  - `c8ef5ca5c` — **CP3.1** on-chain USDC.e allowance approvals for {Exchange, Neg-Risk Exchange, Neg-Risk Adapter}, all MaxUint256
  - **CP3.1.5** (this commit) — delete dead signer surface + `walletKey` + fix Safe-proxy doc per design-review 2026-04-17
- **Operator wallet on Polygon mainnet:** 20.43 USDC.e funded · ~9.99 POL gas · L2 CLOB creds registered · 3 allowances at max. A real BUY order is technically placeable today; only the adapter code path is missing.
- **CP3.1.5 cleaned up dead surface** (pulled forward from original CP3.4 per design-review 2026-04-17): deleted `PolymarketOrderSigner` port + `OperatorWalletPort.signPolymarketOrder` + CP1 stub + 4 `FakeOperatorWalletAdapter` impls + resy contract test case + duplicated `Eip712TypedData` type + `MarketCredentials.walletKey` escape hatch. `PaperAdapter.provider` is now constructor-configurable.

## Decisions Made

- **EOA path, not Safe proxy.** Confirmed by probing — Polymarket's CLOB accepts direct-EOA accounts created via `createOrDeriveApiKey`. See [docs/guides/polymarket-account-setup.md](../../docs/guides/polymarket-account-setup.md).
- **Use `@privy-io/node/viem#createViemAccount`**, not a hand-rolled shim. Private discovery during CP2 rev 4; replaces the planned `PolymarketOrderSigner` adapter path. [Commit 4e1202124](https://github.com/Cogni-DAO/cogni-template/commit/4e1202124).
- **Split CP3 into 4 sub-CPs** (3.1 allowances ✅, 3.2 adapter, 3.3 DB, 3.4 dead-surface cleanup). Each a separate commit so reviews stay small.
- **`@polymarket/clob-client` currently in root devDeps.** CP3.2 moves it to `packages/market-provider` as an optional peerDep when that package becomes its only internal consumer.
- **BUY-only prototype.** SELL orders additionally need ERC-1155 `setApprovalForAll` on the CTF contract; out of scope until SELL mirroring is planned.

## Next Actions

- [x] **CP3.1.5 — Delete dead surface** ✅ pulled forward from original CP3.4. See "Current State" above.
- [ ] **CP3.2 — CLOB adapter** (~1 day). Implement `placeOrder` / `cancelOrder` / `getOrder` in `packages/market-provider/src/adapters/polymarket/clob.adapter.ts` using `ClobClient`. Constructor takes viem `LocalAccount` + `ApiKeyCreds`. Add `DA_EMPTY_HASH_REJECTED` normalizer. Contract test vs recorded clob-client response fixture. **AC**: `@polymarket/clob-client` moves to `packages/market-provider` as optional peerDep.
- [ ] **CP3.2 live dry-rehearsal script** `scripts/experiments/place-polymarket-order.ts` that places (and immediately cancels) one $1-minimum BUY via the new adapter. This is CP5's dress rehearsal.
- [ ] **CP3.3 — DB migrations** (~½ day). Drizzle migrations for `poly_copy_trade_fills`, `poly_copy_trade_config` (singleton, `enabled DEFAULT false` = fail-closed), `poly_copy_trade_decisions` (append-only log). Migration header pins BOTH the P0.2 composite `fill_id` shape AND `client_order_id = keccak256(utf8Bytes(target_id + ':' + fill_id))` verbatim.
- [ ] **CP4** (~4 days). Pure `decide()` + heavy unit tests (include fail-closed kill-switch branch); `clob-executor` with dynamic import gated on `POLY_ROLE=trader`; 30s poll job (`@scaffolding`, `Deleted-in-phase: 4`); SELECT-backed dashboard card (`@scaffolding`); container wiring; env vars.
- [ ] **CP5** (manual, ~1h). Deploy PR #890 to canary. DRY_RUN soak → flip live with tight caps → capture real `order_id` → paste into PR.
- [ ] **Merge gate for PR #890:** one real `order_id` + one live→shadow halt proven + PR description names proxy-wallet key custodian.

## Risks / Gotchas

- **Polygon public RPCs round-robin.** `publicnode.com` sometimes returns post-tx state from a pre-tx node. Always `waitForTransactionReceipt` first, then read with `blockNumber: receipt.blockNumber`. Hit this live during CP3.1 — see the block-pinned read in the approve script.
- **`task.0315.status` frontmatter is stale (`needs_closeout`).** The task is actually mid-flight across multiple CPs on the design branch; the field is outdated. Don't treat it as truth — branch commits are the source.
- **`.env.local` lives in the main worktree, symlinked into the design worktree.** Contains `PRIVY_APP_*`, `OPERATOR_WALLET_ADDRESS`, `POLY_CLOB_API_*`. Never commit `.env.local`. Re-run `derive-polymarket-api-keys` if rotating wallets.
- **Minimum order size on Polymarket.** Historically ~$5 notional; $1 may be below floor for some markets. Confirm against the target market during CP5 — may need `COPY_TRADE_MIRROR_USDC=5` rather than 1.
- **The `workspace:test` job in `check:fast` does NOT typecheck `scripts/`.** Script-only edits skate past `pnpm check:fast`. Always smoke-test scripts with `pnpm tsx --tsconfig tsconfig.scripts.json <file>` before commit.

## Pointers

| File / Resource                                                                                      | Why it matters                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [work/items/task.0315.poly-copy-trade-prototype.md](../items/task.0315.poly-copy-trade-prototype.md) | Full Phase 1–4 plan; CP3 sub-CP breakdown is in the Plan section                                                      |
| [docs/guides/polymarket-account-setup.md](../../docs/guides/polymarket-account-setup.md)             | Operator onboarding (verified 2026-04-17); the 4-step EOA-path flow                                                   |
| `scripts/experiments/sign-polymarket-order.ts`                                                       | CP2 signing proof — pattern for `createViemAccount` + `ClobSigner`                                                    |
| `scripts/experiments/derive-polymarket-api-keys.ts`                                                  | L2 cred derivation (idempotent; safe to re-run)                                                                       |
| `scripts/experiments/probe-polymarket-account.ts`                                                    | Read-only sanity check — use as your "is the wallet still healthy?" probe                                             |
| `scripts/experiments/approve-polymarket-allowances.ts`                                               | CP3.1 on-chain approvals — pattern for Privy-signed Polygon writes via viem                                           |
| `packages/market-provider/src/port/market-provider.port.ts`                                          | Run-phase port CP3.2 implements                                                                                       |
| `packages/operator-wallet/src/adapters/privy/privy-operator-wallet.adapter.ts`                       | Existing Privy adapter — pattern for wallet-id resolution + `authContext`                                             |
| `node_modules/@polymarket/clob-client/dist/client.d.ts`                                              | `ClobClient` constructor + `createOrder`/`postOrder`/`cancelOrder` signatures                                         |
| [PR #890](https://github.com/Cogni-DAO/node-template/pull/890)                                       | Phase-1 flight PR — merges to main when a real `order_id` lands                                                       |
| [Phase 1 spec section](../items/task.0315.poly-copy-trade-prototype.md)                              | `### Phase 1` + `### Files — by phase`; invariants like `SINGLE_WRITER`, `DRY_RUN_DEFAULT`, `KEY_IN_TRADER_ROLE_ONLY` |
