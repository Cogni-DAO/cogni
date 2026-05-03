---
name: poly-dev-manager
description: "Top-level router for Cogni's Polymarket poly node. Load this skill for any poly work; it routes you to the right specialty skill (copy-trading loops, market-data / CLOB / Data-API, or auth & wallets). Use when starting a poly task, triaging a poly bug, reviewing a poly PR, or anytime the work smells poly-adjacent but you don't yet know which sub-domain. Also triggers for: 'work on the poly node', 'poly bug', 'review this poly PR', 'what does the poly node do', 'which poly skill do I need', 'poly roadmap', 'Phase 3 / Phase 4', 'task.0318 / task.0315 / task.0322', 'mirror trade Polymarket wallet', 'fix poly in candidate-a'."
---

# Poly Dev Manager

You are the orientation layer for Cogni's poly node. This file is intentionally short: it gets you to the specialty skill you actually need.

## What the poly node does (one paragraph)

Takes a Polymarket wallet that demonstrably trades with edge and mirrors its fills onto a Cogni-controlled trading wallet. Target wallet trades → `wallet-watch` detects via Polymarket Data-API `/trades` poll → `mirror-coordinator` decides → `INSERT_BEFORE_PLACE` ledger row lands → `PolymarketClobAdapter` signs via Privy HSM → CLOB receipt. v0 shipped single-operator. Phase A shipped RLS on copy-trade tables. Phase B shipped per-tenant Privy trading wallets (`deploy_verified` 2026-04-22 on candidate-a, via [task.0318](../../../work/items/task.0318.poly-wallet-multi-tenant-auth.md)). Phase 4 will swap the 30s poll for CLOB WebSocket + adversarial-robust target ranking.

## Current Status Card (2026-05-03)

**Latest copy-policy branch:** PR #1203 lineage. Candidate-a flight is stale
after the position-pXX correction; re-flight before validating live behavior.

**Active copy-trade behavior:**

- New entries for curated targets use `target_percentile_scaled`: the target condition/token position cost basis must be at or above that wallet's configured pXX threshold before we mirror it.
- Default pXX is p75. The per-target UI/config slider may choose another percentile; unsupported values interpolate between known points and clamp outside the known range.
- Accepted BUY branches size from market minimum toward `max_usdc_per_trade`, scaled by how far the target position is between pXX and p99.
- Individual target orders are triggers only. Do not add a second order-size pXX gate.
- Existing mirror positions add branch context through `position_followup`: same-token `layer`, opposite-token `hedge`, or SELL `sell_close`.
- Follow-ups still require market floors, per-position caps, and local mirror exposure thresholds. They do not bypass `already_resting`, idempotency, tenant grant authorization, or CLOB placement checks.

**Hardcoded position pXX currently baked into bootstrap config:**

| target    |  p75 |  p90 |    p95 |    p99 | sample                                                                   |
| --------- | ---: | ---: | -----: | -----: | ------------------------------------------------------------------------ |
| RN1       | $199 | $726 | $1,773 | $5,453 | 3,942 token positions, Data API `/positions`, captured 2026-05-03T00:59Z |
| swisstony | $146 | $633 | $1,460 | $5,463 | 1,148 token positions, Data API `/positions`, captured 2026-05-03T00:59Z |

**Position follow-up defaults for curated targets:**

- `min_mirror_position_usdc = 5`
- `market_floor_multiple = 5`
- `min_target_hedge_ratio = 0.02`
- `min_target_hedge_usdc = 5`
- `max_hedge_fraction_of_position = 0.25`
- `max_layer_fraction_of_position = 0.5`

**Observability reality:** Loki is the current operational truth. Query `event="poly.mirror.decision"` for processed fills; position-aware branches include `position_branch`, `position_qty_shares`, `position_token_id`, `target_position_usdc`, and `target_hedge_ratio`. Metrics are still wired through `noopMetrics` in candidate-a bootstrap, so do not assume Prometheus counters exist yet.

## Which skill to load

| If you're doing…                                                                                                                                                              | Load                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Mirror pipeline, coordinator, wallet-watch, `poly_copy_trade_*` tables, v0 caps, poll cadence, shared-poller, Phase-4 streaming prep                                          | [`poly-copy-trading`](../poly-copy-trading/SKILL.md) |
| CLOB order placement, Data-API reads, fill-id semantics, EOA-vs-Safe-proxy gotchas, target-wallet screening / ranking research                                                | [`poly-market-data`](../poly-market-data/SKILL.md)   |
| Per-tenant `/api/v1/poly/wallet/connect`, Privy provisioning, `poly_wallet_connections`, CTF + USDC.e approvals, AEAD at rest, CustodialConsent, validating `deploy_verified` | [`poly-auth-wallets`](../poly-auth-wallets/SKILL.md) |

Load all three if you're reviewing a PR that cuts across them (the `/connect` → mirror path on a real tenant, for example). Each specialty skill is self-contained; there is no "base" you have to load first.

## Canonical references (cross-cutting)

**Specs (as-built):**

- [docs/spec/poly-copy-trade-phase1.md](../../../docs/spec/poly-copy-trade-phase1.md) — Phase 1 layer boundaries, invariants, `fill_id` shape
- [docs/spec/poly-order-position-lifecycle.md](../../../docs/spec/poly-order-position-lifecycle.md) — order status vs position lifecycle vs redeem job state machine
- [docs/spec/poly-multi-tenant-auth.md](../../../docs/spec/poly-multi-tenant-auth.md) — Phase A tenant-scoped copy-trade tables + RLS
- [docs/spec/poly-trader-wallet-port.md](../../../docs/spec/poly-trader-wallet-port.md) — Phase B `PolyTraderWalletPort` (AEAD, consent, invariants)

