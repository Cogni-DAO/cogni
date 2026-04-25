---
id: proj.poly-copy-trading
type: project
primary_charter:
title: "Cogni Poly — Autonomous Copy-Trading"
state: Active
priority: 1
estimate: 5
summary: "Autonomous mirror of selected Polymarket wallets from a Cogni-controlled operator wallet. v0 ships single-operator + single-target with hardcoded caps; v1 hardens the ledger + telemetry + SELL path; v2 migrates to per-user multi-tenant wallets (task.0318); Phase 4 swaps the 30s Data-API poll for CLOB WebSocket + adversarial-robust ranking."
outcome: "A Cogni node autonomously mirrors N Polymarket target wallets onto M per-user operator wallets with sub-30s latency, RLS-enforced tenancy, at-most-once idempotency, and real-money caps enforced in code. DAO treasury earns measurable realized PnL tracked against a counterfactual baseline."
assignees: derekg1729
created: 2026-04-19
updated: 2026-04-23
labels: [poly, polymarket, copy-trading, mirror, privy, rls, multi-tenant]
---

# Cogni Poly — Autonomous Copy-Trading

> Spun out of [proj.poly-prediction-bot](proj.poly-prediction-bot.md)'s Run phase on 2026-04-19. That project still owns the Crawl (market port) + Walk (intelligence engine) surface; this project owns everything trade-placing.

## Goal

Take a Polymarket wallet that demonstrably trades with edge, and mirror its fills onto a Cogni-controlled operator wallet at scale. Start with single-operator single-target scaffolding to prove the code path, then harden the correctness rails, then split operator custody per-user so each Cogni account trades its own wallet, then replace the poll-based ingestion with streaming + adversarial signal ranking.

## Roadmap

### Phase 1 (P1) — Single-operator prototype ✅

> **Done.** End-to-end pipeline proven on candidate-a: target wallet trades → wallet-watch detects via Data-API `/trades` → mirror-coordinator decides → INSERT_BEFORE_PLACE row → PolymarketClobAdapter signs via Privy HSM → CLOB receipt.

| Deliverable                                                                                    | Status | Est | Work Item                                                                     |
| ---------------------------------------------------------------------------------------------- | ------ | --- | ----------------------------------------------------------------------------- |
| Copy-trade architecture spike (Data-API source, operator/target roles, paper-first)            | Done   | 2   | [spike.0314](../items/spike.0314.poly-copy-trading-wallets.md)                |
| Candidate-identification spike (niche edge scorecard, wallet funnel, 3 named candidates)       | Done   | 1   | [spike.0323](../items/spike.0323.poly-copy-trade-candidate-identification.md) |
| v0 prototype — single env-directed operator + env-directed target + `poly_copy_trade_*` tables | Done   | 5   | [task.0315](../items/task.0315.poly-copy-trade-prototype.md)                  |

### Phase 2 (P2) — v1 hardening + multi-target

> **Active.** v0 shipped with known gaps — cursor persistence, CTF SELL approvals, ledger status sync, rate-cap telemetry. v2 adds multi-target support as the trivial next step once the ledger is correct.

| Deliverable                                                                                                                                                              | Status       | Est | Work Item                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | --- | ----------------------------------------------------------------------------- |
| v1 hardening bucket — cursor persistence, CTF SELL, status-sync, metrics, alerting                                                                                       | In Review    | 3   | [task.0323](../items/task.0323.poly-copy-trade-v1-hardening.md)               |
| Sync-truth cache — DB as CLOB cache with typed not_found + grace window + `synced_at` + `/sync-health` route                                                             | Done         | 3   | [task.0328](../items/task.0328.poly-sync-truth-ledger-cache.md)               |
| User-owned tracked wallets + RLS on copy-trade tables — `dbTargetSource` (cross-tenant enumerator), CRUD routes, dashboard +/− wire-up, pooled shared-operator execution | In Review    | 3   | [task.0318](../items/task.0318.poly-wallet-multi-tenant-auth.md) Phase A      |
| Shared batched poller — replace per-wallet `setInterval` with one poll loop + `TargetSubscriptionRouter`                                                                 | Needs Design | 3   | [task.0332](../items/task.0332.poly-mirror-shared-poller.md) — blocks Phase 3 |

