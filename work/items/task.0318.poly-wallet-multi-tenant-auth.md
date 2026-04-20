---
id: task.0318
type: task
title: "Poly wallet multi-tenant auth — per-user operator-wallet binding + RLS on copy-trade tables"
status: needs_implement
revision: 3
pr_b: https://github.com/Cogni-DAO/node-template/pull/968
priority: 2
estimate: 8
rank: 5
summary: "Replace the env-directed single-operator wallet model shipped in task.0315 P1 with per-user wallet custody + durable authorization grants. Users connect a Privy-managed (or BYO) wallet to their Cogni account; copy-trade targets and fills are RLS-scoped to the owning user; scheduled executors run under a durable `WalletGrant` (pattern from scheduler's `execution_grants`) rather than a live user session."
outcome: "A Cogni user logs in, provisions or connects an operator wallet, and triggers copy-trade mirroring that places real Polymarket orders through THEIR wallet — no shared env credentials, no single-operator assumption. A second user's targets, fills, and decisions are invisible cross-tenant. Scheduled 30s poll and (P4) Temporal workflows run under a durable `WalletGrant` even when the user is offline."
spec_refs:
  - poly-multi-tenant-auth
  - poly-trader-wallet-port
  - operator-wallet
  - tenant-connections
  - database-rls
  - system-tenant
  - scheduler
assignees: derekg1729
project: proj.poly-copy-trading
pr: https://github.com/Cogni-DAO/node-template/pull/944
created: 2026-04-17
updated: 2026-04-20
branch: feat/task-0318-phase-b
deploy_verified: false
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

#### Recommendation (revised 2026-04-20): ship **Privy-per-user**, defer Safe+4337 to a future OSS-hardening task

The original recommendation (Safe + session keys) rested on an OSS-mission argument that doesn't survive contact with reality:

- **Phase A already shipped Privy.** The shared operator wallet is Privy-custodied; `nodes/poly/app/src/bootstrap/capabilities/poly-trade.ts:660-726` uses `@privy-io/node` + `createViemAccount` → viem LocalAccount → `PolymarketClobAdapter` constructor. Per-user is a credential-lookup change, not an architecture change.
- **Safe+4337 still depends on a closed bundler SaaS** (Pimlico / Alchemy / Biconomy) unless we also self-host a bundler (`silius` / `skandin` — another multi-week project). "Safe + 4337 = OSS" is true for contracts, false for operations. Trading Privy for Pimlico is not an OSS win; it's a different vendor lock.
- The real Safe+4337 win is **custody sovereignty** (user owns the Safe; Pimlico is swappable) — a genuine benefit, but one that earns its cost only when the DAO explicitly asks for it. Bundling it into Phase B inflates scope without isolated benefit over the per-user-custody-goal Phase B is chartered for.

**Ruled out** — the "SIWE + store CLOB creds + skip custody" path: autonomous polling requires an EIP-712 order signature from the funder's key at order time. CLOB L2 creds only authenticate the HTTP POST. Without custody of a signing key OR a delegation (session key / Safe module), no autonomous trading. SIWE proves wallet ownership; it does not delegate signing.

**Phase B plan**: per-user Privy embedded wallets, reusing the existing Privy SDK + `createViemAccount` path. Each tenant gets a Privy wallet on first Polymarket opt-in; the wallet's `walletId` + tenant-encrypted CLOB L2 creds live in `poly_wallet_connections`; `mirror-coordinator` resolves the per-tenant signing context per tick. Zero new vendor deps; zero new on-chain contracts; zero bundler cost.

**Filed separately (not Phase B)**: a future task `Cogni-wide OSS custody hardening` to replace Privy across all signing paths (operator wallet, per-user wallets, any Temporal-worker signers) with a self-hosted Safe+4337+bundler stack. That scope-spans the repo and earns its engineering budget by eliminating one vendor, not by adding an alternate backend to Phase B.

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

## Plan — Phase A checkpoints (implementation-ready)

> Reference: [docs/spec/poly-multi-tenant-auth.md](../../docs/spec/poly-multi-tenant-auth.md). Spec is `spec_state: proposed`.
> Implementation lands on a fresh branch off the PR #932 head. Each checkpoint is a `pnpm check`-clean commit.

