// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/wallet/privy-poly-trader-wallet.adapter`
 * Purpose: Privy-backed PolyTraderWalletPort implementation. Manages per-tenant
 *   Polymarket trading wallets by delegating custody to a DEDICATED user-wallets
 *   Privy app (SEPARATE_PRIVY_APP) — never the operator-wallet system app.
 * Scope: `provisionWithGrant` (atomic wallet + default-grant write under an
 *   advisory-lock, idempotent across retries), `resolve`, `getAddress`,
 *   `getBalances` (DB address + optional Polygon RPC via `POLYGON_RPC_URL`
 *   for USDC.e + POL display on the Money page), `authorizeIntent` (trading-
 *   readiness + scope + cap + active-grant checks; mints the branded
 *   `AuthorizedSigningContext`), `withdraw` (typed USDC.e / pUSD unwrap / POL
 *   withdrawals), `ensureTradingApprovals` (idempotent 6-step
 *   Polymarket onboarding: 3× USDC.e `approve` + 3× CTF `setApprovalForAll`
 *   signed by Privy HSM; stamps the `trading_approvals_ready_at` readiness
 *   column on success), `revoke` (cascades across `poly_wallet_grants` in
 *   the same tx + clears `trading_approvals_ready_at` so the next connection
 *   re-runs the approvals flow).
 *   `rotateClobCreds` remains stubbed until the CLOB-rotation item lands.
 * Invariants:
 *   - SEPARATE_PRIVY_APP: constructor takes a PrivyClient built from
 *     PRIVY_USER_WALLETS_* env. The operator-wallet triple is never read here.
 *   - TENANT_SCOPED: every method takes or derives `billingAccountId`.
 *   - KEY_NEVER_IN_APP: raw *EOA private keys* are never held in app memory —
 *     Privy HSM owns signing material. The Privy-app *authorization private key*
 *     (`privySigningKey`) is required in process to authenticate signing calls
 *     to Privy; this is a different key with a different threat model (losing
 *     it locks the app out of its own user-wallets app, it does not leak user
 *     EOAs). Do not confuse the two.
 *   - FAIL_CLOSED_ON_RESOLVE: returns null on any error.
 *   - TENANT_DEFENSE_IN_DEPTH: post-SELECT equality check on billing_account_id.
 *   - CREDS_ENCRYPTED_AT_REST: clobApiKeyCiphertext is AEAD(aes-256-gcm) with
 *     AAD bound to (billing_account_id, connection_id, provider).
 *   - PROVISION_IS_IDEMPOTENT: pg_advisory_xact_lock on hashtext(billing_account_id)
 *     serializes concurrent attempts; a deterministic `idempotencyKey` passed
 *     to Privy `wallets().create` makes retries converge on the same backend
 *     wallet so crash-mid-provision cannot create orphans (see PROVISION_NO_ORPHAN).
 *   - PROVISION_NO_ORPHAN: idempotency key formula
 *     `poly-wallet:${billing_account_id}:${generation}` where
 *     `generation = count(all rows for tenant) + 1` (includes revoked rows,
 *     so monotonic across revoke cycles). Retries converge; a new provision
 *     after revoke gets a fresh wallet by incrementing generation.
 *   - AUTHORIZED_SIGNING_ONLY: `authorizeIntent` is the ONLY producer of the
 *     branded `AuthorizedSigningContext`. `PolymarketClobAdapter.placeOrder`
 *     requires the brand — no cap/scope check can be bypassed by constructing
 *     a context elsewhere.
 *   - REVOKE_CASCADES_FROM_CONNECTION: `revoke(billingAccountId)` flips
 *     `poly_wallet_connections.revoked_at` AND every grant row whose
 *     `wallet_connection_id` matches, inside the same transaction. Next
 *     `authorizeIntent` fails with `no_active_grant`. Same transaction also
 *     clears `trading_approvals_ready_at` so a re-provision starts un-approved.
 *   `rotateClobCreds` deletes the current Polymarket L2 API key, creates a
 *   fresh one for the same tenant wallet, and updates only the encrypted
 *   credential envelope.
 *   `withdraw` is intentionally typed and limited to pinned Polygon assets.
 *   - APPROVALS_BEFORE_PLACE: `authorizeIntent` reads
 *     `trading_approvals_ready_at` AFTER the active-grant check and fails
 *     closed with `trading_not_ready` when null. Prevents silent CLOB
 *     empty-rejects on freshly-funded wallets that haven't run the 6
 *     Polymarket on-chain approvals yet. The stamp is only written by
 *     `ensureTradingApprovals` after every target reaches MaxUint256 /
 *     approved on-chain, verified at the submission block.
 *   - APPROVAL_TARGETS_PINNED: the 3 USDC.e spenders + 3 CTF operators are
 *     Polymarket mainnet addresses HARDCODED in this module. No env, no
 *     user input. Matches `scripts/experiments/approve-polymarket-allowances.ts`.
 * Side-effects: IO (Privy API, DB reads/writes, AEAD crypto).
 * Links: docs/spec/poly-trader-wallet-port.md,
 *        docs/spec/poly-multi-tenant-auth.md
 * @internal
 */

import type { Database } from "@cogni/db-client";
import { type AeadAAD, aeadDecrypt, aeadEncrypt } from "@cogni/node-shared";
import {
  polyCopyTradeFills,
  polyWalletConnections,
  polyWalletGrants,
} from "@cogni/poly-db-schema";
import type {
  AuthorizationFailure,
  AuthorizedSigningContext,
  AuthorizeIntentResult,
  CustodialConsent,
  EnableTradingPreflightError,
  OrderIntentSummary,
  PolyClobApiKeyCreds,
  PolyTraderSigningContext,
  PolyTraderWalletPort,
  PolyWalletWithdrawalInput,
  PolyWalletWithdrawalResult,
  TradingApprovalStep,
  TradingApprovalsState,
  WrapIdleUsdcEResult,
} from "@cogni/poly-wallet";
import { getContractConfig as clobV2GetContractConfig } from "@polymarket/clob-client-v2";
import type { AuthorizationContext, PrivyClient } from "@privy-io/node";
import { createViemAccount } from "@privy-io/node/viem";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  sql,
  sum,
} from "drizzle-orm";
import type { Logger } from "pino";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  getAddress,
  type Hex,
  http,
  type LocalAccount,
  maxUint256,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from "viem";
import { polygon } from "viem/chains";
import { EVENT_NAMES } from "@/shared/observability/events";

/** Provider identifier pinned into the AEAD AAD envelope. */
const CREDENTIAL_PROVIDER = "polymarket_clob";

/** USDC.e on Polygon mainnet — Polymarket's quote token. Pinned here so the */
/* adapter never has to guess which stable it's reading. */
const USDC_E_POLYGON = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as Address;
const USDC_DECIMALS = 6;
const POL_DECIMALS = 18;
const ERC20_BALANCEOF_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

const POLYMARKET_CONTRACTS = clobV2GetContractConfig(polygon.id);
const CTF_POLYGON = POLYMARKET_CONTRACTS.conditionalTokens as Address;
const EXCHANGE_POLYMARKET = POLYMARKET_CONTRACTS.exchangeV2 as Address;
const NEG_RISK_EXCHANGE_POLYMARKET =
  POLYMARKET_CONTRACTS.negRiskExchangeV2 as Address;
const NEG_RISK_ADAPTER_POLYMARKET =
  POLYMARKET_CONTRACTS.negRiskAdapter as Address;
const PUSD_POLYGON = POLYMARKET_CONTRACTS.collateral as Address;
const COLLATERAL_ONRAMP_POLYGON =
  "0x93070a847efEf7F70739046A929D47a521F5B8ee" as Address;
const COLLATERAL_OFFRAMP_POLYGON =
  "0x2957922Eb93258b93368531d39fAcCA3B4dC5854" as Address;

const USDC_E_ONRAMP_SPENDER = {
  label: "USDC.e → Onramp",
  address: COLLATERAL_ONRAMP_POLYGON,
} as const satisfies { label: string; address: Address };

const USDC_E_SPENDERS: readonly { label: string; address: Address }[] = [
  USDC_E_ONRAMP_SPENDER,
];

const PUSD_SPENDERS: readonly { label: string; address: Address }[] = [
  { label: "pUSD → Exchange (V2)", address: EXCHANGE_POLYMARKET },
  {
    label: "pUSD → Neg-Risk Exchange (V2)",
    address: NEG_RISK_EXCHANGE_POLYMARKET,
  },
  { label: "pUSD → Neg-Risk Adapter", address: NEG_RISK_ADAPTER_POLYMARKET },
];

const CTF_OPERATORS: readonly { label: string; address: Address }[] = [
  { label: "CTF → Exchange (V2)", address: EXCHANGE_POLYMARKET },
  {
    label: "CTF → Neg-Risk Exchange (V2)",
    address: NEG_RISK_EXCHANGE_POLYMARKET,
  },
  { label: "CTF → Neg-Risk Adapter", address: NEG_RISK_ADAPTER_POLYMARKET },
];

const COLLATERAL_ONRAMP_WRAP_ABI = parseAbi([
  "function wrap(address asset, address to, uint256 amount)",
]);
const COLLATERAL_OFFRAMP_UNWRAP_ABI = parseAbi([
  "function unwrap(address asset, address to, uint256 amount)",
]);

const CTF_SET_APPROVAL_ABI = parseAbi([
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
]);

/**
 * Minimum POL balance required before we start submitting approval txs.
 * 0.02 was historically tried and is too low — Polygon gas-price spikes
 * can fail the 6-tx enable sequence at 0.02, and even on a quiet block
 * it leaves no real trading headroom. 0.1 covers the enable sequence
 * plus meaningful post-enable trading runway.
 */
const ENABLE_TRADING_MIN_POL = 0.1;

