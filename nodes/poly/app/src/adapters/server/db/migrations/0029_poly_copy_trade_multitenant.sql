-- ============================================================================
-- task.0318 Phase A — multi-tenant copy-trade tables.
--
-- Spec: docs/spec/poly-tenant-and-collateral.md (spec_state: proposed)
--
-- Adds tenant scoping to every poly_copy_trade_* table: `billing_account_id`
-- is the data column (FK → billing_accounts), `created_by_user_id` is the
-- RLS key (FK → users). Mirrors the `connections` pattern from migration
-- 0025_add_connections.sql exactly:
--
--   CREATE POLICY "tenant_isolation" ON <table>
--     USING ("created_by_user_id" = current_setting('app.current_user_id', true))
--     WITH CHECK ("created_by_user_id" = current_setting('app.current_user_id', true));
--
-- PINNED INVARIANTS (source: docs/spec/poly-tenant-and-collateral.md)
--
--   TENANT_SCOPED_ROWS
--     Every row carries (billing_account_id, created_by_user_id). NOT NULL.
--     RLS enabled + forced on every poly_copy_trade_* table.
--
--   PER_TENANT_KILL_SWITCH
--     poly_copy_trade_config PK is billing_account_id (replaces v0 singleton_id).
--     Default `enabled: false` — fail-closed per tenant.
--
--   NO_PER_TARGET_ENABLED
--     poly_copy_trade_targets has no per-row enable flag. Operators add/remove
--     rows; per-tenant config is the only kill-switch.
--
--   FAIL_CLOSED_ON_DB_ERROR
--     The order-ledger snapshot path treats RLS-denied (zero rows) as disabled
--     — same semantics as a missing config row.
--
-- DECISIONS (resolved at /design 2026-04-19)
--
--   - Phase-0 prototype rows in fills/decisions/config: DROP. No backwards
--     compat — confirmed (PR #932 was the prototype).
--   - Bootstrap operator: COGNI_SYSTEM_PRINCIPAL_USER_ID +
--     COGNI_SYSTEM_BILLING_ACCOUNT_ID (per docs/spec/system-tenant.md).
--     Seed one config row enabled=true so the existing single-operator
--     candidate-a flight keeps working until per-user wallets ship (Phase B).
-- ============================================================================

-- ── 1. Drop Phase-0 prototype data + tables ────────────────────────────────
-- Drop in dependency order. CASCADE the policies/indexes that ride along.
DROP TABLE IF EXISTS "poly_copy_trade_decisions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "poly_copy_trade_fills" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "poly_copy_trade_config" CASCADE;--> statement-breakpoint

-- ── 2. poly_copy_trade_targets — born tenant-scoped ────────────────────────
CREATE TABLE "poly_copy_trade_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "billing_account_id" text NOT NULL REFERENCES "billing_accounts"("id") ON DELETE CASCADE,
  "created_by_user_id" text NOT NULL REFERENCES "users"("id"),
  "target_wallet" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "disabled_at" timestamptz,
  CONSTRAINT "poly_copy_trade_targets_wallet_shape"
    CHECK ("target_wallet" ~ '^0x[a-fA-F0-9]{40}$')
);--> statement-breakpoint

CREATE UNIQUE INDEX "poly_copy_trade_targets_billing_wallet_active_idx"
  ON "poly_copy_trade_targets"("billing_account_id", "target_wallet")
  WHERE "disabled_at" IS NULL;--> statement-breakpoint

CREATE INDEX "poly_copy_trade_targets_billing_account_idx"
  ON "poly_copy_trade_targets"("billing_account_id");--> statement-breakpoint

