---
id: bug.0342
type: bug
title: poly copy-trade places sub-min orders — CLOB rejects silently (success=undefined, orderID=<missing>, errorMsg="")
status: needs_closeout
priority: 2
rank: 20
estimate: 2
summary: "`buildMirrorTargetConfig` hardcodes `mirror_usdc: 1`, and the copy-trade executor submits whatever the target config says without consulting Polymarket's per-market `orderMinSize`. On 5-share-min markets (most sports + many news markets, ~all top-volume as of 2026-04-20) a $1 BUY at price 0.64 → 1.5625 shares < 5-share min → CLOB returns `{}` (no `success`, no `orderID`, no `errorMsg`). Adapter classifies as `rejected`, fill is recorded as `placement_failed`, then mirror-coordinator shrugs and skips future ticks with `reason: already_placed` — the target's trade is silently unmirrored. `orderMinSize` is a per-market integer in **shares**, not USDC; effective USDC minimum varies with price."
outcome: "Copy-trade pre-flights every intent against the market's live `orderMinSize` (Gamma) and either (a) scales the intent up to the share-denominated minimum, bounded by a user-explicit per-trade ceiling, or (b) skips with `reason: below_market_min` so we never emit a sub-min order to CLOB. `success=undefined, orderID=<missing>` rejections drop to zero in Loki on candidate-a."
spec_refs:
  - poly-copy-trade-phase1
assignees: derekg1729
credit:
project: proj.poly-copy-trading
branch: fix/bug-0342-poly-clob-dynamic-min-order-size
pr:
reviewer:
revision: 0
blocked_by:
created: 2026-04-20
updated: 2026-04-20
labels: [poly, polymarket, copy-trading, clob, candidate-a]
external_refs:
  - packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts
  - nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts
  - nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts
---

# poly copy-trade places sub-min orders — CLOB rejects silently

> Surfaced during candidate-a validation of PR #962 (bug.0339) on 2026-04-20 22:32 UTC. The operator wallet `0x7A3347…0aEB` tried to mirror a $1 BUY on "Will CA Vélez Sarsfield win on 2026-04-20?" at price 0.64; CLOB returned `{}`. Target wallet `0x37c1874a…`, client_order_id `0x21c77033…`, target_id `65a48f44-be04-52a9-bc8d-df55a94fb6a8`.

## Reproducer

1. POST a tracked wallet via `/api/v1/poly/copy-trade/targets` (defaults apply: `mirror_usdc=1`).
2. Target wallet fills a BUY on any market with `orderMinSize >= 2` shares at price `p` such that `1/p < orderMinSize` (i.e. ~all top-volume markets as of 2026-04-20).
3. Mirror-coordinator emits `poly.mirror.decision outcome=error reason=placement_failed`.
4. Loki: `{namespace="cogni-candidate-a"} |~ "CLOB rejected order" |~ "success=undefined"` returns one line per failed mirror.

## Evidence (live)

```
22:32:04.540  copy-trade-executor  execute: start           client_order_id=0x21c7703307…
22:32:04.540  poly-clob-adapter    placeOrder: start        size_usdc=1  limit_price=0.64  side=BUY
22:32:05.845  poly-clob-adapter    placeOrder: rejected     duration=1305ms
                                     error: "CLOB rejected order (success=undefined, orderID=<missing>, errorMsg=\"\")"
22:32:05.846  copy-trade-executor  execute: rejected
22:32:05.861  mirror-coordinator   poly.mirror.decision  outcome=error  reason=placement_failed
# all subsequent ticks (22:32:34, 22:33:04, 22:33:34, …)
                                   poly.mirror.decision  outcome=skipped  reason=already_placed
```

Market: `gamma-api.polymarket.com/markets?condition_ids=0x5438c021…` → `orderMinSize: 5`, `orderPriceMinTickSize: 0.01`. Sampled 20 top-volume markets on 2026-04-20: **all** returned `orderMinSize: 5`. User reports older markets were $1-min → threshold appears to have tightened recently.

## Root cause

Two gaps compose:

1. **Adapter doesn't pre-flight size**. `PolymarketClobAdapter.placeOrder` (`packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts`) fetches `tickSize`, `negRisk`, `feeRateBps` from the CLOB client but never pulls `orderMinSize`. Any below-min intent goes straight to `createAndPostOrder`.
2. **CLOB rejects size violations with empty body**. The SDK (`@polymarket/clob-client.createAndPostOrder`) returns `{}` for below-min orders — no `success`, no `orderID`, no `errorMsg`. Our adapter's B2 branch fires `success=undefined, orderID=<missing>, errorMsg=""` — accurate description, but opaque to ops + missing a stable error code.

`buildMirrorTargetConfig` (`nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts:72`) hardcodes `mirror_usdc: 1` — a defensible scaffolding default but now unconditionally sub-min on top-volume markets.

Note: `orderMinSize` is in **shares**, not USDC. Effective USDC minimum = `orderMinSize × limit_price`. A 5-share-min market is $5 min at price 1.0, $0.50 min at price 0.10, and $0.05 min at price 0.01.

## Design — sizing lives in the coordinator; adapter is a dumb validator

### Outcome

The mirror never submits a sub-min intent to CLOB. All sizing logic (today: fixed size with scale-up-to-min; tomorrow: proportional, percentile, historical-distribution) lives in the coordinator. The adapter validates the intent against market mechanics (min, tick) and throws a typed, classified error on violation. No `success=undefined` rejections reach Loki. One user-config object (`TargetConfig.sizing`) captures today's hardcoded defaults and absorbs every future sizing policy without touching the port or adapter.

### Approach

**One sizing object on `TargetConfig`; nothing on `OrderIntent`.**

The port surface (`OrderIntent`) stays as-is. Sizing is 100% coordinator-owned. The adapter's only responsibility is: "submit this exact intent; raise a classified error if market mechanics reject it." This flips the earlier draft (which put `max_size_usdc` on the port) because future sizing policies (proportional, percentile, vol-scaled) produce MANY inputs — stamping each one onto `OrderIntent` would churn the port. A single `sizing` object on `TargetConfig` absorbs all of them.

| Shape                   | Change (this PR only)                                                                                                                                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OrderIntent` (port)    | **No change.** Sizing is not a port concern.                                                                                                                                                                                                                                                                                |
| `TargetConfig`          | Replace flat `mirror_usdc` (and vNext-intended `max_usdc_per_trade`) with a single `sizing: SizingPolicy` discriminated union. Today's only kind: `"fixed"`.                                                                                                                                                                |
| `SizingPolicy` (new)    | Discriminated union. `{ kind: "fixed", mirror_usdc, max_usdc_per_trade }` is the only variant for this PR. The discriminant is the evolution seam.                                                                                                                                                                          |
| `MirrorReasonSchema`    | Add `"below_market_min"`. One code, covers both "target fill too small" and "user ceiling too tight". Prom cardinality bounded (MIRROR_REASON_BOUNDED).                                                                                                                                                                     |
| `PolymarketClobAdapter` | `Promise.all` fetch gains `orderMinSize` (4th parallel call). Check `shareSize >= orderMinSize`. On violation, throw `Error` with `code = "BELOW_MARKET_MIN"` and structured fields `{minShares, gotShares, minUsdc}`. No scaling.                                                                                          |
| `clob-executor.ts`      | Catches the error by `err.code === "BELOW_MARKET_MIN"` (not `instanceof`). Returns `{ outcome: "skipped", reason: "below_market_min" }`.                                                                                                                                                                                    |
| `mirror-coordinator`    | Before `placeIntent`, applies the sizing policy: for `kind: "fixed"`, compute `targetShares = max(mirror_usdc/price, orderMinSize)` only if `targetShares × price ≤ max_usdc_per_trade`; else skip. Coordinator calls a new `adapter.getMarketConstraints(tokenId) → { minShares, tickSize }` to fetch min before deciding. |

**Why the coordinator owns sizing (not the adapter)**:

- Future sizing is rich policy (proportional to target's own bet, historical percentile, vol-scaled, per-market overrides). Policy ≠ platform mechanics. Hexagonal: policy = coordinator, mechanics = adapter.
- The adapter stays a thin validator — one new parallel fetch, one classified throw. No scaling, no policy, no ceiling.
- Every future policy variant plugs into the same `sizing` discriminated union. Zero port change, zero adapter change.

**Flow**:

```
coordinator.decide()
  │ fetch market constraints via adapter (new seam: getMarketConstraints)
  │   → { minShares: 5, tickSize: 0.01 }
  │ apply sizing policy (kind: "fixed") on target's fill
  │   targetShares = max(mirror_usdc / price, minShares)         // share-space, no float chain
  │   effectiveUsdc = targetShares × price
  │   if effectiveUsdc > max_usdc_per_trade → skip(below_market_min)
  │   else → intent.size_usdc = effectiveUsdc
  ▼
