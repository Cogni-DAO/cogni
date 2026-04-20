// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/wallet/privy-poly-trader-wallet.adapter`
 * Purpose: Privy-backed PolyTraderWalletPort implementation. Manages per-tenant
 *   Polymarket trading wallets by delegating custody to a DEDICATED user-wallets
 *   Privy app (SEPARATE_PRIVY_APP) — never the operator-wallet system app.
 * Scope: `provision` (advisory-locked idempotent), `resolve`, `getAddress`,
 *   `revoke`. Other port methods (`authorizeIntent`, `withdrawUsdc`,
 *   `rotateClobCreds`) are stubbed until a follow-up commit lands the grants
 *   table + withdraw flow + CLOB rotation wiring.
 * Invariants:
 *   - SEPARATE_PRIVY_APP: constructor takes a PrivyClient built from
 *     PRIVY_USER_WALLETS_* env. The operator-wallet triple is never read here.
 *   - TENANT_SCOPED: every method takes or derives `billingAccountId`.
 *   - KEY_NEVER_IN_APP: raw key material is held by Privy HSM.
 *   - FAIL_CLOSED_ON_RESOLVE: returns null on any error.
 *   - TENANT_DEFENSE_IN_DEPTH: post-SELECT equality check on billing_account_id.
 *   - CREDS_ENCRYPTED_AT_REST: clobApiKeyCiphertext is AEAD(aes-256-gcm) with
 *     AAD bound to (billing_account_id, connection_id, provider).
 *   - PROVISION_IS_IDEMPOTENT: pg_advisory_xact_lock on hashtext(billing_account_id).
 * Side-effects: IO (Privy API, DB reads/writes, AEAD crypto).
 * Links: docs/spec/poly-trader-wallet-port.md,
 *        docs/spec/poly-multi-tenant-auth.md
 * @internal
 */

import type { AuthorizationContext, PrivyClient } from "@privy-io/node";
import { createViemAccount } from "@privy-io/node/viem";
import type { Database } from "@cogni/db-client";
import { polyWalletConnections } from "@cogni/poly-db-schema";
import type {
  AuthorizedSigningContext,
  AuthorizeIntentResult,
  OrderIntentSummary,
  PolyClobApiKeyCreds,
  PolyTraderSigningContext,
  PolyTraderWalletPort,
} from "@cogni/poly-wallet";
import { aeadDecrypt, aeadEncrypt, type AeadAAD } from "@cogni/node-shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { getAddress, type LocalAccount } from "viem";

/** Provider identifier pinned into the AEAD AAD envelope. */
const CREDENTIAL_PROVIDER = "polymarket_clob";

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
  clobCredsFactory: (
    signer: LocalAccount,
  ) => Promise<PolyClobApiKeyCreds>;
  logger: Logger;
}