/**
 * Default scopes auto-issued alongside every new wallet. BUY + SELL so the
 * mirror pipeline's closePosition path can execute from day one. Today this
 * is an app-issued default for the tenant's active connection; user-managed
 * downscoping and delegated actor grants are future product work.
 */
const DEFAULT_GRANT_SCOPES = ["poly:trade:buy", "poly:trade:sell"] as const;

/**
 * Fills-per-hour rate limit baked into every default grant. Not surfaced in
 * the consent UI (the plan intentionally narrows the slider set to per-order
 * + daily USDC only, per `.cursor/plans/poly-per-tenant-trade-execution_92073c70.plan.md`).
 * Kept high for dev / stress testing; existing tenant rows keep their stored cap.
 */
const DEFAULT_GRANT_HOURLY_FILLS_CAP = 10_000;

/**
 * Fill statuses that commit (or already committed) USDC to the exchange. Used
 * by the authorize-intent daily / hourly cap windows so two concurrent pending
 * orders cannot race past the cap (the canonical bug that "count only filled"
 * exhibits). `canceled` + `error` are excluded — no USDC attached.
 */
const IN_FLIGHT_FILL_STATUSES = [
  "pending",
  "open",
  "filled",
  "partial",
] as const;

/**
 * Grant caps the consent UI collects. The HTTP contract validates bounds
 * (per-order 0.50..20, daily 2..200) before the route hands them here; the
 * DB CHECK enforces `daily >= per_order` as a backstop.
 */
export interface DefaultGrantInput {
  readonly perOrderUsdcCap: number;
  readonly dailyUsdcCap: number;
}

/**
 * Drizzle's transaction handle is structurally the same as `Database` for
 * the CRUD surface we use (select / insert / update / execute) but omits
 * the postgres.js `$client` pool accessor. `Omit` the optional piece so
 * `provisionInsideTx` accepts both a top-level `Database` call and a
 * `.transaction((tx) => …)` handle.
 */
type TxOrDb = Omit<Database, "$client" | "transaction">;

type ResolveSigningContextFailureReason =
  | "no_connection"
  | "tenant_mismatch"
  | "clob_creds_invalid"
  | "wallet_account_unavailable"
  | "backend_unreachable";

type ResolveSigningContextResult =
  | { ok: true; context: PolyTraderSigningContext }
  | {
      ok: false;
      reason: ResolveSigningContextFailureReason;
      connectionId?: string;
    };

export interface PrivyPolyTraderWalletAdapterConfig {
  /**
   * Privy client bound to the USER-WALLETS app. MUST be constructed from
   * PRIVY_USER_WALLETS_APP_ID / _APP_SECRET — never the operator-wallet app.
   * Construction happens in the caller (bootstrap/container) so the adapter
   * stays env-free.
   */
  privyClient: PrivyClient;
  /** Signing key for the user-wallets Privy app (authorization_private_keys). */
  privySigningKey: string;
  /** BYPASSRLS service DB handle — this adapter does cross-tenant reads. */
  serviceDb: Database;
  /** AEAD envelope key + ring id, 32 bytes for AES-256-GCM. */
  encryptionKey: Buffer;
  encryptionKeyId: string;
  /**
   * Factory that derives Polymarket CLOB L2 creds for a given signer.
   * Injected so this package never imports @polymarket/clob-client directly.
   *
   * v0 placeholder: bootstrap may pass a stub that returns synthetic creds
   * (for plumbing verification on candidate-a). Real derivation swaps in
   * under a follow-up commit that wires @polymarket/clob-client.
   */
  clobCredsFactory: (signer: LocalAccount) => Promise<PolyClobApiKeyCreds>;
  /** Factory that deletes the active CLOB L2 API key and returns fresh creds. */
  clobCredsRotator?: (
    signer: LocalAccount,
    currentCreds: PolyClobApiKeyCreds
  ) => Promise<PolyClobApiKeyCreds>;
  /**
   * Polygon RPC URL used by `getBalances`. Optional: when absent, `getBalances`
   * returns the address with `null` USDC.e/POL and an RPC-unconfigured error
   * instead of failing hard — keeps the Money page legible on pods that
   * haven't wired Polygon RPC yet.
   */
  polygonRpcUrl?: string | undefined;
  logger: Logger;
}

export class PrivyPolyTraderWalletAdapter implements PolyTraderWalletPort {
  private readonly privyClient: PrivyClient;
  private readonly authorizationContext: AuthorizationContext;
  private readonly serviceDb: Database;
  private readonly encryptionKey: Buffer;
  private readonly encryptionKeyId: string;
  private readonly clobCredsFactory: (
    signer: LocalAccount
  ) => Promise<PolyClobApiKeyCreds>;
  private readonly clobCredsRotator: (
    signer: LocalAccount,
    currentCreds: PolyClobApiKeyCreds
  ) => Promise<PolyClobApiKeyCreds>;
  private readonly polygonRpcUrl: string | undefined;
  private readonly log: Logger;

  constructor(config: PrivyPolyTraderWalletAdapterConfig) {
    this.privyClient = config.privyClient;
    this.authorizationContext = {
      authorization_private_keys: [config.privySigningKey],
    };
    this.serviceDb = config.serviceDb;
    this.encryptionKey = config.encryptionKey;
    this.encryptionKeyId = config.encryptionKeyId;
    this.clobCredsFactory = config.clobCredsFactory;
    this.clobCredsRotator =
      config.clobCredsRotator ??
      (async () => {
        throw new Error("PrivyPolyTraderWalletAdapter: CLOB rotator missing");
      });
    this.polygonRpcUrl = config.polygonRpcUrl;
    this.log = config.logger.child({
      component: "PrivyPolyTraderWalletAdapter",
    });
  }

  async resolve(
    billingAccountId: string
  ): Promise<PolyTraderSigningContext | null> {
    const result = await this.resolveSigningContext(billingAccountId);
    if (result.ok) return result.context;
    this.logResolveFailure(billingAccountId, result);
    return null;
  }

  private async resolveSigningContext(
    billingAccountId: string
  ): Promise<ResolveSigningContextResult> {
    let rows: (typeof polyWalletConnections.$inferSelect)[];
    try {
      rows = await this.serviceDb
        .select()
        .from(polyWalletConnections)
        .where(
          and(
            eq(polyWalletConnections.billingAccountId, billingAccountId),
            isNull(polyWalletConnections.revokedAt)
          )
        )
        .limit(1);
    } catch {
      return { ok: false, reason: "backend_unreachable" };
    }

    const row = rows[0];
    if (!row) return { ok: false, reason: "no_connection" };

    // TENANT_DEFENSE_IN_DEPTH
    if (row.billingAccountId !== billingAccountId) {
      return { ok: false, reason: "tenant_mismatch", connectionId: row.id };
    }

    let clobCreds: PolyClobApiKeyCreds;
    try {
      clobCreds = this.decryptCreds(row.clobApiKeyCiphertext, {
        billing_account_id: row.billingAccountId,
        connection_id: row.id,
        provider: CREDENTIAL_PROVIDER,
      });
    } catch {
      return {
        ok: false,
        reason: "clob_creds_invalid",
        connectionId: row.id,
      };
    }

    let account: LocalAccount;
    try {
      const rawAccount = createViemAccount(this.privyClient, {
        walletId: row.privyWalletId,
        address: row.address as `0x${string}`,
        authorizationContext: this.authorizationContext,
      });
      // viem version drift between @privy-io/node/viem peerDep and this app's
      // viem forces a cast (runtime shape matches LocalAccount exactly — same
      // pattern as poly-trade.ts:696-700).
      // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
      account = rawAccount as any;
    } catch {
      return {
        ok: false,
        reason: "wallet_account_unavailable",
        connectionId: row.id,
      };
    }

    return {
      ok: true,
      context: {
        account,
        clobCreds,
        funderAddress: getAddress(row.address),
        connectionId: row.id,
      },
    };
  }

  private logResolveFailure(
    billingAccountId: string,
    result: Exclude<ResolveSigningContextResult, { ok: true }>
  ): void {
    if (result.reason === "no_connection") return;
    this.log.error(
      {
        event: EVENT_NAMES.ADAPTER_POLY_WALLET_RESOLVE_ERROR,
        dep: "poly_wallet_connections",
        billing_account_id: billingAccountId,
        connection_id: result.connectionId ?? null,
        reasonCode: result.reason,
      },
      EVENT_NAMES.ADAPTER_POLY_WALLET_RESOLVE_ERROR
    );
  }

  private errorForResolveFailure(
    result: Exclude<ResolveSigningContextResult, { ok: true }>
  ): Error & {
    code: EnableTradingPreflightError;
    connectionId?: string;
  } {
    if (result.reason === "no_connection") {
      return Object.assign(
        new Error(
          "ensureTradingApprovals: no active connection for tenant — provision first"
        ),
        { code: "no_connection" as const }
      );
    }
    const error = Object.assign(
      new Error(`ensureTradingApprovals preflight failed: ${result.reason}`),
      { code: result.reason as EnableTradingPreflightError }
    );
    if (result.connectionId) {
      return Object.assign(error, { connectionId: result.connectionId });
    }
    return error;
  }

