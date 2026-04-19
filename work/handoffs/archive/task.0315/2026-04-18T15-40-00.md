---
id: task.0315.handoff
type: handoff
work_item_id: task.0315
status: active
created: 2026-04-18
updated: 2026-04-18
branch: feat/poly-copy-trade-cp4
worktree: /Users/derek/dev/cogni-template-cp4
last_commit: 034d1a40d
---

# Handoff: task.0315 Phase 1 → Phase 1 CP4.3 (autonomous copy-trade)

**Assumption:** PR #900 merges cleanly after the reviewer's final sweep. Validation on candidate-a passed end-to-end: one agent chat session placed a real Polymarket CLOB order on the dedicated proto wallet, confirmed via the independent `getOpenOrders` API round-trip. Evidence block is already on the PR.

This handoff is for the **next dev implementing CP4.3 + CP4.5**. Assume Phase 1 CP1–CP4.25 is shipped; your job is the autonomy loop.

## TL;DR — what you inherit

```
✅ Shipped on main (after #900 merges):
   PolymarketClobAdapter: placeOrder / cancelOrder / getOrder / listOpenOrders
   Dedicated POLY_PROTO_* wallet, custody-isolated from the billing OPERATOR_WALLET
   Three agent tools (poly-brain):
     core__poly_place_trade     external_side_effect  BUY only, zod-capped 25 USDC
     core__poly_list_orders     read_only             filter by token_id or conditionId
     core__poly_cancel_order    state_change          cancel by order_id (idempotent)
   `decide()` pure function (CP4.1) + `createClobExecutor(deps)` (CP4.2)
   Polymarket Data-API → Fill normalizer (CP4.1)
   Drizzle tables: poly_copy_trade_fills, poly_copy_trade_config, poly_copy_trade_decisions (CP3.3)
   pinned clientOrderIdFor golden-vector helper (CP3.3)

⚪ Your turn:
   CP4.3  autonomous copy-trade loop (poll + fills/decisions DB writes, kill-switch read)
   CP4.5  read-only dashboard "Copy-Trade Activity" card
```

## Derek's CP4.3 product constraint (new, explicit)

> **Always mirror the MINIMUM notional, never proportional.**

- Standard markets: min $1 / trade
- Neg-risk markets: min $5 / trade
- Do NOT scale by the target's fill size. Every copy = market_min.

**Why:** bounded blast radius per copy, per day. The point of v0.1 is proving the SEAM (observe → decide → place → record), not capturing alpha. Size scaling is a Phase 3+ concern after the paper-adapter soak produces edge evidence.

Implementation shape:

- `TargetConfig.mirror_usdc` in the schema is kept (future scaling), but the CP4.3 `decide()` caller PIN it to `market_min_usdc` which the executor looks up from the Polymarket market metadata on the same fetch that today provides tickSize / negRisk / feeRateBps.
- Add `market_min_usdc` to the Polymarket market-meta cache the adapter already maintains (or to the existing CP3 order-metadata fetch — whichever is fewer new calls).

## CP4.3 — autonomous copy-trade loop

**Mechanics (per task.0315 design):**

```
setInterval(30s) → pollTargetWallets()
  ├─ list active targets (P1: env POLY_COPY_TRADE_TARGETS; P2: DB table)
  ├─ for each target: data-api.listUserActivity(wallet) since last cursor
  ├─ normalize Fill[] via polymarket.normalize-fill (ships today)
  ├─ upsert into poly_copy_trade_fills (dedup on PK (target_id, fill_id))
  ├─ for each NEW fill:
  │    ── pure decide(fill, config, state) from CP4.1
  │    ── if action='place':
  │         ── load market_min_usdc for the market (see constraint above)
  │         ── override intent.size_usdc = market_min_usdc
  │         ── container.copyTradeCapability.placeTrade(intent)   ← YES, the CP4.25 capability
  │         ── upsert order_id onto the fill row
  │    ── insert poly_copy_trade_decisions row (audit trail; every decision logged)
  └─ respect poly_copy_trade_config.enabled (global kill-switch)
```

**NO platform governance schedule.** Scheduling is container-local (setInterval on the poly pod). The user controls on/off via the `poly_copy_trade_config` single-row table (bool `enabled`). An internal-ops HTTP route flips that bit; the poll loop reads it on every tick before placing.

