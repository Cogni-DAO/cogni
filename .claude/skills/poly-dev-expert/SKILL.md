---
name: poly-dev-expert
description: "Polymarket copy-trade / prediction-bot domain expert. Use this skill when the work touches the poly node's mirror pipeline, Polymarket CLOB, operator/target wallets, Privy vs raw-PK signing, CTF ERC-1155 approvals, poly_copy_trade_* tables, mirror-coordinator, wallet-watch, or any experiment under scripts/experiments/*poly*. Also triggers for: 'place a polymarket trade', 'mirror this wallet', 'why did SELL reject', 'onboard a new wallet', 'what's in candidate-a poly-node-app-secrets', 'flip copy_trade_config', 'how does the data-api poll work'."
---

# Poly Dev Expert

You are the domain expert for Cogni's Polymarket copy-trade system. This skill exists because the poly node has a set of very specific gotchas that have repeatedly burned devs and agents who didn't know about them. **Read this file before touching poly code or running poly experiments.**

## Ground truth — read before acting

- [task.0315](../../../work/items/task.0315.poly-copy-trade-prototype.md) — Phase 1 parent task, P1→P4 roadmap, MUST_FIX_P2 RLS note
- [task.0323](../../../work/items/task.0323.poly-copy-trade-v1-hardening.md) — v1 hardening bucket (CTF SELL, cursor persistence, status-sync, metrics, alerting)
- [task.0322](../../../work/items/task.0322.poly-copy-trade-phase4-design-prep.md) — Phase 4 streaming + adversarial-robust design prep
- [docs/spec/poly-copy-trade-phase1.md](../../../docs/spec/poly-copy-trade-phase1.md) — as-built spec (layer boundaries, invariants, fill_id shape)
- [docs/guides/polymarket-account-setup.md](../../../docs/guides/polymarket-account-setup.md) — Privy operator wallet onboarding (NB: Privy-only, CTF approvals added via task.0323)
- `nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts` — the `runOnce` glue
- `nodes/poly/app/src/features/wallet-watch/polymarket-source.ts` — Data-API source
- `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts` — poll shim + hardcoded v0 constants
- `packages/market-provider/src/adapters/polymarket/` — CLOB + Data-API adapters

## Wallet roles — NEVER conflate these

**Two wallets, two completely different jobs:**

| Role                       | Env / address                               | Signer                                            | Responsibilities                                                                                        |
| -------------------------- | ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Operator** (Privy)       | `POLY_PROTO_WALLET_ADDRESS` = `0x7A33…0aEB` | Privy HSM (`POLY_PROTO_PRIVY_SIGNING_KEY`)        | The wallet the poly deployment controls. PLACES all autonomous mirror trades.                           |
| **Target / test** (raw-PK) | `TEST_WALLET_ADDRESS` = `0x50f4…c42B`       | Raw PK in `.env.test` (`TEST_WALLET_PRIVATE_KEY`) | What gets monitored. The mirror copies its trades. For validation, also what WE place test trades from. |

**Anti-pattern (burned an agent in Apr 2026):** placing a "test" trade from the operator wallet and claiming you validated the mirror. You did not — you just placed a trade from the wallet that PLACES mirrors, not from the wallet that GETS mirrored. The target wallet must trade, not the operator.

## Wallet onboarding — USDC.e + CTF, not just USDC.e

Polymarket requires **two** kinds of approvals. Skip the second and you cannot close positions.

1. **USDC.e `approve(spender, MaxUint256)`** — three contracts: Exchange (`0x4bFb…982E`), Neg-Risk Exchange (`0xC5d5…f80a`), Neg-Risk Adapter (`0xd91E…5296`). Needed to BUY.
2. **CTF ERC-1155 `setApprovalForAll(operator, true)`** — CTF at `0x4D97…6045`, operators = Exchange + Neg-Risk Exchange (NOT the Adapter — it never takes 1155 custody). **Needed to SELL.**

Symptom of missing CTF approval on SELL: `CLOB rejected order (success=undefined, errorMsg="")`. No real error message — just silent reject.

**Scripts:**

- Privy wallet: `scripts/experiments/approve-polymarket-allowances.ts` (extended with CTF via task.0323)
- Raw-PK wallet: `scripts/experiments/onboard-raw-pk-wallet.ts` (one-shot: USDC.e + CTF + CLOB keys)

Both are idempotent. Re-run safely.

## Scripts arsenal — know what exists before writing new ones

| Script                             | For           | Purpose                                                                                                                 |
| ---------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `approve-polymarket-allowances.ts` | Privy wallet  | USDC.e + CTF approvals                                                                                                  |
| `derive-polymarket-api-keys.ts`    | Privy wallet  | Derive CLOB L2 creds                                                                                                    |
| `onboard-raw-pk-wallet.ts`         | Raw-PK wallet | All of the above in one                                                                                                 |
| `privy-polymarket-order.ts`        | Privy wallet  | Reusable place/cancel with `--side`, `--size`, `--price`, `--outcome`, `--post-only`                                    |
| `raw-pk-polymarket-order.ts`       | Raw-PK wallet | Same interface, raw-PK signer                                                                                           |
| `place-polymarket-order.ts`        | Privy wallet  | Scope-narrow dress-rehearsal (post-only $1 BUY only — do NOT generalize; use `privy-polymarket-order.ts` for new flows) |
| `probe-polymarket-account.ts`      | Either        | Verify balances + allowances                                                                                            |
| `copy-top-wallet-rehearsal.ts`     | Privy         | Top-wallet research rehearsal                                                                                           |
| `fill-market.ts`                   | —             | Market-data test helper                                                                                                 |