### Phase 3 (P3) — Multi-tenant: per-user operator wallets + RLS

> **Active.** Phase A shipped tenant-scoped copy-trade rows + RLS. Phase B (PR #968) shipped the port + schema + adapter + connect route + env plumbing. Phase B3 (this branch) ships the per-tenant trade executor, grants table, `authorizeIntent` cap/scope enforcement, and a full cutover of the single-operator prototype — `PolyTradeExecutorFactory` is now the only placement path. Remaining gate: `deploy_verified: true` via candidate-a e2e.

| Deliverable                                                                                                                       | Status         | Est | Work Item                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------- | --- | --------------------------------------------------------------------------------- |
| Per-user operator wallet binding + durable `WalletGrant` (RLS on copy-trade tables shipped in Phase A)                            | In Review (B3) | 5   | [task.0318](../items/task.0318.poly-wallet-multi-tenant-auth.md) Phase B          |
| Per-tenant trade executor + `authorizeIntent` cap/scope gate + prototype purge (full cutover)                                     | In Review      | 3   | [task.0318](../items/task.0318.poly-wallet-multi-tenant-auth.md) Phase B3         |
| Signing-backend decision (Safe+4337 vs Privy-per-user vs Turnkey) — resolved to Privy-per-user for v0                             | Done           | 2   | (inline in task.0318)                                                             |
| User-wallet orphan sweep for the dedicated Privy app (ops hygiene, not v0 trading path)                                           | Needs Design   | 2   | [task.0348](../items/task.0348.poly-wallet-orphan-sweep.md)                       |
| Per-tenant wallet preferences + copy-trade sizing config (retire hardcoded funding + caps)                                        | Needs Design   | 3   | [task.0347](../items/task.0347.poly-wallet-preferences-sizing-config.md)          |
| Trading wallet withdrawal — `withdrawUsdc` adapter + route + dialog (replaces stubbed button on Money)                            | Needs Triage   | 3   | [task.0351](../items/task.0351.poly-trading-wallet-withdrawal.md)                 |
| Trading wallet one-click fund flow — Polygon in wagmi + `trading_wallet_funding` repo-spec + dialog                               | Needs Design   | 3   | [task.0352](../items/task.0352.poly-trading-wallet-fund-flow.md)                  |
| Money page v0 — hybrid AI-credits + trading-wallet panel; nav label Money, route `/credits`                                       | Done           | 2   | [task.0353](../items/task.0353.poly-money-page-v0.md)                             |
| Enable Trading — 3×USDC.e approve + 3×CTF setApprovalForAll port + Money-page flow (blocks deploy_verified)                       | Needs Review   | 5   | [task.0355](../items/task.0355.poly-trading-wallet-enable-trading.md)             |
| Position exit correctness — live approval revalidation + provider cache refresh + authoritative close/redeem semantics            | In Review      | 3   | [task.0357](../items/task.0357.poly-position-exit-authoritative-close-redeem.md)  |
| Dashboard position-state split — Open Positions + Position History tabs; live/closed contract split; `recentlyClosedIds` eviction | In Review      | 3   | [task.0358](../items/task.0358.poly-dashboard-position-history-open-vs-closed.md) |
| E2E test suite — wallet onboarding (`connect`, grants, enable-trading) + trading path to `placeOrder` (deferred from #992 review) | Needs Triage   | 5   | [task.0356](../items/task.0356.poly-wallet-onboarding-trading-e2e-test-suite.md)  |
| Trading hardening — executor cache, cap-source column, prototype residue, agent tool re-enable                                    | Needs Triage   | 3   | [task.0354](../items/task.0354.poly-trading-hardening-followups.md)               |

### Phase 4 (P4) — Streaming + adversarial-robust ranking

> **Needs design.** 30s Data-API poll bounds our latency floor and loses mid-second fills. Phase 4 swaps to CLOB WebSocket (`clob-ws:…` fill_ids alongside the frozen `data-api:…` shape) and adds a target ranker that re-weights wallets on real-time performance rather than static leaderboard position.

| Deliverable                                                                                        | Status       | Est | Work Item                                                             |
| -------------------------------------------------------------------------------------------------- | ------------ | --- | --------------------------------------------------------------------- |
| Dual-path ingestion (Data-API poll ∪ CLOB WebSocket) + hot signer + target ranker + counterfactual | Needs Design | 5   | [task.0322](../items/task.0322.poly-copy-trade-phase4-design-prep.md) |

## Open Bugs

| Bug                                                                                                                                  | Status          | Impact                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [bug.0329](../items/bug.0329.poly-sell-neg-risk-empty-reject.md) — SELL on neg_risk empty reject                                     | needs_triage    | Every position opened on a neg_risk market becomes roach-motel until resolution. Blocks close-position.                                                                                                          |
| [bug.0335](../items/bug.0335.poly-clob-buy-empty-reject-candidate-a.md) — BUY empty reject on candidate-a                            | needs_triage    | Every autonomous mirror attempt rejected with empty CLOB response. Likely operator-wallet state (balance/allowance/keys), not code. Surfaced during task.0318 Phase A flight validation.                         |
| [bug.0345](../items/bug.0345.poly-neg-risk-adapter-ctf-approval-missing-on-user-exit.md) — neg-risk close needs adapter CTF approval | needs_implement | Multi-tenant wallets can report trading-ready yet still fail every neg-risk close with `spender 0xd91E80... allowance: 0`. Live wallet-level validation proved Enable Trading must provision 6 approvals, not 5. |

## Constraints

- **Live-money caps are hardcoded in v0/v1**: $1/trade, $10/day, 5 fills/hr. Any lift requires code change + redeploy + scorecard review. Per-tenant config lift tracked as [task.0347](../items/task.0347.poly-wallet-preferences-sizing-config.md).
- **INSERT_BEFORE_PLACE is the correctness gate**: ledger row must land before CLOB submit. Skipping it breaks at-most-once mirroring.
- **Idempotency is always `keccak256(target_id + ':' + fill_id)` → client_order_id.** No alternatives.
- **`fill_id` shape is frozen** at `data-api:<tx>:<asset>:<side>:<ts>`. Phase 4 adds `clob-ws:…` — never mix schemes within one fill.
- **Operator places, target trades — never conflate.** Placing a "test" trade from the operator wallet validates nothing.
- **EOA-direct signing only** (`SignatureType.EOA` hardcoded in `PolymarketClobAdapter`). Polymarket `/profile/<addr>` auto-redirects to the Safe-proxy — that page looks empty forever for EOA-direct users. Ground truth is Data-API, not the UI.
- **Raw PKs for `scripts/experiments/` only** — production places orders via Privy HSM (today) or per-user signer (Phase 3).

## Dependencies

- [x] `@cogni/market-provider` Polymarket CLOB + Data-API adapters — task.0230, task.0315
- [x] Operator wallet Privy custody — shipped via proj.ai-operator-wallet's PRIVY_APP_ID plumbing
- [x] `poly_copy_trade_{config,targets,fills}` Postgres tables — task.0315 migration 0027
- [x] `poly_copy_trade_fills.synced_at` column — task.0328 migration 0028
- [ ] Target wallet must be onboarded with USDC.e + CTF approvals — per `scripts/experiments/onboard-raw-pk-wallet.ts`
- [ ] Operator wallet must maintain USDC.e balance + allowances — **currently broken on candidate-a, see bug.0335**
- [ ] Per-tenant wallet must complete Polymarket approvals (3× USDC.e approve + 3× CTF setApprovalForAll) before first trade — productized in [task.0355](../items/task.0355.poly-trading-wallet-enable-trading.md); blocks task.0318 Phase B3 `deploy_verified: true`

## As-Built Specs

- [Poly Copy-Trade Phase 1](../../docs/spec/poly-copy-trade-phase1.md) — layer boundaries, invariants, fill_id shape (as-built v0)
- [Poly Multi-Tenant Auth](../../docs/spec/poly-multi-tenant-auth.md) — tenant-scoped copy-trade tables, `CopyTradeTargetSource` port (Phase A); `PolyTraderWalletPort` + `poly_wallet_{connections,grants}` + `PolyTradeExecutorFactory` (Phase B3, as-built)
- [Poly Trader Wallet Port](../../docs/spec/poly-trader-wallet-port.md) — port contract, `authorizeIntent` + branded `AuthorizedSigningContext`, read-only `getBalances` + HTTP `poly.wallet.balances.v1` (Money page surface), Privy-app isolation, adapter lifecycle (Phase B3, as-built)
- [Poly Position Exit](../../docs/spec/poly-position-exit.md) — authority split for close/redeem plus the readonly-first position-state model (`live_positions`, `closed_positions`, `pending_actions`)
- [Polymarket Account Setup](../../docs/guides/polymarket-account-setup.md) — Privy operator onboarding runbook (guide, not spec)

## Design Notes

- **Operator / target / test wallet roles**: three disjoint jobs. Operator places all autonomous mirror trades via Privy HSM. Target is the wallet being monitored (its trades flow through the mirror). Test is a raw-PK wallet in `.env.test` used for scripted validation — it doubles as a target in some flows. See `.claude/skills/poly-dev-manager/SKILL.md` for the poly-node overview and routing to the specialty runbooks (copy-trading, market-data, auth/wallets).

- **Six-approval onboarding**: a wallet that can BUY but not SELL is useless for copy-trading. USDC.e allowance on {Exchange, Neg-Risk Exchange, Neg-Risk Adapter} enables BUY. CTF `setApprovalForAll(operator, true)` on {Exchange, Neg-Risk Exchange, Neg-Risk Adapter} enables SELL, including neg-risk closes. Skipping the adapter approval is a latent bug that only surfaces on close-position.

- **Provider cache is a real boundary**: candidate-a proved that Polymarket can reject a SELL with `allowance: 0` on the neg-risk adapter even when our live on-chain reads show the spender approved. The integration plan now treats Polymarket's `/balance-allowance` cache as a write-path dependency that must be refreshed on exits, not as an implementation detail we can ignore.

- **Execution rows are a read model, not authority**: candidate-a also proved a close can succeed upstream while the dashboard still renders the old open row from the 30s wallet-analysis process cache. Immediate fix lives in task.0357: evict wallet-scoped execution/read-model cache keys after successful close/redeem. Proper follow-up is a readonly-first split between `live_positions`, `closed_positions`, and `pending_actions` so future MCP tooling can expose each authority cleanly.

- **Readonly-first position state is the clean MCP seam**: the future tool surface is not "give me rows from the execution card." It is a readonly projection of three authorities: `live_positions` (current holdings), `closed_positions` (trade-derived lifecycle history), and `pending_actions` (app-owned write/reconcile state). The domain contract lives in [Poly Position Exit](../../docs/spec/poly-position-exit.md); the generic tool transport will later ride the shared MCP infrastructure from [MCP Control Plane](../../docs/spec/mcp-control-plane.md) and [Tool Use](../../docs/spec/tool-use.md).

- **Target-source seam (`CopyTradeTargetSource`)**: Phase A lands the DB-backed impl (`dbTargetSource` over `poly_copy_trade_targets`) alongside the original `envTargetSource` (now local-dev only). The port has two methods: `listForActor(actorId)` RLS-clamped via appDb for per-user routes, and `listAllActive()` under serviceDb — the ONE sanctioned BYPASSRLS read — used exclusively by the mirror-poll enumerator in `container.ts`.

- **Sync-truth cache (task.0328)**: the ledger's `status` column is insert-time only — actual CLOB state may be filled, canceled, or partial. The reconciler reads CLOB on a 60s cadence and writes `synced_at`. Routes that show live status must cross-check Data-API `/positions?user=<addr>` or check `synced_at` staleness.
