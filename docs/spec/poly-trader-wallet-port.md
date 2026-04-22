---
id: poly-trader-wallet-port
type: spec
title: "Poly Trader Wallet Port: per-tenant signing + credential broker for Polymarket CLOB"
status: active
spec_state: active
trust: reviewed
summary: Port/adapter contract for per-tenant Polymarket trading wallets. `PolyTraderWalletPort` exposes `provisionWithGrant`, `authorizeIntent`, `revoke`, and `getAddress`; `authorizeIntent` is the only producer of the branded `AuthorizedSigningContext` that `PolymarketClobAdapter.placeOrder` requires. Phase B3 shipped `PrivyPolyTraderWalletAdapter` using a Privy app dedicated to user wallets (separate from the system / operator-wallet Privy app). Future adapters (Safe+4337, Turnkey) plug into the same port.
read_when: Wiring per-user Polymarket trading, adding a new signing backend, provisioning per-tenant wallets, or reviewing the separation between system and user Privy credentials.
implements: proj.poly-copy-trading
owner: derekg1729
created: 2026-04-20
verified: 2026-04-22
tags: [poly, polymarket, wallets, multi-tenant, privy, port-adapter]
---

# Poly Trader Wallet Port

> Per-tenant signing context for Polymarket CLOB orders. Narrow, typed, backend-agnostic. The port sits next to — not inside — the system-role [`OperatorWalletPort`](./operator-wallet.md), and its adapters use a **separate Privy app** from the operator wallet so credential rotation, billing, audit, and compromise blast radius are isolated by construction.

## Goal

Define the contract for a per-tenant Polymarket CLOB signing-context port — `PolyTraderWalletPort` — that resolves `(billing_account_id) → { signer, clob_creds, funder_address }`, enforces grant-scope + caps via a branded `AuthorizedSigningContext`, and isolates user-wallet Privy credentials from the system / operator-wallet Privy app.

## Non-Goals

- Generalizing `OperatorWalletPort` to cover per-tenant signing — the operator wallet is a system-role intent-only actuator and stays unchanged.
- Multi-wallet-per-tenant — v1 is one active `poly_wallet_connections` row per `billing_account_id`.
- On-chain allowance flow — approvals (USDC + CTF `setApprovalForAll`) are the onboarding-UX surface's concern (B3), not this port.
- Mid-flight cancellation or sweep on revoke — revocation is halt-future-only.
- A second backend this release — `SafePolyTraderWalletAdapter` / `TurnkeyPolyTraderWalletAdapter` are port-level-compatible future work, not in scope here.

## Why a new port

Phase B needs per-tenant Polymarket trading wallets. Three ways to get there were considered; only one survived review:

| Approach                                                                                                | Verdict                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Extend `OperatorWalletPort`** with `resolvePolyAccount(billingAccountId)` / `signPolymarketOrder`.    | **Rejected.** Violates `OperatorWalletPort`'s `NO_GENERIC_SIGNING` invariant — the port is deliberately intent-only. Also conflates the system-tenant operator wallet with per-user wallets, which have different blast-radius and billing semantics. |
| **Inline per-tenant signer resolution in `bootstrap/capabilities/poly-trade.ts`.**                      | **Rejected.** Works for Phase B but leaks Privy SDK coupling + env-shape assumptions into `nodes/poly/app`, making a future backend swap (Safe+4337, Turnkey) a cross-cutting rewrite. Violates `VENDOR_CONTAINMENT`.                                 |
| **New `PolyTraderWalletPort` in a shared package, `PrivyPolyTraderWalletAdapter` as the Phase B impl.** | **Chosen.** Narrow interface, backend-agnostic, testable without real Privy, future adapters plug in without touching callers. Matches the capability-package shape pinned in [packages-architecture.md](./packages-architecture.md).                 |

**The port is new, not a rename of `OperatorWalletPort`.** The operator wallet is a system-role actuator (intent-only outbound payments for AI-fee forwarding + Splits distribution). The poly-trader wallet is a per-tenant signer. They have different invariants, different lifecycle, different caller sets, and — importantly — **different Privy apps**. Generalizing one to cover the other would weaken the security model.

## Key references

|          |                                                                          |                                                    |
| -------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| **Spec** | [operator-wallet](./operator-wallet.md)                                  | System-role wallet; stays separate                 |
| **Spec** | [poly-multi-tenant-auth](./poly-multi-tenant-auth.md)                    | Tenant-isolation contract + `poly_wallet_*` schema |
| **Spec** | [packages-architecture](./packages-architecture.md)                      | Capability-package shape this port follows         |
| **Spec** | [tenant-connections](./tenant-connections.md)                            | AEAD envelope reused for CLOB creds-at-rest        |
| **Task** | [task.0318](../../work/items/task.0318.poly-wallet-multi-tenant-auth.md) | Phase B lifecycle carrier                          |

## Design

The port lives in `packages/poly-wallet/`. The first adapter (`PrivyPolyTraderWalletAdapter`) lives node-local at `nodes/poly/app/src/adapters/server/wallet/` because it depends on the node-local `@cogni/poly-db-schema` + `@cogni/db-client` service DB handle. Future adapters (Safe+4337, Turnkey) will plug into the same port without caller churn.

## Port

### Interface