RPC flakiness: `polygon-bor-rpc.publicnode.com` round-robins and occasionally returns stale nonces. Just retry — scripts are idempotent.

## Mirror runtime — candidate-a wiring

**Secrets consumed by `poly-node-app` pod** (via k8s secret `poly-node-app-secrets`, namespace `cogni-candidate-a`):

- `POLY_PROTO_WALLET_ADDRESS`, `POLY_PROTO_PRIVY_SIGNING_KEY`, `POLY_PROTO_PRIVY_APP_ID`, `POLY_PROTO_PRIVY_APP_SECRET`
- `POLY_CLOB_API_KEY`, `POLY_CLOB_API_SECRET`, `POLY_CLOB_PASSPHRASE`
- `COPY_TRADE_TARGET_WALLETS` — **comma-separated list** of 0x addresses. **Not in the overlay**; patched directly into the secret (scaffolding per handoff). Empty / unset ⇒ mirror skips boot + logs `poly.mirror.poll.skipped`. Each wallet spawns its own 30s poll; exactly one `startOrderReconciler` runs regardless of target count. Source-of-truth is `CopyTradeTargetSource` (`@/features/copy-trade/target-source`) — P2 swaps the env impl for a DB-backed one.

**Enable switch:** `UPDATE poly_copy_trade_config SET enabled=true WHERE singleton_id=1;` on the poly DB. Takes effect within one poll tick (≤30s).

**Poll cadence:** 30s. Warmup backlog: 60s. Hardcoded in `copy-trade-mirror.job.ts`.

**Live-money caps (hardcoded v0):** $1/trade, $10/day, 5 fills/hr. Change = edit source + redeploy.

## Observability

| Signal                                                       | Where           | Good state                       |
| ------------------------------------------------------------ | --------------- | -------------------------------- |
| `poly.mirror.poll.singleton_claim`                           | Loki            | Fires exactly once per pod start |
| `poly.wallet_watch.fetch`                                    | Loki, every 30s | `raw=N, fills=N, phase=ok`       |
| `poly.mirror.decision outcome=placed`                        | Loki            | Emitted when mirror fires        |
| `poly.mirror.decision outcome=skipped reason=already_placed` | Loki            | Dedup (noisy — see task.0323 §1) |
| `poly.mirror.poll.tick_error`                                | Loki            | ZERO. Any hit = bug.             |
| `poly_copy_trade_fills`                                      | poly DB         | Row per mirror decision          |

**Status gotcha (task.0323 §2):** ledger `status=open` is set at insert time and never re-read from CLOB. Actual CLOB state may be filled. Don't trust the ledger status column alone — cross-check against Data-API `/positions?user=<addr>`.

## Data-API notes

- Base: `https://data-api.polymarket.com`
- `/trades?user=<addr>` — the mirror's input. Filters by `timestamp >= sinceTs` client-side.
- `/positions?user=<addr>` — canonical source of truth for what a wallet holds. Use this, not the UI.
- Lag: ~30–60s between CLOB fill and Data-API surfacing.

## EOA-direct vs Safe-proxy — why the UI profile looks empty

The `PolymarketClobAdapter` hardcodes `signatureType: SignatureType.EOA` (`EOA_PATH_ONLY` invariant). Trades settle against the EOA on-chain. **Polymarket's `/profile/<addr>` UI auto-redirects any EOA to its deterministic Safe-proxy address and renders _that_ profile.** For EOA-direct users, the Safe was never instantiated — its profile is empty forever.

**Symptom:** shares show up on Data-API + Polygonscan + market "Activity" tab, but `polymarket.com/profile/<our-eoa>` looks like a blank new account. Easy to mistake for "the trade never happened."

**Ground-truth checks (in order):**

1. `https://data-api.polymarket.com/positions?user=<EOA>` — authoritative
2. `https://data-api.polymarket.com/trades?user=<EOA>&limit=10`
3. Market page → Activity tab → filter by EOA
4. Polygonscan tx hash (from Data-API `transactionHash` field)

Do not rely on the Polymarket profile page for EOA-direct accounts.

## Anti-patterns to flag

- **Placing test trades from the operator wallet** to "validate the mirror" — validates nothing.
- **Skipping CTF approvals** during onboarding — creates a one-way-trade wallet.
- **Generalizing `place-polymarket-order.ts`** (scope-narrow dress-rehearsal) instead of using `privy-polymarket-order.ts`.
- **Re-setting GH env secrets that already exist** without first checking `gh secret list --env candidate-a`.
- **Using `kubectl set env` for long-lived config** — Argo will revert on next sync. If you need a new env var permanently, add it to the overlay or to `poly-node-app-secrets` via `provision-test-vm.sh`.
- **Adding P4 work to v0** — P4 is tracked in task.0322. Don't smuggle WS/streaming changes into v0 tasks.

## Enforcement rules

When reviewing code that touches poly runtime, wallet onboarding, or mirror logic:

- **Never use raw PKs in production code paths.** Raw-PK is fine for `scripts/experiments/` only. Production places orders via Privy HSM.
- **Never place orders without `--yes-real-money` on the CLI path** or an equivalent explicit opt-in.
- **Never skip `INSERT_BEFORE_PLACE`** in the coordinator — it is the correctness gate for at-most-once mirroring.
- **CTF approvals live alongside USDC.e approvals** — adding a new wallet to the system means both or nothing.
- **Idempotency is always `keccak256(target_id + ':' + fill_id)` → client_order_id.** Do not invent alternatives.
- **`fill_id` shape is frozen** at `data-api:<tx>:<asset>:<side>:<ts>`. Phase 4 will add `clob-ws:…` — do not mix.
