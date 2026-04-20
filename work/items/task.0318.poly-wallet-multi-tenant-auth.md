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
  - poly-multi-tenant-auth
assignees: derekg1729
project: proj.poly-copy-trading
pr: https://github.com/Cogni-DAO/node-template/pull/932
created: 2026-04-17
updated: 2026-04-19
labels: [poly, polymarket, wallets, auth, rls, multi-tenant, privy, security]
external_refs:
  - work/items/task.0315.poly-copy-trade-prototype.md
  - packages/db-schema/src/connections.ts
  - packages/db-schema/src/scheduling.ts
pr: https://github.com/Cogni-DAO/node-template/pull/925
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

## Phased approach (added 2026-04-19)

This task ships in two phases. **Phase A** lands the user-owned **tracked-wallet records + RLS** while keeping the existing shared operator wallet for execution. **Phase B** lands per-user signing wallets and isolated execution.

PR #932 (multi-wallet copy-trade v0) shipped a strongly-typed `CopyTradeTargetSource` port specifically so Phase A can swap `envTargetSource` → `dbTargetSource` with no caller churn.

### Phase A — user-owned tracked wallets + RLS (shared execution)

Goal: each user manages their own list of wallets to mirror; RLS prevents cross-tenant reads. Mirror polls still place from the shared operator wallet — fills are pooled.

| Layer          | Change                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB             | New `poly_copy_trade_targets` table (born tenant-scoped). Migrate `poly_copy_trade_fills`, `poly_copy_trade_decisions` to add `billing_account_id`. Per-tenant `poly_copy_trade_config`. |
| RLS            | `USING (billing_account_id = current_setting('app.current_billing_account_id', true))`. Same shape as `connections`.                                                                     |
| Port           | `dbTargetSource(serviceDb)` impl alongside existing `envTargetSource`. Container uses DB impl. Env impl preserved for local-dev only.                                                    |
| Routes         | `POST /api/v1/poly/copy-trade/targets` (create for session user), `DELETE /api/v1/poly/copy-trade/targets/:id`. GET already exists.                                                      |
| Dashboard      | Wire the existing `+` CTA on `TopWalletsCard` (currently disabled stub). Add `−` on user-owned tracked rows.                                                                             |
| Container poll | Iterate **union of all users' enabled targets**, deduped by `target_wallet`. Same operator wallet, pooled fills.                                                                         |
| Env            | Delete `COPY_TRADE_TARGET_WALLETS`.                                                                                                                                                      |

Phase A non-goals: per-user caps, per-user P&L attribution, per-user kill-switch, per-user wallet custody. Document the pooled-execution wart on the dashboard.

Size: ~2–3 days.

### Phase B — user-owned signing wallets (isolated execution)

Goal: each user's mirror fills settle on **their own** wallet. Real isolation, real attribution, real per-user caps. This is where the existing task.0318 schema (`poly_wallet_connections`, `poly_wallet_grants`) lands.

#### Signing-backend comparison

| Option                             | OSS                      | Autonomous      | Connect UX                                                                                                                                                                                                              | Notes                                                                                                                                            |
| ---------------------------------- | ------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **RainbowKit / wagmi alone**       | ✅                       | ❌ popup per tx | Great connect                                                                                                                                                                                                           | **Cannot drive a 30s autonomous poll.** Connect-wallet UI only — every signature requires a browser-wallet popup.                                |
| **Privy per-user**                 | ❌ closed                | ✅              | Email / social login, custodial                                                                                                                                                                                         | Cheapest copy-paste (Privy already in repo for the operator wallet). Locks Cogni to a closed dependency forever. Violates CLAUDE.md OSS mission. |
| **Turnkey**                        | partial (Rust core open) | ✅              | API-driven MPC                                                                                                                                                                                                          | Middle ground. More work than Privy.                                                                                                             |
| **ERC-4337 + Safe + session keys** | ✅ fully                 | ✅ within scope | User connects via RainbowKit → signs **one** meta-tx granting a session key scoped to (CTF approvals + USDC.e approvals + CLOB order signing), bounded by $/day + expiry, revocable anytime. App holds the session key. | Best OSS story. Aligns with CLAUDE.md mission. ~2–3 weeks of engineering + audit.                                                                |
| Raw encrypted PK                   | ✅ but awful             | ✅              | User pastes PK                                                                                                                                                                                                          | Custody liability. **Avoid.**                                                                                                                    |

**RainbowKit ≠ alternative to Privy for autonomous signing.** RainbowKit is a connect-wallet UI on top of wagmi; once connected, every signature still goes through the user's browser wallet. A 30-second autonomous poll cannot survive popups. You need either (a) a custodial signer the app controls (Privy / Turnkey) or (b) delegated signing authority from a Safe via session keys.

