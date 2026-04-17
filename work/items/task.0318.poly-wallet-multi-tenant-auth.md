---
id: task.0318
type: task
title: "Poly wallet multi-tenant auth — per-user operator-wallet binding + RLS on copy-trade tables"
status: needs_design
priority: 2
estimate: 5
rank: 5
summary: "Replace the env-directed single-operator wallet model shipped in task.0315 P1 with per-user wallet custody + durable authorization grants. Users connect a Privy-managed (or BYO) wallet to their Cogni account; copy-trade targets and fills are RLS-scoped to the owning user; scheduled executors run under a durable `WalletGrant` (pattern from scheduler's `execution_grants`) rather than a live user session."
outcome: "A Cogni user logs in, provisions or connects an operator wallet, and triggers copy-trade mirroring that places real Polymarket orders through THEIR wallet — no shared env credentials, no single-operator assumption. A second user's targets, fills, and decisions are invisible cross-tenant. Scheduled 30s poll and (P4) Temporal workflows run under a durable `WalletGrant` even when the user is offline."
spec_refs:
  - operator-wallet
  - tenant-connections
  - scheduler
assignees: derekg1729
project: proj.poly-prediction-bot
created: 2026-04-17
updated: 2026-04-17
labels: [poly, polymarket, wallets, auth, rls, multi-tenant, privy, security]
external_refs:
  - work/items/task.0315.poly-copy-trade-prototype.md
  - packages/db-schema/src/connections.ts
  - packages/db-schema/src/scheduling.ts
---

# Poly Wallet Multi-Tenant Auth

> Predecessor: [task.0315](task.0315.poly-copy-trade-prototype.md) — shipped the single-operator, env-directed prototype.

## Context

task.0315 P1 intentionally shipped single-operator scope to prove the trade-placement path end-to-end. The prototype's env vars (`OPERATOR_WALLET_ADDRESS`, `PRIVY_APP_ID`, `POLY_CLOB_API_KEY/SECRET/PASSPHRASE`) map one Cogni instance to one Polymarket EOA, and the copy-trade tables have no tenant column — every row is globally visible. That's correct for v0 and wrong for anything past a single-developer demo.

Two existing repo patterns inform the fix:

- **`execution_grants`** (`packages/db-schema/src/scheduling.ts`) — durable authorization for scheduled graph runs. A user creates a grant with a scope array (`"graph:execute:*"`); a scheduler-worker consuming the grant can run the graph at 3 AM without the user being online. Revocable, auditable, scope-checked.
- **`connections`** (`packages/db-schema/src/connections.ts`) — tenant-isolated encrypted credential storage for BYO external services (ChatGPT, GitHub, Google, Bluesky). `billing_account_id`-scoped RLS, AEAD encryption, scopes array, revocation fields.

Copy-trade needs both shapes composed: the wallet itself is a `connections`-style credential (encrypted or Privy-managed) bound to a `billing_account_id`, and the **authorization to trade** on that wallet from a scheduled poll is an `execution_grants`-style durable grant that survives user session expiry.

## Goal

Replace the single-operator env-directed model with per-user wallet connections + durable trade grants, then enable RLS on every copy-trade table so data is tenant-isolated by construction. No single-user assumption remains in the code path.

## Non-goals

- BYO-key (user-supplied private keys). v1 is Privy-custodied only; hardware wallets / imported EOAs are a later task.
- Multi-wallet-per-user. v1 is one operator wallet per `billing_account_id`.
- Revoking grants mid-flight (in-flight order completion is out of scope — grants gate placement, not cancellation).
- Migrating historical P1 rows to a tenant. P1 rows were written with a synthetic `target_id` under `updated_by='system'`; this task either drops them as prototype debris or assigns them to the bootstrap operator account.

## Design sketch

> Draft. Finalize during `/design` before `/implement`.

### New tables

`poly_wallet_connections` (extends the `connections` pattern for Polymarket EOAs)

- `id uuid PK`
- `billing_account_id text NOT NULL REFERENCES billing_accounts(id) ON DELETE cascade` — tenant boundary
- `privy_wallet_id text NOT NULL` — Privy HSM reference; no raw key material in app
- `address text NOT NULL` — checksummed EOA
- `chain_id int NOT NULL` — 137 (Polygon mainnet) today; future Amoy testnet gate
- `clob_api_key_ciphertext bytea NOT NULL` — AEAD-encrypted Polymarket L2 creds (reuse `connections` envelope)
- `encryption_key_id text NOT NULL`
- `allowance_state jsonb` — last observed on-chain allowance snapshot (exchange, neg-risk, neg-risk-adapter)
- `created_at / created_by_user_id / last_used_at / revoked_at / revoked_by_user_id`
- UNIQUE(billing_account_id) WHERE revoked_at IS NULL — one active wallet per tenant
- RLS: `created_by_user_id = current_setting('app.current_user_id', true)` (same policy shape as `connections`)

