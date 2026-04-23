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
 *   `AuthorizedSigningContext`), `ensureTradingApprovals` (idempotent 6-step
 *   Polymarket onboarding: 3× USDC.e `approve` + 3× CTF `setApprovalForAll`
 *   signed by Privy HSM; stamps the `trading_approvals_ready_at` readiness
 *   column on success), `revoke` (cascades across `poly_wallet_grants` in
 *   the same tx + clears `trading_approvals_ready_at` so the next connection
 *   re-runs the approvals flow).
 *   `withdrawUsdc` + `rotateClobCreds` remain stubbed until the Money-page
 *   withdraw + CLOB-rotation items land.
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
  TradingApprovalStep,
  TradingApprovalsState,
} from "@cogni/poly-wallet";
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

// ─── APPROVAL_TARGETS_PINNED ────────────────────────────────────────────────
// Polymarket mainnet CLOB contracts. Source-of-truth: `@polymarket/clob-client`
// `config.js` + `scripts/experiments/approve-polymarket-allowances.ts`. Not
// env-overridable, not user-input — a misconfigured address here would
// authorize an arbitrary spender to move the tenant's entire USDC.e balance.
// ───────────────────────────────────────────────────────────────────────────
const CTF_POLYGON = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045" as Address;
const EXCHANGE_POLYMARKET =
  "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E" as Address;
const NEG_RISK_EXCHANGE_POLYMARKET =
  "0xC5d563A36AE78145C45a50134d48A1215220f80a" as Address;
const NEG_RISK_ADAPTER_POLYMARKET =
  "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296" as Address;

/** 3 USDC.e spenders that need max-uint256 allowance (enables BUY). */
const USDC_E_SPENDERS: readonly { label: string; address: Address }[] = [
  { label: "USDC.e → Exchange", address: EXCHANGE_POLYMARKET },
  {
    label: "USDC.e → Neg-Risk Exchange",
    address: NEG_RISK_EXCHANGE_POLYMARKET,
  },
  { label: "USDC.e → Neg-Risk Adapter", address: NEG_RISK_ADAPTER_POLYMARKET },
];

/** 3 CTF operators that need `setApprovalForAll(true)` (enables SELL). */
const CTF_OPERATORS: readonly { label: string; address: Address }[] = [
  { label: "CTF → Exchange", address: EXCHANGE_POLYMARKET },
  { label: "CTF → Neg-Risk Exchange", address: NEG_RISK_EXCHANGE_POLYMARKET },
  { label: "CTF → Neg-Risk Adapter", address: NEG_RISK_ADAPTER_POLYMARKET },
];

const CTF_SET_APPROVAL_ABI = parseAbi([
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
]);

/**
 * Minimum POL balance required before we start submitting approval txs.
 * Empirically each tx is ~35k gas @ ~30 gwei ≈ 0.001 POL; 6 txs + headroom
 * for gas-price spikes ≈ 0.02 POL. We gate on 0.02 to keep the UX error
 * ("insufficient gas") fast and loud instead of letting a mid-sequence tx
 * fail and leave the wallet half-approved.
 */
const ENABLE_TRADING_MIN_POL = 0.02;