#### Recommendation: ship **B.2 (Safe + session keys)**, skip Privy-per-user

The week saved by shipping Privy is paid back the moment the DAO asks to remove the closed-source dependency. The only argument for B.1 (Privy) is a revenue milestone blocked on user wallets in <1 week.

Suggested sequencing:

1. Ship Phase A.
2. Spike B.2 in parallel (1–2 days): prove a Safe session key granted from a RainbowKit connection can place a CLOB order from the operator pod. If clean, commit to B.2. If blocked, reopen the Privy debate.
3. Ship B.2.

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

### Env vars this task deletes (current single-operator scaffolding)

The poly-node mirror currently runs on a cluster of env vars that encode _the single operator wallet_ + _the single target being copied_ + _the single CLOB credential set_. When this task ships, these become per-tenant rows in `poly_wallet_grants` / `poly_copy_trade_targets` and the env vars are removed from the pod entirely.

Listed below for visibility — and because preview/production currently require these to be **manually set on the VM's `poly-node-app-secrets`** (not propagated through CI/CD). The decision to defer propagation: given this task flips the whole shape, investing in compose / ci.yaml / promote-and-deploy / provision-test-vm.sh wiring for env vars about to be deleted would be churn. Candidate-a is the only env where they're CI-wired (via `candidate-flight-infra.yml`). Preview + prod copies are manually seeded from candidate-a's values until this task lands.

| Env var                        | Source            | Role                  | Preview state    | Replaced by                                                                          |
| ------------------------------ | ----------------- | --------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `POLY_PROTO_WALLET_ADDRESS`    | Privy wallet addr | Operator EOA          | manual k8s patch | `poly_wallet_grants.wallet_address` per tenant                                       |
| `POLY_PROTO_PRIVY_APP_ID`      | Privy app         | Operator Privy creds  | manual k8s patch | Shared Privy creds live in a node-level secret; per-tenant just holds the `walletId` |
| `POLY_PROTO_PRIVY_APP_SECRET`  | Privy app         | Operator Privy creds  | manual k8s patch | same                                                                                 |
| `POLY_PROTO_PRIVY_SIGNING_KEY` | Privy app         | Operator Privy creds  | manual k8s patch | same                                                                                 |
| `POLY_CLOB_API_KEY`            | Polymarket CLOB   | Operator API key      | manual k8s patch | Per-tenant `poly_clob_credentials` row (AEAD-encrypted)                              |
| `POLY_CLOB_API_SECRET`         | Polymarket CLOB   | Operator API key      | manual k8s patch | same                                                                                 |
| `POLY_CLOB_PASSPHRASE`         | Polymarket CLOB   | Operator API key      | manual k8s patch | same                                                                                 |
| `POLY_CLOB_HOST`               | Polymarket CLOB   | Operator API endpoint | manual k8s patch | Shared config / env                                                                  |
| `COPY_TRADE_TARGET_WALLET`     | Env               | Single target wallet  | manual k8s patch | `poly_copy_trade_targets` rows per tenant                                            |

**Preview bootstrap recipe** (one-time, until this task ships):

```bash
# From the preview VM, copy candidate-a's values into preview's secret
kubectl -n cogni-preview patch secret poly-node-app-secrets --type=merge -p "$(jq -n \
  --arg addr    "<candidate-a POLY_PROTO_WALLET_ADDRESS>" \
  --arg appId   "<candidate-a POLY_PROTO_PRIVY_APP_ID>" \
  --arg appSec  "<candidate-a POLY_PROTO_PRIVY_APP_SECRET>" \
  --arg signKey "<candidate-a POLY_PROTO_PRIVY_SIGNING_KEY>" \
  --arg clobKey "<candidate-a POLY_CLOB_API_KEY>" \
  --arg clobSec "<candidate-a POLY_CLOB_API_SECRET>" \
  --arg clobPas "<candidate-a POLY_CLOB_PASSPHRASE>" \
  --arg clobHos "<candidate-a POLY_CLOB_HOST>" \
  --arg target  "0x331bf91c132af9d921e1908ca0979363fc47193f" \
  '{stringData: {
    POLY_PROTO_WALLET_ADDRESS: $addr,
    POLY_PROTO_PRIVY_APP_ID: $appId,
    POLY_PROTO_PRIVY_APP_SECRET: $appSec,
    POLY_PROTO_PRIVY_SIGNING_KEY: $signKey,
    POLY_CLOB_API_KEY: $clobKey,
    POLY_CLOB_API_SECRET: $clobSec,
    POLY_CLOB_PASSPHRASE: $clobPas,
    POLY_CLOB_HOST: $clobHos,
    COPY_TRADE_TARGET_WALLET: $target
  }}')"

kubectl -n cogni-preview rollout restart deployment poly-node-app
```

