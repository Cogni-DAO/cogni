---
id: bug.0335
type: bug
title: "Polymarket CLOB rejects every operator BUY on candidate-a with empty error — mirror pipeline boots clean but places zero orders"
status: done
priority: 1
rank: 51
estimate: 2
branch: fix/bug-0335-poly-clob-buy-empty-reject
pr: https://github.com/Cogni-DAO/node-template/pull/964
deploy_verified: true
created: 2026-04-19
updated: 2026-04-20
summary: 'Candidate-a operator wallet `0x7A33…0aEB` has not landed a successful CLOB order in 20+ hours. Every BUY from the autonomous mirror (5 attempts at $1 each, mix of neg_risk=true and neg_risk=false markets) returns the empty-error signature `success=undefined, orderID=<missing>, errorMsg=""`. Same surface as bug.0329, but distinct: that bug is SELL-on-neg-risk-only; this is BUY on every market type. Blocks all mirror validation on candidate-a until diagnosed.'
outcome: "Operator wallet `0x7A33…0aEB` places a $1 BUY via `scripts/experiments/privy-polymarket-order.ts` against any active Polymarket market and receives a normal orderID receipt. The candidate-a mirror can then resume placing trades when kill switch is flipped on."
spec_refs:
  - poly-copy-trade-phase1
assignees: []
project: proj.poly-copy-trading
labels: [poly, polymarket, adapter, bug, candidate-a, operator-wallet]
external_refs:
  - work/items/bug.0329.poly-sell-neg-risk-empty-reject.md
  - work/items/task.0315.poly-copy-trade-prototype.md
  - work/items/task.0318.poly-wallet-multi-tenant-auth.md
---

# bug.0335 — CLOB rejects every operator BUY on candidate-a with empty error

> Surfaced during PR #932 flight validation on 2026-04-19. With kill switch ON and a high-frequency target wallet (`0x204f72…5e14`, sports HFT, 296 trades/hr), the mirror pipeline correctly detected 17 fills, wrote 5 INSERT_BEFORE_PLACE rows, signed 5 BUYs via the operator Privy wallet, and got 5 identical empty-error rejects from CLOB. See Grafana `{service_name="app"} |= "poly.copy_trade.execute" |= "rejected"` between `2026-04-19T23:52:40Z` and `2026-04-19T23:52:43Z`.

## Symptom

Every `PolymarketClobAdapter.placeOrder` call with `side: "BUY"` against operator `0x7A3347D25A69e735f6E3a793ecbdca08F97A0aEB` returns:

- `success = undefined`
- `orderID = <missing>`
- `errorMsg = ""`
- adapter `error` string: `PolymarketClobAdapter.placeOrder: CLOB rejected order (success=undefined, orderID=<missing>, errorMsg="")`

Observed across 5 consecutive attempts within a 2-second window:

| client_order_id prefix | market                | neg_risk  | limit_px | size |
| ---------------------- | --------------------- | --------- | -------- | ---- |
| `0xfebe6d…`            | `0x0f6b87…86fc7b2`    | true      | 0.51     | $1   |
| `0xda8e8e…`            | `0xe83bc7…f8a960bd`   | true      | 0.80     | $1   |
| `0xffc888…`            | `0x10141e…8c2228e268` | **false** | 0.61     | $1   |
| `0x5161e8…`            | `0x10141e…8c2228e268` | **false** | 0.61     | $1   |
| `0x37e21e…`            | `0x4e2eba…b34cc42e8`  | ?         | 0.43     | $1   |

