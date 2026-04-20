// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-db-schema/wallet-connections`
 * Purpose: Schema for per-tenant Polymarket trading wallets (task.0318 Phase B).
 *   One active `poly_wallet_connections` row per billing account, binding to a
 *   Privy server-wallet id in the DEDICATED user-wallets Privy app (not the
 *   operator-wallet system app) plus AEAD-encrypted Polymarket CLOB L2 creds.
 * Scope: Drizzle table definition only. No queries, no RLS policy (lives in
 *   migration `0030_poly_wallet_connections.sql`), no runtime logic.
 * Invariants:
 *   - TENANT_SCOPED: (billing_account_id, created_by_user_id) NOT NULL.
 *   - CREDS_ENCRYPTED_AT_REST: clob_api_key_ciphertext is bytea from the
 *     aeadEncrypt helper in `@cogni/node-shared/crypto/aead`.
 *   - CUSTODIAL_CONSENT: custodial_consent_accepted_at NOT NULL (app enforces
 *     before insert; DB carries NOT NULL as backstop).
 *   - REVOKE_IS_DURABLE: revoked_at is the soft-delete kill-switch. Partial
 *     unique index on billing_account_id WHERE revoked_at IS NULL allows
 *     re-provisioning after revoke.
 *   - SEPARATE_PRIVY_APP: privy_wallet_id references the USER-WALLETS Privy
 *     app only. The app-layer adapter enforces this; the DB cannot.
 * Side-effects: none (schema only)
 * Links: docs/spec/poly-trader-wallet-port.md,
 *        docs/spec/poly-multi-tenant-auth.md,
 *        work/items/task.0318.poly-wallet-multi-tenant-auth.md
 * @public
 */

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; notNull: true; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Per-tenant Polymarket trading wallet binding.
 *
 * One active row per `billing_account_id` (partial unique index). Stores the
 * Privy server-wallet id (in the USER-WALLETS Privy app) + encrypted L2 CLOB
 * creds + allowance snapshot + custodial-consent trail.
 *
 * @public
 */
export const polyWalletConnections = pgTable(
  "poly_wallet_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Tenant data column. FK → billing_accounts.id (enforced in migration). */
    billingAccountId: text("billing_account_id").notNull(),
    /** RLS key column. FK → users.id. */
    createdByUserId: text("created_by_user_id").notNull(),
    /** Privy server-wallet id in the USER-WALLETS Privy app. */
    privyWalletId: text("privy_wallet_id").notNull(),
    /** Checksummed EOA address. */
    address: text("address").notNull(),
    /** 137 = Polygon mainnet today. */
    chainId: integer("chain_id").notNull().default(137),
    /** AEAD ciphertext of the JSON-serialized ApiKeyCreds. */
    clobApiKeyCiphertext: bytea("clob_api_key_ciphertext").notNull(),
    /** Key-ring id used to encrypt `clobApiKeyCiphertext`. Enables rotation. */
    encryptionKeyId: text("encryption_key_id").notNull(),
    /** Last observed on-chain allowance snapshot (Exchange + NegRisk + CTF). */
    allowanceState: jsonb("allowance_state"),
    /** When the tenant accepted the custodial disclosure. */
    custodialConsentAcceptedAt: timestamp("custodial_consent_accepted_at", {
      withTimezone: true,
    }).notNull(),
    /** 'user' or 'agent' — who accepted the disclosure. */
    custodialConsentActorKind: text("custodial_consent_actor_kind").notNull(),
    /** Principal id of the actor that accepted. */
    custodialConsentActorId: text("custodial_consent_actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: text("revoked_by_user_id"),
  },
  (table) => ({
    addressShape: check(
      "poly_wallet_connections_address_shape",
      sql`${table.address} ~ '^0x[a-fA-F0-9]{40}$'`,
    ),
    privyWalletIdNonempty: check(
      "poly_wallet_connections_privy_wallet_id_nonempty",
      sql`char_length(${table.privyWalletId}) > 0`,
    ),
    consentActorKind: check(
      "poly_wallet_connections_consent_actor_kind",
      sql`${table.custodialConsentActorKind} IN ('user', 'agent')`,
    ),
    tenantActive: uniqueIndex(
      "poly_wallet_connections_tenant_active_idx",
    ).on(table.billingAccountId).where(sql`${table.revokedAt} IS NULL`),
    addressChainActive: uniqueIndex(
      "poly_wallet_connections_address_chain_active_idx",
    )
      .on(table.chainId, table.address)
      .where(sql`${table.revokedAt} IS NULL`),
    byUser: index("poly_wallet_connections_created_by_user_idx").on(
      table.createdByUserId,
    ),
  }),
);

export type PolyWalletConnectionRow = typeof polyWalletConnections.$inferSelect;
export type PolyWalletConnectionInsert =
  typeof polyWalletConnections.$inferInsert;