- [x] **A1 — DB migration** (`nodes/poly/app/src/adapters/server/db/migrations/0029_poly_copy_trade_multitenant.sql` — slot 0028 already taken by `0028_small_doomsday.sql`)
  - Drop existing rows in `poly_copy_trade_fills`, `poly_copy_trade_decisions`, `poly_copy_trade_config` (prototype debris per `/design` decision).
  - Add `billing_account_id text NOT NULL` (FK → `billing_accounts(id)` ON DELETE CASCADE) + `created_by_user_id text NOT NULL` (FK → `users(id)`) to `poly_copy_trade_fills` and `poly_copy_trade_decisions`. **`created_by_user_id` is the RLS key; `billing_account_id` is the data column.** Mirrors `connections` exactly (migration `0025_add_connections.sql`).
  - Recreate `poly_copy_trade_config` with PK `(billing_account_id)`, `enabled boolean NOT NULL DEFAULT false`, `created_by_user_id text NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`. Drop `singleton_id`.
  - Create `poly_copy_trade_targets` table per spec § Schema (both `billing_account_id` and `created_by_user_id` NOT NULL).
  - `ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY;` on all four tables. Policy `tenant_isolation` USING + WITH CHECK clause: `created_by_user_id = current_setting('app.current_user_id', true)` — copy-paste-equivalent to the `connections` policy.
  - Seed bootstrap rows owned by `COGNI_SYSTEM_PRINCIPAL_USER_ID` + `COGNI_SYSTEM_BILLING_ACCOUNT_ID`: one `poly_copy_trade_config` row with `enabled = true`, plus one optional `poly_copy_trade_targets` row preserving the existing single-operator candidate-a flight.
  - `pnpm db:generate` — confirm zero drift against the new schema.

- [x] **A2 — Drizzle schema update** (`packages/poly-db-schema/` — or wherever `poly_copy_trade_*` lives today)
  - Add new columns + the `poly_copy_trade_targets` table to the Drizzle schema. Re-export from `@cogni/poly-db-schema` (or the local poly path).
  - `pnpm packages:build`.

- [x] **A3 — `dbTargetSource` impl** (`nodes/poly/app/src/features/copy-trade/target-source.ts`)
  - Add `dbTargetSource({ serviceDb })`. Implements:
    - `listAllActive(): Promise<readonly { billingAccountId: string; createdByUserId: string; targetWallet: WalletAddress }[]>` — single SELECT joining `poly_copy_trade_targets` × `poly_copy_trade_config` where `config.enabled = true AND target.disabled_at IS NULL`. Runs on `serviceDb` (BYPASSRLS). The **only** cross-tenant read.
    - `listForActor(userId: ActorId): Promise<readonly WalletAddress[]>` — used by the GET route. Wraps SELECT in `withTenantScope(appDb, userId, ...)`.
  - Extend the `CopyTradeTargetSource` interface so both methods are part of the port. `envTargetSource` implements `listAllActive` returning `[{ billingAccountId: COGNI_SYSTEM_BILLING_ACCOUNT_ID, createdByUserId: COGNI_SYSTEM_PRINCIPAL_USER_ID, targetWallet }, …]` (preserved for local-dev only, gated on `APP_ENV=test`).
  - Container default: `dbTargetSource` outside test mode.

- [x] **A4 — CRUD routes + contract** (`packages/node-contracts/src/poly.copy-trade.targets.v1.contract.ts` + new route files)
  - Add `polyCopyTradeTargetCreateOperation` (POST input: `{ target_wallet }`; output: target row) and `polyCopyTradeTargetDeleteOperation` (DELETE param: `id`; output: `{ deleted: boolean }`). GET keeps existing shape but switches `source: "env" | "db"` semantics to be sourced from the port.
  - New routes: `POST /api/v1/poly/copy-trade/targets/route.ts`, `DELETE /api/v1/poly/copy-trade/targets/[id]/route.ts`. `auth: { mode: "required", getSessionUser }`. Both use `withTenantScope(appDb, sessionUser.id, ...)` — RLS enforces tenant boundary.
  - **Defense-in-depth**: after every RLS-scoped SELECT, verify `row.billing_account_id === sessionUser.billingAccountId` before returning to the caller. Mirrors `DrizzleConnectionBrokerAdapter.resolve()` (`adapters/server/connections/drizzle-broker.adapter.ts`). On mismatch, log a security warning + reject with a typed error.
  - GET route: switch from system-scope to `dbTargetSource.listForActor(sessionUser.id)` so each user sees only their own targets.