  async getAddress(billingAccountId: string): Promise<`0x${string}` | null> {
    const rows = await this.serviceDb
      .select({
        id: polyWalletConnections.id,
        billingAccountId: polyWalletConnections.billingAccountId,
        address: polyWalletConnections.address,
      })
      .from(polyWalletConnections)
      .where(
        and(
          eq(polyWalletConnections.billingAccountId, billingAccountId),
          isNull(polyWalletConnections.revokedAt)
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    if (row.billingAccountId !== billingAccountId) {
      this.log.warn(
        { billing_account_id: billingAccountId, connection_id: row.id },
        "tenant mismatch on getAddress — refusing"
      );
      return null;
    }
    return getAddress(row.address);
  }

  async getConnectionSummary(billingAccountId: string): Promise<{
    connectionId: string;
    funderAddress: `0x${string}`;
    tradingApprovalsReadyAt: Date | null;
    autoWrapConsentAt: Date | null;
    autoWrapFloorUsdceAtomic: bigint;
  } | null> {
    const rows = await this.serviceDb
      .select({
        id: polyWalletConnections.id,
        billingAccountId: polyWalletConnections.billingAccountId,
        address: polyWalletConnections.address,
        tradingApprovalsReadyAt: polyWalletConnections.tradingApprovalsReadyAt,
        autoWrapConsentAt: polyWalletConnections.autoWrapConsentAt,
        autoWrapRevokedAt: polyWalletConnections.autoWrapRevokedAt,
        autoWrapFloorUsdceE6dp: polyWalletConnections.autoWrapFloorUsdceE6dp,
      })
      .from(polyWalletConnections)
      .where(
        and(
          eq(polyWalletConnections.billingAccountId, billingAccountId),
          isNull(polyWalletConnections.revokedAt)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.billingAccountId !== billingAccountId) {
      this.log.warn(
        { billing_account_id: billingAccountId, connection_id: row.id },
        "tenant mismatch on getConnectionSummary — refusing"
      );
      return null;
    }
    return {
      connectionId: row.id,
      funderAddress: getAddress(row.address),
      tradingApprovalsReadyAt: row.tradingApprovalsReadyAt,
      autoWrapConsentAt:
        row.autoWrapRevokedAt === null ? row.autoWrapConsentAt : null,
      autoWrapFloorUsdceAtomic: row.autoWrapFloorUsdceE6dp,
    };
  }

  async getBalances(billingAccountId: string): Promise<{
    address: `0x${string}`;
    usdcE: number | null;
    pusd: number | null;
    pol: number | null;
    errors: readonly string[];
  } | null> {
    const address = await this.getAddress(billingAccountId);
    if (!address) return null;

    const errors: string[] = [];
    const [usdcE, pusd, pol] = await this.readPolygonBalances(address, errors);
    return { address, usdcE, pusd, pol, errors };
  }

  private async readPolygonBalances(
    addr: `0x${string}`,
    errors: string[]
  ): Promise<[number | null, number | null, number | null]> {
    if (!this.polygonRpcUrl) {
      errors.push("polygon_rpc_unconfigured");
      return [null, null, null];
    }
    try {
      const client = createPublicClient({
        chain: polygon,
        transport: http(this.polygonRpcUrl),
      });
      const [usdcERaw, pusdRaw, polRaw] = await Promise.all([
        client.readContract({
          address: USDC_E_POLYGON,
          abi: ERC20_BALANCEOF_ABI,
          functionName: "balanceOf",
          args: [addr],
        }),
        client.readContract({
          address: PUSD_POLYGON,
          abi: ERC20_BALANCEOF_ABI,
          functionName: "balanceOf",
          args: [addr],
        }),
        client.getBalance({ address: addr }),
      ]);
      const usdcE = Number(formatUnits(usdcERaw, USDC_DECIMALS));
      const pusd = Number(formatUnits(pusdRaw, USDC_DECIMALS));
      return [usdcE, pusd, Number(formatUnits(polRaw, POL_DECIMALS))];
    } catch (err) {
      errors.push(
        `polygon_rpc: ${err instanceof Error ? err.message : String(err)}`
      );
      return [null, null, null];
    }
  }

  async provision(input: {
    billingAccountId: string;
    createdByUserId: string;
    custodialConsent: CustodialConsent;
  }): Promise<PolyTraderSigningContext> {
    return this.serviceDb.transaction(async (tx) => {
      // PROVISION_IS_IDEMPOTENT: tenant-scoped advisory lock for the whole txn.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${input.billingAccountId}))`
      );
      const result = await this.provisionInsideTx(tx, input);
      return result.signingContext;
    });
  }

  /**
   * Provision + atomic default-grant issuance. The /connect route calls this
   * (not `provision`) so a freshly-provisioned wallet is never without a
   * grant — `authorizeIntent` is fail-closed on missing grants, so handing
   * back a wallet without one would produce a soft-brick.
   *
   * Consent + grant + connection all land inside one transaction; the tenant
   * advisory lock serializes concurrent attempts exactly the way `provision`
   * already does.
   */
  async provisionWithGrant(input: {
    billingAccountId: string;
    createdByUserId: string;
    custodialConsent: CustodialConsent;
    defaultGrant: DefaultGrantInput;
  }): Promise<PolyTraderSigningContext> {
    return this.serviceDb.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${input.billingAccountId}))`
      );
      const result = await this.provisionInsideTx(tx, {
        billingAccountId: input.billingAccountId,
        createdByUserId: input.createdByUserId,
        custodialConsent: input.custodialConsent,
      });

      // Idempotent re-hit on an already-provisioned tenant must still have an
      // active grant. If a grant already exists we keep it (caller's earlier
      // slider choice wins); if not, we issue one using the current request's
      // caps so a crash between provision and grant-insert is self-healing.
      const activeGrant = await tx
        .select({ id: polyWalletGrants.id })
        .from(polyWalletGrants)
        .where(
          and(
            eq(
              polyWalletGrants.walletConnectionId,
              result.signingContext.connectionId
            ),
            isNull(polyWalletGrants.revokedAt)
          )
        )
        .limit(1);

      if (!activeGrant[0]) {
        const [inserted] = await tx
          .insert(polyWalletGrants)
          .values({
            billingAccountId: input.billingAccountId,
            walletConnectionId: result.signingContext.connectionId,
            createdByUserId: input.createdByUserId,
            scopes: [...DEFAULT_GRANT_SCOPES],
            perOrderUsdcCap: input.defaultGrant.perOrderUsdcCap.toFixed(2),
            dailyUsdcCap: input.defaultGrant.dailyUsdcCap.toFixed(2),
            hourlyFillsCap: DEFAULT_GRANT_HOURLY_FILLS_CAP,
            expiresAt: null,
          })
          .returning({ id: polyWalletGrants.id });

        this.log.info(
          {
            billing_account_id: input.billingAccountId,
            grant_id: inserted?.id,
            connection_id: result.signingContext.connectionId,
            per_order_cap: input.defaultGrant.perOrderUsdcCap,
            daily_cap: input.defaultGrant.dailyUsdcCap,
            hourly_fills_cap: DEFAULT_GRANT_HOURLY_FILLS_CAP,
          },
          "poly.wallet.grant.issue — auto-issued default grant"
        );
      }

      return result.signingContext;
    });
  }

  /**
   * Shared provision body. Lives inside a caller-owned transaction so
   * `provisionWithGrant` can insert the grant row in the same atomic unit
   * without duplicating the advisory lock / idempotency logic.
   */
  private async provisionInsideTx(
    tx: TxOrDb,
    input: {
      billingAccountId: string;
      createdByUserId: string;
      custodialConsent: CustodialConsent;
    }
  ): Promise<{
    signingContext: PolyTraderSigningContext;
    isIdempotentHit: boolean;
  }> {
    const consent = input.custodialConsent;

    const existing = await tx
      .select()
      .from(polyWalletConnections)
      .where(
        and(
          eq(polyWalletConnections.billingAccountId, input.billingAccountId),
          isNull(polyWalletConnections.revokedAt)
        )
      )
      .limit(1);

    if (existing[0]) {
      const row = existing[0];
      if (row.billingAccountId !== input.billingAccountId) {
        throw new Error(
          "tenant mismatch on provision idempotency check — aborting"
        );
      }
      const clobCreds = this.decryptCreds(row.clobApiKeyCiphertext, {
        billing_account_id: row.billingAccountId,
        connection_id: row.id,
        provider: CREDENTIAL_PROVIDER,
      });
      const rawIdemAccount = createViemAccount(this.privyClient, {
        walletId: row.privyWalletId,
        address: row.address as `0x${string}`,
        authorizationContext: this.authorizationContext,
      });
      // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
      const account: any = rawIdemAccount;
      return {
        signingContext: {
          account,
          clobCreds,
          funderAddress: getAddress(row.address),
          connectionId: row.id,
        },
        isIdempotentHit: true,
      };
    }

    // PROVISION_NO_ORPHAN: derive a deterministic generation counter from
    // the tenant's full row history (active + revoked). Under the advisory
    // lock this is race-free; on retry after crash the count is unchanged
    // so the idempotency key resolves to the same Privy wallet.
    const [generationRow] = await tx
      .select({ c: count() })
      .from(polyWalletConnections)
      .where(
        eq(polyWalletConnections.billingAccountId, input.billingAccountId)
      );
    const generation = Number(generationRow?.c ?? 0) + 1;
    const idempotencyKey = `poly-wallet:${input.billingAccountId}:${generation}`;

    const privyWallet = await this.privyClient
      .wallets()
      .create({ chain_type: "ethereum" }, { idempotencyKey });

    const rawFreshAccount = createViemAccount(this.privyClient, {
      walletId: privyWallet.id,
      address: privyWallet.address as `0x${string}`,
      authorizationContext: this.authorizationContext,
    });
    // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
    const account: any = rawFreshAccount;

    const clobCreds = await this.clobCredsFactory(account);

    const [{ gen_id }] = (await tx.execute<{ gen_id: string }>(
      sql`SELECT gen_random_uuid()::text AS gen_id`
    )) as unknown as [{ gen_id: string }];

    const aad: AeadAAD = {
      billing_account_id: input.billingAccountId,
      connection_id: gen_id,
      provider: CREDENTIAL_PROVIDER,
    };
    const ciphertext = aeadEncrypt(
      JSON.stringify(clobCreds),
      aad,
      this.encryptionKey
    );

    await tx.insert(polyWalletConnections).values({
      id: gen_id,
      billingAccountId: input.billingAccountId,
      createdByUserId: input.createdByUserId,
      privyWalletId: privyWallet.id,
      address: getAddress(privyWallet.address),
      chainId: 137,
      clobApiKeyCiphertext: ciphertext,
      encryptionKeyId: this.encryptionKeyId,
      allowanceState: null,
      custodialConsentAcceptedAt: consent.acceptedAt,
      custodialConsentActorKind: consent.actorKind,
      custodialConsentActorId: consent.actorId,
    });

    this.log.info(
      {
        billing_account_id: input.billingAccountId,
        connection_id: gen_id,
        funder_address: getAddress(privyWallet.address),
        generation,
      },
      "poly.wallet.provision — created per-tenant Privy trading wallet"
    );

    return {
      signingContext: {
        account,
        clobCreds,
        funderAddress: getAddress(privyWallet.address),
        connectionId: gen_id,
      },
      isIdempotentHit: false,
    };
  }

  /**
   * Soft-delete the tenant's active connection row + cascade to grants.
   *
   * WARNING — this is a halt-future kill-switch ONLY. It does NOT:
   *   - delete the Privy backend wallet (funds at that address remain spendable),
   *   - move USDC.e / MATIC off the address (no on-chain transfer),
   *   - verify the address is empty before marking revoked.
   *
   * Callers (UI, API route handlers) MUST enforce `WITHDRAW_BEFORE_REVOKE`: show
   * the current on-chain balance and require explicit "proceed with non-zero
   * balance" confirmation from the user. Skipping that check strands funds.
   *
   * The grant cascade (REVOKE_CASCADES_FROM_CONNECTION invariant, migration
   * 0031) runs inside the same transaction as the connection update so
   * `authorizeIntent` cannot succeed against a stale grant whose connection
   * just got revoked.
   */
  async revoke(input: {
    billingAccountId: string;
    revokedByUserId: string;
  }): Promise<void> {
    await this.serviceDb.transaction(async (tx) => {
      const [revokedConnection] = await tx
        .update(polyWalletConnections)
        .set({
          revokedAt: new Date(),
          revokedByUserId: input.revokedByUserId,
          // Clear the readiness stamp so a post-revoke re-provision starts in
          // `trading_not_ready` and must re-run `ensureTradingApprovals`.
          // Same transaction as the revoke flip — APPROVALS_BEFORE_PLACE
          // cannot leak across a revoke cycle.
          tradingApprovalsReadyAt: null,
        })
        .where(
          and(
            eq(polyWalletConnections.billingAccountId, input.billingAccountId),
            isNull(polyWalletConnections.revokedAt)
          )
        )
        .returning({ id: polyWalletConnections.id });

      if (!revokedConnection) {
        // Nothing to cascade — either no active connection or already revoked.
        return;
      }

      const revokedGrants = await tx
        .update(polyWalletGrants)
        .set({
          revokedAt: new Date(),
          revokedByUserId: input.revokedByUserId,
        })
        .where(
          and(
            eq(polyWalletGrants.walletConnectionId, revokedConnection.id),
            isNull(polyWalletGrants.revokedAt)
          )
        )
        .returning({ id: polyWalletGrants.id });

      this.log.info(
        {
          billing_account_id: input.billingAccountId,
          connection_id: revokedConnection.id,
          revoked_by_user_id: input.revokedByUserId,
          cascaded_grant_ids: revokedGrants.map((g) => g.id),
        },
        "poly.wallet.revoke — soft-deleted active connection + cascaded grants (funds NOT moved; caller must have enforced withdraw)"
      );

      for (const g of revokedGrants) {
        this.log.info(
          {
            billing_account_id: input.billingAccountId,
            grant_id: g.id,
            cascaded_from_connection_id: revokedConnection.id,
          },
          "poly.wallet.grant.revoke — cascaded by connection revoke"
        );
      }
    });
  }

  /**
   * Resolve + grant-check in one call. Only mint site for
   * `AuthorizedSigningContext`; `PolymarketClobAdapter.placeOrder` takes the
   * branded type, so a tenant without an active grant simply cannot place
   * orders. Fails closed — any DB error returns `backend_unreachable`.
   *
   * Reads connection + grant fresh on every call so a cached per-tenant
   * executor cannot bypass a revoke that landed after the executor was
   * constructed.
   *
   * Cap windows count any fill status that currently commits or has
   * committed USDC (pending / open / filled / partial). Counting only
   * `filled` would let two concurrent pending orders race past the cap.
   */
  async authorizeIntent(
    billingAccountId: string,
    intent: OrderIntentSummary
  ): Promise<AuthorizeIntentResult> {
    try {
      // APPROVALS_BEFORE_PLACE — check the connection row's readiness stamp
      // up front. Order matters: we want `no_connection` (never provisioned)
      // and `trading_not_ready` (provisioned but hasn't run the 6 approvals)
      // to short-circuit BEFORE we run cap math, otherwise those counters
      // would fill with ghost reservations for wallets that can't settle.
      const [connection] = await this.serviceDb
        .select({
          id: polyWalletConnections.id,
          billingAccountId: polyWalletConnections.billingAccountId,
          tradingApprovalsReadyAt:
            polyWalletConnections.tradingApprovalsReadyAt,
        })
        .from(polyWalletConnections)
        .where(
          and(
            eq(polyWalletConnections.billingAccountId, billingAccountId),
            isNull(polyWalletConnections.revokedAt)
          )
        )
        .limit(1);

      if (!connection) {
        return this.denyAuthorization(
          billingAccountId,
          intent,
          "no_connection"
        );
      }
      if (connection.billingAccountId !== billingAccountId) {
        this.log.warn(
          {
            billing_account_id: billingAccountId,
            connection_id: connection.id,
          },
          "tenant mismatch on poly_wallet_connections SELECT — refusing to authorize"
        );
        return this.denyAuthorization(
          billingAccountId,
          intent,
          "backend_unreachable"
        );
      }
      if (!connection.tradingApprovalsReadyAt) {
        return this.denyAuthorization(
          billingAccountId,
          intent,
          "trading_not_ready"
        );
      }

      const [grant] = await this.serviceDb
        .select()
        .from(polyWalletGrants)
        .where(
          and(
            eq(polyWalletGrants.billingAccountId, billingAccountId),
            eq(polyWalletGrants.walletConnectionId, connection.id),
            isNull(polyWalletGrants.revokedAt)
          )
        )
        .orderBy(desc(polyWalletGrants.createdAt))
        .limit(1);

      if (!grant) {
        return this.denyAuthorization(
          billingAccountId,
          intent,
          "no_active_grant"
        );
      }
      // TENANT_DEFENSE_IN_DEPTH.
      if (grant.billingAccountId !== billingAccountId) {
        this.log.warn(
          {
            billing_account_id: billingAccountId,
            grant_id: grant.id,
          },
          "tenant mismatch on poly_wallet_grants SELECT — refusing to authorize"
        );
        return this.denyAuthorization(
          billingAccountId,
          intent,
          "backend_unreachable"
        );
      }

      if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) {
        return this.denyAuthorization(
          billingAccountId,
          intent,
          "grant_expired",
          grant.id
        );
      }

      const requiredScope =
        intent.side === "BUY" ? "poly:trade:buy" : "poly:trade:sell";
      if (!grant.scopes.includes(requiredScope)) {
        return this.denyAuthorization(
          billingAccountId,
          intent,
          "scope_missing",
          grant.id
        );
      }

      const perOrderCap = Number(grant.perOrderUsdcCap);
      if (intent.usdcAmount > perOrderCap) {
        return this.denyAuthorization(
          billingAccountId,
          intent,
          "cap_exceeded_per_order",
          grant.id
        );
      }

      // Cap windows — include every status that has USDC attached (pending /
      // open / filled / partial). CAPS_COUNT_INTENTS: filter by createdAt
      // (intent insertion time) NOT observedAt (upstream fill time) so
      // historical target activity doesn't artificially backdate caps.
      const [spendRow] = await this.serviceDb
        .select({
          spent: sum(
            sql<string>`COALESCE((${polyCopyTradeFills.attributes}->>'size_usdc')::numeric, 0)`
          ),
        })
        .from(polyCopyTradeFills)
        .where(
          and(
            eq(polyCopyTradeFills.billingAccountId, billingAccountId),
            gte(polyCopyTradeFills.createdAt, sql`now() - interval '24 hours'`),
            inArray(polyCopyTradeFills.status, [...IN_FLIGHT_FILL_STATUSES])
          )
        );

      const spent24h = Number(spendRow?.spent ?? 0);
      const dailyCap = Number(grant.dailyUsdcCap);
      if (spent24h + intent.usdcAmount > dailyCap) {
        return this.denyAuthorization(
          billingAccountId,
          intent,
          "cap_exceeded_daily",
          grant.id
        );
      }

      const [rateRow] = await this.serviceDb
        .select({ n: count() })
        .from(polyCopyTradeFills)
        .where(
          and(
            eq(polyCopyTradeFills.billingAccountId, billingAccountId),
            gte(polyCopyTradeFills.createdAt, sql`now() - interval '1 hour'`),
            inArray(polyCopyTradeFills.status, [...IN_FLIGHT_FILL_STATUSES])
          )
        );
      const fillsLastHour = Number(rateRow?.n ?? 0);
      if (fillsLastHour >= grant.hourlyFillsCap) {
        return this.denyAuthorization(
          billingAccountId,
          intent,
          "cap_exceeded_hourly_fills",
          grant.id
        );
      }

      // All checks passed; resolve signing context. `resolve` performs the
      // connection SELECT + decrypt + viem-account wrap; if it returns null
      // the connection was revoked (or never existed) despite the grant —
      // treat as `no_connection` so callers see the right failure class.
      const signingContext = await this.resolve(billingAccountId);
      if (!signingContext) {
        return this.denyAuthorization(
          billingAccountId,
          intent,
          "no_connection",
          grant.id
        );
      }

      const authorized = {
        ...signingContext,
        grantId: grant.id,
        authorizedIntent: intent,
      } as AuthorizedSigningContext;

      this.log.info(
        {
          billing_account_id: billingAccountId,
          grant_id: grant.id,
          intent_side: intent.side,
          intent_usdc: intent.usdcAmount,
          ok: true,
        },
        "poly.authorize.outcome"
      );

      return { ok: true, context: authorized };
    } catch (err) {
      this.log.warn(
        {
          billing_account_id: billingAccountId,
          intent_side: intent.side,
          intent_usdc: intent.usdcAmount,
          err: err instanceof Error ? err.message : String(err),
        },
        "poly.authorize.outcome — backend unreachable"
      );
      return {
        ok: false,
        reason: "backend_unreachable",
      };
    }
  }

  private denyAuthorization(
    billingAccountId: string,
    intent: OrderIntentSummary,
    reason: AuthorizationFailure,
    grantId?: string
  ): AuthorizeIntentResult {
    this.log.info(
      {
        billing_account_id: billingAccountId,
        grant_id: grantId,
        intent_side: intent.side,
        intent_usdc: intent.usdcAmount,
        ok: false,
        reason,
      },
      "poly.authorize.outcome"
    );
    return { ok: false, reason };
  }

  /**
   * Idempotent 6-step Polymarket approvals ceremony for a single tenant.
   * See APPROVALS_BEFORE_PLACE + APPROVAL_TARGETS_PINNED invariants on the
   * module header. Logic mirrors
   * `scripts/experiments/approve-polymarket-allowances.ts` — pinned
   * addresses, read-current-state-first, sequential writes, post-verify at
   * the receipt block — lifted into a tenant-scoped, Privy-signed, DB-aware
   * adapter method.
   */
  async ensureTradingApprovals(
    billingAccountId: string
  ): Promise<TradingApprovalsState> {
    const resolveResult = await this.resolveSigningContext(billingAccountId);
    if (!resolveResult.ok) {
      throw this.errorForResolveFailure(resolveResult);
    }
    const signingContext = resolveResult.context;
    if (!this.polygonRpcUrl) {
      throw Object.assign(
        new Error(
          "ensureTradingApprovals: POLYGON_RPC_URL is not configured on this pod"
        ),
        { code: "polygon_rpc_unconfigured" as EnableTradingPreflightError }
      );
    }

    const address = signingContext.funderAddress;
    const publicClient = createPublicClient({
      chain: polygon,
      transport: http(this.polygonRpcUrl),
    });
    // Cross-peerDep viem drift (same pattern as `resolve`): the viem account
    // returned by @privy-io/node/viem conforms to LocalAccount at runtime
    // but carries type-incompatibilities from a different viem minor.
    const walletClient: WalletClient = createWalletClient({
      // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
      account: signingContext.account as any,
      chain: polygon,
      transport: http(this.polygonRpcUrl),
    });

    const [
      polRaw,
      usdcEAllowances,
      pusdAllowances,
      ctfApprovals,
      usdcEBalanceRaw,
    ] = await Promise.all([
      publicClient.getBalance({ address }),
      Promise.all(
        USDC_E_SPENDERS.map((sp) =>
          publicClient.readContract({
            address: USDC_E_POLYGON,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, sp.address],
          })
        )
      ),
      Promise.all(
        PUSD_SPENDERS.map((sp) =>
          publicClient.readContract({
            address: PUSD_POLYGON,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, sp.address],
          })
        )
      ),
      Promise.all(
        CTF_OPERATORS.map((op) =>
          publicClient.readContract({
            address: CTF_POLYGON,
            abi: CTF_SET_APPROVAL_ABI,
            functionName: "isApprovedForAll",
            args: [address, op.address],
          })
        )
      ),
      publicClient.readContract({
        address: USDC_E_POLYGON,
        abi: ERC20_BALANCEOF_ABI,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);

    const polBalance = Number(formatUnits(polRaw, POL_DECIMALS));
    const usdcEBalance = usdcEBalanceRaw;

    this.log.info(
      {
        billing_account_id: billingAccountId,
        connection_id: signingContext.connectionId,
        funder_address: address,
        pol_balance: polBalance,
        usdc_e_allowances: usdcEAllowances.map((a) => a === maxUint256),
        pusd_allowances: pusdAllowances.map((a) => a === maxUint256),
        ctf_approvals: ctfApprovals,
        usdc_e_balance_raw: usdcEBalance.toString(),
      },
      "poly.wallet.enable_trading.start"
    );

    const needsUsdcE = usdcEAllowances.map((a) => a !== maxUint256);
    const needsPusd = pusdAllowances.map((a) => a !== maxUint256);
    const needsCtf = ctfApprovals.map((b) => !b);
    const needsWrap = usdcEBalance > 0n;
    const workCount =
      needsUsdcE.filter(Boolean).length +
      (needsWrap ? 1 : 0) +
      needsPusd.filter(Boolean).length +
      needsCtf.filter(Boolean).length;

    const buildSatisfiedSteps = (): TradingApprovalStep[] => {
      const out: TradingApprovalStep[] = [];
      for (const sp of USDC_E_SPENDERS) {
        out.push({
          kind: "erc20_approve",
          label: sp.label,
          tokenContract: USDC_E_POLYGON,
          operator: sp.address,
          state: "satisfied",
          txHash: null,
          error: null,
        });
      }
      out.push({
        kind: "collateral_wrap",
        label: "Wrap USDC.e → pUSD",
        tokenContract: COLLATERAL_ONRAMP_POLYGON,
        operator: COLLATERAL_ONRAMP_POLYGON,
        state: "satisfied",
        txHash: null,
        error: null,
      });
      for (const sp of PUSD_SPENDERS) {
        out.push({
          kind: "erc20_approve",
          label: sp.label,
          tokenContract: PUSD_POLYGON,
          operator: sp.address,
          state: "satisfied",
          txHash: null,
          error: null,
        });
      }
      for (const op of CTF_OPERATORS) {
        out.push({
          kind: "ctf_set_approval_for_all",
          label: op.label,
          tokenContract: CTF_POLYGON,
          operator: op.address,
          state: "satisfied",
          txHash: null,
          error: null,
        });
      }
      return out;
    };

    const steps: TradingApprovalStep[] = [];

    if (workCount === 0) {
      steps.push(...buildSatisfiedSteps());
      const readyAt = await this.stampTradingReady(
        signingContext.connectionId,
        billingAccountId
      );
      this.log.info(
        {
          billing_account_id: billingAccountId,
          connection_id: signingContext.connectionId,
          funder_address: address,
        },
        "poly.wallet.enable_trading.already_ready"
      );
      return { ready: true, address, polBalance, steps, readyAt };
    }

    if (polBalance < ENABLE_TRADING_MIN_POL) {
      USDC_E_SPENDERS.forEach((sp, i) => {
        steps.push({
          kind: "erc20_approve",
          label: sp.label,
          tokenContract: USDC_E_POLYGON,
          operator: sp.address,
          state: usdcEAllowances[i] === maxUint256 ? "satisfied" : "skipped",
          txHash: null,
          error:
            usdcEAllowances[i] === maxUint256 ? null : "insufficient_pol_gas",
        });
      });
      steps.push({
        kind: "collateral_wrap",
        label: "Wrap USDC.e → pUSD",
        tokenContract: COLLATERAL_ONRAMP_POLYGON,
        operator: COLLATERAL_ONRAMP_POLYGON,
        state: needsWrap ? "skipped" : "satisfied",
        txHash: null,
        error: needsWrap ? "insufficient_pol_gas" : null,
      });
      PUSD_SPENDERS.forEach((sp, i) => {
        steps.push({
          kind: "erc20_approve",
          label: sp.label,
          tokenContract: PUSD_POLYGON,
          operator: sp.address,
          state: pusdAllowances[i] === maxUint256 ? "satisfied" : "skipped",
          txHash: null,
          error:
            pusdAllowances[i] === maxUint256 ? null : "insufficient_pol_gas",
        });
      });
      CTF_OPERATORS.forEach((op, i) => {
        steps.push({
          kind: "ctf_set_approval_for_all",
          label: op.label,
          tokenContract: CTF_POLYGON,
          operator: op.address,
          state: ctfApprovals[i] ? "satisfied" : "skipped",
          txHash: null,
          error: ctfApprovals[i] ? null : "insufficient_pol_gas",
        });
      });
      this.log.warn(
        {
          billing_account_id: billingAccountId,
          connection_id: signingContext.connectionId,
          funder_address: address,
          pol_balance: polBalance,
          pol_required: ENABLE_TRADING_MIN_POL,
        },
        "poly.wallet.enable_trading.insufficient_pol_gas"
      );
      return { ready: false, address, polBalance, steps, readyAt: null };
    }

    let allOk = true;
    for (let i = 0; i < USDC_E_SPENDERS.length && allOk; i++) {
      const sp = USDC_E_SPENDERS[i];
      if (!sp) continue;
      if (!needsUsdcE[i]) {
        steps.push({
          kind: "erc20_approve",
          label: sp.label,
          tokenContract: USDC_E_POLYGON,
          operator: sp.address,
          state: "satisfied",
          txHash: null,
          error: null,
        });
        continue;
      }
      const step = await this.submitErc20Approve(
        publicClient,
        walletClient,
        signingContext,
        billingAccountId,
        USDC_E_POLYGON,
        sp
      );
      steps.push(step);
      if (step.state !== "set") allOk = false;
    }

    if (allOk) {
      if (!needsWrap) {
        steps.push({
          kind: "collateral_wrap",
          label: "Wrap USDC.e → pUSD",
          tokenContract: COLLATERAL_ONRAMP_POLYGON,
          operator: COLLATERAL_ONRAMP_POLYGON,
          state: "satisfied",
          txHash: null,
          error: null,
        });
      } else {
        const step = await this.submitCollateralWrap(
          publicClient,
          walletClient,
          signingContext,
          billingAccountId,
          usdcEBalance
        );
        steps.push(step);
        if (step.state !== "set") allOk = false;
        if (allOk) {
          // Wrapping consumes the USDC.e Onramp allowance; restore max so the
          // readiness check remains true after the wallet's first wrap.
          const restoreStep = await this.submitErc20Approve(
            publicClient,
            walletClient,
            signingContext,
            billingAccountId,
            USDC_E_POLYGON,
            USDC_E_ONRAMP_SPENDER
          );
          steps[0] = restoreStep;
          if (restoreStep.state !== "set") allOk = false;
        }
      }
    }

    if (allOk) {
      for (let i = 0; i < PUSD_SPENDERS.length && allOk; i++) {
        const sp = PUSD_SPENDERS[i];
        if (!sp) continue;
        if (!needsPusd[i]) {
          steps.push({
            kind: "erc20_approve",
            label: sp.label,
            tokenContract: PUSD_POLYGON,
            operator: sp.address,
            state: "satisfied",
            txHash: null,
            error: null,
          });
          continue;
        }
        const step = await this.submitErc20Approve(
          publicClient,
          walletClient,
          signingContext,
          billingAccountId,
          PUSD_POLYGON,
          sp
        );
        steps.push(step);
        if (step.state !== "set") allOk = false;
      }
    }

    if (allOk) {
      for (let i = 0; i < CTF_OPERATORS.length && allOk; i++) {
        const op = CTF_OPERATORS[i];
        if (!op) continue;
        if (!needsCtf[i]) {
          steps.push({
            kind: "ctf_set_approval_for_all",
            label: op.label,
            tokenContract: CTF_POLYGON,
            operator: op.address,
            state: "satisfied",
            txHash: null,
            error: null,
          });
          continue;
        }
        const step = await this.submitCtfSetApproval(
          publicClient,
          walletClient,
          signingContext,
          billingAccountId,
          op
        );
        steps.push(step);
        if (step.state !== "set") allOk = false;
      }
    }

    const totalSteps =
      USDC_E_SPENDERS.length + 1 + PUSD_SPENDERS.length + CTF_OPERATORS.length;
    while (steps.length < totalSteps) {
      const idx = steps.length;
      const usdcEEnd = USDC_E_SPENDERS.length;
      const wrapEnd = usdcEEnd + 1;
      const pusdEnd = wrapEnd + PUSD_SPENDERS.length;
      if (idx < usdcEEnd) {
        const sp = USDC_E_SPENDERS[idx];
        if (!sp) break;
        steps.push({
          kind: "erc20_approve",
          label: sp.label,
          tokenContract: USDC_E_POLYGON,
          operator: sp.address,
          state: "skipped",
          txHash: null,
          error: "aborted_after_prior_failure",
        });
      } else if (idx < wrapEnd) {
        steps.push({
          kind: "collateral_wrap",
          label: "Wrap USDC.e → pUSD",
          tokenContract: COLLATERAL_ONRAMP_POLYGON,
          operator: COLLATERAL_ONRAMP_POLYGON,
          state: "skipped",
          txHash: null,
          error: "aborted_after_prior_failure",
        });
      } else if (idx < pusdEnd) {
        const sp = PUSD_SPENDERS[idx - wrapEnd];
        if (!sp) break;
        steps.push({
          kind: "erc20_approve",
          label: sp.label,
          tokenContract: PUSD_POLYGON,
          operator: sp.address,
          state: "skipped",
          txHash: null,
          error: "aborted_after_prior_failure",
        });
      } else {
        const op = CTF_OPERATORS[idx - pusdEnd];
        if (!op) break;
        steps.push({
          kind: "ctf_set_approval_for_all",
          label: op.label,
          tokenContract: CTF_POLYGON,
          operator: op.address,
          state: "skipped",
          txHash: null,
          error: "aborted_after_prior_failure",
        });
      }
    }

    if (!allOk) {
      this.log.warn(
        {
          billing_account_id: billingAccountId,
          connection_id: signingContext.connectionId,
          funder_address: address,
          step_states: steps.map((s) => s.state),
        },
        "poly.wallet.enable_trading.tx.reverted"
      );
      return { ready: false, address, polBalance, steps, readyAt: null };
    }

    const readyAt = await this.stampTradingReady(
      signingContext.connectionId,
      billingAccountId
    );
    this.log.info(
      {
        billing_account_id: billingAccountId,
        connection_id: signingContext.connectionId,
        funder_address: address,
        work_count: workCount,
      },
      "poly.wallet.enable_trading.ok"
    );
    return { ready: true, address, polBalance, steps, readyAt };
  }

  private async submitErc20Approve(
    publicClient: PublicClient,
    walletClient: WalletClient,
    signingContext: PolyTraderSigningContext,
    billingAccountId: string,
    token: Address,
    target: { label: string; address: Address }
  ): Promise<TradingApprovalStep> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
      const hash: Hex = await (walletClient.writeContract as any)({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [target.address, maxUint256],
      });
      this.log.info(
        {
          billing_account_id: billingAccountId,
          connection_id: signingContext.connectionId,
          token_contract: token,
          operator: target.address,
          tx_hash: hash,
        },
        "poly.wallet.enable_trading.tx.submitted"
      );
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });
      if (receipt.status !== "success") {
        return {
          kind: "erc20_approve",
          label: target.label,
          tokenContract: token,
          operator: target.address,
          state: "failed",
          txHash: hash,
          error: "tx_reverted",
        };
      }
      const after = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [signingContext.funderAddress, target.address],
        blockNumber: receipt.blockNumber,
      });
      if (after !== maxUint256) {
        return {
          kind: "erc20_approve",
          label: target.label,
          tokenContract: token,
          operator: target.address,
          state: "failed",
          txHash: hash,
          error: "post_verify_mismatch",
        };
      }
      this.log.info(
        {
          billing_account_id: billingAccountId,
          connection_id: signingContext.connectionId,
          token_contract: token,
          operator: target.address,
          tx_hash: hash,
          block_number: Number(receipt.blockNumber),
        },
        "poly.wallet.enable_trading.tx.confirmed"
      );
      return {
        kind: "erc20_approve",
        label: target.label,
        tokenContract: token,
        operator: target.address,
        state: "set",
        txHash: hash,
        error: null,
      };
    } catch (err) {
      return {
        kind: "erc20_approve",
        label: target.label,
        tokenContract: token,
        operator: target.address,
        state: "failed",
        txHash: null,
        error:
          err instanceof Error ? err.message.slice(0, 128) : "submit_failed",
      };
    }
  }

  private async submitCollateralWrap(
    publicClient: PublicClient,
    walletClient: WalletClient,
    signingContext: PolyTraderSigningContext,
    billingAccountId: string,
    amount: bigint
  ): Promise<TradingApprovalStep> {
    const baseStep: Omit<TradingApprovalStep, "state" | "txHash" | "error"> = {
      kind: "collateral_wrap",
      label: "Wrap USDC.e → pUSD",
      tokenContract: COLLATERAL_ONRAMP_POLYGON,
      operator: COLLATERAL_ONRAMP_POLYGON,
    };
    try {
      // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
      const hash: Hex = await (walletClient.writeContract as any)({
        address: COLLATERAL_ONRAMP_POLYGON,
        abi: COLLATERAL_ONRAMP_WRAP_ABI,
        functionName: "wrap",
        args: [USDC_E_POLYGON, signingContext.funderAddress, amount],
      });
      this.log.info(
        {
          billing_account_id: billingAccountId,
          connection_id: signingContext.connectionId,
          amount: amount.toString(),
          tx_hash: hash,
        },
        "poly.wallet.enable_trading.wrap.submitted"
      );
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });
      if (receipt.status !== "success") {
        return {
          ...baseStep,
          state: "failed",
          txHash: hash,
          error: "tx_reverted",
        };
      }
      const remaining = await publicClient.readContract({
        address: USDC_E_POLYGON,
        abi: ERC20_BALANCEOF_ABI,
        functionName: "balanceOf",
        args: [signingContext.funderAddress],
        blockNumber: receipt.blockNumber,
      });
      if (remaining > 0n) {
        return {
          ...baseStep,
          state: "failed",
          txHash: hash,
          error: "post_verify_residual_usdc_e",
        };
      }
      this.log.info(
        {
          billing_account_id: billingAccountId,
          connection_id: signingContext.connectionId,
          amount: amount.toString(),
          tx_hash: hash,
          block_number: Number(receipt.blockNumber),
        },
        "poly.wallet.enable_trading.wrap.confirmed"
      );
      return { ...baseStep, state: "set", txHash: hash, error: null };
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message.slice(0, 128) : "submit_failed";
      const errorClass =
        err && typeof err === "object" && err.constructor?.name
          ? err.constructor.name
          : undefined;
      this.log.error(
        {
          event: "poly.wallet.enable_trading.wrap.error",
          billing_account_id: billingAccountId,
          connection_id: signingContext.connectionId,
          amount: amount.toString(),
          err: errMsg,
          error_class: errorClass,
        },
        "wrap: failed"
      );
      return { ...baseStep, state: "failed", txHash: null, error: errMsg };
    }
  }

  private async submitCtfSetApproval(
    publicClient: PublicClient,
    walletClient: WalletClient,
    signingContext: PolyTraderSigningContext,
    billingAccountId: string,
    target: { label: string; address: Address }
  ): Promise<TradingApprovalStep> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
      const hash: Hex = await (walletClient.writeContract as any)({
        address: CTF_POLYGON,
        abi: CTF_SET_APPROVAL_ABI,
        functionName: "setApprovalForAll",
        args: [target.address, true],
      });
      this.log.info(
        {
          billing_account_id: billingAccountId,
          connection_id: signingContext.connectionId,
          operator: target.address,
          tx_hash: hash,
        },
        "poly.wallet.enable_trading.tx.submitted"
      );
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });
      if (receipt.status !== "success") {
        return {
          kind: "ctf_set_approval_for_all",
          label: target.label,
          tokenContract: CTF_POLYGON,
          operator: target.address,
          state: "failed",
          txHash: hash,
          error: "tx_reverted",
        };
      }
      const after = await publicClient.readContract({
        address: CTF_POLYGON,
        abi: CTF_SET_APPROVAL_ABI,
        functionName: "isApprovedForAll",
        args: [signingContext.funderAddress, target.address],
        blockNumber: receipt.blockNumber,
      });
      if (!after) {
        return {
          kind: "ctf_set_approval_for_all",
          label: target.label,
          tokenContract: CTF_POLYGON,
          operator: target.address,
          state: "failed",
          txHash: hash,
          error: "post_verify_mismatch",
        };
      }
      this.log.info(
        {
          billing_account_id: billingAccountId,
          connection_id: signingContext.connectionId,
          operator: target.address,
          tx_hash: hash,
          block_number: Number(receipt.blockNumber),
        },
        "poly.wallet.enable_trading.tx.confirmed"
      );
      return {
        kind: "ctf_set_approval_for_all",
        label: target.label,
        tokenContract: CTF_POLYGON,
        operator: target.address,
        state: "set",
        txHash: hash,
        error: null,
      };
    } catch (err) {
      return {
        kind: "ctf_set_approval_for_all",
        label: target.label,
        tokenContract: CTF_POLYGON,
        operator: target.address,
        state: "failed",
        txHash: null,
        error:
          err instanceof Error ? err.message.slice(0, 128) : "submit_failed",
      };
    }
  }

  private async stampTradingReady(
    connectionId: string,
    billingAccountId: string
  ): Promise<Date> {
    const readyAt = new Date();
    await this.serviceDb
      .update(polyWalletConnections)
      .set({ tradingApprovalsReadyAt: readyAt })
      .where(
        and(
          eq(polyWalletConnections.id, connectionId),
          eq(polyWalletConnections.billingAccountId, billingAccountId),
          isNull(polyWalletConnections.revokedAt)
        )
      );
    return readyAt;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Typed withdrawal surface.
  // ────────────────────────────────────────────────────────────────────────

  async withdraw(
    input: PolyWalletWithdrawalInput
  ): Promise<PolyWalletWithdrawalResult> {
    const signingContext = await this.resolve(input.billingAccountId);
    if (!signingContext) {
      throw Object.assign(
        new Error("withdraw: no active connection for tenant"),
        { code: "no_connection" }
      );
    }
    if (!this.polygonRpcUrl) {
      throw Object.assign(
        new Error("withdraw: POLYGON_RPC_URL is not configured on this pod"),
        { code: "polygon_rpc_unconfigured" }
      );
    }

    const destination = getAddress(input.destination) as Address;
    const publicClient = createPublicClient({
      chain: polygon,
      transport: http(this.polygonRpcUrl),
    });
    const walletClient: WalletClient = createWalletClient({
      // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
      account: signingContext.account as any,
      chain: polygon,
      transport: http(this.polygonRpcUrl),
    });

    if (input.asset === "usdc_e") {
      return this.withdrawErc20({
        publicClient,
        walletClient,
        signingContext,
        billingAccountId: input.billingAccountId,
        requestedByUserId: input.requestedByUserId,
        token: USDC_E_POLYGON,
        asset: "usdc_e",
        deliveredAsset: "usdc_e",
        destination,
        amountAtomic: input.amountAtomic,
      });
    }

    if (input.asset === "pusd") {
      return this.withdrawPusdViaOfframp({
        publicClient,
        walletClient,
        signingContext,
        billingAccountId: input.billingAccountId,
        requestedByUserId: input.requestedByUserId,
        destination,
        amountAtomic: input.amountAtomic,
      });
    }

    return this.withdrawNativePol({
      publicClient,
      walletClient,
      signingContext,
      billingAccountId: input.billingAccountId,
      requestedByUserId: input.requestedByUserId,
      destination,
      amountAtomic: input.amountAtomic,
    });
  }

  private async withdrawErc20(input: {
    publicClient: PublicClient;
    walletClient: WalletClient;
    signingContext: PolyTraderSigningContext;
    billingAccountId: string;
    requestedByUserId: string;
    token: Address;
    asset: "usdc_e";
    deliveredAsset: "usdc_e";
    destination: Address;
    amountAtomic: bigint;
  }): Promise<PolyWalletWithdrawalResult> {
    const balance = await input.publicClient.readContract({
      address: input.token,
      abi: ERC20_BALANCEOF_ABI,
      functionName: "balanceOf",
      args: [input.signingContext.funderAddress],
    });
    if (balance < input.amountAtomic) {
      throw Object.assign(new Error("withdraw: insufficient token balance"), {
        code: "insufficient_balance",
      });
    }

    // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
    const txHash: Hex = await (input.walletClient.writeContract as any)({
      address: input.token,
      abi: erc20Abi,
      functionName: "transfer",
      args: [input.destination, input.amountAtomic],
    });
    await this.confirmWithdrawalTx(input.publicClient, txHash);
    this.logWithdrawal({
      billingAccountId: input.billingAccountId,
      connectionId: input.signingContext.connectionId,
      requestedByUserId: input.requestedByUserId,
      asset: input.asset,
      deliveredAsset: input.deliveredAsset,
      sourceAddress: input.signingContext.funderAddress,
      destination: input.destination,
      amountAtomic: input.amountAtomic,
      txHashes: [txHash],
    });
    return {
      asset: input.asset,
      deliveredAsset: input.deliveredAsset,
      sourceAddress: input.signingContext.funderAddress,
      destination: input.destination,
      amountAtomic: input.amountAtomic,
      primaryTxHash: txHash,
      txHashes: [txHash],
    };
  }

  private async withdrawPusdViaOfframp(input: {
    publicClient: PublicClient;
    walletClient: WalletClient;
    signingContext: PolyTraderSigningContext;
    billingAccountId: string;
    requestedByUserId: string;
    destination: Address;
    amountAtomic: bigint;
  }): Promise<PolyWalletWithdrawalResult> {
    const [balance, allowance] = await Promise.all([
      input.publicClient.readContract({
        address: PUSD_POLYGON,
        abi: ERC20_BALANCEOF_ABI,
        functionName: "balanceOf",
        args: [input.signingContext.funderAddress],
      }),
      input.publicClient.readContract({
        address: PUSD_POLYGON,
        abi: erc20Abi,
        functionName: "allowance",
        args: [input.signingContext.funderAddress, COLLATERAL_OFFRAMP_POLYGON],
      }),
    ]);
    if (balance < input.amountAtomic) {
      throw Object.assign(new Error("withdraw: insufficient pUSD balance"), {
        code: "insufficient_balance",
      });
    }

    const txHashes: `0x${string}`[] = [];
    if (allowance < input.amountAtomic) {
      // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
      const approveHash: Hex = await (input.walletClient.writeContract as any)({
        address: PUSD_POLYGON,
        abi: erc20Abi,
        functionName: "approve",
        args: [COLLATERAL_OFFRAMP_POLYGON, input.amountAtomic],
      });
      await this.confirmWithdrawalTx(input.publicClient, approveHash);
      txHashes.push(approveHash);
    }

    // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
    const unwrapHash: Hex = await (input.walletClient.writeContract as any)({
      address: COLLATERAL_OFFRAMP_POLYGON,
      abi: COLLATERAL_OFFRAMP_UNWRAP_ABI,
      functionName: "unwrap",
      args: [USDC_E_POLYGON, input.destination, input.amountAtomic],
    });
    await this.confirmWithdrawalTx(input.publicClient, unwrapHash);
    txHashes.push(unwrapHash);

    this.logWithdrawal({
      billingAccountId: input.billingAccountId,
      connectionId: input.signingContext.connectionId,
      requestedByUserId: input.requestedByUserId,
      asset: "pusd",
      deliveredAsset: "usdc_e",
      sourceAddress: input.signingContext.funderAddress,
      destination: input.destination,
      amountAtomic: input.amountAtomic,
      txHashes,
    });
    return {
      asset: "pusd",
      deliveredAsset: "usdc_e",
      sourceAddress: input.signingContext.funderAddress,
      destination: input.destination,
      amountAtomic: input.amountAtomic,
      primaryTxHash: unwrapHash,
      txHashes,
    };
  }

  private async withdrawNativePol(input: {
    publicClient: PublicClient;
    walletClient: WalletClient;
    signingContext: PolyTraderSigningContext;
    billingAccountId: string;
    requestedByUserId: string;
    destination: Address;
    amountAtomic: bigint;
  }): Promise<PolyWalletWithdrawalResult> {
    const balance = await input.publicClient.getBalance({
      address: input.signingContext.funderAddress,
    });
    const [gas, gasPrice] = await Promise.all([
      input.publicClient.estimateGas({
        account: input.signingContext.funderAddress,
        to: input.destination,
        value: input.amountAtomic,
      }),
      input.publicClient.getGasPrice(),
    ]);
    const required = input.amountAtomic + gas * gasPrice;
    if (balance < required) {
      throw Object.assign(
        new Error("withdraw: insufficient POL for value plus gas"),
        {
          code: "insufficient_balance",
        }
      );
    }

    // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
    const txHash: Hex = await (input.walletClient.sendTransaction as any)({
      to: input.destination,
      value: input.amountAtomic,
    });
    await this.confirmWithdrawalTx(input.publicClient, txHash);
    this.logWithdrawal({
      billingAccountId: input.billingAccountId,
      connectionId: input.signingContext.connectionId,
      requestedByUserId: input.requestedByUserId,
      asset: "pol",
      deliveredAsset: "pol",
      sourceAddress: input.signingContext.funderAddress,
      destination: input.destination,
      amountAtomic: input.amountAtomic,
      txHashes: [txHash],
    });
    return {
      asset: "pol",
      deliveredAsset: "pol",
      sourceAddress: input.signingContext.funderAddress,
      destination: input.destination,
      amountAtomic: input.amountAtomic,
      primaryTxHash: txHash,
      txHashes: [txHash],
    };
  }

  private async confirmWithdrawalTx(
    publicClient: PublicClient,
    txHash: Hex
  ): Promise<void> {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
    });
    if (receipt.status !== "success") {
      throw Object.assign(new Error(`withdraw: tx reverted ${txHash}`), {
        code: "tx_reverted",
      });
    }
  }

  private logWithdrawal(input: {
    billingAccountId: string;
    connectionId: string;
    requestedByUserId: string;
    asset: "usdc_e" | "pusd" | "pol";
    deliveredAsset: "usdc_e" | "pol";
    sourceAddress: `0x${string}`;
    destination: `0x${string}`;
    amountAtomic: bigint;
    txHashes: readonly `0x${string}`[];
  }): void {
    this.log.info(
      {
        billing_account_id: input.billingAccountId,
        connection_id: input.connectionId,
        requested_by_user_id: input.requestedByUserId,
        asset: input.asset,
        delivered_asset: input.deliveredAsset,
        source_address: input.sourceAddress,
        destination: input.destination,
        amount_atomic: input.amountAtomic.toString(),
        primary_tx_hash: input.txHashes[input.txHashes.length - 1] ?? null,
        tx_hashes: input.txHashes,
      },
      "poly.wallet.withdraw.confirmed"
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Deferred methods — follow-up ops slices.
  // ────────────────────────────────────────────────────────────────────────

  async rotateClobCreds(input: {
    billingAccountId: string;
  }): Promise<PolyTraderSigningContext> {
    return this.serviceDb.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${input.billingAccountId}))`
      );