**Reuses the CP4.25 capability directly.** Do not build a second placement path. `container.copyTradeCapability.placeTrade(...)` is the same call site the agent tool uses. The auditing distinction is in the `client_order_id` hash input: pass the target's synthetic UUID as `target_id` instead of the literal string `"agent"` (see `clientOrderIdFor` in market-provider).

**Stack test** proves the full chain: `Data-API → normalize-fill → decide() → capability.executor → fills/decisions DB rows`. No network calls; stack-test mock for Data-API + `FakePolymarketClobAdapter` from `@/adapters/test/poly-trade/`.

**Kill switch verification:** one stack test case with `config.enabled=false` asserts zero `placeTrade` invocations even with fresh fills.

## CP4.5 — dashboard "Copy-Trade Activity" card

Read-only server component on `/(app)/dashboard`. Queries `poly_copy_trade_decisions` joined with `poly_copy_trade_fills` for the last 24h. Columns: time / target wallet / market / side / size / decision / reason / order_id link. No cancel button (agents handle that via `core__poly_cancel_order`).

**DO NOT** add any trading action on the dashboard in this phase. Read-only keeps the attack surface at zero until the paper-soak evidence lands in Phase 3.

## Architecture constraints (non-negotiable)

### 1. Do NOT touch operator-wallet code

`OPERATOR_WALLET_ADDRESS` + `PRIVY_SIGNING_KEY` are the production billing wallet (Base distributeSplit / OpenRouter top-ups). The Polymarket path reads exclusively from `POLY_PROTO_*` env and its own Privy signing key. Never cross these.

### 2. Single CLOB-client importer

`@polymarket/clob-client` may be imported ONLY from:

- `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts`
- `nodes/poly/app/src/bootstrap/capabilities/poly-trade.ts` (dynamic import only)

Biome `noRestrictedImports` enforces this. If CP4.3 needs a second importer, prefer extending the adapter over adding a new one.

### 3. CP4.3 must NOT add new ai-tools

Autonomy = server-side. No new agent tools for the poll/decide/place loop. (A future agent tool `core__poly_copy_trade_targets_list` etc. can come in Phase 2.) Every new ai-tool today costs stubs on 3 non-poly nodes per bug.0319.

### 4. Always minimum bet per copy (see above)

### 5. Capability-not-adapter

CP4.3's loop calls `container.copyTradeCapability.placeTrade(intent)` — NOT `PolymarketClobAdapter.placeOrder` directly. Same invariant the CP4.25 tool follows.

## Wallet state (as of 2026-04-18)

```
Proto wallet:  0x7A3347D25A69e735f6E3a793ecbdca08F97A0aEB
  - Funded: ~62 USDC.e + ~129 POL on Polygon
  - Allowances: MaxUint256 to 3 Polymarket exchanges
  - Owner quorum: mjhtiz88b6s1p9f4xd07el8o (programmatic, controlled by
                  POLY_PROTO_PRIVY_SIGNING_KEY)
  - Resting order (validation artifact, safe to leave): 0x9ea45b76…d84b8af7
    $5 BUY at 0.001 on LeBron-2028 YES — never fills, known sunk cost
    if market resolves to YES (won't)

Production billing wallet (DO NOT TOUCH): 0xdCCa8…5056 on Base
```

## GH candidate-a env secrets — already set

```
POLY_PROTO_PRIVY_APP_ID
POLY_PROTO_PRIVY_APP_SECRET
POLY_PROTO_PRIVY_SIGNING_KEY
POLY_PROTO_WALLET_ADDRESS
POLY_CLOB_API_KEY
POLY_CLOB_API_SECRET
POLY_CLOB_PASSPHRASE
```

Propagate to `canary` + `production` before flighting CP4.3 beyond candidate-a. Use `scripts/experiments/derive-polymarket-api-keys.ts` to re-derive CLOB creds per environment if you use separate proto wallets there.

## Known follow-ups (all filed, all non-blocking for CP4.3)

| ID                                                                 | Title                                                      | Blocks?                                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| bug.0317                                                           | candidate-flight-infra.yml checkout hardcoded to main      | no — workaround is SSH hotfix, same as this flight                                                               |
| bug.0318                                                           | rename canary → candidate-a in .local/ + provision scripts | no                                                                                                               |
| bug.0319                                                           | split @cogni/ai-tools into per-node packages               | no, but makes CP4.3 painless if you land it first — no new tool ceremony needed for follow-up agent-facing tools |
| $16.32 stuck in 0x1Db192…47Dc (old dashboard wallet, Privy locked) | Privy support ticket open                                  | no                                                                                                               |