```ts
// packages/poly-wallet/src/port/poly-trader-wallet.port.ts

/**
 * Minimal order-intent summary the port needs to enforce scopes + caps.
 * Duplicated on purpose from the trading module's richer `OrderIntent` so
 * this package stays CLOB-client-free.
 */
export interface OrderIntentSummary {
  readonly side: "BUY" | "SELL";
  readonly usdcAmount: number; // decimal USDC, not atomic units
  readonly marketConditionId: string;
}

/**
 * Signing context for a single tenant's Polymarket CLOB trading.
 * All three fields are needed together by `PolymarketClobAdapter`; any
 * caller that requests one always needs the others, so they are returned
 * as an atomic bundle rather than as separate getter methods.
 */
export interface PolyTraderSigningContext {
  /**
   * viem `LocalAccount` that can sign EIP-712 order hashes.
   *
   * The viem dependency here is intentional: `@polymarket/clob-client` already
   * consumes viem signers natively, and every plausible adapter (Privy today,
   * Safe+4337 tomorrow) terminates at a viem-shaped account. Treating this as
   * a port-level coupling keeps the CLOB adapter construction trivial. If a
   * future backend cannot produce a viem `LocalAccount`, the port evolves —
   * but that is not a leak to be fixed speculatively.
   */
  readonly account: LocalAccount;
  /** Polymarket CLOB L2 API credentials (key + secret + passphrase). */
  readonly clobCreds: ApiKeyCreds;
  /** Checksummed funder address — MUST equal `account.address` for SignatureType.EOA. */
  readonly funderAddress: `0x${string}`;
  /** Opaque correlation id for observability; maps 1:1 to `poly_wallet_connections.id`. */
  readonly connectionId: string;
}

/**
 * Branded subtype of `PolyTraderSigningContext` issued only by
 * `authorizeIntent`. `PolymarketClobAdapter.placeOrder` accepts this type,
 * NOT the raw `PolyTraderSigningContext` — so cap / scope bypass is a
 * compile error, not a discipline problem.
 */
declare const __authorized: unique symbol;
export type AuthorizedSigningContext = PolyTraderSigningContext & {
  readonly [__authorized]: true;
  /** `poly_wallet_grants.id` that authorized this intent. */
  readonly grantId: string;
  /** The exact intent the grant was checked against; placeOrder MUST NOT mutate. */
  readonly authorizedIntent: OrderIntentSummary;
};

/**
 * Reasons `authorizeIntent` may return `null`.
 * Logged at the adapter boundary; the coordinator writes a
 * `poly.mirror.decision reason=<value>` row.
 */
export type AuthorizationFailure =
  | "no_connection"
  | "no_active_grant"
  | "grant_expired"
  | "grant_revoked"
  | "scope_missing"
  | "cap_exceeded_per_order"
  | "cap_exceeded_daily"
  | "cap_exceeded_hourly_fills"
  | "backend_unreachable";

/**
 * Resolve a per-tenant signing context for Polymarket CLOB trading.
 *
 * Invariants:
 *   - TENANT_SCOPED: every call takes a `billingAccountId`; cross-tenant resolution returns `null`.
 *   - NO_GENERIC_SIGNING: the port has no `signMessage(bytes)` / `signTransaction(calldata)` surface.
 *   - KEY_NEVER_IN_APP: no adapter implementation may hold raw private key material in the app process.
 *   - CONTEXT_IS_READ_ONLY: the returned bundle is frozen; callers must not mutate.
 */
export interface PolyTraderWalletPort {
  /**
   * Resolve the active signing context for a tenant.
   * Returns `null` if the tenant has no un-revoked `poly_wallet_connections` row
   * OR if the connection exists but the adapter cannot materialize credentials
   * (e.g. Privy HSM unreachable). Callers treat `null` as fail-closed.
   */
  resolve(billingAccountId: string): Promise<PolyTraderSigningContext | null>;

  /**
   * Read-only lookup of the funder address for a tenant, without decrypting
   * CLOB creds or constructing a signer. Used by the dashboard / onboarding
   * UX to show the deposit address. Returns `null` for unknown / revoked
   * tenants. Cheap enough to call on every page render.
   */
  getAddress(billingAccountId: string): Promise<`0x${string}` | null>;

  /**
   * Read-only Polygon balance snapshot for the tenant funder address: USDC.e
   * (Polymarket quote token) plus native POL for gas. Implementations use a
   * DB-only address lookup (same row as `getAddress`) plus optional RPC via
   * `POLYGON_RPC_URL`; no Privy call, no CLOB decrypt. Returns `null` when
   * there is no active `poly_wallet_connections` row. RPC failures per field
   * surface in `errors[]`; the method does not throw.
   */
  getBalances(billingAccountId: string): Promise<{
    readonly address: `0x${string}`;
    readonly usdcE: number | null;
    readonly pol: number | null;
    readonly errors: readonly string[];
  } | null>;

  /**
   * Provision a brand-new wallet for a tenant.
   * Idempotent under concurrency: implementations MUST hold a tenant-scoped
   * lock (e.g. a Postgres advisory lock keyed on `billing_account_id`) for
   * the entire create-wallet → derive-creds → insert-row sequence, so two
   * concurrent calls do not create two backend wallets. If the tenant
   * already has an un-revoked connection, returns it unchanged.
   * The adapter chooses the backend (Privy today); callers do not pick.
   *
   * External dependencies at provision-time: backend custody API (Privy)
   * AND Polymarket CLOB `/auth/api-key`. Either being unreachable fails
   * the call; callers retry. Partial success (Privy wallet created but
   * CLOB creds derivation failed) is rolled back inside the lock so the
   * next retry starts clean — see § Behavior.
   */
  provision(input: {
    billingAccountId: string;
    createdByUserId: string;
    custodialConsent: CustodialConsent;
  }): Promise<PolyTraderSigningContext>;

  /**
   * Mark a connection revoked. Sets `poly_wallet_connections.revoked_at`;
   * does NOT delete the backend wallet (the address may still hold funds).
   * The next `resolve` for the same tenant returns `null`; the next
   * `provision` creates a *new* connection with a *new* address. Funds
   * on the old address must be withdrawn manually by the tenant — the
   * port does not attempt a sweep. Callers are responsible for warning
   * the user before calling `revoke` on a funded wallet.
   */
  revoke(input: {
    billingAccountId: string;
    revokedByUserId: string;
  }): Promise<void>;

  /**
   * Resolve + check an active grant's scope and caps against the intent.
   * Only callers holding the returned `AuthorizedSigningContext` may drive
   * `PolymarketClobAdapter.placeOrder`. A `null` return means the intent is
   * unauthorized; the second tuple value carries the precise reason for
   * observability. The adapter consults `poly_wallet_grants` for
   * scope/caps and a windowed SELECT on `poly_copy_trade_fills` for
   * running-total caps.
   */
  authorizeIntent(
    billingAccountId: string,
    intent: OrderIntentSummary
  ): Promise<
    | { ok: true; context: AuthorizedSigningContext }
    | { ok: false; reason: AuthorizationFailure }
  >;

  /**
   * Move USDC from the tenant's trading wallet to an external address.
   * Intent-typed (token locked to USDC.e on Polygon for v0); the adapter
   * encodes the transfer calldata — callers cannot provide raw calldata,
   * so the port keeps its `NO_GENERIC_SIGNING` invariant intact.
   * The on-chain cost (gas) is paid from the tenant's own MATIC balance
   * at the funder address.
   *
   * Used by the dashboard "Withdraw funds" flow and by the
   * "warn-then-revoke" step of wallet disconnection UX.
   */
  withdrawUsdc(input: {
    billingAccountId: string;
    destination: `0x${string}`;
    amountAtomic: bigint; // USDC.e has 6 decimals
    requestedByUserId: string;
  }): Promise<{ txHash: `0x${string}` }>;

  /**
   * Rotate the Polymarket CLOB L2 API credentials for a tenant's wallet.
   * Calls Polymarket's `/auth/api-key` rotation endpoint, re-encrypts, and
   * updates `poly_wallet_connections.clob_api_key_ciphertext` + bumps
   * `encryption_key_id`. The wallet address and `privy_wallet_id` are
   * unchanged. Idempotent at the call-site level (safe to retry on error).
   *
   * Ships as a callable interface method in B2; the scheduled rotation job
   * is a follow-up (tracked separately under operational hygiene).
   */
  rotateClobCreds(input: {
    billingAccountId: string;
  }): Promise<PolyTraderSigningContext>;
}
```

