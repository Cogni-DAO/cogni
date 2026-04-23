// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-wallet/port`
 * Purpose: Defines the per-tenant Polymarket CLOB signing-context port (credential broker + grant-aware intent authorization + intent-typed withdraw), backend-agnostic.
 * Scope: Interface + types only. Does not contain runtime, lifecycle, or env reads; adapters live under `src/adapters/*`.
 * Invariants:
 *   - TENANT_SCOPED — every method takes a `billingAccountId`.
 *   - NO_GENERIC_SIGNING — no `signMessage(bytes)` / `signTransaction(calldata)` surface.
 *   - KEY_NEVER_IN_APP — adapters never hold raw private key material in the app process.
 *   - FAIL_CLOSED_ON_RESOLVE — `resolve` returns `null` (never a stub) on failure.
 *   - AUTHORIZED_SIGNING_ONLY — `PolymarketClobAdapter.placeOrder` accepts the
 *     branded `AuthorizedSigningContext`, not the raw one. Scope/cap bypass is a
 *     compile error.
 *   - SEPARATE_PRIVY_APP — adapters for Privy backends MUST read the
 *     user-wallets Privy app creds (`PRIVY_USER_WALLETS_*`), never the
 *     operator-wallet app creds (`PRIVY_APP_*`).
 * Side-effects: none (interface definition only)
 * Links: docs/spec/poly-trader-wallet-port.md, docs/spec/poly-multi-tenant-auth.md,
 *        work/items/task.0318.poly-wallet-multi-tenant-auth.md
 * @public
 */

import type { LocalAccount } from "viem";

/**
 * Polymarket CLOB L2 API credentials.
 * Shape mirrors `@polymarket/clob-client`'s `ApiKeyCreds`; duplicated here so
 * this package stays clob-client-free (callers construct the adapter with the
 * returned creds).
 */
export interface PolyClobApiKeyCreds {
  readonly key: string;
  readonly secret: string;
  readonly passphrase: string;
}

/**
 * Minimal order-intent summary the port needs to enforce scopes + caps.
 * Duplicated on purpose from the trading module's richer `OrderIntent` so this
 * package stays free of CLOB-specific trading types.
 */
export interface OrderIntentSummary {
  readonly side: "BUY" | "SELL";
  /** Decimal USDC amount, not atomic units. */
  readonly usdcAmount: number;
  readonly marketConditionId: string;
}

/**
 * Signing context for a single tenant's Polymarket CLOB trading.
 * All fields are returned together because any caller that needs one always
 * needs the others.
 *
 * The viem `LocalAccount` coupling is intentional: `@polymarket/clob-client`
 * consumes viem signers natively, and every plausible backend terminates at a
 * viem-shaped account. If a future backend cannot produce one, the port
 * evolves — not a leak to pre-emptively abstract.
 */
export interface PolyTraderSigningContext {
  readonly account: LocalAccount;
  readonly clobCreds: PolyClobApiKeyCreds;
  /** Checksummed funder address; MUST equal `account.address` for `SignatureType.EOA`. */
  readonly funderAddress: `0x${string}`;
  /** Opaque correlation id; 1:1 with `poly_wallet_connections.id`. */
  readonly connectionId: string;
}

/**
 * Brand preventing untyped contexts from reaching `placeOrder`.
 * Only `authorizeIntent` returns an `AuthorizedSigningContext`.
 */
declare const __authorizedBrand: unique symbol;

export type AuthorizedSigningContext = PolyTraderSigningContext & {
  readonly [__authorizedBrand]: true;
  /** `poly_wallet_grants.id` that authorized this intent. */
  readonly grantId: string;
  /** The exact intent the grant was checked against; placeOrder MUST NOT mutate. */
  readonly authorizedIntent: OrderIntentSummary;
};

/**
 * Reason `authorizeIntent` returned `{ ok: false, ... }`.
 * Logged at the adapter boundary; coordinator writes a
 * `poly.mirror.decision reason=<value>` observability row.
 */
export type AuthorizationFailure =
  | "no_connection"
  | "trading_not_ready"
  | "no_active_grant"
  | "grant_expired"
  | "grant_revoked"
  | "scope_missing"
  | "cap_exceeded_per_order"
  | "cap_exceeded_daily"
  | "cap_exceeded_hourly_fills"
  | "backend_unreachable";

export type AuthorizeIntentResult =
  | { readonly ok: true; readonly context: AuthorizedSigningContext }
  | { readonly ok: false; readonly reason: AuthorizationFailure };

/**
 * Kind of a single Polymarket on-chain approval step. One row per target
 * contract × operator pair; shape is intentionally flat so the UI can render
 * progress pills without cross-referencing a lookup table.
 */