Mixed neg_risk=true AND neg_risk=false → rules out "neg_risk signing-domain mismatch" as the explanation (that's bug.0329's scope, and it's SELL-specific anyway).

## Evidence suggesting this is an operator-wallet problem, not a PR-#932 code regression

- Data-API `/trades?user=0x7A3347D25A69e735f6E3a793ecbdca08F97A0aEB&limit=5` shows the operator's **last successful trade was 20.5 hours before the PR #932 flight** (2026-04-19 ~03:20Z):
  - `BUY 5 @ 0.20` on "US x Iran permanent peace" (74095 s ago at flight time)
  - `SELL 1.96 @ 0.49` UFC Castaneda vs Mark (81517 s ago)
  - `BUY 1.97 @ 0.50` same UFC market (82661 s ago)
  - `BUY 500 @ 0.007` LeBron 2028 (106793 s ago)
- Data-API `/positions` shows the wallet holds exactly the two orphans from bug.0329 (LeBron 2028 500 shares, Iran 5 shares) — nothing traded since.
- The pre-PR-#932 pod serving the same operator wallet would have had the same failure mode if tested; this PR just gave us the telemetry to see it.

## Not a duplicate of bug.0329

- bug.0329: SELL + neg_risk only; bug.0329 explicitly states "**BUY path works fine on the same markets**."
- This bug: BUY on both neg_risk=true and neg_risk=false markets.
- Shared surface symptom (empty CLOB response) is a CLOB-side behavior: on any invalid order it returns `{}` rather than a typed error. The **cause** is almost certainly different.

## Reproducer

```bash
cd /Users/derek/dev/cogni-template-poly-multi-wallet
# Use the same Privy operator creds as candidate-a's poly-node-app-secrets
export POLY_PROTO_PRIVY_APP_ID=...       # from candidate-a secret
export POLY_PROTO_PRIVY_APP_SECRET=...   # from candidate-a secret
export POLY_PROTO_PRIVY_SIGNING_KEY=...  # from candidate-a secret
export POLY_PROTO_WALLET_ADDRESS=0x7A3347D25A69e735f6E3a793ecbdca08F97A0aEB
export POLY_CLOB_API_KEY=...             # from candidate-a secret
export POLY_CLOB_API_SECRET=...          # from candidate-a secret
export POLY_CLOB_PASSPHRASE=...          # from candidate-a secret

# Pick any currently-active sports market (fresh token-id each time)
pnpm tsx scripts/experiments/privy-polymarket-order.ts place \
  --side BUY \
  --token-id <fresh-token-id-from-an-active-sports-market> \
  --size 1 \
  --price 0.5 \
  --yes-real-money
# Expect (today): `Response: {success: undefined, errorMsg: ''}`
```

Also reproducible via `scripts/experiments/probe-polymarket-account.ts` to capture balance + allowance state alongside the reject.

## Diagnostic checklist — collect before triaging

Per `.claude/skills/poly-auth-wallets/SKILL.md` wallet-onboarding runbook (CTF + USDC.e + CLOB creds), silent rejects on BUY point at one of these. Walk this list IN ORDER with the probe script:

- [ ] **USDC.e balance** on `0x7A3347D25A69e735f6E3a793ecbdca08F97A0aEB`: polygon mainnet USDC.e `0x2791Bca1…`. Zero balance → CLOB silent-rejects BUYs. Most-likely cause.
- [ ] **USDC.e allowance** for:
  - Exchange `0x4bFb…982E`
  - Neg-Risk Exchange `0xC5d5…f80a`
  - Neg-Risk Adapter `0xd91E…5296`
    Any revoked / expired allowance → silent reject.
- [ ] **CLOB L2 API key validity**: call `derive-polymarket-api-keys.ts` with the same Privy signer and compare to the key stored in `poly-node-app-secrets`. If they diverge, the CLOB keys have rotated silently (Privy session TTL expired + new derive produced a new key).
- [ ] **Privy signing key functioning**: the `funder` field shows the right address in logs (`0x7A3347D25A69e735f6E3a793ecbdca08F97A0aEB`), so the Privy adapter is building orders correctly, but double-check signature validity via `signTypedData` round-trip.
- [ ] **MATIC gas balance** for potential fallback L1 signing paths — not expected to matter for CLOB BUY but quick to rule out.
- [ ] **Privy wallet session expired** — Privy HSM sessions can age out. Compare `POLY_PROTO_PRIVY_SIGNING_KEY` timestamp in the candidate-a secret against Privy dashboard.

## Fix criteria

- [ ] Diagnostic checklist above captured in a triage note (which step revealed the cause).
- [ ] Root cause addressed: e.g. top-up USDC.e + re-run `approve-polymarket-allowances.ts`, OR rotate Privy session, OR regenerate CLOB L2 keys.
- [ ] Reproducer above returns a normal orderID receipt.
- [ ] Post-fix candidate-a mirror validation: flip kill switch ON for ≤1 minute with the high-frequency target, confirm ≥1 `poly_copy_trade_fills` row with `status != 'error'`, flip OFF.
- [ ] Preventative: add a boot-time preflight in `createContainer()` that calls `probe-polymarket-account.ts` logic once at startup and refuses to start the mirror if balance/allowance/CLOB-key checks fail. Logs `poly.mirror.preflight_failed` and skips `startMirrorPoll` (without crashing the pod — operator and read-only APIs keep serving). Saves future operators 20 hours of silent no-op.

## Validation

Fixed when the reproducer in §Reproducer returns a normal orderID receipt, AND a 1-minute kill-switch-ON mirror run on candidate-a with the high-frequency target (`0x204f72…5e14`) yields at least one `poly_copy_trade_fills` row with `status != 'error'`. Grafana query: `{service_name="app"} |= "poly.copy_trade.execute" |= "phase\":\"placed\""` should be non-empty in that window.

## Blast radius

- **candidate-a mirror is a pure no-op today.** Every detected target fill produces an `error`-status ledger row and spends nothing. Rate cap (5 fills/hr) makes the noise bounded.
- **Spending caps are intact**: hardcoded $1/trade + $10/day + 5 fills/hr. Even if the underlying cause turns out to be a CLOB regression (not a wallet problem), worst case is we lose $10/day in attempted but-rejected placements until it's diagnosed.
- **Preview / production**: bug.0318's documented manual-seed recipe copies candidate-a's `POLY_CLOB_*` and `POLY_PROTO_PRIVY_*` values into those envs. If candidate-a's CLOB keys are stale, preview's will be too.

## Live validation — candidate-a 2026-04-21T00:01–00:06Z (post-deploy)

Operator-user's tracked-wallet subscriptions fired 3 placements through the patched adapter. All three logged the new structured fields. `deploy_verified: true`.

| UTC        | result   | market               | price | `error_code`                      | `reason` (was previously `""`)                                      |
| ---------- | -------- | -------------------- | ----- | --------------------------------- | ------------------------------------------------------------------- |
| `00:01:04` | rejected | Miami Marlins        | 0.63  | `unknown`→`below_min_order_size`¹ | `Size (1.58) lower than the minimum: 5`                             |
| `00:06:04` | rejected | Baltimore Orioles    | 0.49  | `unknown`→`below_min_order_size`¹ | `invalid amount for a marketable BUY order ($0.9996), min size: $1` |
| `00:06:04` | **ok**   | Washington Nationals | 0.20  | —                                 | — (order_id `0x6504f83f…`, status `open`)                           |

¹ First flight classified as `unknown` because the min-size signature wasn't in the enum. Post-flight classifier extension (same branch, commit following this note) adds `below_min_order_size`; re-plays would now carry that label. `response_keys: ["error", "status"]` was the signal for both — the live payload shape differs from documented `{success, errorMsg, orderID}`.

## Follow-ups discovered from live data

1. **`below_min_order_size` classifier** — **landed on this branch** (follow-up commit). Enum expanded, patterns `"minimum"|"min size"|"invalid amount"` added, 2 new tests. Rejection hits alert-routable label directly, pairs with bug.0342's business-logic fix (PR #967).
2. **`ClobOrderResponseLike` interface** — **landed on this branch**. Added `error?: string; message?: string` to encode the discovered `{error, status}` shape. Keeps callers compile-time-honest about what CLOB can return.
3. **`error_category` dimension (deferred)** — see Analysis §3 below. Not in this PR; would require dashboard coordination.

## Analysis — design against top-0.1% observability patterns

| #   | Pattern                                                              | This PR                                                        | Gap                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Structured JSON, bounded enum label                                  | ✅ `error_code` is 9-value enum, dashboard-safe                | —                                                                                                                                                                                                                                                         |
| 2   | Market/request context on success **and** failure                    | ✅ `tick_size`, `neg_risk`, `fee_rate_bps` on both paths       | —                                                                                                                                                                                                                                                         |
| 3   | Error **category** vs **code** (retryable / caller_fault / upstream) | ❌ single-dimension enum                                       | Add `error_category: "transient"\|"permanent"\|"caller_fault"\|"upstream_fault"` — lets alert routing and retry policy branch without re-parsing `error_code`. Not worth a breaking dashboard change yet; revisit when we wire retry policy.              |
| 4   | Free-text `reason` is a **temporary bucket**, not a permanent field  | ⚠️ kept as 128-char truncated string                           | Every new `reason` pattern seen in Loki should become a new `error_code`. Track in-flight via `poly_clob_place_total{error_code="unknown"}` — when non-zero, extend the enum. (Did exactly this loop for `below_min_order_size`.)                         |
| 5   | Response-shape encoded in types once discovered                      | ⚠️ `response_keys` is a bootstrapping tool                     | `ClobOrderResponseLike` now typed with the observed `{error, status}` shape. Keep discovering via `response_keys`, then promote into the interface.                                                                                                       |
| 6   | Trace correlation across layers                                      | ❌ adapter log lines lack `traceId`                            | Routes carry `reqId + traceId` (confirmed Loki), but adapter's child logger doesn't bind them. Node-app's bootstrap should pass `ctx.log` (which has `reqId`/`traceId` bound) as the adapter's logger instead of a fresh component logger. Separate task. |
| 7   | Sampling / cardinality budget                                        | ✅ ≤3 logs/request (start + ok\|rejected), enum labels bounded | —                                                                                                                                                                                                                                                         |
| 8   | SLI — `rate(result="ok") / rate(*)`                                  | ❌ no named SLI / SLO                                          | Recording rule + dashboard for `poly_clob_place_ok_rate_5m`. Separate task.                                                                                                                                                                               |
| 9   | Event name in registry                                               | ⚠️ inline strings (`event: "poly.clob.place"`)                 | Poly node's `events/` index is empty. Bug for a new task to centralize poly events; not adapter's scope (it's a shared package — the registry belongs at the node).                                                                                       |

**Score:** 5/9 green, 2 yellow (fixed in this follow-up), 2 red (correlation + SLI — deferred, separate tasks).

## Fix note (observability patch — this PR)

Root cause turned out to be orderMinSize × price (tracked as bug.0342 by parallel agent — Option A/B design pending). This PR does **not** close that business-logic gap; it closes the diagnostic gap that made the silent reject unreadable:

- `classifyClobFailure(response)` + `classifyClientError(err)` extract `{error_code, response_keys, http_status, reason}` from whatever CLOB actually returned — no more `(success=undefined, errorMsg="")` blackholes.
- `ClobRejectionError` carries `ClobFailureDetails`; callers branch on enum, not string-matching.
- `placeOrder` catch logs those fields + preflight market context (`tick_size`, `neg_risk`, `fee_rate_bps`). Metric labels gain `error_code` (bounded 8-value enum, dashboard-safe).
- No raw response bodies logged — structured fields + 128-char `reason` only (per `docs/spec/observability.md` rule 5).

When bug.0342 ships and the next silent reject appears, the Loki line will read `error_code: invalid_price_or_tick` (or similar) instead of the opaque empty-string signature.

## Pointers

- `packages/market-provider/src/adapters/polymarket/polymarket.clob.adapter.ts` — adapter that builds the empty-error string
- `scripts/experiments/privy-polymarket-order.ts` — CLI reproducer
- `scripts/experiments/probe-polymarket-account.ts` — balance + allowance probe
- `scripts/experiments/derive-polymarket-api-keys.ts` — regenerate CLOB L2 creds from Privy signer
- `scripts/experiments/approve-polymarket-allowances.ts` — re-set USDC.e allowances
- `.claude/skills/poly-auth-wallets/SKILL.md` — wallet roles + approvals runbook
- Loki query (flight window): `{service_name="app"} |= "poly.clob.place" |= "rejected"` between `2026-04-19T23:50:00Z` and `2026-04-19T23:55:00Z`