export class PrivyPolyTraderWalletAdapter implements PolyTraderWalletPort {
  private readonly privyClient: PrivyClient;
  private readonly authorizationContext: AuthorizationContext;
  private readonly serviceDb: Database;
  private readonly encryptionKey: Buffer;
  private readonly encryptionKeyId: string;
  private readonly clobCredsFactory: (
    signer: LocalAccount,
  ) => Promise<PolyClobApiKeyCreds>;
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
    this.log = config.logger.child({
      component: "PrivyPolyTraderWalletAdapter",
    });
  }

  async resolve(
    billingAccountId: string,
  ): Promise<PolyTraderSigningContext | null> {
    try {
      const rows = await this.serviceDb
        .select()
        .from(polyWalletConnections)
        .where(
          and(
            eq(polyWalletConnections.billingAccountId, billingAccountId),
            isNull(polyWalletConnections.revokedAt),
          ),
        )
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      // TENANT_DEFENSE_IN_DEPTH
      if (row.billingAccountId !== billingAccountId) {
        this.log.warn(
          { billing_account_id: billingAccountId, connection_id: row.id },
          "tenant mismatch on poly_wallet_connections SELECT — refusing to resolve",
        );
        return null;
      }

      const clobCreds = this.decryptCreds(row.clobApiKeyCiphertext, {
        billing_account_id: row.billingAccountId,
        connection_id: row.id,
        provider: CREDENTIAL_PROVIDER,
      });

      const account = createViemAccount(this.privyClient, {
        walletId: row.privyWalletId,
        address: row.address as `0x${string}`,
        authorizationContext: this.authorizationContext,
      });

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
        "poly_wallet resolve failed — returning null (fail-closed)",
      );
      return null;
    }
  }

  async getAddress(
    billingAccountId: string,
  ): Promise<`0x${string}` | null> {
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
          isNull(polyWalletConnections.revokedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    if (row.billingAccountId !== billingAccountId) {
      this.log.warn(
        { billing_account_id: billingAccountId, connection_id: row.id },
        "tenant mismatch on getAddress — refusing",
      );
      return null;
    }
    return getAddress(row.address);
  }

  async provision(input: {
    billingAccountId: string;
    createdByUserId: string;
    custodialConsent?: {
      acceptedAt: Date;
      actorKind: "user" | "agent";
      actorId: string;
    };
  }): Promise<PolyTraderSigningContext> {
    const consent = input.custodialConsent;
    if (!consent) {
      // CUSTODIAL_CONSENT backstop; API layer is the authoritative gate.
      throw new Error(
        "CUSTODIAL_CONSENT: provision called without custodialConsent payload",
      );
    }

    return this.serviceDb.transaction(async (tx) => {
      // PROVISION_IS_IDEMPOTENT: tenant-scoped advisory lock for the whole txn.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${input.billingAccountId}))`,
      );

      // Idempotency short-circuit.
      const existing = await tx
        .select()
        .from(polyWalletConnections)
        .where(
          and(
            eq(polyWalletConnections.billingAccountId, input.billingAccountId),
            isNull(polyWalletConnections.revokedAt),
          ),
        )
        .limit(1);

      if (existing[0]) {
        const row = existing[0];
        if (row.billingAccountId !== input.billingAccountId) {
          throw new Error(
            "tenant mismatch on provision idempotency check — aborting",
          );
        }
        const clobCreds = this.decryptCreds(row.clobApiKeyCiphertext, {
          billing_account_id: row.billingAccountId,
          connection_id: row.id,
          provider: CREDENTIAL_PROVIDER,
        });
        const account = createViemAccount(this.privyClient, {
          walletId: row.privyWalletId,
          address: row.address as `0x${string}`,
          authorizationContext: this.authorizationContext,
        });
        return {
          account,
          clobCreds,
          funderAddress: getAddress(row.address),
          connectionId: row.id,
        };
      }

      // Fresh provision path.
      const privyWallet = await this.privyClient
        .wallets()
        .create({ chain_type: "ethereum" });

      const account = createViemAccount(this.privyClient, {
        walletId: privyWallet.id,
        address: privyWallet.address as `0x${string}`,
        authorizationContext: this.authorizationContext,
      });

      const clobCreds = await this.clobCredsFactory(account);

      // Pre-assign the row id so the AEAD AAD binds to it before INSERT.
      const [{ gen_id }] = (await tx.execute<{ gen_id: string }>(
        sql`SELECT gen_random_uuid()::text AS gen_id`,
      )) as unknown as [{ gen_id: string }];

      const aad: AeadAAD = {
        billing_account_id: input.billingAccountId,
        connection_id: gen_id,
        provider: CREDENTIAL_PROVIDER,
      };
      const ciphertext = aeadEncrypt(
        JSON.stringify(clobCreds),
        aad,
        this.encryptionKey,
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
        },
        "poly.wallet.provision — created per-tenant Privy trading wallet",
      );

      return {
        account,
        clobCreds,
        funderAddress: getAddress(privyWallet.address),
        connectionId: gen_id,
      };
    });
  }

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
          isNull(polyWalletConnections.revokedAt),
        ),
      );
    this.log.info(
      {
        billing_account_id: input.billingAccountId,
        revoked_by_user_id: input.revokedByUserId,
      },
      "poly.wallet.revoke — soft-deleted active connection",
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Deferred methods — lands in a follow-up B2 slice alongside grants table.
  // Calls throw explicitly so misuse is obvious in logs + tests.
  // ────────────────────────────────────────────────────────────────────────

  async authorizeIntent(
    _billingAccountId: string,
    _intent: OrderIntentSummary,
  ): Promise<AuthorizeIntentResult> {
    throw new Error(
      "PrivyPolyTraderWalletAdapter.authorizeIntent: not implemented (B4 grants wiring)",
    );
  }

  async withdrawUsdc(_input: {
    billingAccountId: string;
    destination: `0x${string}`;
    amountAtomic: bigint;
    requestedByUserId: string;
  }): Promise<{ txHash: `0x${string}` }> {
    throw new Error(
      "PrivyPolyTraderWalletAdapter.withdrawUsdc: not implemented (follow-up B3 slice)",
    );
  }

  async rotateClobCreds(_input: {
    billingAccountId: string;
  }): Promise<PolyTraderSigningContext> {
    throw new Error(
      "PrivyPolyTraderWalletAdapter.rotateClobCreds: not implemented (follow-up ops slice)",
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private decryptCreds(
    ciphertext: Buffer,
    aad: AeadAAD,
  ): PolyClobApiKeyCreds {
    const plaintext = aeadDecrypt(ciphertext, aad, this.encryptionKey);
    const parsed = JSON.parse(plaintext) as PolyClobApiKeyCreds;
    if (!parsed.key || !parsed.secret || !parsed.passphrase) {
      throw new Error("decrypted CLOB creds missing required fields");
    }
    return parsed;
  }

  /**
   * Narrow `PolyTraderSigningContext` → `AuthorizedSigningContext` by adding
   * the grant brand. Marked for use by `authorizeIntent` once the grants
   * table lands. Kept here so the branding logic lives in one place.
   */
  protected brandAuthorized(
    context: PolyTraderSigningContext,
    grantId: string,
    intent: OrderIntentSummary,
  ): AuthorizedSigningContext {
    return Object.freeze({
      ...context,
      grantId,
      authorizedIntent: intent,
    }) as AuthorizedSigningContext;
  }
}
