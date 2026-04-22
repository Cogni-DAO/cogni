---
id: task.0318
type: task
title: "Poly wallet multi-tenant auth — per-user operator-wallet binding + RLS on copy-trade tables"
status: needs_implement
revision: 6
pr_b: https://github.com/Cogni-DAO/node-template/pull/968
priority: 2
estimate: 5
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
updated: 2026-04-22
branch: feat/task-0318-phase-b
deploy_verified: true
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
  - Remove from `nodes/poly/app/src/shared/env/server-env.ts`, `.env.local.example`, and any remaining skill references (`.claude/skills/poly-copy-trading/SKILL.md` covers the `envTargetSource` local-dev-only caveat). Update `MOCK_SERVER_ENV` test fixture.
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

| #   | Criterion                                                                                        | Evidence                              |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 1   | `createWallet` returns a distinct `walletId` from the operator wallet's                          | `wallet-provision.md`                 |
| 2   | `createViemAccount` + `createWalletClient` produce a working viem `LocalAccount` for that wallet | step 3 runs without signing errors    |
| 3   | Allowances (USDC to Exchange/NegRisk/NegRiskAdapter + CTF `setApprovalForAll`) land idempotently | `approvals-tx.json`                   |
| 4   | CLOB L2 creds generated via the new wallet's signature (not the operator's)                      | `clob-creds.md` signer matches step 1 |
| 5   | BUY + SELL orders placed and acknowledged by CLOB against the new funder address                 | `buy-sell-receipts.json`              |

**Secrets needed**: `PRIVY_APP_ID` + `PRIVY_APP_SECRET` (reuse existing), ~$5 USDC.e + ~0.2 MATIC deposit (user-funded, one-time). No new vendor accounts. No new env surface in the app.

**If B1 passes**: commit to Privy-per-user, proceed to B2 immediately.
**If B1 fails**: the failure mode is almost certainly mechanical (Privy API surface, CLOB signature type) rather than strategic — fix in place; no direction change.

### B2-B7 — production decomposition + progress