- [x] **A5 — Dashboard CRUD wire-up** (`nodes/poly/app/src/app/(app)/dashboard/_components/TopWalletsCard.tsx` + new fetch helpers)
  - Replace the disabled `+` button with a real handler: `POST /api/v1/poly/copy-trade/targets { target_wallet }` → invalidate the targets query. Add a `−` button on tracked rows: `DELETE /api/v1/poly/copy-trade/targets/{id}` → invalidate.
  - Add the pooled-execution disclaimer above the table: "Mirror execution is shared across all operators in this node. Per-wallet isolation ships in Phase B."

- [x] **A6 — Container poll cross-tenant enumerator** (`nodes/poly/app/src/bootstrap/container.ts` + `copy-trade-mirror.job.ts`)
  - Replace the per-wallet loop with two passes:
    1. Service-role SELECT via `copyTradeTargetSource.listAllActive()` → `EnumeratedTarget[]`.
    2. **Dedup by `target_wallet`** (one wallet → one Polymarket Data-API source instance). Group attribution: each enumerated target carries `(billing_account_id, created_by_user_id)` so fills + decisions inherit tenant on insert.
  - `mirror-coordinator.runOnce` opens `withTenantScope(appDb, target.created_by_user_id, ...)` for the fills/decisions insert path. The placement itself still uses the shared operator wallet (Phase A non-goal).
  - Reconciler stays single, operator-wide (BYPASSRLS via `serviceDb`).

- [x] **A7 — Delete `COPY_TRADE_TARGET_WALLETS` env var (and its CI plumbing)**
  - Remove from `nodes/poly/app/src/shared/env/server-env.ts`, `.env.local.example`, `.claude/skills/poly-dev-expert/SKILL.md`. Update `MOCK_SERVER_ENV` test fixture.
  - **CI plumbing added by PR #932 commit `3e61f45f1`** (must be removed in the same A7 commit so nothing orphans):
    - `.github/workflows/candidate-flight-infra.yml` — drop the `COPY_TRADE_TARGET_WALLETS: ${{ secrets.COPY_TRADE_TARGET_WALLETS }}` env line
    - `scripts/ci/deploy-infra.sh` — drop the `COPY_TRADE_TARGET_WALLETS=${COPY_TRADE_TARGET_WALLETS:-}` declaration and the forwarded env var on the SSH command
    - GH secret `COPY_TRADE_TARGET_WALLETS` at candidate-a env scope — delete via `gh secret delete COPY_TRADE_TARGET_WALLETS --env candidate-a`
    - Candidate-a k8s secret `poly-node-app-secrets` — drop the key from the next `deploy-infra` rollout (handled automatically once the workflow stops writing it)
  - `envTargetSource` is no longer wired by default; it's reachable only by direct construction in tests.

- [x] **A8 — Phase A integration + isolation tests** (scope-pinned per spec § Phase A scope clarification)
  - **In-scope assertions (row-level isolation only)**: A user cannot SELECT, INSERT, UPDATE, or DELETE another tenant's `poly_copy_trade_targets / fills / decisions / config` rows via `appDb`. The mirror-poll cross-tenant enumerator correctly attributes fills/decisions to the originating tenant.
  - **Out-of-scope assertions (cannot be tested in Phase A)**: per-user USDC balance, per-user CTF positions, per-user spend caps, per-user P&L. The operator wallet is shared. Tests MUST NOT assert these — they require Phase B.
  - **Component test** (`tests/component/copy-trade/db-target-source.test.ts`, testcontainers): seed two users + two billing accounts + targets in each. Assert `listForActor(userA)` returns user-A's targets only; `listAllActive()` returns the union with correct tenant attribution.
  - **Component test** (`tests/component/copy-trade/targets-route.test.ts`): user-A POSTs a target; user-B GETs and sees zero rows; user-B DELETE on user-A's `id` returns 404 (RLS scopes the row to invisible). User-A POSTs a target with a tampered `billing_account_id` belonging to user-B → defense-in-depth check rejects with a typed error.
  - **Stack test** (`tests/stack/copy-trade/multi-tenant-mirror.stack.test.ts`): seed two tenants with disjoint targets, run one mirror tick, assert (a) both tenants' decisions tables get rows attributed correctly, (b) cross-tenant SELECT via `appDb` returns only own rows, (c) the shared operator wallet placed orders for both via the existing placeIntent path. Do NOT assert per-user balance changes.
  - **psql smoke** (commit a `scripts/experiments/poly-rls-smoke.sh`): `SET LOCAL app.current_user_id = '<userA>'; INSERT INTO poly_copy_trade_targets (..., created_by_user_id) VALUES (..., '<userB>');` is rejected by `WITH CHECK`.