      const rows = await tx
        .select()
        .from(polyWalletConnections)
        .where(
          and(
            eq(polyWalletConnections.billingAccountId, input.billingAccountId),
            isNull(polyWalletConnections.revokedAt)
          )
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        throw Object.assign(
          new Error("rotateClobCreds: no active connection for tenant"),
          { code: "no_connection" as EnableTradingPreflightError }
        );
      }
      if (row.billingAccountId !== input.billingAccountId) {
        throw new Error(
          "tenant mismatch on rotateClobCreds connection SELECT — aborting"
        );
      }

      const aad: AeadAAD = {
        billing_account_id: row.billingAccountId,
        connection_id: row.id,
        provider: CREDENTIAL_PROVIDER,
      };
      const currentCreds = this.decryptCreds(row.clobApiKeyCiphertext, aad);
      const rawAccount = createViemAccount(this.privyClient, {
        walletId: row.privyWalletId,
        address: row.address as `0x${string}`,
        authorizationContext: this.authorizationContext,
      });
      // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
      const account: any = rawAccount;

      const clobCreds = await this.clobCredsRotator(account, currentCreds);
      const ciphertext = aeadEncrypt(
        JSON.stringify(clobCreds),
        aad,
        this.encryptionKey
      );

      await tx
        .update(polyWalletConnections)
        .set({
          clobApiKeyCiphertext: ciphertext,
          encryptionKeyId: this.encryptionKeyId,
        })
        .where(
          and(
            eq(polyWalletConnections.id, row.id),
            eq(polyWalletConnections.billingAccountId, input.billingAccountId),
            isNull(polyWalletConnections.revokedAt)
          )
        );

