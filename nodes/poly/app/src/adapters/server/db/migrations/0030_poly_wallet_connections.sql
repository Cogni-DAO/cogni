-- ============================================================================
-- task.0318 Phase B — per-tenant Polymarket trading wallets.
--
-- Spec: docs/spec/poly-trader-wallet-port.md
--       docs/spec/poly-multi-tenant-auth.md (Phase B)
--
-- Stores one per-tenant `poly_wallet_connections` row binding a billing
-- account to a Privy server-wallet (in the DEDICATED user-wallets Privy app,
-- NOT the operator-wallet system app — SEPARATE_PRIVY_APP invariant) plus
-- AEAD-encrypted Polymarket CLOB L2 creds. RLS scopes reads through
-- billing-account ownership (matching `llm_charge_details`) — principal-agnostic:
-- whoever the app resolves for `app.current_user_id` gets access iff they own
-- the referenced billing_account. Partial unique index enforces one active
-- wallet per tenant.
--
-- PINNED INVARIANTS (source: docs/spec/poly-trader-wallet-port.md)
--
--   TENANT_SCOPED
--     Every row carries (billing_account_id, created_by_user_id). NOT NULL.
--
--   CREDS_ENCRYPTED_AT_REST
--     clob_api_key_ciphertext is a bytea from the AEAD envelope in
--     packages/node-shared/src/crypto/aead.ts. Plaintext never touches disk.
--
--   CUSTODIAL_CONSENT
--     custodial_consent_accepted_at MUST be set before a row is inserted
--     (enforced app-side; DB carries NOT NULL as a backstop).
--
--   REVOKE_IS_DURABLE
--     revoked_at is the authoritative kill-switch. Partial unique index
--     allows re-provisioning after revoke with a fresh row.
-- ============================================================================

CREATE TABLE "poly_wallet_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "billing_account_id" text NOT NULL REFERENCES "billing_accounts"("id") ON DELETE CASCADE,
  "created_by_user_id" text NOT NULL REFERENCES "users"("id"),
  "privy_wallet_id" text NOT NULL,
  "address" text NOT NULL,
  "chain_id" integer NOT NULL DEFAULT 137,
  "clob_api_key_ciphertext" bytea NOT NULL,
  "encryption_key_id" text NOT NULL,
  "allowance_state" jsonb,
  "custodial_consent_accepted_at" timestamptz NOT NULL,
  "custodial_consent_actor_kind" text NOT NULL,
  "custodial_consent_actor_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "revoked_by_user_id" text REFERENCES "users"("id"),
  CONSTRAINT "poly_wallet_connections_address_shape"
    CHECK ("address" ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT "poly_wallet_connections_privy_wallet_id_nonempty"
    CHECK (char_length("privy_wallet_id") > 0),
  CONSTRAINT "poly_wallet_connections_consent_actor_kind"
    CHECK ("custodial_consent_actor_kind" IN ('user', 'agent'))
);--> statement-breakpoint

-- One active wallet per tenant; revoked rows do not block re-provisioning.
CREATE UNIQUE INDEX "poly_wallet_connections_tenant_active_idx"
  ON "poly_wallet_connections"("billing_account_id")
  WHERE "revoked_at" IS NULL;--> statement-breakpoint

-- Global address uniqueness across un-revoked rows prevents two tenants
-- binding to the same Privy wallet address accidentally.
CREATE UNIQUE INDEX "poly_wallet_connections_address_chain_active_idx"
  ON "poly_wallet_connections"("chain_id", "address")
  WHERE "revoked_at" IS NULL;--> statement-breakpoint

CREATE INDEX "poly_wallet_connections_created_by_user_idx"
  ON "poly_wallet_connections"("created_by_user_id");--> statement-breakpoint

ALTER TABLE "poly_wallet_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "poly_wallet_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Tenant isolation via billing-account ownership (mirrors the `llm_charge_details`
-- pattern). `created_by_user_id` is audit metadata only — NOT an RLS key. The app
-- layer decides what `app.current_user_id` resolves to (today: the authenticated
-- end-user; future: any actor — agent API key, service principal — whose session
-- resolves to a user_id that owns the billing_account). When multi-user billing
-- accounts land, swap the EXISTS clause below to a membership check; no column
-- change required.
CREATE POLICY "tenant_isolation" ON "poly_wallet_connections"
  USING (
    EXISTS (
      SELECT 1 FROM "billing_accounts" ba
      WHERE ba."id" = "poly_wallet_connections"."billing_account_id"
        AND ba."owner_user_id" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "billing_accounts" ba
      WHERE ba."id" = "poly_wallet_connections"."billing_account_id"
        AND ba."owner_user_id" = current_setting('app.current_user_id', true)
    )
  );--> statement-breakpoint