export type TradingApprovalStepKind =
  | "erc20_approve"
  | "ctf_set_approval_for_all";

export type TradingApprovalStepState =
  /** Before run: target was already at MaxUint256 / approved. Written as-is. */
  | "satisfied"
  /** After run: we submitted a tx and confirmed the post-state. */
  | "set"
  /** After run: submit or confirm failed. `txHash` may be null or present. */
  | "failed"
  /** Pre-run gate rejected (e.g. insufficient POL gas). No tx submitted. */
  | "skipped";

export interface TradingApprovalStep {
  readonly kind: TradingApprovalStepKind;
  /** Human-readable label. Example: `"USDC.e → Exchange"`. */
  readonly label: string;
  /** The token contract being approved from (USDC.e or CTF). */
  readonly tokenContract: `0x${string}`;
  /** The spender / operator being authorized. */
  readonly operator: `0x${string}`;
  readonly state: TradingApprovalStepState;
  /** Present when a tx was submitted; null otherwise. */
  readonly txHash: `0x${string}` | null;
  /** Populated on `failed` / `skipped`. Short constant-ish code + reason. */
  readonly error: string | null;
}

/**
 * Outcome of `ensureTradingApprovals`. Idempotent: safe to call repeatedly.
 * Shape is JSON-friendly so the route can serialize it directly.
 */
export interface TradingApprovalsState {
  /** True iff all 6 targets ended the run at `satisfied` | `set`. */
  readonly ready: boolean;
  readonly address: `0x${string}`;
  /** Decimal POL balance used for gas. `null` when RPC unconfigured. */
  readonly polBalance: number | null;
  readonly steps: readonly TradingApprovalStep[];
  /** ISO timestamp when `trading_approvals_ready_at` was stamped; null if not. */
  readonly readyAt: Date | null;
}

/**
 * Reason `ensureTradingApprovals` could not even start. Thrown (not returned
 * as a step error) so the route returns a structured 4xx/5xx body.
 */
export type EnableTradingPreflightError =
  | "no_connection"
  | "polygon_rpc_unconfigured"
  | "backend_unreachable";

/**
 * CUSTODIAL_CONSENT envelope. Every `provision` call MUST carry an explicit
 * consent record; the adapter persists it on the row as an audit trail.
 *
 * The HTTP contract (`@cogni/node-contracts/poly.wallet.connection.v1`)
 * validates the client-supplied fields (`actorKind`, `actorId`,
 * `acknowledged`); the route adds a server-stamped `acceptedAt` before
 * handing the merged shape to this port. That's the right split:
 *   - Zod = wire-boundary trust (HTTP payload).
 *   - TS  = internal contract between app and adapter (this port).
 *
 * v0 narrows `actorKind` to `"user"` at the HTTP contract; this type keeps
 * the DB-shape union (`"user" | "agent"`) so widening to agent-API-key auth
 * later is a contract-only change, no port migration.
 */
export interface CustodialConsent {
  /** Server-stamped at the time the route handler received the request. */
  readonly acceptedAt: Date;
  /** Matches `poly_wallet_connections.custodial_consent_actor_kind`. */
  readonly actorKind: "user" | "agent";
  /** Matches `poly_wallet_connections.custodial_consent_actor_id`. */
  readonly actorId: string;
}

/**
 * Per-tenant signing context for Polymarket CLOB trading.
 * See `docs/spec/poly-trader-wallet-port.md` for the full contract.
 */
export interface PolyTraderWalletPort {
  /**
   * Resolve the active signing context for a tenant.
   * Returns `null` fail-closed on missing / revoked / backend-unreachable.
   * Callers: read-only surfaces (balance checks, agent-status endpoints).
   * Trading flows MUST go through `authorizeIntent` instead.
   */
  resolve(billingAccountId: string): Promise<PolyTraderSigningContext | null>;

  /**
   * Read-only lookup of the funder address.
   * No Privy call, no decryption. Cheap enough for every page render.
   */
  getAddress(billingAccountId: string): Promise<`0x${string}` | null>;

  /**
   * Read-only summary of the tenant's active connection — connection id,
   * funder address, and the APPROVALS_BEFORE_PLACE readiness stamp.
   * DB-only (no Privy, no RPC, no decryption) so the Money / Profile pages
   * can render the "Enable Trading" / "✓ Trading enabled" state on every
   * load without a round-trip. Returns `null` when no active connection
   * exists for the tenant (PROVISION_FIRST).
   */
  getConnectionSummary(billingAccountId: string): Promise<{
    readonly connectionId: string;
    readonly funderAddress: `0x${string}`;
    readonly tradingApprovalsReadyAt: Date | null;
  } | null>;