`poly_wallet_grants` (extends the `execution_grants` pattern for trade-placement authorization)

- `id uuid PK`
- `wallet_connection_id uuid NOT NULL REFERENCES poly_wallet_connections(id) ON DELETE cascade`
- `user_id text NOT NULL REFERENCES users(id)` — who issued the grant
- `scopes text[] NOT NULL` — e.g. `["poly:trade:buy", "poly:trade:cancel"]`; future `poly:trade:sell` etc.
- `daily_usdc_cap numeric(10,2) NOT NULL`
- `hourly_fills_cap int NOT NULL`
- `per_order_usdc_cap numeric(10,2) NOT NULL`
- `expires_at / revoked_at / revoked_by_user_id`
- `created_at NOT NULL DEFAULT now()`
- RLS: same as wallet connections

### Changes to existing tables (task.0315 CP3.3)

Add tenant columns and enable RLS:

- `poly_copy_trade_fills`: add `billing_account_id text NOT NULL` + `created_by_user_id text NOT NULL`. Enable RLS with `created_by_user_id = current_setting('app.current_user_id', true)`. Migration backfills any P1 rows to the bootstrap operator or drops them (decide at `/design`).
- `poly_copy_trade_config`: collapse singleton into **per-tenant** config — PK becomes `billing_account_id` (no more `singleton_id=1`). Each tenant has their own kill-switch. Fail-closed default preserved.
- `poly_copy_trade_decisions`: add `billing_account_id text NOT NULL`. RLS same policy.
- `poly_copy_trade_targets` (Phase 2 table, not yet shipped): born tenant-scoped from day one — builds on top of this task.

### Container wiring

- `PolymarketClobAdapter` still constructed per-request / per-tenant, not once at boot. Caller (CP4 executor or a future Temporal activity) resolves `(billing_account_id, wallet_connection_id)` → fetches Privy `walletId` + decrypts `ApiKeyCreds` → calls `createViemAccount` → passes into adapter constructor.
- Poll job (task.0315 CP4 scaffolding) iterates over active `poly_wallet_grants` instead of reading env vars. One grant → one tenant's targets → one adapter instance.
- **Fail-closed kill-switch becomes per-tenant**: the poll's config SELECT is per `billing_account_id`; a missing or failed row skips that tenant without affecting others.

### Scoped signer — reinstate the narrow port?

In CP3.1.5 we deleted `PolymarketOrderSigner` + `OperatorWalletPort.signPolymarketOrder` as dead surface because CP2 proved `createViemAccount` is enough. That remains correct for a single-operator path. With multi-tenant, the question is whether the **credential broker** (not the signer) belongs on `OperatorWalletPort` — something like `operatorWallet.resolvePolymarketAccount(walletConnectionId): Promise<LocalAccount>`. Decide at `/design` — but default to keeping the `createViemAccount` call inline in the executor if the indirection buys nothing.

## Plan (draft checkpoints — revise at `/design`)

- [ ] **CP1 — Schema + migration for `poly_wallet_connections` + `poly_wallet_grants`**. Both tenant-scoped with RLS policies. Seed helper for the bootstrap operator.
- [ ] **CP2 — Add tenant columns + RLS to `poly_copy_trade_{fills, config, decisions}`**. Migrate config from singleton to per-tenant. Backfill or drop P1 rows.
- [ ] **CP3 — Wallet-connection CRUD** (server actions + dashboard): provision a new Privy HSM wallet bound to the signed-in billing account; surface address + allowance state; "Connect wallet" button; revocation UI.
- [ ] **CP4 — Grant issuance UI + server actions**: user-set caps (daily / hourly / per-order); explicit "authorize trading" step that creates the `poly_wallet_grants` row.
- [ ] **CP5 — Executor + poll rewiring**: env-directed path removed; poll iterates grants; per-tenant kill-switch; per-tenant `decide()` state.
- [ ] **CP6 — Cross-tenant isolation tests**: two users, two wallets, two target sets; proves RLS forbids cross-reads and that one tenant's kill-switch has no effect on the other.

## Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] TENANT_SCOPED_ROWS: every copy-trade table has a `billing_account_id` (or equivalent) column + RLS policy. No row without a tenant.
- [ ] GRANT_REQUIRED_FOR_PLACEMENT: the executor MUST resolve an active, unrevoked, unexpired `poly_wallet_grants` row before calling `adapter.placeOrder`. Missing grant → skip with reason `no_active_grant`.
- [ ] SCOPES_ENFORCED: `poly:trade:buy` required for BUY intents; SELL (future) requires its own scope. Unscoped grants cannot place orders.
- [ ] PER_TENANT_KILL_SWITCH: `poly_copy_trade_config.enabled` is per-`billing_account_id`. Flipping one tenant's row does NOT affect other tenants.
- [ ] CAPS_ENFORCED_PER_GRANT: `daily_usdc_cap` / `hourly_fills_cap` / `per_order_usdc_cap` evaluated in `decide()` against the grant, not against global env.
- [ ] KEY_NEVER_IN_APP: raw key material stays in Privy HSM. L2 API creds are AEAD-encrypted in `poly_wallet_connections.clob_api_key_ciphertext`.
- [ ] NO*ENV_FALLBACK: once this task lands, the `OPERATOR_WALLET_ADDRESS` / `POLY_CLOB*\*` env vars are removed from the poly executor code path. Bootstrap-operator pre-seeding goes through the same tables.
- [ ] CROSS_TENANT_ISOLATION_TESTED: an integration test with two users proves user-A cannot read / cancel / see user-B's fills, decisions, or config.
- [ ] REVOCATION_HALTS_PLACEMENT: setting `poly_wallet_grants.revoked_at` halts placement from the NEXT poll cycle. In-flight orders complete; no new orders place.

## Open questions (resolve at `/design`)

- **Bootstrap operator**: do we keep a "system" operator that the existing P1 tests / scripts can use, or move everything to a real `billing_account_id`? Leaning toward a `billing_accounts` row with `id='system:poly-bootstrap'` + a helper seed migration.
- **Pre-existing P1 rows**: drop (prototype debris) vs backfill to bootstrap operator. Drop is simpler; backfill preserves the CP5 dress-rehearsal `order_id` evidence if anyone already placed one.
- **BYO wallet (imported EOAs) timeline**: punt to follow-up task, or include a thin import path in CP3? Leaning punt — Privy-only is enough to exercise the whole grant flow.
- **SSR vs client wallet creation**: Privy HSM wallets are server-provisioned; ensure the dashboard CRUD happens through a server action, not client SDK (avoid leaking app-secret key material).
- **Revocation during an active poll tick**: do we cancel placed orders, or just halt future placements? Leaning halt-only — cancellation via a separate explicit "emergency cancel" action.
- **Per-tenant observability**: `decisions_total{outcome, reason, source, billing_account_id}` — is `billing_account_id` as a Prometheus label safe, or do we need to hash / bucket? Follow-up with observability owner.

## Alignment decisions (TBD at `/design`)

- This task does NOT touch the on-chain allowance flow (task.0315 CP3.1) — allowances are per-EOA and set once at wallet provisioning; wallet-scoped, not user-scoped.
- This task does NOT introduce DAO-wide treasury trading (that was the original project charter's end-state). Per-user wallets are the correct step; DAO treasury re-enters as a separate wallet-kind after paper-soak evidence.
- Legal / KYC: the single-operator prototype punted legal responsibility to the operator via the PR alignment checklist. Multi-tenant re-introduces the question; this task's scope is **technical isolation only** — legal review is a blocker on any production rollout, filed separately.

## Validation

- [ ] Two-user integration test passes: user-A provisions wallet + grant → places mirror order; user-B (separate billing account) SELECTs `poly_copy_trade_fills` and sees zero rows; user-B cancelling user-A's `order_id` returns an RLS-scoped "not found".
- [ ] Per-tenant kill-switch: flipping user-A's `poly_copy_trade_config.enabled=false` halts user-A's placements within one poll cycle without affecting user-B.
- [ ] Grant revocation: setting `poly_wallet_grants.revoked_at` halts placement from user-A's next poll cycle; the `poly_copy_trade_decisions` log records skip-reason `no_active_grant`.
- [ ] Cap enforcement: a mirror target configured above `per_order_usdc_cap` is skipped with reason `cap_exceeded_per_order`; day-two spending past `daily_usdc_cap` is skipped with `cap_exceeded_daily`.
- [ ] No env fallback: removing `OPERATOR_WALLET_ADDRESS` + `POLY_CLOB_*` from `.env.local` does not regress any test; the env lookup is gone from the executor code path.
- [ ] `pnpm check` clean; `pnpm check:docs` clean; fresh `db:generate` produces no drift against the new schema.