### Phase A invariants (block PR merge)

- TENANT_SCOPED_ROWS, GRANT_REQUIRED_FOR_PLACEMENT (vacuous in A — no per-user grants yet), PER_TENANT_KILL_SWITCH, KEY_NEVER_IN_APP, TARGET_SOURCE_TENANT_SCOPED, CROSS_TENANT_ISOLATION_TESTED, FAIL_CLOSED_ON_DB_ERROR per [poly-multi-tenant-auth](../../docs/spec/poly-multi-tenant-auth.md).
- Bootstrap-tenant rows created in A1 are valid system-tenant rows; they survive the migration and pass RLS when the executor runs under `withTenantScope(appDb, COGNI_SYSTEM_PRINCIPAL_USER_ID, ...)`.

## Plan — Phase B (Privy-per-user; decomposed into B1-B7 shippable slices)

**Design shift (2026-04-20)**: the earlier Safe + ERC-4337 B1 spike is withdrawn — see the revised recommendation above. Phase B ships per-user Privy wallets leveraging the existing operator-wallet code path. The only real unknown is the per-tenant credential-broker wiring, which a **B1 end-to-end script spike** pins in ~1 day, not 2.

### B1 — End-to-end Privy-per-user script spike (~1 day)

**Goal**: prove, on Polygon mainnet, that a freshly-created Privy embedded wallet (not the shared operator wallet) can (a) be provisioned via `privyClient.walletApi.createWallet()`, (b) sign a Polymarket CLOB L2 api-key exchange, (c) have USDC + CTF allowances granted idempotently, (d) place a $1 BUY + SELL via the existing `PolymarketClobAdapter` with zero changes to the adapter.

**Why this is 1 day, not 2**: every moving part is already proven in the operator-wallet code path (`bootstrap/capabilities/poly-trade.ts:660-726`). The spike swaps the env-sourced wallet for a `walletApi.createWallet()` result and calls the same helpers. No new contracts, no bundler, no module wiring, no RainbowKit UX.

**Spike layout (`scripts/experiments/poly-privy-per-user-spike/`)**:

```
poly-privy-per-user-spike/
├── README.md             ← goal, run instructions, evidence template
├── src/
│   ├── 1-create-wallet.ts   ← privyClient.walletApi.createWallet({ chainType: 'ethereum' }) → print { walletId, address }
│   ├── 2-fund.md            ← manual step: deposit ~$5 USDC.e + ~0.2 MATIC to the printed address
│   ├── 3-approvals.ts       ← reuses scripts/experiments/approve-polymarket-allowances.ts patterns via createViemAccount
│   ├── 4-clob-creds.ts      ← POST /auth/api-key (clob-client) signed by the new wallet → print ApiKeyCreds
│   ├── 5-place-buy.ts       ← construct PolymarketClobAdapter({ signer, creds, funderAddress }) → placeOrder BUY $1
│   └── 6-place-sell.ts      ← placeOrder SELL of the outcome token bought in step 5
└── evidence/
    ├── wallet-provision.md  ← walletId + address + tx hash of first funding
    ├── approvals-tx.json    ← USDC + CTF approve receipts
    ├── clob-creds.md        ← api-key generation response (redacted in repo; kept in operator-only notes)
    ├── buy-sell-receipts.json ← CLOB order receipts for BUY + SELL
    └── verdict.md           ← pass/fail + notes for B2
```

**Pass criteria** (all must hold):

| # | Criterion                                                                                       | Evidence                              |
|---|-------------------------------------------------------------------------------------------------|---------------------------------------|
| 1 | `createWallet` returns a distinct `walletId` from the operator wallet's                         | `wallet-provision.md`                 |
| 2 | `createViemAccount` + `createWalletClient` produce a working viem `LocalAccount` for that wallet| step 3 runs without signing errors    |
| 3 | Allowances (USDC to Exchange/NegRisk/NegRiskAdapter + CTF `setApprovalForAll`) land idempotently | `approvals-tx.json`                   |
| 4 | CLOB L2 creds generated via the new wallet's signature (not the operator's)                     | `clob-creds.md` signer matches step 1 |
| 5 | BUY + SELL orders placed and acknowledged by CLOB against the new funder address                | `buy-sell-receipts.json`              |