## Invariants

<!-- Required heading: port-level invariants also live inline in `src/port/poly-trader-wallet.port.ts` module header. -->

### Port invariants (`CODE_REVIEW_CRITERIA`)

- `TENANT_SCOPED` — every method takes a `billingAccountId`. No "current" state inside the adapter.
- `NO_GENERIC_SIGNING` — the port does not expose a free-form `signMessage` / `signTransaction` method.
- `KEY_NEVER_IN_APP` — no raw private key material in the app process; backend holds custody.
- `FAIL_CLOSED_ON_RESOLVE` — `resolve` returns `null` (never a stub signer) when credentials are unavailable; the executor treats `null` as "skip this tenant this tick."
- `TENANT_DEFENSE_IN_DEPTH` — after any RLS-scoped DB read, the adapter verifies `row.billing_account_id === input.billingAccountId` before returning, mirroring `DrizzleConnectionBrokerAdapter.resolve`.
- `READ_BALANCES_FAIL_SOFT` — `getBalances` never throws; RPC or config gaps populate `errors[]` and null numeric fields while the HTTP route stays 200.
- `CREDS_ENCRYPTED_AT_REST` — CLOB API creds stored in `poly_wallet_connections.clob_api_key_ciphertext` via the existing `connections` AEAD envelope.
- `PROVISION_IS_IDEMPOTENT` — calling `provision` twice for the same tenant (concurrently or sequentially) returns the same connection. Implementations MUST serialize the create-wallet → derive-creds → insert sequence per tenant (advisory lock); partial failures roll back inside the lock so orphaned backend wallets cannot be created.
- `REVOKE_IS_DURABLE` — `revoked_at` is the authoritative kill-switch; the executor's `resolve` call is the only enforcement point. Revocation is halt-future-only: in-flight orders complete, funds on the revoked address remain until the user withdraws.
- `SEPARATE_PRIVY_APP` — the Privy adapter MUST NOT read `PRIVY_APP_ID` / `PRIVY_APP_SECRET` / `PRIVY_SIGNING_KEY` (those are the system / operator-wallet app). It reads a distinct env scope; see § Env below. Enforcement: the adapter is constructor-injected with a `PrivyClient` and signing key, so it stays env-free; bootstrap loads only `PRIVY_USER_WALLETS_*`, and routes import bootstrap rather than `@/adapters/**` directly.
- `AUTHORIZED_SIGNING_ONLY` — `PolymarketClobAdapter.placeOrder` accepts `AuthorizedSigningContext` (branded), not `PolyTraderSigningContext`. Grant scope + cap enforcement is compile-checked at the call site, not left to coordinator discipline.
- `NO_ORPHAN_BACKEND_WALLETS` — `provision` MUST pass a deterministic `idempotencyKey` (derived from `billing_account_id` + a monotonically-increasing per-tenant generation counter) to the backend wallet-create call. This makes retries converge on the same backend wallet even if the DB transaction fails mid-provision, so a crash between backend-create and DB-commit is self-healing on the next retry. `task.0348` (`scripts/ops/sweep-orphan-poly-wallets.ts`) remains as defense-in-depth for out-of-band drift (admin deletes, cross-environment mistakes) but is NOT the primary correctness mechanism.
- `WITHDRAW_BEFORE_REVOKE` — the dashboard MUST expose manual `withdrawUsdc` before offering `revoke`. Stranding funds at a revoked address is a UX failure mode, not an acceptable edge case.
- `CUSTODIAL_CONSENT` — a plain-English disclosure screen ("Cogni creates and holds this trading wallet via our custody provider Privy; only you can trigger trades and withdrawals through this app; if you lose access to your Cogni account, wallet recovery requires Cogni operator assistance") ships in the B3 onboarding flow. The tenant's acknowledgement is persisted (`poly_wallet_connections.custodial_consent_accepted_at`) before `provision` is permitted to run. The invariant is enforced at **two layers**: the HTTP Zod contract (`poly.wallet.connection.v1`) requires `custodialConsentAcknowledged: true` on the wire, and the port's `provision({ custodialConsent: CustodialConsent })` makes the server-stamped consent envelope a compile-time obligation. Zod at the trust boundary (HTTP); TypeScript at the internal port boundary (adapter) — same single source of truth, two layers of enforcement.