      return {
        account,
        clobCreds,
        funderAddress: getAddress(row.address),
        connectionId: row.id,
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // task.0429 — auto-wrap consent loop
  // ────────────────────────────────────────────────────────────────────────

  async wrapIdleUsdcE(billingAccountId: string): Promise<WrapIdleUsdcEResult> {
    const rows = await this.serviceDb
      .select({
        id: polyWalletConnections.id,
        billingAccountId: polyWalletConnections.billingAccountId,
        autoWrapConsentAt: polyWalletConnections.autoWrapConsentAt,
        autoWrapRevokedAt: polyWalletConnections.autoWrapRevokedAt,
        autoWrapFloorUsdceE6dp: polyWalletConnections.autoWrapFloorUsdceE6dp,
      })
      .from(polyWalletConnections)
      .where(
        and(
          eq(polyWalletConnections.billingAccountId, billingAccountId),
          isNull(polyWalletConnections.revokedAt)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return {
        outcome: "skipped",
        reason: "not_provisioned",
        observedBalanceAtomic: null,
      };
    }
    if (row.billingAccountId !== billingAccountId) {
      this.log.warn(
        { billing_account_id: billingAccountId, connection_id: row.id },
        "tenant mismatch on wrapIdleUsdcE — refusing"
      );
      return {
        outcome: "skipped",
        reason: "not_provisioned",
        observedBalanceAtomic: null,
      };
    }
    if (row.autoWrapConsentAt === null || row.autoWrapRevokedAt !== null) {
      return {
        outcome: "skipped",
        reason: "no_consent",
        observedBalanceAtomic: null,
      };
    }

    const signingContext = await this.resolve(billingAccountId);
    if (!signingContext) {
      return {
        outcome: "skipped",
        reason: "not_provisioned",
        observedBalanceAtomic: null,
      };
    }
    if (!this.polygonRpcUrl) {
      throw Object.assign(
        new Error(
          "wrapIdleUsdcE: POLYGON_RPC_URL is not configured on this pod"
        ),
        { code: "polygon_rpc_unconfigured" }
      );
    }

    const publicClient = createPublicClient({
      chain: polygon,
      transport: http(this.polygonRpcUrl),
    });
    const balanceAtomic = await publicClient.readContract({
      address: USDC_E_POLYGON,
      abi: ERC20_BALANCEOF_ABI,
      functionName: "balanceOf",
      args: [signingContext.funderAddress],
    });

    if (balanceAtomic === 0n) {
      return {
        outcome: "skipped",
        reason: "no_balance",
        observedBalanceAtomic: balanceAtomic,
      };
    }
    if (balanceAtomic < row.autoWrapFloorUsdceE6dp) {
      return {
        outcome: "skipped",
        reason: "below_floor",
        observedBalanceAtomic: balanceAtomic,
      };
    }

    const walletClient: WalletClient = createWalletClient({
      // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
      account: signingContext.account as any,
      chain: polygon,
      transport: http(this.polygonRpcUrl),
    });

    // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
    const txHash: Hex = await (walletClient.writeContract as any)({
      address: COLLATERAL_ONRAMP_POLYGON,
      abi: COLLATERAL_ONRAMP_WRAP_ABI,
      functionName: "wrap",
      args: [USDC_E_POLYGON, signingContext.funderAddress, balanceAtomic],
    });
    this.log.info(
      {
        billing_account_id: billingAccountId,
        connection_id: signingContext.connectionId,
        amount_atomic: balanceAtomic.toString(),
        tx_hash: txHash,
      },
      "poly.auto_wrap.tx.submitted"
    );
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
    });
    if (receipt.status !== "success") {
      throw new Error(`poly.auto_wrap.tx.reverted ${txHash}`);
    }
    this.log.info(
      {
        billing_account_id: billingAccountId,
        connection_id: signingContext.connectionId,
        amount_atomic: balanceAtomic.toString(),
        tx_hash: txHash,
        block_number: Number(receipt.blockNumber),
      },
      "poly.auto_wrap.tx.confirmed"
    );
    return {
      outcome: "wrapped",
      txHash,
      amountAtomic: balanceAtomic,
    };
  }