**Secrets needed**: `PRIVY_APP_ID` + `PRIVY_APP_SECRET` (reuse existing), ~$5 USDC.e + ~0.2 MATIC deposit (user-funded, one-time). No new vendor accounts. No new env surface in the app.

**If B1 passes**: commit to Privy-per-user, proceed to B2 immediately.
**If B1 fails**: the failure mode is almost certainly mechanical (Privy API surface, CLOB signature type) rather than strategic — fix in place; no direction change.

### B2-B7 — production decomposition

| Checkpoint                                                                          | Size   | Ships                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B2** — `@cogni/poly-wallet` package: port + Privy adapter + schema + reconciler   | ~3d    | Per [poly-trader-wallet-port](../../docs/spec/poly-trader-wallet-port.md). New package `packages/poly-wallet/` containing: (a) `src/port/poly-trader-wallet.port.ts` — `PolyTraderWalletPort` interface + `PolyTraderSigningContext` + branded `AuthorizedSigningContext` + `AuthorizationFailure` union + `OrderIntentSummary` type, (b) `src/adapters/privy/privy-poly-trader-wallet.adapter.ts` — Phase B impl covering `resolve` / `getAddress` / `provision` (advisory-locked) / `revoke` / `authorizeIntent` / `withdrawUsdc` / `rotateClobCreds`. Migration 0030 creates `poly_wallet_connections` table (includes `custodial_consent_accepted_at`). Drizzle schema + AEAD envelope reuses `packages/connections/` helpers. **New env scope**: `PRIVY_USER_WALLETS_APP_ID` / `_APP_SECRET` / `_SIGNING_KEY` — distinct Privy app from the system / operator-wallet triple (explicit invariants `SEPARATE_PRIVY_APP`, enforced by dep-cruiser rule + scoped Zod env schema). **Orphan reconciler**: `scripts/ops/sweep-orphan-poly-wallets.ts` ships in this checkpoint with dry-run default + `--apply` flag. **Runbook**: `docs/guides/poly-wallet-provisioning.md` covers user-wallets-app Privy creation + secret wiring. **Type-level enforcement**: compile-test fixture proves `PolymarketClobAdapter.placeOrder` rejects raw `PolyTraderSigningContext`. Component tests: concurrent `provision` (advisory lock), distinct funders across tenants, defense-in-depth, every `AuthorizationFailure` variant, AEAD round-trip, withdraw path, Privy-unreachable fail-closed. |
| **B3** — Wallet onboarding: user + agent paths + custodial consent + withdraw UX    | ~2.5d  | **User flow (dashboard)**: 7-step flow per [spec § Onboarding](../../docs/spec/poly-trader-wallet-port.md#user-onboarding-dashboard-b3) — Start setup → custodial-consent screen (required, persisted) → server-side `provision` → fund prompt with QR + live balance poll → one-click allowance setup → default grant issuance → done state with Withdraw + Disconnect actions. **Agent flow (API)**: `POST /api/v1/poly/wallet/connect` + `GET /api/v1/poly/wallet/status` + `POST /api/v1/poly/wallet/allowances` + `POST /api/v1/poly/wallet/withdraw`. Agent API key must carry `poly:wallet:provision` scope; custodial consent must have been acknowledged by the minting user. `CUSTODIAL_CONSENT` invariant: `provision` rejects with 409 if `custodial_consent_accepted_at` is NULL. `WITHDRAW_BEFORE_REVOKE`: Disconnect shows current balance + requires explicit "proceed with non-zero balance" confirmation. Contract: `packages/node-contracts/src/poly.wallet.connections.v1.contract.ts`. Guide: `docs/guides/poly-wallet-onboarding.md`. |
| **B4** — `poly_wallet_grants` schema + issuance API                                 | ~1.5d  | Migration 0031 creates `poly_wallet_grants` (caps + scopes + expiry + revoked_at). `POST /api/v1/poly/wallet/grants` issues; `DELETE /:id` revokes. Default grant auto-created by B3 with operator-safe caps (per-order $2, daily $10, hourly-fills 20); user can tighten via dashboard.                                                                                    |
| **B5** — Executor + coordinator rewiring                                            | ~2d    | `mirror-coordinator` per-tenant loop: for each tenant → `polyTraderWallet.resolve(billingAccountId)` → if `null`, skip (fail-closed per `FAIL_CLOSED_ON_RESOLVE`) → build per-tenant `PolymarketClobAdapter({ signer: context.account, creds: context.clobCreds, funderAddress: context.funderAddress })` → run the existing placeIntent path. Drop the shared `POLY_PROTO_WALLET_ADDRESS` + `POLY_CLOB_*` reads from `server-env.ts` (these remain only for system-tenant bootstrap until B6). Per-tenant adapter instances are LRU-cached keyed on `connectionId` to avoid rebuilding per tick. |
| **B6** — Per-grant cap + scope enforcement + revocation checks                      | ~1.5d  | `mirror-coordinator` reads grant before each placement attempt: expired / revoked / missing-scope / cap-exceeded paths all log `poly.mirror.decision reason=…` and skip. Per-grant running-total cache (daily/hourly) read from `poly_copy_trade_fills` via a windowed SELECT on the per-tenant scope. System-tenant bootstrap grant removed; candidate-a runs as a normal tenant from here on.                                                             |
| **B7** — Cross-tenant wallet + grant + fill isolation tests                         | ~1.5d  | Component tests: two tenants each with their own connection + grant + targets; assert placements land on distinct funder addresses; revocation on tenant-A halts only tenant-A's next tick; cap-breach skips only the breaching tenant. Stack test: full dev-stack two-tenant poll with fake CLOB adapter proving the per-tenant adapter wiring (no mainnet). Mainnet-verification by a single candidate-a flight + deploy_verified handshake on Loki. |

**Phase B total**: ~11 days engineering + 1 day flight + verification. vs. Safe+4337's ~3 weeks of which ~0 days are mechanically de-risked before committing.

**Deferred to follow-up (explicitly NOT in Phase B)**:

- `poly_wallet_connections.backend` CHECK constraint (`privy|safe_4337|turnkey`) — Phase B is single-backend (Privy). The column lands when a second adapter lands.
- Safe + 4337 + self-hosted bundler (`SafePolyTraderWalletAdapter`) — filed as a separate OSS-hardening task that spans the repo. The port is designed to accept it without caller churn.
- Hardware / BYO-imported EOA support — user asked for Privy-reuse.
- Renaming `OperatorWalletPort` → `WalletPort`: rejected at /design per [poly-trader-wallet-port § Why a new port](../../docs/spec/poly-trader-wallet-port.md#why-a-new-port). Operator wallet is a system-role intent-only actuator; merging it with the per-tenant signing port would weaken the security model.

## Invariants

<!-- CODE REVIEW CRITERIA -->

- [x] TENANT_SCOPED_ROWS **(Phase A — migration 0029 + Drizzle schema)**: every copy-trade table has `billing_account_id` + `created_by_user_id` NOT NULL + RLS `tenant_isolation` policy.
- [ ] GRANT_REQUIRED_FOR_PLACEMENT **(Phase B)**: executor resolves an active `poly_wallet_grants` row before `adapter.placeOrder`.
- [ ] SCOPES_ENFORCED **(Phase B)**: `poly:trade:buy` required for BUY intents; SELL requires its own scope.
- [x] PER_TENANT_KILL_SWITCH **(Phase A — config PK migrated to `billing_account_id`)**: per-tenant config row gates placement; component test asserts disabling tenant-A's row leaves tenant-B's enumerator output intact.
- [ ] CAPS_ENFORCED_PER_GRANT **(Phase B)**: caps from `poly_wallet_grants`, not env / scaffolding.
- [x] KEY_NEVER_IN_APP **(Phase A — inherited; no raw keys touched)**: shared operator wallet still uses Privy HSM (no change). Phase B extends this to per-user signing backends.
- [x] NO*ENV_FALLBACK **(Phase A — CP A7)**: `COPY_TRADE_TARGET_WALLETS` removed from server-env, `.env.local.example`, SKILL.md, workflow, deploy-infra.sh. Bootstrap seed lives in migration 0029. `POLY_CLOB*\*`env vars are still read (they're the operator wallet's L2 creds; Phase B moves them into per-user`connections`rows with provider`polymarket_clob`).
- [x] CROSS_TENANT_ISOLATION_TESTED **(Phase A — row-level only)**: `tests/component/copy-trade/db-target-source.int.test.ts` asserts two-tenant RLS clamp + per-tenant kill-switch + soft-delete; `tests/component/copy-trade/targets-route.int.test.ts` asserts POST→GET→DELETE round-trip. Phase B adds wallet/fill isolation.
- [ ] REVOCATION_HALTS_PLACEMENT **(Phase B)**: requires `poly_wallet_grants`.

## Decisions (resolved 2026-04-19 at `/design`)

See [docs/spec/poly-multi-tenant-auth.md § Decisions](../../docs/spec/poly-multi-tenant-auth.md#decisions-resolved-2026-04-19-at-design) for the canonical record. Summary:

- **Bootstrap operator**: reuse `COGNI_SYSTEM_PRINCIPAL_USER_ID` + `COGNI_SYSTEM_BILLING_ACCOUNT_ID` from [system-tenant](../../docs/spec/system-tenant.md). The A1 migration seeds the system tenant's `poly_copy_trade_config` + (optionally) one `poly_copy_trade_targets` row. Existing dev / candidate-a flights run as the system tenant.
- **Pre-existing prototype rows**: drop in the migration. No production users to preserve.
- **Per-tenant Prometheus labels**: do not add `billing_account_id` as a label (cardinality bomb). Pino JSON → Loki for per-tenant slicing.
- **Revocation**: halt-future-only. Cancellation is a separate emergency-cancel action, out of scope.
- **Safe vs Privy (Phase B)**: **superseded 2026-04-20** — committing to Privy-per-user. Reasons in the recommendation block above; Safe+4337 moved to a separate repo-wide OSS-hardening task.
- **BYO imported EOAs**: punt to a follow-up task. Phase B's recognized backends are Safe / Privy / Turnkey only.
- **SSR vs client wallet creation**: server actions only. The Privy app secret never touches the browser; same rule applies to Safe session-key signing material.
- **Phase A pooled-execution UX**: disclaimer banner above the targets table.

## Alignment decisions

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

## Review Feedback (revision 1 — 2026-04-19)

`/review-implementation` against PR #944 found two blocking bugs and a handful of smaller items. Status returned to `needs_implement`. Both blockers are small fixes; round-trip test would pin Bug #2.

### Blocking

1. **Migration 0029 will fail under FORCE RLS on apply.** The bootstrap seed INSERT at `migrations/0029_poly_copy_trade_multitenant.sql:165-172` runs after `ALTER TABLE … FORCE ROW LEVEL SECURITY` (L85). With no `app.current_user_id` set, the `WITH CHECK` policy rejects the INSERT in any environment whose migrator role is not `BYPASSRLS`.
   - **Fix:** add `SELECT set_config('app.current_user_id', '00000000-0000-4000-a000-000000000001', true);--> statement-breakpoint` immediately before the INSERT. Mirror `0008_seed_system_tenant.sql:6`.

2. **Dashboard DELETE button is broken end-to-end.** `targets/route.ts:52-75` (`buildTargetView`) declares `params.id?: string` but never reads it; the response's `target_id` is always `targetIdFromWallet(target_wallet)` (UUIDv5). The DELETE route at `targets/[id]/route.ts:64` queries `polyCopyTradeTargets.id` (DB row PK = random uuid v4). Dashboard sends the UUIDv5 → server queries by PK → **404 every time**.
   - **Fix in three places:**
     - `target-source.ts:127-138` — `listForActor` returns `{ id, target_wallet }[]` (or a sibling `listRowsForActor` if the bare-string return must stay).
     - `targets/route.ts:52-75` — `target_id: params.id ?? config.target_id`; GET populates `params.id` from `listForActor` rows; POST passes `inserted.id`.
     - `node-contracts/src/poly.copy-trade.targets.v1.contract.ts:22` — update docstring to clarify `target_id` is the DB row uuid (Phase A); UUIDv5 stays internal to the fills ledger for `client_order_id` correlation.
   - **Add a component test** at `tests/component/copy-trade/targets-route.int.test.ts` (or extend `db-target-source.int.test.ts`) exercising `POST → GET → DELETE` round-trip. Would have caught this.

### Non-blocking suggestions

- **Use memoized `container.orderLedger`** in `targets/route.ts:105, 236` instead of `createOrderLedger(...)` per request.
- **Narrow `TENANT_DEFENSE_IN_DEPTH`** invariant scope in `targets/route.ts:13-17` — it's verified on POST writes only; GET returns bare wallet strings, nothing row-shaped to verify.
- **Document migration 0029's CASCADE drop** in the PR body. `DROP TABLE … CASCADE` on `poly_copy_trade_{fills,decisions,config}` wipes Phase-0 candidate-a trading history irreversibly. The `/design` decision approved this, but the operator should explicitly know.
- **Duplicate polls on shared wallets** (container loop) — flagged in PR body, covered by task.0332. No fix needed in this PR.

## Review Feedback (revision 3 — 2026-04-20, Phase B slice on PR #968)

`/review-implementation` on commits `6224cec8c..32a58aa19` found blocking gaps. Status back to `needs_implement`. Summary:

### Blocking

1. **Stub CLOB creds ship silently.** `nodes/poly/app/src/adapters/server/wallet/index.ts:83-91` returns literal `"placeholder-*"` strings on every provision. Once this lands on candidate-a, any caller that then tries to actually trade will hit CLOB auth errors that look like production bugs.
   - **Fix**: gate the stub behind an explicit `POLY_WALLET_ALLOW_STUB_CREDS=1` env flag. Without it, the factory throws `ClobCredsFactoryNotWiredError`. Add a `logger.warn` inside the stub naming `billing_account_id` + "NOT tradeable, plumbing test only".

2. **Agent-consent path is unguarded.** `nodes/poly/app/src/app/api/v1/poly/wallet/connect/route.ts:89-97` allows `custodialConsentActorKind: "agent"` through session auth without validating the actor id against any agent-API-key binding. The "agent auth comes later" deferral left a bypass.
   - **Fix**: reject `actorKind: "agent"` with **501 Not Implemented** until B3 wires agent API keys. Don't ship a half-guarded enum branch.

3. **Spec claim about dep-cruiser doesn't match reality.** `docs/spec/poly-trader-wallet-port.md` § Invariants `SEPARATE_PRIVY_APP` claims "dep-cruiser rule forbids imports of `PRIVY_APP_ID`..." — dep-cruiser enforces import-graph, not source-string identifiers. No such rule could be written; none was written.
   - **Fix**: rewrite the invariant to reflect the ACTUAL enforcement: the adapter is constructor-injected with `PrivyClient`, so package source has no reachable path to env vars. Acceptance check #3 updates accordingly.

4. **`@cogni/node-shared` import unverified.** `privy-poly-trader-wallet.adapter.ts:40` imports `{ aeadEncrypt, aeadDecrypt, AeadAAD }` from the package root — not verified that the barrel re-exports these. Either verify or use `@cogni/node-shared/crypto/aead` submodule.

5. **`pnpm check` was not run on this branch.** The worktree has no installed deps from this session and I did not bootstrap + verify. Typecheck correctness is unproven.
   - **Fix**: bootstrap the phase-b worktree, run `pnpm check`, fix any errors, post the green result on the PR.

6. **Zero tests shipped.** Spec acceptance checks #4–#11 are unimplemented — no component test, no unit test, no type-level compile test, no orphan-reconciler script. The adapter ships to candidate-a completely untested.
   - **Fix**: at minimum one component test (testcontainers PG) proving `provision → resolve → getAddress → revoke → resolve=null` end-to-end under two tenants with RLS defense-in-depth.

### Non-blocking suggestions

- Use `crypto.randomUUID()` instead of `tx.execute(\`SELECT gen_random_uuid()::text\`)` roundtrip in adapter provision.
- Delete `brandAuthorized` dead method or document it clearly as the seed for B4's `authorizeIntent`.
- Move route Zod schemas into `packages/node-contracts/src/poly.wallet.connections.v1.contract.ts` — deviation from every other poly route.
- Add `poly.wallet.connect` info log on success in route; current implementation only logs failure paths. Validation plan on PR body says Loki query must find this event.
- Add hex-format regex validation on `POLY_WALLET_AEAD_KEY_HEX` before `Buffer.from(..., "hex")` — current length-check catches short output but not e.g. 64 chars of `"z"`.
- Decide system-tenant bootstrap: migration 0030 has no seed; § Onboarding claims "same provision code path" but container boot may rely on a system-tenant wallet row existing.
- Add index on `created_at` to support the B2 orphan reconciler's "older than 24h" query.
- Migration 0030 could default `custodial_consent_accepted_at` to `now()` as belt-and-suspenders; app-side is authoritative.
- Consider extracting `deploy-infra.sh` remote-SSH env block from the megaline into a heredoc — typo risk is high today.