## Adapter: `PrivyPolyTraderWalletAdapter`

The Phase B default implementation. Uses Privy **server wallets** (`privy.walletApi.create({ chain_type: "ethereum" })`) — one per tenant, fully app-custodial from Privy's perspective, Cogni-controlled from the app's perspective.

### Dependencies (constructor-injected)

```ts
interface PrivyPolyTraderWalletAdapterDeps {
  /** Privy app distinct from the operator-wallet app. See § Env. */
  privyClient: PrivyClient;
  /** Privy signing key for the user-wallets app. */
  privySigningKey: string;
  /** BYPASSRLS DB handle for the cross-tenant reads this adapter performs. */
  serviceDb: ServiceDb;
  /** AEAD envelope used by `@cogni/connections` for at-rest encryption. */
  credentialEnvelope: CredentialEnvelope;
  /** Polymarket CLOB client factory — injected from bootstrap so the adapter never imports `@polymarket/clob-client` directly. */
  clobFactory: (signer: LocalAccount) => Promise<ApiKeyCreds>;
  /** Logger. */
  logger: Logger;
}
```

### Behavior

- `resolve(billingAccountId)`:
  1. `SELECT * FROM poly_wallet_connections WHERE billing_account_id = $1 AND revoked_at IS NULL LIMIT 1` on `serviceDb`.
  2. Defense-in-depth equality check on `row.billing_account_id`.
  3. `createViemAccount(privyClient, { walletId: row.privy_wallet_id, address: row.address, authorizationContext: { authorization_private_keys: [privySigningKey] } })`.
  4. Decrypt `row.clob_api_key_ciphertext` via `credentialEnvelope.decrypt`.
  5. Return `{ account, clobCreds, funderAddress: row.address, connectionId: row.id }`.
  6. On any failure: log a sanitized warning (no ciphertext, no walletId in the message) and return `null`.

- `getAddress(billingAccountId)`:
  1. `SELECT address FROM poly_wallet_connections WHERE billing_account_id = $1 AND revoked_at IS NULL LIMIT 1`.
  2. Defense-in-depth equality check on `row.billing_account_id`.
  3. Return `row.address` or `null`. No Privy calls, no decryption.