## Validation procedure for CP4.3 on candidate-a

1. Merge the CP4.3 PR; image builds.
2. Flight to candidate-a via `candidate-flight.yml` (the APP lever).
3. Loki check: `{namespace="cogni-candidate-a", container="app", service="app"} |= "poly.copy_trade"` should show periodic `tick` events and at least one `decide` event per target.
4. Insert a known copy target (env or DB) pointing at a wallet actively placing fills. Watch for:
   - `poly.copy_trade.fill_observed`
   - `poly.copy_trade.decision { action: "place", reason: "new_fill" }`
   - `poly.copy_trade.placement { order_id, client_order_id }`
   - corresponding `poly.trade.capability.ready` (first invocation) or subsequent `poly.clob.place` events
5. On-chain: Polygonscan for 0x7A3347… shows a USDC.e transfer event from the Polymarket exchange contract on a fill.
6. Kill-switch test: flip `poly_copy_trade_config.enabled=false`, wait one tick, confirm zero `placement` events. Flip back, confirm resumption.
7. Evidence on PR: {target_wallet, observed_fill_id, our order_id, tx_hash, timestamp-chain}.

## Gotchas worth knowing

- **Dashboard-created wallets cannot be signed-for via API.** The Privy `owner_id` defaults to the dashboard user account, not a key quorum. If you ever need a new proto wallet, use `scripts/provision-poly-proto-wallet.ts` with `POLY_PROTO_OWNER_QUORUM_ID` set — NOT the console. See `docs/guides/polymarket-account-setup.md` (rewrote during this PR).
- **Infra lever checks out `main`.** If CP4.3 needs new env vars, land the script + workflow edits to main FIRST, then SSH hotfix the existing candidate-a secret, then flight. See bug.0317 for the proper fix.
- **Polymarket CLOB has no update op.** Cancel + replace. `core__poly_cancel_order` is idempotent (already-canceled / already-filled id → success no-op).
- **viem dual-peerDep `as any` casts** in `bootstrap/capabilities/poly-trade.ts` — not a bug, cross-peerDep drift. Don't try to remove without upgrading both sides atomically.
- **First tool invocation is 1–3s** — dynamic import + Privy wallet resolution. Expected.
- **Kill-switch failure mode:** if POLY*PROTO*\* env is missing, the capability is undefined and tools register as stubs that throw on invocation. Pod boots fine; nothing trades. This is the intentional soft-kill path.

## Pointers

```
PR                       https://github.com/Cogni-DAO/node-template/pull/900
Task doc                 work/items/task.0315.poly-copy-trade-prototype.md
Setup guide              docs/guides/polymarket-account-setup.md
Capability factory       nodes/poly/app/src/bootstrap/capabilities/poly-trade.ts
Pure decide()            nodes/poly/app/src/features/copy-trade/decide.ts
Executor                 nodes/poly/app/src/features/copy-trade/clob-executor.ts
CLOB adapter             packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts
Data-API client          packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts
Fill normalizer          packages/market-provider/src/adapters/polymarket/polymarket.normalize-fill.ts
DB schema                nodes/poly/app/src/shared/db/schema.ts (poly_copy_trade_*)
Env schema               nodes/poly/app/src/shared/env/server-env.ts
Tool catalog             packages/ai-tools/src/catalog.ts
Poly-brain tool list     nodes/poly/graphs/src/graphs/poly-brain/tools.ts
Deploy lever (infra)     .github/workflows/candidate-flight-infra.yml  (see bug.0317)
Deploy lever (app)       .github/workflows/candidate-flight.yml
Proto wallet SSH hotfix  work/handoffs/archive/task.0315/2026-04-17T23-40-00.md (context for bug.0317)
```

## Next command for the incoming dev

1. Skim this file + task.0315.md CP4.3 section + `decide.ts` + `clob-executor.ts`.
2. Pick one of the P2-filed bugs to knock out first if you want low-stakes warm-up; `bug.0319` is the biggest future-cost-saver.
3. Start CP4.3 with the stack test skeleton: Data-API mock → fills upsert → decide → `FakePolymarketClobAdapter.placeOrder` called with the expected min-notional intent. Work backward from that test.
4. When CP4.3 is green end-to-end on candidate-a, ship CP4.5 (dashboard card) + `/closeout`.