/**
 * Default scopes auto-issued alongside every new wallet. BUY + SELL so the
 * mirror pipeline's closePosition path can execute from day one; tenants can
 * downscope later via grant revoke + re-issue.
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
    this.polygonRpcUrl = config.polygonRpcUrl;
    this.log = config.logger.child({
      component: "PrivyPolyTraderWalletAdapter",
    });
  }

  async resolve(
    billingAccountId: string
  ): Promise<PolyTraderSigningContext | null> {
    try {
      const rows = await this.serviceDb
        .select()
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

      // TENANT_DEFENSE_IN_DEPTH
      if (row.billingAccountId !== billingAccountId) {
        this.log.warn(
          { billing_account_id: billingAccountId, connection_id: row.id },
          "tenant mismatch on poly_wallet_connections SELECT — refusing to resolve"
        );
        return null;
      }

      const clobCreds = this.decryptCreds(row.clobApiKeyCiphertext, {
        billing_account_id: row.billingAccountId,
        connection_id: row.id,
        provider: CREDENTIAL_PROVIDER,
      });

      const rawAccount = createViemAccount(this.privyClient, {
        walletId: row.privyWalletId,
        address: row.address as `0x${string}`,
        authorizationContext: this.authorizationContext,
      });
      // viem version drift between @privy-io/node/viem peerDep and this app's
      // viem forces a cast (runtime shape matches LocalAccount exactly — same
      // pattern as poly-trade.ts:696-700).
      // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
      const account: any = rawAccount;

      return {
        account,
        clobCreds,
        funderAddress: getAddress(row.address),
        connectionId: row.id,
      };
    } catch (err) {
      this.log.warn(
        {
          billing_account_id: billingAccountId,
          err: err instanceof Error ? err.message : String(err),
        },
        "poly_wallet resolve failed — returning null (fail-closed)"
      );
      return null;
    }
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
  } | null> {
    const rows = await this.serviceDb
      .select({
        id: polyWalletConnections.id,
        billingAccountId: polyWalletConnections.billingAccountId,
        address: polyWalletConnections.address,
        tradingApprovalsReadyAt: polyWalletConnections.tradingApprovalsReadyAt,
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
    };
  }

  async getBalances(billingAccountId: string): Promise<{
    address: `0x${string}`;
    usdcE: number | null;
    pol: number | null;
    errors: readonly string[];
  } | null> {
    const address = await this.getAddress(billingAccountId);
    if (!address) return null;

    const errors: string[] = [];
    const [usdcE, pol] = await this.readPolygonBalances(address, errors);
    return { address, usdcE, pol, errors };
  }

  private async readPolygonBalances(
    addr: `0x${string}`,
    errors: string[]
  ): Promise<[number | null, number | null]> {
    if (!this.polygonRpcUrl) {
      errors.push("polygon_rpc_unconfigured");
      return [null, null];
    }
    try {
      const client = createPublicClient({
        chain: polygon,
        transport: http(this.polygonRpcUrl),
      });
      const [usdcRaw, polRaw] = await Promise.all([
        client.readContract({
          address: USDC_E_POLYGON,
          abi: ERC20_BALANCEOF_ABI,
          functionName: "balanceOf",
          args: [addr],
        }),
        client.getBalance({ address: addr }),
      ]);
      return [
        Number(formatUnits(usdcRaw, USDC_DECIMALS)),
        Number(formatUnits(polRaw, POL_DECIMALS)),
      ];
    } catch (err) {
      errors.push(
        `polygon_rpc: ${err instanceof Error ? err.message : String(err)}`
      );
      return [null, null];
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
    const signingContext = await this.resolve(billingAccountId);
    if (!signingContext) {
      throw Object.assign(
        new Error(
          "ensureTradingApprovals: no active connection for tenant — provision first"
        ),
        { code: "no_connection" as EnableTradingPreflightError }
      );
    }
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

    const [polRaw, usdcAllowances, ctfApprovals] = await Promise.all([
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
        CTF_OPERATORS.map((op) =>
          publicClient.readContract({
            address: CTF_POLYGON,
            abi: CTF_SET_APPROVAL_ABI,
            functionName: "isApprovedForAll",
            args: [address, op.address],
          })
        )
      ),
    ]);

    const polBalance = Number(formatUnits(polRaw, POL_DECIMALS));

    this.log.info(
      {
        billing_account_id: billingAccountId,
        connection_id: signingContext.connectionId,
        funder_address: address,
        pol_balance: polBalance,
        usdc_allowances: usdcAllowances.map((a) => a === maxUint256),
        ctf_approvals: ctfApprovals,
      },
      "poly.wallet.enable_trading.start"
    );

    const steps: TradingApprovalStep[] = [];
    const needsUsdc = usdcAllowances.map((a) => a !== maxUint256);
    const needsCtf = ctfApprovals.map((b) => !b);
    const workCount =
      needsUsdc.filter(Boolean).length + needsCtf.filter(Boolean).length;

    if (workCount === 0) {
      // Already-satisfied — record every target as `satisfied` and stamp DB.
      for (let i = 0; i < USDC_E_SPENDERS.length; i++) {
        const sp = USDC_E_SPENDERS[i];
        if (!sp) continue;
        steps.push({
          kind: "erc20_approve",
          label: sp.label,
          tokenContract: USDC_E_POLYGON,
          operator: sp.address,
          state: "satisfied",
          txHash: null,
          error: null,
        });
      }
      for (let i = 0; i < CTF_OPERATORS.length; i++) {
        const op = CTF_OPERATORS[i];
        if (!op) continue;
        steps.push({
          kind: "ctf_set_approval_for_all",
          label: op.label,
          tokenContract: CTF_POLYGON,
          operator: op.address,
          state: "satisfied",
          txHash: null,
          error: null,
        });
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
        },
        "poly.wallet.enable_trading.already_ready"
      );
      return { ready: true, address, polBalance, steps, readyAt };
    }

    // Gas preflight: fail-fast with skipped steps, no tx submitted.
    if (polBalance < ENABLE_TRADING_MIN_POL) {
      for (let i = 0; i < USDC_E_SPENDERS.length; i++) {
        const sp = USDC_E_SPENDERS[i];
        if (!sp) continue;
        steps.push({
          kind: "erc20_approve",
          label: sp.label,
          tokenContract: USDC_E_POLYGON,
          operator: sp.address,
          state: usdcAllowances[i] === maxUint256 ? "satisfied" : "skipped",
          txHash: null,
          error:
            usdcAllowances[i] === maxUint256 ? null : "insufficient_pol_gas",
        });
      }
      for (let i = 0; i < CTF_OPERATORS.length; i++) {
        const op = CTF_OPERATORS[i];
        if (!op) continue;
        steps.push({
          kind: "ctf_set_approval_for_all",
          label: op.label,
          tokenContract: CTF_POLYGON,
          operator: op.address,
          state: ctfApprovals[i] ? "satisfied" : "skipped",
          txHash: null,
          error: ctfApprovals[i] ? null : "insufficient_pol_gas",
        });
      }
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

    // Sequential writes — parallel would race the Privy signer's nonce.
    let allOk = true;
    for (let i = 0; i < USDC_E_SPENDERS.length; i++) {
      const sp = USDC_E_SPENDERS[i];
      if (!sp) continue;
      if (!needsUsdc[i]) {
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
        sp
      );
      steps.push(step);
      if (step.state !== "set") {
        allOk = false;
        break;
      }
    }
    if (allOk) {
      for (let i = 0; i < CTF_OPERATORS.length; i++) {
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
        if (step.state !== "set") {
          allOk = false;
          break;
        }
      }
    }

    // Any failure aborts mid-sequence — don't stamp; pad remaining steps as
    // skipped so the UI renders the full 6-pill row.
    while (steps.length < USDC_E_SPENDERS.length + CTF_OPERATORS.length) {
      const idx = steps.length;
      if (idx < USDC_E_SPENDERS.length) {
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
      } else {
        const op = CTF_OPERATORS[idx - USDC_E_SPENDERS.length];
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
    target: { label: string; address: Address }
  ): Promise<TradingApprovalStep> {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: cross-peerDep viem type drift
      const hash: Hex = await (walletClient.writeContract as any)({
        address: USDC_E_POLYGON,
        abi: erc20Abi,
        functionName: "approve",
        args: [target.address, maxUint256],
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
          kind: "erc20_approve",
          label: target.label,
          tokenContract: USDC_E_POLYGON,
          operator: target.address,
          state: "failed",
          txHash: hash,
          error: "tx_reverted",
        };
      }
      // Pin the post-verify to the receipt's block — publicnode RPCs
      // round-robin, a fresh read can hit a lagging node.
      const after = await publicClient.readContract({
        address: USDC_E_POLYGON,
        abi: erc20Abi,
        functionName: "allowance",
        args: [signingContext.funderAddress, target.address],
        blockNumber: receipt.blockNumber,
      });
      if (after !== maxUint256) {
        return {
          kind: "erc20_approve",
          label: target.label,
          tokenContract: USDC_E_POLYGON,
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
        kind: "erc20_approve",
        label: target.label,
        tokenContract: USDC_E_POLYGON,
        operator: target.address,
        state: "set",
        txHash: hash,
        error: null,
      };
    } catch (err) {
      return {
        kind: "erc20_approve",
        label: target.label,
        tokenContract: USDC_E_POLYGON,
        operator: target.address,
        state: "failed",
        txHash: null,
        error:
          err instanceof Error ? err.message.slice(0, 128) : "submit_failed",
      };
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
  // Deferred methods — follow-up ops slices.
  // ────────────────────────────────────────────────────────────────────────

  async withdrawUsdc(_input: {
    billingAccountId: string;
    destination: `0x${string}`;
    amountAtomic: bigint;
    requestedByUserId: string;
  }): Promise<{ txHash: `0x${string}` }> {
    throw new Error(
      "PrivyPolyTraderWalletAdapter.withdrawUsdc: not implemented (follow-up B3 slice)"
    );
  }

  async rotateClobCreds(_input: {
    billingAccountId: string;
  }): Promise<PolyTraderSigningContext> {
    throw new Error(
      "PrivyPolyTraderWalletAdapter.rotateClobCreds: not implemented (follow-up ops slice)"
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