ALTER TABLE "poly_copy_trade_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "poly_copy_trade_targets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "tenant_isolation" ON "poly_copy_trade_targets"
  USING ("created_by_user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("created_by_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint

-- ── 3. poly_copy_trade_config — per-tenant, replaces singleton ─────────────
CREATE TABLE "poly_copy_trade_config" (
  "billing_account_id" text PRIMARY KEY REFERENCES "billing_accounts"("id") ON DELETE CASCADE,
  "created_by_user_id" text NOT NULL REFERENCES "users"("id"),
  "enabled" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" text NOT NULL DEFAULT 'system'
);--> statement-breakpoint

ALTER TABLE "poly_copy_trade_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "poly_copy_trade_config" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "tenant_isolation" ON "poly_copy_trade_config"
  USING ("created_by_user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("created_by_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint

-- ── 4. poly_copy_trade_fills — recreate with tenant columns ────────────────
CREATE TABLE "poly_copy_trade_fills" (
  "billing_account_id" text NOT NULL REFERENCES "billing_accounts"("id") ON DELETE CASCADE,
  "created_by_user_id" text NOT NULL REFERENCES "users"("id"),
  "target_id" uuid NOT NULL,
  "fill_id" text NOT NULL,
  "observed_at" timestamptz NOT NULL,
  "client_order_id" text NOT NULL,
  "order_id" text,
  "status" text NOT NULL,
  "attributes" jsonb,
  "synced_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("target_id", "fill_id"),
  CONSTRAINT "poly_copy_trade_fills_fill_id_shape"
    CHECK ("fill_id" ~ '^(data-api|clob-ws):.+'),
  CONSTRAINT "poly_copy_trade_fills_status_check"
    CHECK ("status" IN ('pending','open','filled','partial','canceled','error'))
);--> statement-breakpoint

CREATE INDEX "poly_copy_trade_fills_observed_at_idx"
  ON "poly_copy_trade_fills"("observed_at");--> statement-breakpoint
CREATE INDEX "poly_copy_trade_fills_client_order_id_idx"
  ON "poly_copy_trade_fills"("client_order_id");--> statement-breakpoint
CREATE INDEX "idx_poly_copy_trade_fills_synced_at"
  ON "poly_copy_trade_fills"("synced_at");--> statement-breakpoint
CREATE INDEX "poly_copy_trade_fills_billing_account_idx"
  ON "poly_copy_trade_fills"("billing_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "poly_copy_trade_fills_order_id_unique"
  ON "poly_copy_trade_fills"("order_id")
  WHERE "order_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "poly_copy_trade_fills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "poly_copy_trade_fills" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "tenant_isolation" ON "poly_copy_trade_fills"
  USING ("created_by_user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("created_by_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint

-- ── 5. poly_copy_trade_decisions — recreate with tenant columns ────────────
CREATE TABLE "poly_copy_trade_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "billing_account_id" text NOT NULL REFERENCES "billing_accounts"("id") ON DELETE CASCADE,
  "created_by_user_id" text NOT NULL REFERENCES "users"("id"),
  "target_id" uuid NOT NULL,
  "fill_id" text NOT NULL,
  "outcome" text NOT NULL,
  "reason" text,
  "intent" jsonb NOT NULL,
  "receipt" jsonb,
  "decided_at" timestamptz NOT NULL,
  CONSTRAINT "poly_copy_trade_decisions_outcome_check"
    CHECK ("outcome" IN ('placed','skipped','error'))
);--> statement-breakpoint

CREATE INDEX "poly_copy_trade_decisions_decided_at_idx"
  ON "poly_copy_trade_decisions"("decided_at");--> statement-breakpoint
CREATE INDEX "poly_copy_trade_decisions_target_fill_idx"
  ON "poly_copy_trade_decisions"("target_id", "fill_id");--> statement-breakpoint
CREATE INDEX "poly_copy_trade_decisions_billing_account_idx"
  ON "poly_copy_trade_decisions"("billing_account_id");--> statement-breakpoint

ALTER TABLE "poly_copy_trade_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "poly_copy_trade_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "tenant_isolation" ON "poly_copy_trade_decisions"
  USING ("created_by_user_id" = current_setting('app.current_user_id', true))
  WITH CHECK ("created_by_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint

-- ── 6. Bootstrap operator seed ─────────────────────────────────────────────
-- COGNI_SYSTEM_PRINCIPAL_USER_ID + COGNI_SYSTEM_BILLING_ACCOUNT_ID
-- per docs/spec/system-tenant.md (seeded by migration 0008_seed_system_tenant.sql).
-- The candidate-a flight runs as the system tenant until per-user wallets ship.
--
-- Set RLS context to the system principal (transaction-local) BEFORE the INSERT —
-- without this, the FORCE ROW LEVEL SECURITY clause above rejects the row via
-- WITH CHECK because `app.current_user_id` is unset on the migrator session.
-- Mirrors 0008_seed_system_tenant.sql:6.
SELECT set_config('app.current_user_id', '00000000-0000-4000-a000-000000000001', true);
--> statement-breakpoint
INSERT INTO "poly_copy_trade_config" ("billing_account_id", "created_by_user_id", "enabled", "updated_by")
VALUES (
  '00000000-0000-4000-b000-000000000000',
  '00000000-0000-4000-a000-000000000001',
  true,
  'migration:0029'
)
ON CONFLICT ("billing_account_id") DO NOTHING;--> statement-breakpoint