- `provision({ billingAccountId, createdByUserId })`:
  1. `BEGIN` a transaction.
  2. `SELECT pg_advisory_xact_lock(hashtext($1))` — tenant-scoped lock; held until COMMIT/ROLLBACK.
  3. `SELECT` existing un-revoked row for this tenant; if present, COMMIT + return the signing context (idempotent, no Privy call).
  4. Derive the per-tenant **generation counter** `g = count(rows_for_billing_account) + 1` (includes revoked rows; monotonic). Compute `idempotencyKey = "poly-wallet:${billingAccountId}:${g}"`.
  5. `privyClient.wallets().create({ chain_type: "ethereum" }, { idempotencyKey })` → `{ walletId, address }`. Privy honors `privy-idempotency-key` at the HTTP layer: repeated calls with the same key return the same wallet rather than minting a new one. **External dependency: Privy HSM must be reachable.**
  6. `createViemAccount(...)` → `LocalAccount`.
  7. `clobFactory(account)` → `ApiKeyCreds` via Polymarket `/auth/api-key`. The production implementation lives at the bootstrap boundary: wrap the Privy `LocalAccount` in `createWalletClient({ account, chain: polygon, transport: http() })`, dynamically import `ClobClient`, then call `createOrDeriveApiKey()` — which is itself idempotent per signer. **External dependency: CLOB API must be reachable.**
  8. `credentialEnvelope.encrypt(JSON.stringify(creds))` → `{ ciphertext, encryptionKeyId }`.
  9. `INSERT INTO poly_wallet_connections(...) VALUES (...)`.
  10. `COMMIT` and return the `PolyTraderSigningContext`.
  - **Any failure at steps 5–9** rolls back the transaction. On retry: the generation counter is recomputed from the same DB state → the same `idempotencyKey` → Privy returns the **same** wallet (no new wallet minted), CLOB returns the **same** creds, INSERT succeeds. Retries converge; orphans cannot be created from crash-mid-provision.
  - After a successful `revoke`, the revoked row still counts toward the generation counter, so the next `provision` computes a higher `g` and receives a **new** Privy wallet — the connect→revoke→connect cycle intentionally does not reuse the revoked wallet.
  - `task.0348` (`scripts/ops/sweep-orphan-poly-wallets.ts`) remains as defense-in-depth for the narrow case where a Privy admin-side delete or cross-environment drift leaves a dangling wallet without a matching idempotency record. Not a load-bearing dependency of the v0 trading path.
  - **Connect-route abuse bounding.** Steps 5–9 are cheap for Privy to re-serve (same idempotency key → cached response), but every `/connect` call still requires the advisory lock + a live DB/Privy round trip. To avoid pathological churn under an attacker session, the HTTP layer imposes a per-tenant rate limit (default: at most one provision or revoke within a 5-minute window per `billing_account_id`). Enforced in `app/api/v1/poly/wallet/connect/route.ts`, not in the port — the port must remain idempotent under arbitrary retry pressure.

- `revoke({ billingAccountId, revokedByUserId })`:
  1. `UPDATE poly_wallet_connections SET revoked_at = now(), revoked_by_user_id = $2 WHERE billing_account_id = $1 AND revoked_at IS NULL`.
  2. No Privy-side action. The backend wallet is retained because it may still hold user funds. A subsequent `provision` for the same tenant creates a _new_ connection with a _new_ address; funds on the old address are the tenant's responsibility to withdraw manually via `withdrawUsdc` **before** revoking.
  - **UX contract**: callers (the dashboard revoke button, API handlers) MUST surface a confirmation warning that names the current USDC.e balance at the address and require explicit "proceed with balance" confirmation if non-zero. The `WITHDRAW_BEFORE_REVOKE` invariant is enforced in UX, not in the port itself — the port will still execute `revoke` even with a non-zero balance (there are legitimate operator-initiated revokes after sweep).

- `authorizeIntent(billingAccountId, intent)`:
  1. `resolve(billingAccountId)` — if `null`, return `{ ok: false, reason: "no_connection" }` (or `"backend_unreachable"` if the underlying cause was Privy).
  2. `SELECT * FROM poly_wallet_grants WHERE billing_account_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 1`. Absent row → `"no_active_grant"`; expired → `"grant_expired"`; revoked → `"grant_revoked"`.
  3. Scope check: `"poly:trade:buy" in grant.scopes` for BUY, `"poly:trade:sell" in grant.scopes` for SELL. Missing → `"scope_missing"`.
  4. `intent.usdcAmount > grant.per_order_usdc_cap` → `"cap_exceeded_per_order"`.
  5. Windowed SELECT `sum(usdc_amount) FROM poly_copy_trade_fills WHERE billing_account_id = $1 AND filled_at > now() - interval '24 hours'`; if `sum + intent.usdcAmount > grant.daily_usdc_cap` → `"cap_exceeded_daily"`.
  6. Windowed SELECT `count(*)` on the same table for the last hour; if `count >= grant.hourly_fills_cap` → `"cap_exceeded_hourly_fills"`.
  7. Mint `AuthorizedSigningContext` by `Object.freeze(Object.assign(context, { grantId, authorizedIntent: intent, [__authorized]: true }))`. Return `{ ok: true, context }`.

- `withdrawUsdc({ billingAccountId, destination, amountAtomic, requestedByUserId })`:
  1. `resolve(billingAccountId)` — throw `WalletUnavailableError` if `null`.
  2. Sanity check: `destination !== context.funderAddress` (no self-transfer round-trips).
  3. `walletClient.writeContract({ address: USDC_E_POLYGON, abi: erc20Abi, functionName: "transfer", args: [destination, amountAtomic] })`.
  4. Log `poly.wallet.withdraw { billing_account_id, connection_id, destination_hash, amount_atomic, tx_hash, requested_by_user_id }`.
  5. Return `{ txHash }`. Gas paid from the tenant's MATIC balance at the funder address. Insufficient gas → surfaced as a typed error the UX layer translates to "Top up MATIC before withdrawing."

