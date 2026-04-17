-- ============================================================================
-- task.0315 Phase 1 CP3.3 — poly copy-trade ledger tables
--
-- This migration adds the three tables that carry the copy-trade prototype's
-- observed-fills ledger, global kill-switch, and decisions audit log. All
-- three are SYSTEM-OWNED (single-operator prototype; no tenant RLS yet —
-- revisit when Phase 2 adds multi-operator UI).
--
-- PINNED INVARIANTS (source: work/items/task.0315.poly-copy-trade-prototype.md)
--
--   FILL_ID_SHAPE_DECIDED
--     poly_copy_trade_fills.fill_id is composite "<source>:<native_id>".
--       source ∈ {data-api, clob-ws}
--       data-api native_id = `${transactionHash}:${asset}:${side}:${timestamp}`
--     Empty-transactionHash rows MUST be rejected upstream at the normalizer
--     (DA_EMPTY_HASH_REJECTED) — they cannot be reliably deduped cross-source.
--     The clob-ws native_id shape is deliberately NOT pinned here; P4 migration
--     commits its final shape before the WS ingester activity lands.
--
--   IDEMPOTENT_BY_CLIENT_ID
--     poly_copy_trade_fills.client_order_id =
--       keccak256(utf8Bytes(target_id + ':' + fill_id))
--     as 0x-prefixed 32-byte hex (66 chars including 0x). The canonical helper
--     is `clientOrderIdFor()` at packages/market-provider/src/domain/client-order-id.ts.
--     Executor code (CP4) and any future WS path MUST import the helper — never
--     inline or fork the implementation. A DB backfill is required before any
--     revision.
--
--   GLOBAL_KILL_DB_ROW + fail-closed
--     poly_copy_trade_config.enabled DEFAULT false. A freshly-migrated node
--     refuses to place orders until an operator explicitly flips the row. The
--     poll's config SELECT treats any error as enabled = false.
--
--   SYSTEM_OWNED
--     No RLS on any of these three tables. The dashboard card SELECTs without
--     a user-scoped filter. When Phase 2 introduces per-operator UI, add RLS
--     via a follow-up migration and thread `app.current_user_id` through.
-- ============================================================================

CREATE TABLE "poly_copy_trade_fills" (
	"target_id" uuid NOT NULL,
	"fill_id" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"client_order_id" text NOT NULL,
	"order_id" text,
	"status" text NOT NULL,
	"attributes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poly_copy_trade_fills_target_id_fill_id_pk" PRIMARY KEY("target_id","fill_id")
);
--> statement-breakpoint
CREATE TABLE "poly_copy_trade_config" (
	"singleton_id" smallint PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT 'system' NOT NULL,
	CONSTRAINT "poly_copy_trade_config_singleton" CHECK ("poly_copy_trade_config"."singleton_id" = 1)
);
--> statement-breakpoint
CREATE TABLE "poly_copy_trade_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid NOT NULL,
	"fill_id" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"intent" jsonb NOT NULL,
	"receipt" jsonb,
	"decided_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "poly_copy_trade_fills_observed_at_idx" ON "poly_copy_trade_fills" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "poly_copy_trade_fills_client_order_id_idx" ON "poly_copy_trade_fills" USING btree ("client_order_id");--> statement-breakpoint
CREATE INDEX "poly_copy_trade_decisions_decided_at_idx" ON "poly_copy_trade_decisions" USING btree ("decided_at");--> statement-breakpoint
CREATE INDEX "poly_copy_trade_decisions_target_fill_idx" ON "poly_copy_trade_decisions" USING btree ("target_id","fill_id");--> statement-breakpoint

-- Seed the kill-switch singleton explicitly to `enabled = false` so the
-- fail-closed invariant holds from the moment this migration completes.
INSERT INTO "poly_copy_trade_config" ("singleton_id", "enabled", "updated_at", "updated_by")
  VALUES (1, false, now(), 'migration:0027') ON CONFLICT DO NOTHING;