Shipped on PR [#968](https://github.com/Cogni-DAO/node-template/pull/968):

- [x] B2.1 — `@cogni/poly-wallet` port + types + branded `AuthorizedSigningContext`
- [x] B2.2 — Migration `0030_poly_wallet_connections.sql` + Drizzle schema (`poly_wallet_connections` table with RLS + partial unique on `billing_account_id` + chain/address unique)
- [x] B2.3 — `PrivyPolyTraderWalletAdapter` `provision` (advisory-locked) + `resolve` + `getAddress` + `revoke`
- [x] B2.4 — Bootstrap factory (`nodes/poly/app/src/bootstrap/poly-trader-wallet.ts`) with `SEPARATE_PRIVY_APP` env scope and injected CLOB-creds seam kept outside the adapter package
- [x] B2.5 — `POST /api/v1/poly/wallet/connect` route (session-auth, 503 on unconfigured, 501 on `actorKind=agent` placeholder, info log on success)
- [x] B2.6 — CI secret plumbing: `PRIVY_USER_WALLETS_*` + `POLY_WALLET_AEAD_KEY_*` through `candidate-flight-infra.yml` + `deploy-infra.sh`
- [x] B2.7 — `.env.local.example` updated; `tsconfig.json` references the new package
- [x] B2.8 — Runbook: [`docs/guides/poly-wallet-provisioning.md`](../../docs/guides/poly-wallet-provisioning.md) covers user-wallets-app Privy creation, 5 GH secrets, `/profile` UI + API exercise path, Loki handshake
- [x] B2.9 — `pnpm check:fast` green on the branch (2026-04-21)

Open within B2 (blocking before merge):

- [x] B2.10 — Component test: testcontainers PG, two-tenant round-trip `provision → resolve → getAddress → revoke → resolve=null` with RLS + tenant defense-in-depth + AEAD binding. Landed in `nodes/poly/app/tests/component/wallet/privy-poly-trader-wallet.adapter.int.test.ts`, and fixed the missing `0030_poly_wallet_connections` journal entry so fresh DBs actually apply the wallet table migration.
- [x] B2.12 — Real CLOB L2 creds factory wired at the bootstrap boundary: `@cogni/poly-wallet` adapter package stays free of `@polymarket/clob-client`; bootstrap uses `createOrDerivePolymarketApiKeyForSigner()` at the existing `poly-trade.ts` dynamic-import boundary, wraps the Privy `LocalAccount` in `createWalletClient({ account, chain: polygon, transport: http() })`, calls `createOrDeriveApiKey()`, and persists the returned creds through the existing AEAD envelope during `provision`.

Deferred out of this PR / v0 path:

- [ ] B2.11 — Orphan reconciler `scripts/ops/sweep-orphan-poly-wallets.ts` moved to [task.0348](task.0348.poly-wallet-orphan-sweep.md). Useful ops hygiene, but not required to prove per-tenant wallet provisioning or real CLOB trading in v0.

Following slices:

| Checkpoint                                                                       | Size  | Ships                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **B2** — `@cogni/poly-wallet` package: port + Privy adapter + schema             | ~3d   | Per [poly-trader-wallet-port](../../docs/spec/poly-trader-wallet-port.md). New package `packages/poly-wallet/` containing: (a) `src/port/poly-trader-wallet.port.ts` — `PolyTraderWalletPort` interface + `PolyTraderSigningContext` + branded `AuthorizedSigningContext` + `AuthorizationFailure` union + `OrderIntentSummary` type, (b) node-local `PrivyPolyTraderWalletAdapter` — Phase B impl covering `resolve` / `getAddress` / `provision` (advisory-locked) / `revoke` / `authorizeIntent` / `withdrawUsdc` / `rotateClobCreds`. Migration 0030 creates `poly_wallet_connections` table (includes `custodial_consent_accepted_at`). Drizzle schema + AEAD envelope reuses `packages/connections/` helpers. **New env scope**: `PRIVY_USER_WALLETS_APP_ID` / `_APP_SECRET` / `_SIGNING_KEY` — distinct Privy app from the system / operator-wallet triple. **Real CLOB creds stay bootstrap-owned**: the injected `clobCredsFactory` is the seam, and B2.12 wires it with the existing `createViemAccount` → `createWalletClient` → `createOrDeriveApiKey` pattern already proven in `poly-trade.ts` / `derive-polymarket-api-keys.ts`. **Runbook**: `docs/guides/poly-wallet-provisioning.md` covers user-wallets-app Privy creation + secret wiring. **Type-level enforcement**: compile-test fixture proves `PolymarketClobAdapter.placeOrder` rejects raw `PolyTraderSigningContext`. Component tests: concurrent `provision` (advisory lock), distinct funders across tenants, defense-in-depth, every `AuthorizationFailure` variant, AEAD round-trip, withdraw path, Privy-unreachable fail-closed. |
| **B3** — Wallet onboarding: user + agent paths + custodial consent + withdraw UX | ~2.5d | **User flow (dashboard)**: 7-step flow per [spec § Onboarding](../../docs/spec/poly-trader-wallet-port.md#user-onboarding-dashboard-b3) — Start setup → custodial-consent screen (required, persisted) → server-side `provision` → fund prompt with QR + live balance poll → one-click allowance setup → default grant issuance → done state with Withdraw + Disconnect actions. **Agent flow (API)**: `POST /api/v1/poly/wallet/connect` + `GET /api/v1/poly/wallet/status` + `POST /api/v1/poly/wallet/allowances` + `POST /api/v1/poly/wallet/withdraw`. Agent API key must carry `poly:wallet:provision` scope; custodial consent must have been acknowledged by the minting user. `CUSTODIAL_CONSENT` invariant: `provision` rejects with 409 if `custodial_consent_accepted_at` is NULL. `WITHDRAW_BEFORE_REVOKE`: Disconnect shows current balance + requires explicit "proceed with non-zero balance" confirmation. Contract: `packages/node-contracts/src/poly.wallet.connections.v1.contract.ts`. Guide: `docs/guides/poly-wallet-onboarding.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **B4** — `poly_wallet_grants` schema + issuance API                              | ~1.5d | Migration 0031 creates `poly_wallet_grants` (caps + scopes + expiry + revoked_at). `POST /api/v1/poly/wallet/grants` issues; `DELETE /:id` revokes. Default grant auto-created by B3 with operator-safe caps (per-order $2, daily $10, hourly-fills 20); user can tighten via dashboard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **B5** — Executor + coordinator rewiring                                         | ~2d   | `mirror-coordinator` per-tenant loop: for each tenant → `polyTraderWallet.resolve(billingAccountId)` → if `null`, skip (fail-closed per `FAIL_CLOSED_ON_RESOLVE`) → build per-tenant `PolymarketClobAdapter({ signer: context.account, creds: context.clobCreds, funderAddress: context.funderAddress })` → run the existing placeIntent path. Drop the shared `POLY_PROTO_WALLET_ADDRESS` + `POLY_CLOB_*` reads from `server-env.ts` (these remain only for system-tenant bootstrap until B6). Per-tenant adapter instances are LRU-cached keyed on `connectionId` to avoid rebuilding per tick.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **B6** — Per-grant cap + scope enforcement + revocation checks                   | ~1.5d | `mirror-coordinator` reads grant before each placement attempt: expired / revoked / missing-scope / cap-exceeded paths all log `poly.mirror.decision reason=…` and skip. Per-grant running-total cache (daily/hourly) read from `poly_copy_trade_fills` via a windowed SELECT on the per-tenant scope. System-tenant bootstrap grant removed; candidate-a runs as a normal tenant from here on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **B7** — Cross-tenant wallet + grant + fill isolation tests                      | ~1.5d | Component tests: two tenants each with their own connection + grant + targets; assert placements land on distinct funder addresses; revocation on tenant-A halts only tenant-A's next tick; cap-breach skips only the breaching tenant. Stack test: full dev-stack two-tenant poll with fake CLOB adapter proving the per-tenant adapter wiring (no mainnet). Mainnet-verification by a single candidate-a flight + deploy_verified handshake on Loki.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Phase B total**: ~11 days engineering + 1 day flight + verification. vs. Safe+4337's ~3 weeks of which ~0 days are mechanically de-risked before committing.

**Deferred to follow-up (explicitly NOT in Phase B)**:

- `poly_wallet_connections.backend` CHECK constraint (`privy|safe_4337|turnkey`) — Phase B is single-backend (Privy). The column lands when a second adapter lands.
- Safe + 4337 + self-hosted bundler (`SafePolyTraderWalletAdapter`) — filed as a separate OSS-hardening task that spans the repo. The port is designed to accept it without caller churn.
- Hardware / BYO-imported EOA support — user asked for Privy-reuse.
- [task.0348](task.0348.poly-wallet-orphan-sweep.md) — Privy user-wallet orphan sweep. Kept separate from v0 wallet provisioning / real-creds work so Phase B can ship the trading path first.
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

- `exercise:` On `candidate-a`, sign into the poly app, visit `/profile`, and click `Create trading wallet` under `Polymarket Trading Wallet`. Expect the row to flip to connected with a tenant wallet address and Polygonscan link. API fallback: `POST /api/v1/poly/wallet/connect` with the signed-in session cookie returns `{ connection_id, funder_address, requires_funding: true, suggested_usdc: 5, suggested_matic: 0.1 }`, and `GET /api/v1/poly/wallet/status` then returns `{ configured: true, connected: true, ... }`.
- `observability:` Query Loki at the deployed SHA with `{job="poly-node-app",sha="<sha>"} |= "poly.wallet.connect"` and confirm your request logs `billing_account_id`, `connection_id`, and `funder_address`.

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

`/review-implementation` on commits `6224cec8c..32a58aa19` found blocking gaps. r3/r4 follow-up truth-sync on 2026-04-21 resolved the test gap, and the final v0 blocker (B2.12 real CLOB creds) is now implemented. The orphan sweep is deferred to [task.0348](task.0348.poly-wallet-orphan-sweep.md) instead of quietly inflating the Phase B merge bar.

### Blocking status

| #   | Gap                                                              | State    | Resolution                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Wallet provisioning silently falls back to fake Polymarket creds | ✅ fixed | There is no stub path anymore. `bootstrap/poly-trader-wallet.ts` derives live L2 creds via `createOrDerivePolymarketApiKeyForSigner()` and throws a stable error if derivation fails.                                                                                                                                                                                                     |
| 2   | Agent-consent path unguarded                                     | ✅ fixed | Route rejects `custodialConsentActorKind: "agent"` with 501 Not Implemented until agent-API-key auth lands in B3.                                                                                                                                                                                                                                                                         |
| 3   | Spec claim about dep-cruiser doesn't match reality               | ✅ fixed | `SEPARATE_PRIVY_APP` rewritten to describe the actual enforcement: adapter is constructor-injected with `PrivyClient`, so package source has no reachable path to env vars. Route is in the `@/bootstrap/**` allowlist, not `@/adapters/**`.                                                                                                                                              |
| 4   | `@cogni/node-shared` barrel export unverified                    | ✅ fixed | `pnpm check:fast` green — imports resolve cleanly.                                                                                                                                                                                                                                                                                                                                        |
| 5   | `pnpm check` not run                                             | ✅ fixed | `pnpm check:fast` green on `feat/task-0318-phase-b @ HEAD` (2026-04-21). Full output below.                                                                                                                                                                                                                                                                                               |
| 6   | Zero tests                                                       | ✅ fixed | `nodes/poly/app/tests/component/wallet/privy-poly-trader-wallet.adapter.int.test.ts` now covers the two-tenant `provision → resolve → getAddress → revoke → resolve=null` round-trip with RLS, tenant defense-in-depth, and AEAD binding. The same pass caught a real issue: `_journal.json` was missing `0030_poly_wallet_connections`, so fresh DBs skipped the wallet table migration. |

### Non-blocking suggestions — status

| Suggestion                                                | State    |
| --------------------------------------------------------- | -------- |
| `crypto.randomUUID()` instead of PG roundtrip             | ⛔ open  |
| Delete `brandAuthorized` dead method                      | ⛔ open  |
| Move route Zod schemas into `packages/node-contracts/`    | ⛔ open  |
| `poly.wallet.connect` info log on success                 | ✅ fixed |
| Hex-format regex validation on `POLY_WALLET_AEAD_KEY_HEX` | ✅ fixed |
| System-tenant bootstrap decision                          | ⛔ open  |
| Index on `created_at` for orphan reconciler               | ⛔ open  |
| `custodial_consent_accepted_at DEFAULT now()`             | ⛔ open  |
| `deploy-infra.sh` megaline refactor                       | ⛔ open  |

### Architecture footnote (reviewer visibility)

This slice lives across three locations — see [`docs/guides/poly-wallet-provisioning.md` § Architecture (honest accounting)](../../docs/guides/poly-wallet-provisioning.md#architecture-honest-accounting) for the full explanation including the smells (split package/node-local/bootstrap, two `biome-ignore noExplicitAny` comments for cross-peerDep viem type drift, ESLint `@/adapters/**` boundary forcing bootstrap indirection).

### check:fast output (2026-04-21 HEAD)

```
✓ packages:build passed (2s)
✓ workspace:typecheck passed (1s)
✓ lint passed (4s)
✓ workspace:lint passed (0s)
✓ format passed (12s)
✓ check:docs passed (2s)
✓ workspace:test passed (1s)
✓ All fast checks passed!
```

## Review Feedback (revision 4 — 2026-04-21, Phase B v0 pre-merge)

`/review-implementation` pass against PR #968 `HEAD = 94d053932` after `candidate-flight-infra` green.
Verdict: **REQUEST CHANGES**. Surface is sound, but three provisioning-path issues block merge
because this is the security-sensitive slice the rest of Phase B rides on.

### Blocking (must fix before merge)

- [x] **B-1 — Provisioning is not atomic; orphan Privy wallets + CLOB API keys can be minted on
      every failed attempt.** `adapters/server/wallet/privy-poly-trader-wallet.adapter.ts:254-297`
      creates a Privy wallet and derives a Polymarket L2 creds **inside** the DB transaction but
      **before** the `INSERT`. Any post-Privy failure (CLOB derive throws, AEAD throws,
      connection drop, INSERT fails) rolls back the DB but leaves a paid, spendable Privy wallet
      with CLOB creds — untracked by the app. Combined with B-2, an authenticated user can mint an
      unbounded number of orphans via retry loops. **Fix (atomic + idempotent v0 foundation)**:
      pass a deterministic `idempotencyKey` to `privyClient.wallets().create(..., { idempotencyKey })`
      so retries converge on the same Privy wallet (Privy SDK honors `privy-idempotency-key`
      header; `@privy-io/node` `RequestOptions.idempotencyKey` maps to it). Key formula: a
      per-tenant generation counter (`count(all_rows_for_tenant) + 1`) so (a) retries of a
      single attempt always get the same wallet, (b) a new attempt after revoke increments
      generation and gets a fresh wallet. `createOrDeriveApiKey()` is already idempotent per
      signer. With both external calls idempotent, crash-mid-provision self-heals on retry and
      no new orphans can be created. `task.0348` sweep remains defense-in-depth, not a load-bearing
      dependency.

- [x] **B-2 — `/connect` has no per-tenant rate limit.** `app/api/v1/poly/wallet/connect/route.ts:86-118`
      calls `adapter.provision` on every request. Even without B-1, a user can call
      `connect → revoke → connect → revoke …` in a tight loop to churn Privy wallets + CLOB API
      keys until Privy rate-limits the whole app. **Fix (v0)**: in the route, before calling
      `adapter.provision`, SELECT from `poly_wallet_connections` filtered by `billing_account_id`
      with `created_at > now() - interval '5 minutes'`; if any row is present, return 429 with a
      `retry_after_seconds`. Simple, DB-native, no new dependencies. Tighten the window
      downstream once we have abuse data.

- [x] **B-3 — `revoke` silently strands funds.** Adapter soft-deletes the row (L317-340) without
      checking on-chain balance. The port spec already pushes this to the UX layer
      (`WITHDRAW_BEFORE_REVOKE` is a caller invariant, not a port invariant), so the real v0 fix
      is: (a) strengthen JSDoc on the port + adapter so this is unmistakable at the call site,
      (b) leave the real `withdrawUsdc` + balance-guard for B3. Live Polygon RPC + balance
      reading is not this PR's scope, but callers must not be able to claim the port gave them
      safe revoke semantics.

- [x] **B-4 — RLS policy is keyed on `created_by_user_id`, not `billing_account_id`.**
      **Fixed in-branch.** Rewrote `migrations/0030_poly_wallet_connections.sql` RLS policy to
      `EXISTS`-join through `billing_accounts.owner_user_id` (same shape as `llm_charge_details`).
      `created_by_user_id` becomes pure audit metadata. The policy is now principal-agnostic —
      whoever the app resolves for `app.current_user_id` (today: authenticated user; future:
      agent API key → user pivot) gets access iff they own the billing_account. Extends cleanly
      to multi-user billing later by swapping the EXISTS clause for a membership check (no column
      change, no data backfill).

### Suggestions (cheap wins, land in this PR)

_(S-1 reclassified to D-5 after impact audit — see Deferred.)_

- [x] **S-2 — Narrow contract `custodialConsentActorKind` to `z.literal("user")`.**
      `packages/node-contracts/src/poly.wallet.connection.v1.contract.ts:33` allows `"agent"`
      but the route immediately 501s on that branch. Narrow the contract to match v0 capability;
      widen when agent-API-key auth lands in B3.

- [x] **S-3 — Delete dead `brandAuthorized` method.** The adapter's `brandAuthorized` (L393-403)
      is unreachable — `authorizeIntent` throws. Ship branding logic alongside the grants-table
      code when it lands (B4). Dead code in security paths is noise.

- [x] **S-4 — Fix `KEY_NEVER_IN_APP` JSDoc.** Adapter module header (L17) says raw keys never
      enter app memory, but `this.authorizationContext` holds the Privy app's **signing key**
      in process memory. Clarify: raw EOA private keys never reach the app; the Privy HSM
      _authorization_ key is required in-process to issue signing requests — that's a different
      key with a different threat model. Misleading doc on a security path is worse than no doc.

### Deferred — follow-up tasks (NOT in this PR)

- [ ] **D-1 — `/status` creates billing accounts as a side effect.**
      `app/api/v1/poly/wallet/status/route.ts:43-46` uses `getOrCreateBillingAccountForUser`,
      creating rows on read. Existing pattern across the codebase, but on a read-only status
      route it's unexpected. Add a `getBillingAccountForUser` variant that returns `null` and
      switch status to that. File as its own task — touches shared `AccountService`.

- [ ] **D-2 — Encryption key rotation (keyring).** We store `encryption_key_id` per row but
      never consult a keyring; rotating `POLY_WALLET_AEAD_KEY_HEX` immediately breaks
      decryption of all existing rows. Out of scope for v0. File as ops-hygiene task alongside
      CLOB L2 rotation (`rotateClobCreds` stub).

- [ ] **D-3 — HTTP route-level component tests.** Adapter has good component coverage (RLS,
      AEAD, multi-tenant round-trip); routes have zero. Not a merge blocker for v0 because the
      adapter is the surface that carries the security invariants, but cover `/connect` happy
      path + validation-error + rate-limit + unconfigured-503 + consent-actor-mismatch-400 in a
      follow-up.

- [ ] **D-4 — Live balance-guard on revoke.** When B3 lands withdraw UX + Polygon RPC wiring,
      add `withdrawUsdc` + a pre-revoke balance check. Tracked by existing B3 scope in the
      roadmap above.

- [ ] **D-5 — Canonical AAD serialization (cross-node).** `packages/node-shared/src/crypto/aead.ts`
      uses `JSON.stringify(aad)` for AEAD AAD, which is implicitly key-ordering-dependent. A fixed
      canonical form (pipe-concat) would remove a silent source of ordering drift. Reclassified
      from a v0 suggestion to a deferred task after impact audit: `aead.ts` already backs
      tenant-connections ciphertext on `operator`, `resy`, `node-template`, and `poly` (OpenAI + Codex creds in prod), so changing the format requires a coordinated migration with key
      rotation, not a drop-in code change. File as its own cross-node crypto-ops task.

### check:fast output (2026-04-21 r4 HEAD)

Green at `HEAD = 94d053932` before this review's code changes ship. Will re-run after.

## Review Feedback (revision 6 — 2026-04-22, post-revision-5 critical review)

Second pass after revision-5 changes shipped (idempotency key + generation counter,
`/connect` rate limit, revoke WARNING JSDoc, contract narrowing to `user`, dead
`brandAuthorized` removal, RLS pivot to `billing_accounts.owner_user_id` EXISTS-join).
Full `pnpm check` green (43s, all 10 tasks: packages:build / workspace:typecheck /
workspace:lint / lint / format / ui-tokens / workspace:test / check:docs /
check:root-layout / arch:check). One blocking issue remains; everything else is
non-blocking.

### Blocking

- [x] **B-5 — Port `provision()` doesn't model `custodialConsent` but the adapter requires it.**
      **Fixed in-branch.** Added `CustodialConsent` type to the port
      (`packages/poly-wallet/src/port/poly-trader-wallet.port.ts`) and made it a required field
      on `provision`'s input. Dropped the optional `?` + runtime `consent ?? throw` guard on the
      adapter — `CUSTODIAL_CONSENT` is now a compile-time invariant every implementation has to
      honour. Exported the new type from both barrel files. Zod-vs-TS split kept correctly:
      the HTTP Zod contract (`poly.wallet.connection.v1`) validates the wire payload; the port
      TS type receives the merged shape (client fields + server-stamped `acceptedAt`). Spec
      updated to document the two-layer enforcement.

### Suggestions

- [ ] **S-5 — `checkConnectRateLimit` bypasses the adapter's DI pattern.**
      `nodes/poly/app/src/bootstrap/poly-trader-wallet.ts:166-193` reads `getServiceDb()` at
      module scope. The adapter itself takes `serviceDb` as a constructor dep (testable); the
      rate-limit helper doesn't, so it can only be exercised via component tests that spin up a
      real DB. Accept `db: Database = getServiceDb()` as a second param (or factory it like the
      adapter) so a unit test can pass a seeded stub. Matches the rest of the architecture.

- [ ] **S-6 — No direct unit test for `checkConnectRateLimit`.**
      Security-sensitive abuse bound has zero direct coverage — only incidental exercise via the
      concurrent-provision component test. At minimum: unit-test the three return branches
      (no rows → allow, active row → allow, revoked inside window → 429) with a stubbed DB.
      Gated on S-5 landing first (singleton → DI).

- [ ] **S-7 — Provision holds the DB transaction across two external HTTP calls (2-10 s).**
      `adapter.ts:220-343` runs inside `serviceDb.transaction(...)` which wraps both the Privy
      `wallets().create(...)` and the CLOB `createOrDeriveApiKey(...)` call. Under load this
      pins a pooled connection and the advisory lock for the whole round-trip. Idempotency-key
      already makes retries converge so orphans are not a concern, which means the fix is a
      perf / connection-pool hygiene question, not correctness: consider splitting into
      (1) short tx: acquire lock + compute `generation` + commit, (2) outside-tx: Privy + CLOB
      calls, (3) short tx: re-acquire lock + verify no active row + INSERT. Defer unless
      candidate-a shows pool exhaustion. Flag here so it doesn't get lost.

- [ ] **S-8 — `/connect` output hardcodes `requires_funding: true` + fixed suggestions.**
      `route.ts:137-143` returns `{ requires_funding: true, suggested_usdc: 5,
suggested_matic: 0.1 }` on every call — including idempotent re-hits where the wallet
      already has balance. Same gap on `/status` (no balance field). UI will say "fund me with 5
      USDC" even when the wallet has 50. Real fix requires a Polygon RPC balance read; belongs
      with the withdraw-UX work (B3) or its own micro-task. Note, not blocking.

### Good — preserve these patterns

- **G-1 — Idempotency-key + generation counter is a clean orphan-prevention design.**
  Deterministic `poly-wallet:${billingAccountId}:${generation}` key under the advisory lock
  means a mid-provision crash either (a) converges on the same Privy wallet on retry or
  (b) falls through to the `existing[0]` short-circuit. No orphans. Component test at
  `adapter.int.test.ts:342-416` verifies both the initial `:1` key and the `:2` increment
  across a revoke cycle.

- **G-2 — RLS `EXISTS`-pivot via `billing_accounts.owner_user_id` is principal-agnostic.**
  Migration `0030_poly_wallet_connections.sql:83-97` keys tenant isolation on the
  billing-account owner, not on the row's creator. Any actor whose session resolves to
  `app.current_user_id = owner` gets access. Forward-compatible with agent API keys
  (same policy, no migration) and multi-user billing (swap `EXISTS` clause only, no column
  change). Mirrors `llm_charge_details` so the pattern is already battle-tested.

- **G-3 — Belt-and-suspenders concurrency safety.** Advisory lock on `hashtext(billing_account_id)`
  inside the tx + partial unique index `WHERE revoked_at IS NULL` at the schema level. If
  the lock ever gave up (it can't in Postgres — xact lock auto-releases on commit/rollback),
  the unique index rejects the second insert.

- **G-4 — AEAD AAD binding verified end-to-end.** `(billing_account_id, connection_id,
provider)` pinned into the AAD envelope; component test
  `adapter.int.test.ts:282-292` explicitly proves that re-binding ciphertext to a different
  `billing_account_id` causes `aeadDecrypt` to throw.

- **G-5 — Fail-closed `resolve()` with an explicit warn log on every error path.**
  Never returns a partial context; never silently swallows an error.

- **G-6 — `revoke()` JSDoc now screams about the funds-still-spendable gap.**
  `adapter.ts:345-359` explicitly enumerates what revoke does NOT do (no Privy delete, no
  withdraw, no balance check) and names the caller (UI) as the party that MUST enforce
  `WITHDRAW_BEFORE_REVOKE`. Good documentation of a real caller obligation.

- **G-7 — Tests cover the hard cases.** Three-way concurrent provision collapses to one Privy
  call + one row; revoke cycle increments generation; cross-tenant RLS scoped + unscoped
  reads return expected counts; AEAD rebind throws. That's the actual threat model.

### Check Results

- `pnpm check`: **PASS** (43 s; 10/10 tasks green).
- component tests: not run locally this pass (covered in revision 5; no component-level code
  changed since).
- `pnpm check:docs`: PASS (inside `pnpm check`).

### Verdict

**APPROVE (post-B-5 fix)** — B-5 fixed in this revision (port now models `CustodialConsent`
as a required type; adapter runtime guard deleted). `pnpm check:fast` green. S-5 / S-6 /
S-7 / S-8 are explicit non-blocking suggestions and tracked here for follow-up. Ready to
flight.

## Validation Result (2026-04-22, candidate-a flight)

**Feature gate: GREEN.** Real per-tenant provisioning exercised end-to-end on
candidate-a at deployed SHA `fd2e61e20`.

### exercise (as-run)

Signed-in user (`userId=8d5757a3-0f3b-42b2-8319-a3641bffa0c9`) hit
`POST https://poly-test.cognidao.org/api/v1/poly/wallet/connect` → **HTTP 200
in 2289ms**. Returned `connection_id=79703dff-0c94-44da-9eea-ad64f7c99af9`,
`funder_address=0x9A9e7276b3C4d6E7c9a866EB6FEB8CFaB82C160A`. On-chain wallet
visible at
[polygonscan.com/address/0x9A9e7276…160A](https://polygonscan.com/address/0x9A9e7276b3C4d6E7c9a866EB6FEB8CFaB82C160A).

### observability (as-read)

Pulled from Grafana Cloud Loki (MCP was unavailable; used
`scripts/loki-query.sh` with the service-account token):

```
2026-04-22T05:31:47.029Z  msg="request received"
   route=poly.wallet.connect  method=POST  userId=8d5757a3-…
   reqId=3f6e6e58-a74b-4aa0-a185-42c3ec4e4688

2026-04-22T05:31:49.317Z  msg="poly.wallet.connect — provisioned per-tenant Polymarket trading wallet"
   billing_account_id=777dedd4-b49e-443f-a1e7-23c2e77468ef
   connection_id=79703dff-0c94-44da-9eea-ad64f7c99af9
   funder_address=0x9A9e7276b3C4d6E7c9a866EB6FEB8CFaB82C160A
   actor_kind=user

2026-04-22T05:31:49.318Z  msg="request complete"
   route=poly.wallet.connect  status=200  durationMs=2288.97
```

Separate sweep: `level=50` error/warn count on `poly-node-app-*` pods over the
30-minute window around provisioning: **0**.

### What this proves

- **Address match.** `funder_address` in the app log equals the on-chain
  address on Polygonscan — the Privy HSM minted the wallet during the
  `/connect` call and the adapter persisted that same address on
  `poly_wallet_connections.funder_address` in the same request.
- **Full invariant chain.** The "provisioned per-tenant" log line only fires
  after `provision()` returns, so the full path ran green: advisory lock
  acquired → idempotent Privy create → CLOB L2 creds derived + AEAD-encrypted
  → INSERT committed → consent row persisted.
- **RLS pivot works in prod.** Session user resolved to
  `billing_account_id` through the new `billing_accounts.owner_user_id`
  EXISTS-join RLS policy (B-4 fix); the old `created_by_user_id` coupling is
  no longer load-bearing.
- **Rate-limit didn't false-positive.** `checkConnectRateLimit` ran before
  adapter construction and passed (no 429).

### Post-flight note on `98df9a92c`

Commit `98df9a92c` (B-5 fix: make `CustodialConsent` a compile-time invariant
on the port) is NOT on the deployed `fd2e61e20`. It was a pure type-level
tightening + deletion of a never-firing runtime guard, so there is **zero
runtime behavioural delta** vs the flighted build. The validation above is
authoritative; no re-flight required for `deploy_verified: true`.

## PR / Links

- Handoff: [handoff](../handoffs/task.0318.handoff.md)
