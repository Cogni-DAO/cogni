-- ============================================================================
-- task.0318 Phase B3 — per-tenant Polymarket trade-authorization grants.
--
-- Spec: docs/spec/poly-trader-wallet-port.md (AUTHORIZED_SIGNING_ONLY)
--       docs/spec/poly-multi-tenant-auth.md
--       .cursor/plans/poly-per-tenant-trade-execution_92073c70.plan.md
--
-- One row per active (billing_account, grant) binding. `authorizeIntent` on
-- the PolyTraderWalletPort reads the active grant, validates scope + caps,
-- and mints the branded `AuthorizedSigningContext` that
-- `PolymarketClobAdapter.placeOrder` requires. Without an active grant row a
-- tenant CANNOT place orders — fail-closed at the adapter boundary.
--
-- Consent is NOT duplicated here — it lives on
-- `poly_wallet_connections.custodial_consent_accepted_at` (migration 0030)
-- and grants FK back to the connection row. Single source of truth.
--
-- PINNED INVARIANTS
--
--   TENANT_SCOPED
--     Every row carries (billing_account_id, created_by_user_id). NOT NULL.
--
--   GRANT_CAPS_ARE_CEILINGS_NOT_TARGETS
--     per_order_usdc_cap + daily_usdc_cap are post-sizing gates consumed by
--     authorizeIntent. Sizing lives upstream in planMirrorFromFill and is
--     driven by MIRROR_USDC + (future) per-tenant preferences (task.0347).
--
--   SCOPES_ARE_STRINGS
--     `poly:trade:buy`, `poly:trade:sell`. Kept as text[] not an enum so adding
--     a new scope is a config change, not a migration.
--
--   REVOKE_CASCADES_FROM_CONNECTION
--     When `adapter.revoke` flips `poly_wallet_connections.revoked_at`, the
--     same transaction also flips `revoked_at` on every grant whose
--     `wallet_connection_id` matches. Enforced app-side (no DB trigger) so
--     the revoker identity flows through `revoked_by_user_id` uniformly.
--
--   ACTIVE_GRANT_QUERY_SHAPE
--     "active grant" = `revoked_at IS NULL AND (expires_at IS NULL OR
--     expires_at > now())`. All consumers MUST use this predicate; a partial
--     index backs the common "latest active per tenant" read.
-- ============================================================================

CREATE TABLE "poly_wallet_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "billing_account_id" text NOT NULL REFERENCES "billing_accounts"("id") ON DELETE CASCADE,
  "wallet_connection_id" uuid NOT NULL REFERENCES "poly_wallet_connections"("id") ON DELETE CASCADE,
  "created_by_user_id" text NOT NULL REFERENCES "users"("id"),
  "scopes" text[] NOT NULL,
  "per_order_usdc_cap" numeric(10,2) NOT NULL,
  "daily_usdc_cap" numeric(10,2) NOT NULL,
  "hourly_fills_cap" integer NOT NULL,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz,
  "revoked_by_user_id" text REFERENCES "users"("id"),
  CONSTRAINT "poly_wallet_grants_scopes_nonempty"
    CHECK (array_length("scopes", 1) > 0),
  CONSTRAINT "poly_wallet_grants_per_order_cap_positive"
    CHECK ("per_order_usdc_cap" > 0),
  CONSTRAINT "poly_wallet_grants_daily_cap_positive"
    CHECK ("daily_usdc_cap" > 0),
  CONSTRAINT "poly_wallet_grants_hourly_fills_cap_positive"
    CHECK ("hourly_fills_cap" > 0),
  CONSTRAINT "poly_wallet_grants_daily_ge_per_order"
    CHECK ("daily_usdc_cap" >= "per_order_usdc_cap")
);--> statement-breakpoint

-- Hot path: "latest active grant for tenant" — authorizeIntent reads this on
-- every intent. Partial index skips revoked rows.
CREATE INDEX "poly_wallet_grants_active_idx"
  ON "poly_wallet_grants"("billing_account_id", "created_at" DESC)
  WHERE "revoked_at" IS NULL;--> statement-breakpoint

-- Revoke-cascade fast path: adapter.revoke UPDATE-where-wallet_connection_id.
CREATE INDEX "poly_wallet_grants_connection_idx"
  ON "poly_wallet_grants"("wallet_connection_id")
  WHERE "revoked_at" IS NULL;--> statement-breakpoint

CREATE INDEX "poly_wallet_grants_created_by_user_idx"
  ON "poly_wallet_grants"("created_by_user_id");--> statement-breakpoint

ALTER TABLE "poly_wallet_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "poly_wallet_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Tenant isolation via billing-account ownership — mirrors migration 0030.
-- `created_by_user_id` is audit metadata only; RLS keys on the
-- billing_account owner. Swap the EXISTS clause to a membership check when
-- multi-user billing accounts land (no column change).
CREATE POLICY "tenant_isolation" ON "poly_wallet_grants"
  USING (
    EXISTS (
      SELECT 1 FROM "billing_accounts" ba
      WHERE ba."id" = "poly_wallet_grants"."billing_account_id"
        AND ba."owner_user_id" = current_setting('app.current_user_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "billing_accounts" ba
      WHERE ba."id" = "poly_wallet_grants"."billing_account_id"
        AND ba."owner_user_id" = current_setting('app.current_user_id', true)
    )
  );--> statement-breakpoint