adapter.placeOrder(intent)
  │ Promise.all(tickSize, negRisk, feeRateBps, minOrderSize)
  │ shareSize = size_usdc / price
  │ if shareSize < minOrderSize → throw { code: "BELOW_MARKET_MIN", ... }  // defense-in-depth
  │ createAndPostOrder
```

**Why share-space math** (fixes B1): floats aren't associative. Scaling `size_usdc = orderMinSize × price` then recomputing `shareSize = size_usdc / price` can produce `minShares − ε` → CLOB rejects. Coordinator computes `targetShares` directly in share units; adapter re-verifies `shareSize >= minShares` as defense-in-depth.

**Why classified error not `instanceof`** (fixes B3): package boundaries + bundlers break class identity. Adapter sets `err.code = "BELOW_MARKET_MIN"` + `err.name = "BelowMarketMinError"`; coordinator discriminates on `err.code` (primitive string, bundle-stable).

### Future-vision fit (why this shape, explicitly)

User stated near-term vision: "desired bet size/range + dynamically size bets based on copy-traded wallet's current bet vs its historical distribution."

| Future policy                                 | New variant on `sizing` union                                             | Touches port? | Touches adapter? |
| --------------------------------------------- | ------------------------------------------------------------------------- | ------------- | ---------------- |
| User picks explicit bet range                 | `{ kind: "fixed", mirror_usdc, max_usdc_per_trade }` (today)              | no            | no               |
| Mirror X% of target's bet                     | `{ kind: "proportional", pct, min_usdc, max_usdc_per_trade }`             | no            | no               |
| Scale by target's historical percentile       | `{ kind: "percentile", curve: [...], min_usdc, max_usdc_per_trade }`      | no            | no               |
| Hybrid (e.g. proportional with floor/ceiling) | `{ kind: "hybrid", base: <policy>, floor: <policy>, ceiling: <policy> }`  | no            | no               |
| Per-market override                           | Orthogonal: `sizing_overrides_by_market?: Record<MarketId, SizingPolicy>` | no            | no               |

All of them compute `effectiveUsdc` in the coordinator before intent construction. The adapter sees an OrderIntent with a concrete `size_usdc` and checks it against `orderMinSize`. That's the stable contract.

**Reuses**:

- Existing `Promise.all` seam in `polymarket.clob.adapter.ts:200` — add one parallel call.
- Existing `MirrorDecision` + `MirrorReason` machinery — one new enum value.
- Existing `@polymarket/clob-client` fetch methods (verify the exact method for min-order-size before `/implement` — see Prerequisites below).

**Rejected**:

- _Scaling in the adapter_ (prior draft of this design). Rejected: adapter then needs to know the user's ceiling, which means the port grows a `max_size_usdc` field that becomes an attractive nuisance for every future sizing policy. Bad for the vision.
- _`instanceof BelowMarketMinError` across packages_. Rejected: class identity fractures after bundling. Use `err.code`.
- _Float-space scaling (`size_usdc = orderMinSize × price`)_. Rejected: `5 × 0.07 / 0.07 = 4.999…` → re-rejected. Share-space only.
- _Raise `MIRROR_USDC` default to 5_. Rejected: breaks "only risk $1" promise + still fails on higher-min markets.
- _Flat fields on `TargetConfig` (`mirror_usdc + max_usdc_per_trade`) with no discriminated union_. Rejected: every future policy re-expands the row with new nullable columns. Discriminant absorbs policy shape growth cleanly.

### Invariants (code review criteria)

<!-- CODE REVIEW CRITERIA -->

- [ ] SIZING_LIVES_IN_COORDINATOR: no sizing math in the adapter beyond the defense-in-depth min-shares guard. `OrderIntent` unchanged.
- [ ] SHARE_SPACE_MATH: coordinator computes `targetShares` directly; never scales via the USDC round-trip. Adapter guards on shares (`shareSize >= minShares`), not reconstructed USDC.
- [ ] CLASSIFY_BY_CODE_NOT_INSTANCEOF: coordinator matches `err.code === "BELOW_MARKET_MIN"`. No `instanceof` across packages.
- [ ] MIRROR_REASON_BOUNDED: one new `"below_market_min"` reason; no variable strings in Prometheus label.
- [ ] ZERO_SILENT_REJECTIONS: Loki query `|~ "CLOB rejected order" |~ "success=undefined"` on deployed SHA returns zero lines during validation window.
- [ ] SIZING_POLICY_IS_DISCRIMINATED: `TargetConfig.sizing` is a Zod discriminated union on `kind`. Adding a new policy is a new variant, not a flat-field addition.
- [ ] VNEXT_SEAM_STABLE: the DB column added in vNext is `poly_copy_trade_targets.sizing jsonb NOT NULL` (stores the full policy object verbatim). Zero port churn. Zero adapter churn.
- [ ] SIMPLE_SOLUTION: Leverages existing Promise.all + existing decision/reason enum. One discriminated union; no new ports.
- [ ] ARCHITECTURE_ALIGNMENT: Adapter = mechanics, coordinator = policy (spec: architecture § hexagonal).

### Files

- Modify: `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts` — (1) add `minOrderSize` to `Promise.all`, (2) defense-in-depth guard `if (shareSize < minOrderSize) throw err({code:"BELOW_MARKET_MIN", ...})`, (3) new method `getMarketConstraints(tokenId)` → `{ minShares, tickSize }` on the adapter interface.
- Modify: `packages/market-provider/src/ports/market-provider.ts` (or wherever the trade capability lives) — add `getMarketConstraints` to the port.
- Modify: `nodes/poly/app/src/features/copy-trade/types.ts` — replace `mirror_usdc: z.number().positive()` with `sizing: SizingPolicySchema` (discriminated union on `kind`; only variant `"fixed"` this PR). Add `"below_market_min"` to `MirrorReasonSchema`.
- Modify: `nodes/poly/app/src/features/copy-trade/decide.ts` — take `minShares` as an input; compute `effectiveUsdc` in share space; route intent or skip. Pure function stays pure.
- Modify: `nodes/poly/app/src/features/copy-trade/mirror-coordinator.ts` — fetch `getMarketConstraints` before `decide`; catch `err.code === "BELOW_MARKET_MIN"` as defense-in-depth.
- Modify: `nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts` — `buildMirrorTargetConfig` returns `sizing: { kind: "fixed", mirror_usdc: 1, max_usdc_per_trade: 5 }`. Rename the two old constants into one `DEFAULT_SIZING_POLICY`.
- Modify: `nodes/poly/app/src/app/api/v1/poly/copy-trade/targets/route.ts` — POST response `buildTargetView` reads `sizing.mirror_usdc` + `sizing.max_usdc_per_trade`; shape kept flat on the wire for now (spec-agnostic to internal rep).
- Test: `packages/market-provider/tests/polymarket-clob-adapter.test.ts` — (a) shareSize below min throws classified error with `code`, `name`, and structured fields; (b) at-or-above min → no change.
- Test: `nodes/poly/app/tests/unit/features/copy-trade/decide-sizing-fixed.spec.ts` — table tests: (a) `mirror_usdc` buys ≥ minShares → `effective = mirror_usdc`; (b) `mirror_usdc` buys < minShares but `max_usdc_per_trade ≥ minUsdc` → `effective = minShares × price`; (c) `max_usdc_per_trade < minUsdc` → skip.
- Test: one `mirror-coordinator` integration test that asserts the error-code discriminator path works (no `instanceof`).

### Prerequisites for `/implement` (Blockers B1–B3 resolved here; B2 still to confirm)

1. **Verify sub-min is the sole cause on candidate-a** (B2). Smallest test: place a single $5 BUY via the same adapter path with the operator key. If it succeeds → hypothesis confirmed; if it also returns `{}` → compounding bug, re-open design before coding. Do this before starting on files.
2. **Verify the minOrderSize source in `@polymarket/clob-client`** (former C4). Expected: `client.getOrderBook(tokenId).min_order_size` or similar. If the SDK doesn't expose it, fall back to the Gamma client (`market.orderMinSize`) already wired via `@cogni/market-provider`. Pick the source at file-edit time.

### vNext extensibility (informational — NOT in this PR)

- DB: `ALTER TABLE poly_copy_trade_targets ADD COLUMN sizing jsonb NOT NULL DEFAULT '{"kind":"fixed","mirror_usdc":1,"max_usdc_per_trade":5}'::jsonb`. Policy object stored verbatim; new `kind` values = new variants, no schema migration.
- POST body accepts `sizing?: SizingPolicy`; defaults retained.
- UI: today shows "bet $X, cap $Y"; tomorrow shows a picker ("fixed" | "proportional" | "percentile") that swaps the form fields.
- Proportional: `{ kind: "proportional", pct: 0.1, min_usdc: 1, max_usdc_per_trade: 50 }` — mirror 10% of target's fill, clamped.
- Percentile: `{ kind: "percentile", curve: [{p: 0.5, usdc: 1}, {p: 0.9, usdc: 10}], ... }` — bet more when target is betting at the high end of their own history.
- All future variants compute `effectiveUsdc` in the coordinator; adapter never sees sizing policy.

## Design sketch — two viable paths (superseded, left for context)

Both add a pre-flight step in the mirror-coordinator (before `placeIntent`) that reads `orderMinSize` for the token's market. They differ in what happens on a below-min intent.

**Option A — Skip, never overbet** (safest, loses trades):

```ts
const minUsdc = market.orderMinSize * intent.limit_price;
if (intent.size_usdc < minUsdc) return decision("skipped", "below_market_min");
```

- Zero risk of unexpected spend.
- User configured $1 → never bets more than $1.
- Cost: misses every fill on a 5-share-min market whenever config < market min. In today's market landscape, that's almost every copy-trade.

**Option B — Scale up to min, bounded by explicit ceiling** (user-opt-in):

Add `max_usdc_per_trade` to `TargetConfig` (default = `mirror_usdc`, i.e. "no scaling unless user opts in"). Pre-flight:

```ts
const minUsdc = market.orderMinSize * intent.limit_price;
const effective = Math.max(intent.size_usdc, Math.ceil(minUsdc * 100) / 100);
if (effective > target.max_usdc_per_trade)
  return decision("skipped", "above_user_ceiling");
