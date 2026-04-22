---
name: poly-market-data
description: "Polymarket CLOB + Data-API ground-truth specialist. Load when reading market / position / fill state from Polymarket, placing CLOB orders at the wire level, researching target wallets, debugging an 'empty reject' or price-at-limit issue, or working on target screening / ranking. Also triggers for: 'where is Polymarket ground truth', 'EOA vs Safe-proxy profile', '/positions returns empty', 'CLOB rejected my order', 'neg_risk market SELL', 'CTF tokenId ERC1155', 'fill_id shape', 'top-wallet research', 'wallet screening', 'rank these targets', 'CLOB WebSocket Phase 4'. For mirror loop / coordinator / tables see `poly-copy-trading`; for per-tenant wallet provisioning / AEAD / CustodialConsent see `poly-auth-wallets`."
---

# Poly Market-Data & CLOB

You are the expert for reading truth from Polymarket (Data-API + CLOB) and for the wire-level semantics of placing orders. Mirror glue lives in `poly-copy-trading`; wallet provisioning / signing setup lives in `poly-auth-wallets`.

## Ground-truth check order (always this order)

1. **Polygon blockchain** — Polygonscan, the source of truth for token balances, transfers, CTF ERC1155 positions. Unambiguous.
2. **Polymarket Data-API** (`/data/trades`, `/data/positions`) — Polymarket's own read index of blockchain + CLOB events. Up-to-date within a few seconds.
3. **Polymarket website** — UI on top of Data-API. Useful for market names + human context, **NOT** for position / profile data of EOA-direct operators (see EOA-vs-Safe gotcha below).
4. **Poly-node's own `poly_copy_trade_fills.status`** — DB ledger, NOT re-synced from CLOB. Use `synced_at` + `/api/v1/poly/sync-health` to gauge staleness.

## EOA-direct vs Safe-proxy (the gotcha)

Polymarket UI assumes every trader trades through a Safe smart-contract proxy. Our shared operator (and our per-tenant trading wallets) trade **EOA-direct** — an externally-owned account signs CLOB orders itself.

- `polymarket.com/profile/<operator-EOA>` → shows an **empty** Safe-proxy, because the UI looks up `safeFactory.computeProxyAddress(EOA)` and displays THAT, which has no activity.
- Data-API `/positions?user=<EOA>` and `/trades?user=<EOA>` → correct. Use these.
- Polygonscan `https://polygonscan.com/address/<EOA>` → always correct.
- USDC.e deposit (`0x2791…8174` on Polygon PoS) goes to the **EOA directly** (no Safe bridging step).

Code references: `OrderActivityCard.tsx` links at Polygon tx hashes, never Polymarket profiles, precisely because of this. Don't "fix" that by adding a profile link.

## CLOB adapter essentials

- `nodes/poly/app/src/features/trading/polymarket-clob.adapter.ts` — primary adapter (Privy-HSM signed, shared operator legacy + per-tenant Phase B)
- `nodes/poly/app/src/features/trading/privy-clob-signer.ts` — Privy signer (production path)
- `scripts/experiments/place-polymarket-order.ts` — post-only $1 dress-rehearsal (tiny on-chain proof)
- `scripts/experiments/privy-polymarket-order.ts` — Privy-signed order path (end-to-end sanity check)
- `scripts/experiments/sign-polymarket-order.ts` — Phase B experiment: EIP-712 hash preview before Privy-HSM signing

**Order fields that matter:**

- `tokenId` — Polymarket CTF ERC1155 token representing YES or NO. Read from Gamma `/markets/<condition_id>`.
- `side` — `BUY` / `SELL`
- `price` — limit price in USDC (0.01 – 0.99 for a binary)
- `size` — token quantity. At 50 ¢ × $1 trade-cap, `size = 2.0`.
- `client_order_id` — our idempotency key (see `poly-copy-trading` skill). Essential for at-most-once.
- `time_in_force` — `GTC` / `POST_ONLY` for dress-rehearsal.

**Price-at-limit is not a bug.** A $0.01 BUY reject on a $0.30-mid market is "no taker at your price" — correct CLOB behaviour.

## Fill-ID shape (frozen, cross-cutting)

`fill_id = data-api:<tx_hash>:<asset_token_id>:<side>:<unix_ts_ms>`

