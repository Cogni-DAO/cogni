// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/wallet/privy-poly-trader-wallet.adapter`
 * Purpose: Privy-backed PolyTraderWalletPort implementation. Manages per-tenant
 *   Polymarket trading wallets by delegating custody to a DEDICATED user-wallets
 *   Privy app (SEPARATE_PRIVY_APP) — never the operator-wallet system app.
 * Scope: `provision` (advisory-locked idempotent), `resolve`, `getAddress`,
 *   `getBalances` (DB address + optional Polygon RPC via `POLYGON_RPC_URL`),
 *   `revoke`. Other port methods (`authorizeIntent`, `withdrawUsdc`,
 *   `rotateClobCreds`) are stubbed until a follow-up commit lands the grants
 *   table + withdraw flow + CLOB rotation wiring.
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
 * Side-effects: IO (Privy API, DB reads/writes, AEAD crypto).
 * Links: docs/spec/poly-trader-wallet-port.md,
 *        docs/spec/poly-multi-tenant-auth.md
 * @internal
 */

import type { Database } from "@cogni/db-client";
import { type AeadAAD, aeadDecrypt, aeadEncrypt } from "@cogni/node-shared";
import { polyWalletConnections } from "@cogni/poly-db-schema";
import type {
  AuthorizeIntentResult,
  CustodialConsent,
  OrderIntentSummary,
  PolyClobApiKeyCreds,
  PolyTraderSigningContext,
  PolyTraderWalletPort,
} from "@cogni/poly-wallet";
import type { AuthorizationContext, PrivyClient } from "@privy-io/node";
import { createViemAccount } from "@privy-io/node/viem";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { Logger } from "pino";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  type LocalAccount,
  parseAbi,
} from "viem";
import { polygon } from "viem/chains";

/** Provider identifier pinned into the AEAD AAD envelope. */
const CREDENTIAL_PROVIDER = "polymarket_clob";

/** USDC.e on Polygon mainnet — Polymarket's quote token. Pinned here so the */
/* adapter never has to guess which stable it's reading. */
const USDC_E_POLYGON = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
const USDC_DECIMALS = 6;
const POL_DECIMALS = 18;
const ERC20_BALANCEOF_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

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
    const consent = input.custodialConsent;

    return this.serviceDb.transaction(async (tx) => {
      // PROVISION_IS_IDEMPOTENT: tenant-scoped advisory lock for the whole txn.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${input.billingAccountId}))`
      );

      // Idempotency short-circuit.
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
          account,
          clobCreds,
          funderAddress: getAddress(row.address),
          connectionId: row.id,
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

      // Fresh provision path. The idempotencyKey option maps to the
      // `privy-idempotency-key` HTTP header; Privy returns the same wallet
      // for repeated calls with the same key instead of minting a new one.
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

      // Pre-assign the row id so the AEAD AAD binds to it before INSERT.
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
        account,
        clobCreds,
        funderAddress: getAddress(privyWallet.address),
        connectionId: gen_id,
      };
    });
  }

  /**
   * Soft-delete the tenant's active connection row.
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
   * A real balance-guard lands with B3 (withdraw UX + Polygon RPC wiring); for
   * v0 the port stays halt-future-only and enforcement lives in the caller.
   */
  async revoke(input: {
    billingAccountId: string;
    revokedByUserId: string;
  }): Promise<void> {
    await this.serviceDb
      .update(polyWalletConnections)
      .set({
        revokedAt: new Date(),
        revokedByUserId: input.revokedByUserId,
      })
      .where(
        and(
          eq(polyWalletConnections.billingAccountId, input.billingAccountId),
          isNull(polyWalletConnections.revokedAt)
        )
      );
    this.log.info(
      {
        billing_account_id: input.billingAccountId,
        revoked_by_user_id: input.revokedByUserId,
      },
      "poly.wallet.revoke — soft-deleted active connection (funds NOT moved; caller must have enforced withdraw)"
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Deferred methods — lands in a follow-up B2 slice alongside grants table.
  // Calls throw explicitly so misuse is obvious in logs + tests.
  // ────────────────────────────────────────────────────────────────────────

  async authorizeIntent(
    _billingAccountId: string,
    _intent: OrderIntentSummary
  ): Promise<AuthorizeIntentResult> {
    throw new Error(
      "PrivyPolyTraderWalletAdapter.authorizeIntent: not implemented (B4 grants wiring)"
    );
  }

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