intent.size_usdc = effective;
```

- User knows their ceiling. Defaulting `max_usdc_per_trade === mirror_usdc` preserves current "only bet $N" behavior for existing targets (they just skip instead of failing).
- New targets can opt in to scaling by setting `max_usdc_per_trade > mirror_usdc` in their POST body.
- Obeys `max_daily_usdc` unchanged.

Recommend **Option B** — it's what "dynamic min bet" means, and the explicit ceiling is the safety rail.

## Not in scope

- Adapter-level retry on empty CLOB response. The empty body IS the reject signal; pre-flight eliminates the need.
- Reading `orderMinSize` from CLOB (`/markets/{conditionId}`) vs Gamma. Gamma is our existing seam; use it.
- Raising `MIRROR_USDC` default. That's a band-aid — still fails on $10+ markets, breaks the "only risk $1" promise.
- Changing `poly_copy_trade_decisions` schema. New `reason` codes fit the existing `reason TEXT` field.

## Validation

- **exercise**: Two agents follow the same high-volume target wallet (e.g. rank-1 DAY volume leaderboard trader) on candidate-a; target fills a BUY at `p=0.64` on a 5-share-min market. Agent A keeps `max_usdc_per_trade === mirror_usdc = 1` (opt-out). Agent B sets `max_usdc_per_trade = 5` (opt-in to scaling).
- **observability**:
  - `{namespace="cogni-candidate-a"} |~ "CLOB rejected order" |~ "success=undefined"` returns zero lines at the deployed SHA.
  - Agent A: `poly.mirror.decision outcome=skipped reason=below_market_min` with `userId=<agent-A>`.
  - Agent B: `placeOrder: ok` with `filled_size_usdc >= 3.20` (5 shares × 0.64), `userId=<agent-B>` on the envelope.