  /**
   * Read-only on-chain balance snapshot for the tenant's trading wallet on
   * Polygon: native POL gas + USDC.e (`0x2791Bca1…`, the Polymarket quote
   * token). Returns `null` when no connection row exists for the tenant
   * (PROVISION_FIRST). A connection that exists but partially fails RPC
   * reads returns partial values with `errors[]` populated, never throws —
   * matches the fail-soft contract of `resolve()` for read surfaces.
   *
   * This is a pure read method: no signing, no Privy call, no decryption.
   * The adapter MAY use the backend custody API to learn the address but
   * SHOULD prefer a DB-only lookup (same as `getAddress`) for page-render
   * performance. No grant check — callers are read-only UIs.
   */
  getBalances(billingAccountId: string): Promise<{
    readonly address: `0x${string}`;
    /** Decimal USDC.e. `null` when the RPC read failed. */
    readonly usdcE: number | null;
    /** Decimal native POL. `null` when the RPC read failed. */
    readonly pol: number | null;
    readonly errors: readonly string[];
  } | null>;

  /**
   * Provision a brand-new wallet for a tenant.
   * Idempotent under concurrency via a Postgres advisory lock on
   * `billing_account_id` + a deterministic idempotency key on the backend
   * custody call, so a crash mid-provision converges on the same backend
   * wallet on retry (PROVISION_NO_ORPHAN).
   *
   * `custodialConsent` is REQUIRED — the port enforces the
   * `CUSTODIAL_CONSENT` invariant at the type level so callers can't forget
   * it. The route is the authoritative gate (validates the HTTP contract +
   * stamps `acceptedAt`); the port type makes consent a compile-time
   * obligation for every implementation.
   *
   * External deps at provision time: backend custody API (Privy) AND
   * Polymarket CLOB `/auth/api-key`. Either unreachable → throws; callers
   * retry.
   */
  provision(input: {
    billingAccountId: string;
    createdByUserId: string;
    custodialConsent: CustodialConsent;
  }): Promise<PolyTraderSigningContext>;

  /**
   * Mark a connection revoked. Halt-future-only; in-flight orders complete.
   * Does NOT delete the backend wallet or sweep funds. Next `provision`
   * creates a new connection with a new address.
   */
  revoke(input: {
    billingAccountId: string;
    revokedByUserId: string;
  }): Promise<void>;

  /**
   * Resolve + grant-check in one call. The only source of
   * `AuthorizedSigningContext`, which `placeOrder` requires.
   */
  authorizeIntent(
    billingAccountId: string,
    intent: OrderIntentSummary
  ): Promise<AuthorizeIntentResult>;

  /**
   * Move USDC.e from the tenant's trading wallet to an external address.
   * Intent-typed (token locked to USDC.e on Polygon for v0); the adapter
   * encodes the ERC-20 `transfer` calldata so the port's `NO_GENERIC_SIGNING`
   * invariant is preserved.
   */
  withdrawUsdc(input: {
    billingAccountId: string;
    destination: `0x${string}`;
    /** Atomic units (USDC.e has 6 decimals). */
    amountAtomic: bigint;
    requestedByUserId: string;
  }): Promise<{ txHash: `0x${string}` }>;

  /**
   * Rotate the Polymarket CLOB L2 API credentials for a tenant.
   * Wallet address and backend-wallet id are unchanged.
   * Scheduled-rotation cadence is a separate ops task.
   */
  rotateClobCreds(input: {
    billingAccountId: string;
  }): Promise<PolyTraderSigningContext>;

  /**
   * Idempotently drive the tenant's trading wallet to "ready to trade" by
   * running the six Polymarket onboarding approvals:
   *   - USDC.e `approve(MaxUint256)` on Exchange, Neg-Risk Exchange,
   *     Neg-Risk Adapter (enables BUY)
   *   - CTF `setApprovalForAll(true)` on Exchange + Neg-Risk Exchange +
   *     Neg-Risk Adapter (enables SELL on neg_risk, including close)
   *
   * On full success, stamps `poly_wallet_connections.trading_approvals_ready_at`
   * so subsequent calls no-op and `authorizeIntent`'s `APPROVALS_BEFORE_PLACE`
   * gate opens.
   *
   * Pre-flight: requires the tenant to have a non-revoked connection AND at
   * least `polMinAtomic` native POL on Polygon for gas; short-balance returns
   * `{ ready: false, steps: all-skipped, error: "insufficient_pol_gas" }`
   * without submitting any tx. Any step failure stops the sequence and the
   * DB stamp is NOT written — safe to retry.
   *
   * Throws `EnableTradingPreflightError` ONLY when the call can't start
   * (no connection, RPC unconfigured, backend unreachable). Step-level
   * failures surface inside the returned `steps[]` array.
   */
  ensureTradingApprovals(
    billingAccountId: string
  ): Promise<TradingApprovalsState>;
}