- `rotateClobCreds({ billingAccountId })`:
  1. `resolve(billingAccountId)` for the current signer.
  2. Call Polymarket `/auth/api-key` rotation (clob-client's `createOrDeriveApiKey` with rotation flag).
  3. `credentialEnvelope.encrypt` new creds + bump `encryption_key_id`.
  4. `UPDATE poly_wallet_connections SET clob_api_key_ciphertext = ..., encryption_key_id = ...`.
  5. Return a fresh `PolyTraderSigningContext` with the new creds.

### Orphan reconciler (`scripts/ops/sweep-orphan-poly-wallets.ts`, follow-up ops task `task.0348`)

Minimal TypeScript script run on demand (cron comes later):

1. `for await (wallet of privyClient.wallets().list())` — paginate user-wallets app.
2. `SELECT privy_wallet_id FROM poly_wallet_connections WHERE revoked_at IS NULL` — active-set.
3. For each Privy wallet NOT in the active-set **AND** older than 24h **AND** carrying zero USDC.e + zero MATIC: log flag.
4. `--apply` flag deletes the flagged wallets via Privy `DELETE wallet`; default is dry-run.

Output: summary table (total listed / matched / orphans flagged / deleted). Run before + after major provisioning churn; re-run weekly by hand until the scheduled job lands. This is intentionally separate from the v0 trading path.

### What the adapter deliberately does NOT do

- **No on-chain allowance flow.** Approvals (USDC + CTF `setApprovalForAll`) are Phase B3's "onboarding UX" concern. The adapter returns a `LocalAccount`; the onboarding surface uses it to run the existing `scripts/experiments/approve-polymarket-allowances.ts` pattern.
- **No shared-state memoization.** Every `resolve` call re-reads the DB. Upstream may LRU-cache the result keyed on `connectionId`; the port is pure.
- **No emergency cancel.** `authorizeIntent` gates future placements; it does not touch in-flight orders. Emergency cancel is a separate operator-initiated action, out of scope here.

## Schema

The port is backed by the `poly_wallet_connections` table defined in [poly-multi-tenant-auth § Schema](./poly-multi-tenant-auth.md). This spec does not redefine it; it pins the port's read/write contract on that schema.

Relevant columns:

- `billing_account_id` — tenant key
- `privy_wallet_id` — backend reference (Privy server-wallet id)
- `address` — checksummed EOA (funder)
- `clob_api_key_ciphertext` + `encryption_key_id` — encrypted L2 creds
- `created_by_user_id`, `revoked_at`, `revoked_by_user_id` — audit metadata (not RLS keys)
- Unique: one un-revoked row per `billing_account_id`

### RLS policy — pivot through billing-account ownership

Migration `0030_poly_wallet_connections.sql` keys `tenant_isolation` on an `EXISTS`
join through `billing_accounts.owner_user_id` (same shape as `llm_charge_details`), so
the policy is principal-agnostic: whoever the app resolves for `app.current_user_id`
gets access iff they own the referenced `billing_account`. `created_by_user_id` is
pure audit metadata — it records who provisioned the row but is not load-bearing for
isolation.

This is forward-compatible with:

- **Agent / service principals** — when an agent API key authenticates, the app sets
  `app.current_user_id` to the user whose billing account the agent is acting on
  behalf of; the existing EXISTS clause grants access without any migration.
- **Multi-user billing accounts** — swap the EXISTS clause to join through a
  membership table (`billing_account_members`) when it lands. No column change,
  no data backfill.

## Env — separation of system and user-wallet Privy apps

**Load-bearing design decision.** The operator wallet and per-tenant wallets use **separate Privy apps**. The argument is **Privy-side operational isolation**, not intra-cluster blast radius (both apps' API keys live in the same k8s secret store, so a cluster compromise takes both).

1. **Privy-side single-app failure modes.** Privy's rate limits, anomaly-detection triggers, and admin-initiated disables are enforced per-app. If a bug in the AI-fee forwarding code pumps operator txns and Privy rate-limits or disables that app, co-located user wallets die with it. Separating apps bounds that failure to one population.
2. **Per-app audit cleanliness.** Privy's audit log is per-app. System-ops traffic (Splits distribution, OpenRouter top-ups) vs. user-wallet traffic (CLOB order signs, per-tenant provision calls) is clearly separable without custom instrumentation — one app = one operational persona.
3. **Independent rotation cadence.** Rotating the system app's signing key (scheduled AI-fee infrastructure maintenance, incident response for the operator wallet) must not invalidate every user's trading wallet. Two apps = two independent rotation schedules.
4. **Privy product-tier alignment.** Server-wallet volume for user trading and server-wallet volume for operator AI-fee forwarding grow at different rates and may eventually qualify for different Privy plans / SLAs. Pre-separating avoids a forced migration later.
5. **Compliance / custody posture (speculative).** The two populations may take different legal paths — operator is Cogni's own treasury; user wallets may need a distinct custody narrative. Low-probability but cheap to preserve by starting with two apps.

### Env variables (new)

```
# Existing — operator wallet (system tenant). Unchanged.
PRIVY_APP_ID=
PRIVY_APP_SECRET=
PRIVY_SIGNING_KEY=

# New — per-tenant Polymarket trading wallets. Distinct Privy app.
PRIVY_USER_WALLETS_APP_ID=
PRIVY_USER_WALLETS_APP_SECRET=
PRIVY_USER_WALLETS_SIGNING_KEY=
```

Candidate-a + preview + production all get the new `PRIVY_USER_WALLETS_*` triple wired through `scripts/ci/deploy-infra.sh` and the candidate-flight-infra workflow. Dev / `.env.local.example` ships placeholder values. Missing or empty values fail-closed: `PrivyPolyTraderWalletAdapter.resolve` returns `null` and the coordinator skips the tenant.

## Onboarding

Two actor classes provision wallets. The port API is the same for both; the surfaces that invoke it differ.

### User onboarding (dashboard, B3)

Goal: a human going from "I want to mirror a wallet" to "Cogni is trading from my funded Polymarket wallet" in one sitting, without needing to understand Privy, Polymarket, or custody mechanics.

```
Step 1  Connect wallet (card on Poly dashboard)
         ├─ "Cogni will create a Polymarket trading wallet for you."
         └─ [Start setup] →

Step 2  Custodial consent screen (CUSTODIAL_CONSENT)
         ├─ Plain-English disclosure (Privy custody, Cogni-controlled trading,
         │  recovery caveats, withdrawal is always available).
         ├─ Checkbox: "I understand Cogni holds this wallet via Privy."
         └─ [I understand] → persists custodial_consent_accepted_at

Step 3  Backend call: polyTraderWallet.provision({ billingAccountId, createdByUserId })
         ├─ Advisory-locked, idempotent.
         ├─ Server-side only — Privy app secret never touches the browser.
         └─ Returns { funderAddress, connectionId }

Step 4  Fund prompt
         ├─ QR + copy-to-clipboard of the funderAddress.
         ├─ Live USDC.e + MATIC balance poll (dashboard-side).
         ├─ "You need ~$5 USDC.e + ~0.1 MATIC to start."
         └─ When balances cross threshold → auto-advance.

Step 5  Allowance setup
         ├─ One-click: "Authorize Polymarket contracts."
         ├─ Server-side: runs the approve-polymarket-allowances flow with
         │  the tenant's signer (reuses scripts/experiments pattern).
         └─ Receipts surfaced as allowance_state on the connection row.

Step 6  Grant issuance (B4)
         ├─ Default grant auto-created: per-order $2, daily $10,
         │  hourly-fills 20 — operator-safe defaults.
         └─ "You can tighten these in settings."

Step 7  Done state
         ├─ "Your trading wallet is ready."
         └─ Shows funderAddress + current balance + "Withdraw" / "Disconnect" actions.
```

At any point the tenant can **Withdraw**: `polyTraderWallet.withdrawUsdc(...)` sends USDC.e to an external address. **Disconnect** surfaces a warning listing the current balance and explicitly requires withdraw-first if funds are present (`WITHDRAW_BEFORE_REVOKE`).

### Agent onboarding (API, B3)

Goal: an autonomous agent acting for a `billing_account_id` — scheduled workflow, Temporal activity, external integration — can self-provision a Polymarket wallet without a human dashboard session.

```
POST /api/v1/poly/wallet/connect
Authorization: Bearer <agent-api-key bound to billingAccountId>
Body: {
  custodialConsentAcknowledged: true,       // REQUIRED — enforces CUSTODIAL_CONSENT
  custodialConsentActorKind: "agent",       // vs. "user"
  custodialConsentActorId: "<agent-api-key-id>"
}
→ 200 {
  connection_id, funder_address, requires_funding: true, suggested_usdc: 5,
  suggested_matic: 0.1
}
```

- The agent API key must carry the `poly:wallet:provision` scope, minted by a user in the dashboard. Absent the scope → 403.
- `custodialConsentAcknowledged: true` is only valid when the agent's minting user has themselves accepted the disclosure for the account; otherwise 409 with a pointer to the user flow.
- Funding is the agent's operational responsibility (deposit to `funder_address`); the API returns the address and suggested amounts. A polling endpoint `GET /api/v1/poly/wallet/status` reports `{ funded: bool, allowances_set: bool, ready: bool }`.
- Allowances: the agent calls `POST /api/v1/poly/wallet/allowances` once funded. Server-side the same allowance flow runs with the tenant's signer.
- Grant issuance: defaults apply as in the user flow; the agent may tighten via `POST /api/v1/poly/wallet/grants`.

**System-tenant bootstrap**: the same API path seeds `COGNI_SYSTEM_BILLING_ACCOUNT_ID`'s wallet at first boot (migration 0030 does not hard-code a Privy wallet; the system agent provisions it via the same code path as any other tenant). This eliminates "system is special" branches in the provisioning code.

Runbook: `docs/guides/poly-wallet-provisioning.md` ships in B2 covering the user-wallets Privy-app creation + the `PRIVY_USER_WALLETS_*` secrets wiring; `docs/guides/poly-wallet-onboarding.md` ships in B3 covering both flows above.

## Relation to `OperatorWalletPort`

| Axis      | `OperatorWalletPort`                                     | `PolyTraderWalletPort`                                       |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| Surface   | Intent-only (`distributeSplit`, `fundOpenRouterTopUp`)   | Credential-broker (`resolve`, `provision`, `revoke`)         |
| Tenant    | Single system tenant (`COGNI_SYSTEM_BILLING_ACCOUNT_ID`) | Any `billing_account_id`                                     |
| Custody   | One Privy server-wallet, env-configured                  | N Privy server-wallets, DB-tracked per tenant                |
| Privy app | `PRIVY_APP_ID` (system)                                  | `PRIVY_USER_WALLETS_APP_ID` (users)                          |
| Signing   | Not exposed on the port (calldata encoded inside)        | Returned as viem `LocalAccount` for CLOB adapter composition |
| Lifecycle | Provisioned once via `scripts/provision-operator-wallet` | Provisioned per-tenant on first Polymarket opt-in            |

They do not share a base interface and should not be merged. If a future need surfaces for e.g. per-user treasury payouts, the right move is a third narrow port, not a generalized "WalletPort."

## Future adapters

The port is designed to accept additional backends without caller churn:

- **`SafePolyTraderWalletAdapter`** — for the future OSS-hardening task. `resolve` returns a session-key-backed `LocalAccount` instead of a Privy one; `provision` deploys a Safe + grants a scoped session key. The `PolyTraderSigningContext` shape is unchanged.
- **`TurnkeyPolyTraderWalletAdapter`** — plug-compatible alternative if Cogni-DAO later prefers MPC custody.

`poly_wallet_connections` may grow a `backend` column (`CHECK IN ('privy', 'safe_4337', 'turnkey')`) at that point. Today the table is implicitly single-backend (Privy) and the column is not needed.

## Acceptance

| #   | Check                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `PolyTraderWalletPort` interface defined in `packages/poly-wallet/src/port/` with all invariants doc-pinned.                                                                                                                                                                                             |
| 2   | `PrivyPolyTraderWalletAdapter` lives node-local in `nodes/poly/app/src/adapters/server/wallet/` (because it depends on `@cogni/poly-db-schema`) and implements `resolve`, `getAddress`, `provision`, and `revoke`; component tests cover the shipped lifecycle.                                          |
| 3   | **`SEPARATE_PRIVY_APP` enforcement shipped in B2**: the adapter is constructor-injected with a user-wallets `PrivyClient` and signing key, bootstrap loads only `PRIVY_USER_WALLETS_*`, and routes import bootstrap rather than `@/adapters/**` directly.                                                |
| 4   | **Concurrent-provision test**: two simultaneous `provision(tenantA)` calls (promise-level `Promise.all`) return the same `connectionId`; Privy is called exactly once. Validates the advisory-lock contract.                                                                                             |
| 5   | Component test: `provision(tenantA)` + `provision(tenantB)` return distinct `funderAddress`; `resolve(tenantA)` ≠ `resolve(tenantB)`.                                                                                                                                                                    |
| 6   | Component test: calling `provision(tenantA)` sequentially twice returns the same `connectionId` (idempotent, DB-hit-only).                                                                                                                                                                               |
| 7   | Component test: `revoke(tenantA)` → `resolve(tenantA)` returns `null` on the next call; `getAddress(tenantA)` also returns `null`.                                                                                                                                                                       |
| 8   | Component test: CLOB creds round-trip through the AEAD envelope and decrypt to the original `ApiKeyCreds`.                                                                                                                                                                                               |
| 9   | Tenant defense-in-depth test: direct DB tamper setting `billing_account_id` to the wrong tenant → `resolve` logs + returns `null`.                                                                                                                                                                       |
| 10  | **Privy-unreachable fail-closed test**: mock a Privy client that throws on `.create` → `provision` returns the thrown error with no DB row inserted; a second `provision` call succeeds cleanly (advisory lock released on rollback).                                                                    |
| 11  | **Operational runbook**: `docs/guides/poly-wallet-provisioning.md` documents how to create the user-wallets Privy app, populate the three `PRIVY_USER_WALLETS_*` secrets in candidate-a / preview / production, and verify the separation from the operator-wallet app. Link from this spec's § Related. |
| 12  | **`authorizeIntent` grant enforcement tests**: unit tests cover every `AuthorizationFailure` variant — no_connection, no_active_grant, grant_expired, grant_revoked, scope_missing, cap_exceeded_per_order, cap_exceeded_daily, cap_exceeded_hourly_fills.                                               |
| 13  | **Type-level enforcement**: a TS compile-test fixture proves `PolymarketClobAdapter.placeOrder(rawContext)` fails to type-check; only `AuthorizedSigningContext` is accepted.                                                                                                                            |
| 14  | **Orphan reconciler deferred cleanly**: `scripts/ops/sweep-orphan-poly-wallets.ts` is tracked separately in `task.0348` as follow-up ops hygiene. Its absence does not block v0 provisioning or real-credentials trading, but the runtime path must keep orphan creation bounded and sweepable later.    |
| 15  | **Withdraw path tested**: component test + local fake ERC-20 prove `withdrawUsdc` sends USDC.e from the tenant funder to an external destination and emits the expected Pino log.                                                                                                                        |
| 16  | **Custodial consent persisted**: B3 onboarding test asserts `provision` rejects (409) when `custodial_consent_accepted_at` is NULL; accepts when set.                                                                                                                                                    |
| 17  | **User + agent onboarding paths both exercised**: B3 ships integration tests for (a) the dashboard flow through step 7, (b) the API path with an agent-bound key.                                                                                                                                        |
| 18  | **`rotateClobCreds` callable**: interface method shipped in B2, covered by a unit test that mocks the Polymarket rotation endpoint. Scheduled rotation cadence tracked as a separate ops task.                                                                                                           |

## Related

- [operator-wallet](./operator-wallet.md) — system-role wallet; **not** generalized
- [poly-multi-tenant-auth](./poly-multi-tenant-auth.md) — tenant-isolation contract + schema
- [tenant-connections](./tenant-connections.md) — AEAD envelope reused here
- [packages-architecture](./packages-architecture.md) — capability-package shape
- [operator-wallet adapter](../../packages/operator-wallet/src/adapters/privy/privy-operator-wallet.adapter.ts) — reference implementation for the Privy SDK usage patterns (wallet lookup, `createViemAccount`, signing-key authorization)