  async setAutoWrapConsent(input: {
    billingAccountId: string;
    actorKind: "user" | "agent";
    actorId: string;
    floorUsdceAtomic?: bigint;
  }): Promise<void> {
    const now = new Date();
    const result = await this.serviceDb
      .update(polyWalletConnections)
      .set({
        autoWrapConsentAt: now,
        autoWrapConsentActorKind: input.actorKind,
        autoWrapConsentActorId: input.actorId,
        autoWrapRevokedAt: null,
        ...(input.floorUsdceAtomic !== undefined
          ? { autoWrapFloorUsdceE6dp: input.floorUsdceAtomic }
          : {}),
      })
      .where(
        and(
          eq(polyWalletConnections.billingAccountId, input.billingAccountId),
          isNull(polyWalletConnections.revokedAt)
        )
      )
      .returning({ id: polyWalletConnections.id });
    if (result.length === 0) {
      throw Object.assign(
        new Error(
          "setAutoWrapConsent: no active connection for tenant — provision first"
        ),
        { code: "no_connection" }
      );
    }
    this.log.info(
      {
        billing_account_id: input.billingAccountId,
        connection_id: result[0]?.id,
        actor_kind: input.actorKind,
        actor_id: input.actorId,
        floor_atomic: input.floorUsdceAtomic?.toString() ?? null,
      },
      "poly.auto_wrap.consent.granted"
    );
  }

  async revokeAutoWrapConsent(input: {
    billingAccountId: string;
    actorKind: "user" | "agent";
    actorId: string;
  }): Promise<void> {
    const now = new Date();
    const result = await this.serviceDb
      .update(polyWalletConnections)
      .set({ autoWrapRevokedAt: now })
      .where(
        and(
          eq(polyWalletConnections.billingAccountId, input.billingAccountId),
          isNull(polyWalletConnections.revokedAt)
        )
      )
      .returning({ id: polyWalletConnections.id });
    this.log.info(
      {
        billing_account_id: input.billingAccountId,
        connection_id: result[0]?.id ?? null,
        actor_kind: input.actorKind,
        actor_id: input.actorId,
      },
      "poly.auto_wrap.consent.revoked"
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private decryptCreds(ciphertext: Buffer, aad: AeadAAD): PolyClobApiKeyCreds {
    const plaintext = aeadDecrypt(ciphertext, aad, this.encryptionKey);
    const parsed = JSON.parse(plaintext) as PolyClobApiKeyCreds;
    if (!parsed.key || !parsed.secret || !parsed.passphrase) {
      throw new Error("decrypted CLOB creds missing required fields");
    }
    return parsed;
  }
}