Exit criteria for this task: the bootstrap recipe above **deletes itself** — there are no env-driven poly-operator secrets in the pod, only the AEAD encryption key + DB-held per-tenant credentials.

### Scoped signer — reinstate the narrow port?

In CP3.1.5 we deleted `PolymarketOrderSigner` + `OperatorWalletPort.signPolymarketOrder` as dead surface because CP2 proved `createViemAccount` is enough. That remains correct for a single-operator path. With multi-tenant, the question is whether the **credential broker** (not the signer) belongs on `OperatorWalletPort` — something like `operatorWallet.resolvePolymarketAccount(walletConnectionId): Promise<LocalAccount>`. Decide at `/design` — but default to keeping the `createViemAccount` call inline in the executor if the indirection buys nothing.

## Plan (draft checkpoints — revise at `/design`)

### Phase A — tracked-wallet RLS (shared execution)

- [ ] **A1 — Schema + migration for `poly_copy_trade_targets`**. Born tenant-scoped (`billing_account_id NOT NULL`). RLS policy mirrors `connections`. Seed dev helper for the bootstrap operator.
- [ ] **A2 — Add `billing_account_id` + RLS to `poly_copy_trade_{fills, decisions}`**. Migrate `poly_copy_trade_config` from singleton (`singleton_id=1`) to per-tenant PK. Drop P1 prototype rows.
- [ ] **A3 — `dbTargetSource(serviceDb)` impl** in `nodes/poly/app/src/features/copy-trade/target-source.ts`. Returns wallets keyed by tenant; container `CopyTradeTargetSource` swaps env → DB. `envTargetSource` retained for local-dev only (gated on `APP_ENV=test`).
- [ ] **A4 — CRUD routes + contract**: `POST /api/v1/poly/copy-trade/targets`, `DELETE /api/v1/poly/copy-trade/targets/:id`. Update `polyCopyTradeTargetsOperation` contract. RLS-enforced via `appDb`.
- [ ] **A5 — Dashboard wire-up**: enable the `+` CTA on `TopWalletsCard` (currently `disabled`). Add `−` removal button on user-owned tracked rows. Disclaimer: "Mirror execution is pooled across operators in this node; per-user wallets ship in Phase B."
- [ ] **A6 — Container poll change**: iterate the **union** of all users' enabled targets (deduped by `target_wallet`). Reconciler still single, operator-wide.
- [ ] **A7 — Delete `COPY_TRADE_TARGET_WALLETS` env var** from `server-env.ts`, `.env.local.example`, SKILL.md, candidate-a secret.
- [ ] **A8 — Phase A isolation tests**: two users → two target lists; user-A cannot SELECT user-B's targets via `appDb`. Mirror correctly polls the union.

### Phase B — per-user signing wallets (isolated execution)

- [ ] **B1 — Spike: Safe + ERC-4337 session keys**. Prove a Safe session key granted from a RainbowKit connection can place a CLOB order from the operator pod. Spike timebox: 2 days. If green, B2+ commit to Safe. If blocked, reopen Privy-per-user debate.
- [ ] **B2 — Schema + migration for `poly_wallet_connections` + `poly_wallet_grants`**. Both tenant-scoped with RLS policies. Schema in spec doc.
- [ ] **B3 — Wallet-connection CRUD** (server actions + dashboard): connect Safe via RainbowKit; provision session key; surface address + allowance state; "Connect wallet" button; revocation UI.
- [ ] **B4 — Grant issuance UI + server actions**: user-set caps (daily / hourly / per-order); explicit "authorize trading" step that creates the `poly_wallet_grants` row.
- [ ] **B5 — Executor + poll rewiring**: shared-operator path removed; poll iterates grants; per-tenant kill-switch; per-tenant `decide()` state.
- [ ] **B6 — Add `created_by_user_id` to `poly_copy_trade_fills`** for per-user attribution. Backfill or drop Phase A pooled rows.
- [ ] **B7 — Cross-tenant isolation tests**: two users, two wallets, two target sets; proves RLS forbids cross-reads, fills isolated, kill-switch isolated.

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

- **Safe session-keys vs Privy-per-user (B-phase)**: leaning Safe (OSS-aligned, CLAUDE.md mission). Decide after B1 spike.
- **Phase A pooled-execution UX**: how to message that fills are not user-attributable yet. Disclaimer banner vs feature-flag the "fills" view per-user-only.
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
