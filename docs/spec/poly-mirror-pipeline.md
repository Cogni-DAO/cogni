---
id: poly-mirror-pipeline-spec
type: spec
title: "Poly Mirror Pipeline — monitor → decide → place → fill/cancel → redeem"
status: draft
spec_state: draft
trust: as-built
summary: "One-page visual reference for the full poly copy-trade lifecycle: how a target wallet's fill becomes a placed order, how that order resolves, and how positions ultimately redeem. Each stage names its component, log event, persisted row, and primary failure mode — so an operator can read a single Loki query and a single SQL select to know which stage is broken."
read_when: Triaging why prod isn't placing, debugging a silent mirror loop, onboarding a new agent to the poly node, building observability dashboards or alerts, deciding which env has the latest fix.
implements: task.0315
owner: derekg1729
created: 2026-05-01
tags: [poly, polymarket, copy-trading, mirror, observability, spec]
---

# Poly Mirror Pipeline — Visual Reference

> **Five stages, one wallet's fill end-to-end.** Each stage row names the component, the Loki `event=`, the durable row it writes, and the silent-failure mode you actually have to chase down.

## End-to-end flow

```
TARGET                 OUR NODE                                              POLYMARKET
─────────────         ─────────────────────────────────────────              ─────────────
                                                                              
  trade ───────►   ① MONITOR ───►  ② DECIDE ───►  ③ PLACE ────────────────► CLOB book
                   wallet-watch    mirror-pipe    clob-adapter                  │
                   30s poll        policy.ts      placeOrder                    │
                   (Data-API)                                                   │
                                                                                ▼
  redeem  ◄──── ⑤ REDEEM   ◄────────────────────  ④ FILL/CANCEL ◄───────  match / FOK
                ctf-redeemer       (resy CTF      poly_copy_trade_fills      reject
                on-chain           ConditionAl-   status transitions
                tx)                Resolved evt)
```

## Stage Reference (per stage: component · event · row · silent mode)

| # | Stage | Component (file) | Loki `event=` | DB row written | Silent-failure mode you must chase |
|---|-------|------------------|---------------|----------------|------------------------------------|
| ① | **Monitor** | `wallet-watch/polymarket-source` | `poly.wallet_watch.fetch` | — (cursor on `poly_copy_trade_targets.last_processed_fill_id`) | `raw=0 fills=0` indistinguishable from "target idle" vs "filter hiding maker fills" |
| ② | **Decide** | `copy-trade/mirror-pipeline` | `poly.mirror.decision` | `poly_copy_trade_decisions` | `outcome=skipped reason=position_cap_reached` floods if cumulative-intent counter is stale |
| ③ | **Place** | `clob-adapter / poly-trade-executor` | `poly.clob.place` + `poly.copy_trade.execute` | `poly_copy_trade_fills (status=open)` | `errorCode=fok_no_match` mislabeled as `outcome=error` |
| ④ | **Fill/Cancel** | `clob-adapter` (poll) | (status transition logged on next poll) | `poly_copy_trade_fills.status: open→filled\|canceled\|error` | Stale `open` rows w/ no terminal transition — order died silently |
| ⑤ | **Redeem** | `redeem-pipeline / ctf-subscriber` | `poly.ctf.subscriber.condition_resolution_observed` → `poly.redeem.execute` | `poly_redeem_jobs`, on-chain CTF tx | Resolution observed but no redeem tx — collateral mismatch, gas, or signer drift |

## Per-Env Code-Truth Table (live as of writing)

The mirror pipeline produces correct behavior **only with both** the `0037` race-safe migration **and** the `takerOnly=false` Data-API param. Verify against `/version.buildSha`:

```
ENV              FIX LANDED?  buildSha        WHAT IT MEANS
──────────────  ───────────  ──────────────  ─────────────────────────────────────────────
candidate-a       (verify)    /version        unfixed = wallet-watch raw=0 on maker fills
preview           (verify)    /version        unfixed = same blind spot
production        (verify)    /version        unfixed = blind to maker fills (RN1)
```

**Verification line**: tail Loki for `event=poly.wallet_watch.fetch` and look at `raw`. Pre-fix `raw=0` even when target traded. Post-fix `raw>0` whenever any (taker OR maker) fill happened since cursor.

## Observability Quick-Queries

| Question | LogQL (env=production) | Pass condition |
|----------|------------------------|----------------|
| Is monitor seeing fills at all? | `{env="production"} \|~ "wallet_watch.fetch" \| json \| raw>0` | any hit in last 5 min when target was active |
| Did mirror decide? | `{env="production"} \|~ "poly.mirror.decision"` | one event per detected fill |
| Did place succeed? | `{env="production"} \|~ "poly.clob.place" \| json \| phase="ok"` | duration_ms < 1000, status=open |
| Did order resolve? | (poll) `SELECT status,COUNT(*) FROM poly_copy_trade_fills GROUP BY 1` | open count drains over time |
| Are conditions redeeming? | `{env="production"} \|~ "condition_resolution_observed"` | non-zero when prediction markets settle |

## Known Failure Modes (with fingerprints)

| Symptom in logs | Root cause | Fix |
|-----------------|------------|-----|
| `raw=0 fills=0` continuous, target visibly trading | Data-API `takerOnly=true` default hiding maker fills | `takerOnly=false` in `polymarket.data-api.client.ts:listUserTrades` (PR #1167) |
| `outcome=skipped reason=position_cap_reached` floods | `cumulativeIntentForMarket` counts CLOB-rejected error rows as intent | Filter `attributes.placement = 'market_fok'` in cap query (PR #1164) |
| `migrate` container loops with `column "market_id" contains null values` | Drizzle migration race: ADD COLUMN + UPDATE not atomic | Race-safe `DO $$ … LOCK TABLE … $$;` block in `0037_*.sql` (PR #1167) |
| `outcome=error errorCode=fok_no_match` | Limit price didn't match liquidity at FOK; clean skip semantically | Reclassify: `outcome=skipped reason=fok_no_match` |

## Observability Gaps (open work)

| Gap | Severity | Fix |
|-----|----------|-----|
| Wallet-watch `raw=0` ambiguous (idle vs filter-hidden) | 🔴 | Emit `target_silent_seconds` gauge; log `raw_count` separately from `filtered_count` |
| Migration retry storm (8× same error before success) | 🟡 | `migrate` should fail-fast with structured `errorCode`, not loop |
| Reconciler `list_failed` = raw SQL dump | 🟡 | Add `errorCode + msg "schema mismatch — config column dropped"` |
| `fok_no_match` logged as error not skip | 🟡 | Reclassify outcome |
| No metric for "last successful place age" | 🟢 | `poly_mirror_last_place_ts_seconds`; alert if stale |

## Pointers

- Full layered design (L1 trading / L2 wallet-watch / L3 copy-trade): [`docs/spec/poly-copy-trade-phase1.md`](./poly-copy-trade-phase1.md)
- Wallet provisioning + Privy: [`docs/spec/poly-trader-wallet-port.md`](./poly-trader-wallet-port.md)
- Multi-tenant auth boundary: [`docs/spec/poly-multi-tenant-auth.md`](./poly-multi-tenant-auth.md)
- Position exit path: [`docs/spec/poly-position-exit.md`](./poly-position-exit.md)
- Source files:
  - `nodes/poly/app/src/features/wallet-watch/polymarket-source/`
  - `nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts`
  - `nodes/poly/app/src/features/trading/order-ledger.ts`
  - `nodes/poly/packages/market-provider/src/adapters/polymarket/polymarket.data-api.client.ts`