- Assembled in `wallet-watch/polymarket-source.ts` at `Data-API /trades` parse time.
- Idempotency formula (see `poly-copy-trading`): `keccak256(target_id + ':' + fill_id)` → CLOB `client_order_id`.
- **Phase 4** (task.0322) will add a sibling scheme: `fill_id = clob-ws:<event_id>:<asset>:<side>:<ts>`. Schemes must never mix within one fill. Dual-source dedup is explicit Phase-4 design.

## Active bugs on the CLOB seam

- [bug.0335](../../../work/items/bug.0335.poly-clob-buy-empty-reject-candidate-a.md) — shared operator BUY empty reject on candidate-a. Suspects: operator-wallet balance / allowance state / stale Privy keys / drift between chain-id declared + signed. Not a code bug in this adapter.
- [bug.0329](../../../work/items/bug.0329.poly-sell-neg-risk-empty-reject.md) — SELL on a `neg_risk=true` market empty reject. Root cause: missing CTF `setApprovalForAll` for the neg-risk conditional-tokens contract. Blocks close-position. Fix lives in `poly-auth-wallets` (CTF approvals), not here. Any position on a neg-risk market is roach-motel until resolved.

## Data-API specifics

Base: `https://data-api.polymarket.com`

- `GET /trades?user=<addr>&takerOnly=false&limit=200` — per-wallet trade history. `takerOnly=false` is critical for target-wallet monitoring — otherwise you miss maker fills.
- `GET /positions?user=<addr>&sizeThreshold=1` — current positions. `sizeThreshold=1` filters dust.
- Latency: few seconds behind chain. Our 30s poll cadence absorbs it.
- Robustness: return shape occasionally includes `null` / missing fields; always null-check in parsers (revision-1 bug #5 on task.0318 Phase A was a missing null-check on `outcome`).

## Target-wallet research / screening

Scripts under `scripts/experiments/` (read-only, don't require PKs):

- `poly-wallet-research/top-wallet-research-v1.ts`
- `poly-wallet-research/top-wallet-research-v2-focus-3day.ts`
- `wallet-screen.ts`, `wallet-screen-v2-filtered.ts`, `wallet-screen-v3-weighted.ts`, `wallet-screen-v4-data-api.ts`
- Results: [`docs/design/wallet-analysis-components.md`](../../../docs/design/wallet-analysis-components.md)

Known adversarial failure: wash-trading, round-tripping through split Safes, Sybil-funded sock-puppets. task.0322 Phase 4 has the full "adversarial-robust ranking" design bucket (cross-wallet cluster detection, leakage attribution, counterfactual PnL net of slippage + fees).

## Phase 4 streaming — design-only

[task.0322](../../../work/items/task.0322.poly-copy-trade-phase4-design-prep.md) — `Needs Design`. Deliverables:

- **CLOB WebSocket adapter** — `wss://…/ws/user?…` with EIP-712 auth; reconnect + backfill logic.
- **Target ranker** — multi-factor scoring (realized edge, win-rate, size discipline, cluster-independence).
- **Dual-source ingestion** — Data-API (current, canonical) + CLOB-WS (new, latency-lead). Explicit dedup by `fill_id` scheme.
- **Counterfactual PnL** — "what would we have earned copying this target net of our fees + slippage?"

Do NOT smuggle any of this into a v0 / v1 PR. Scope discipline is the only thing keeping the frozen fill_id invariant honest.

## Anti-patterns specific to market data

- **Trusting Polymarket UI profile for EOA-direct wallet state.** See above. Data-API or Polygonscan only.
- **Reading position state from `poly_copy_trade_fills` without `synced_at` cross-check.** DB ledger is write-through, not cache-through. Use `/api/v1/poly/sync-health`.
- **Parsing Data-API without null-checks** on `outcome`, `price`, `size`. Polymarket occasionally returns these absent.
- **Placing an order on a `neg_risk=true` market without the conditional-tokens SELL approval.** See bug.0329. Approval setup is in `poly-auth-wallets`.

## Enforcement

- `fill_id` shape frozen — any change requires a sibling scheme + explicit dedup layer, not a mutation.
- Always use `takerOnly=false` on target-wallet `/trades` polls; otherwise you miss maker-side fills.
- Script experiments that require a PK must live in `scripts/experiments/` with `.env.local`-scoped PKs, never production paths.