**Current design/research pointers:**

- [docs/design/poly-mirror-position-projection.md](../../../docs/design/poly-mirror-position-projection.md) — `MirrorPositionView`, position authority boundaries, follow-up branch predicates, decision-log observability contract
- [docs/design/poly-positions.md](../../../docs/design/poly-positions.md) — canonical position model; do not confuse local mirror policy cache with chain/Data API authority
- [docs/design/poly-bet-sizer-v1.md](../../../docs/design/poly-bet-sizer-v1.md) — current as-built hardcoded RN1/swisstony target-position pXX policy
- [docs/research/poly/layering-policy-spike-2026-05-02.md](../../../docs/research/poly/layering-policy-spike-2026-05-02.md) — historical layering research; do not treat its order-flow pXX as the active position-pXX policy
- [nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts](../../../nodes/poly/app/src/bootstrap/jobs/copy-trade-mirror.job.ts) — current hardcoded v0 sizing snapshots and position-follow-up defaults
- [nodes/poly/app/src/features/copy-trade/plan-mirror.ts](../../../nodes/poly/app/src/features/copy-trade/plan-mirror.ts) — pure planner for pXX, layer, hedge, and SELL-close branch decisions
- [nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts](../../../nodes/poly/app/src/features/copy-trade/mirror-pipeline.ts) — sequencing, target-position hydration, ledger decision recording, Loki fields

**Guides:**

- [docs/guides/poly-wallet-provisioning.md](../../../docs/guides/poly-wallet-provisioning.md) — per-tenant flow + honest architecture accounting
- [docs/guides/polymarket-account-setup.md](../../../docs/guides/polymarket-account-setup.md) — shared-operator onboarding (legacy)

**Project charter + work items:**

- [proj.poly-copy-trading](../../../work/projects/proj.poly-copy-trading.md) — full roadmap, open bugs, constraints
- [task.0315](../../../work/items/task.0315.poly-copy-trade-prototype.md) — v0 prototype (Phase 1)
- [task.0318](../../../work/items/task.0318.poly-wallet-multi-tenant-auth.md) — multi-tenant auth (Phase A + B)
- [task.0322](../../../work/items/task.0322.poly-copy-trade-phase4-design-prep.md) — Phase 4 streaming + ranking
- [task.0323](../../../work/items/task.0323.poly-copy-trade-v1-hardening.md) — v1 hardening bucket
- [task.0332](../../../work/items/task.0332.poly-mirror-shared-poller.md) — shared batched poller
- [task.0346](../../../work/items/task.0346.poly-wallet-orphan-sweep.md) — Privy orphan cleanup
- [task.0347](../../../work/items/task.0347.poly-wallet-preferences-sizing-config.md) — retire hardcoded caps + funding suggestions
- [bug.0329](../../../work/items/bug.0329.poly-sell-neg-risk-empty-reject.md) — SELL on neg_risk empty reject
- [bug.0335](../../../work/items/bug.0335.poly-clob-buy-empty-reject-candidate-a.md) — shared operator BUY empty reject on candidate-a

## Anti-patterns that bite everywhere (regardless of specialty)

- **Placing a test trade from a wallet you control and calling it "mirror validation."** The mirror copies the TARGET. If the target didn't trade, the mirror has nothing to copy. True of shared operator, true of your own per-tenant wallet, true of raw-PK test wallets.
- **Smuggling P4 (streaming / ranking) work into a v0 or v1 task.** P4 is tracked in task.0322. Scope discipline matters here because the fill_id shape is frozen (`data-api:…`) and mixing schemes corrupts the idempotency layer.
- **`kubectl set env` for long-lived config.** Argo reverts on next sync. Secrets go through `scripts/setup/setup-secrets.ts` → `candidate-flight-infra`; config goes into the kustomize overlay.
- **Re-setting GH env secrets without checking `gh secret list --env candidate-a` first.** Rotates tokens out from under live flights.
- **Trusting the Polymarket UI profile for EOA-direct wallets.** The `/profile/<addr>` page redirects to an empty Safe-proxy. Use Data-API `/positions` / `/trades` or Polygonscan. See [`poly-market-data`](../poly-market-data/SKILL.md) for the full ground-truth order.

## Observability backstop (MCP-down fallback)

`grafana` MCP is flaky. When it's down, use [`scripts/loki-query.sh`](../../../scripts/loki-query.sh) — accepts raw LogQL, hits Grafana Cloud via service-account token, auto-sources `.env.canary` / `.env.local`. Same LogQL syntax as the MCP. Used to flip `deploy_verified` on task.0318 on 2026-04-22.

## Cross-cutting enforcement

Rules that apply regardless of which specialty you're in:

- **Never use raw PKs in production code paths.** `scripts/experiments/` only. Production signs via Privy HSM (shared or per-user).
- **Never skip `INSERT_BEFORE_PLACE`** in the coordinator — at-most-once correctness gate.
- **`fill_id` shape is frozen** at `data-api:<tx>:<asset>:<side>:<ts>`. P4 will add `clob-ws:…`. Never mix schemes within one fill.
- **Idempotency is always `keccak256(target_id + ':' + fill_id)` → `client_order_id`.** No alternatives.
- **`deploy_verified: true` requires the full validation recipe**, not just `pnpm check`. See [`poly-auth-wallets`](../poly-auth-wallets/SKILL.md) for the per-tenant provisioning recipe.
