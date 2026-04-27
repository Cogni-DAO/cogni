-- ============================================================================
-- task.0388 — Event-driven redeem job queue.
--
-- Spec: docs/design/poly-positions.md
--       work/items/task.0388.poly-redeem-job-queue-capability-b.md
--
-- Replaces the in-process polling sweep + cooldown Map + mutex in
-- `poly-trade-executor.ts` with a Postgres-backed job table driven by viem
-- `watchContractEvent` subscriptions on CTF + NegRiskAdapter. One worker per
-- pod drains `pending` rows via `FOR UPDATE SKIP LOCKED`. Removes the
-- SINGLE_POD_ASSUMPTION so poly can scale replicas.
--
-- Two tables:
--   * `poly_redeem_jobs` — durable redeem state machine (pending → submitted
--     → confirmed | failed_transient | abandoned). Unique
--     `(funder_address, condition_id)` is the canonical dedup key.
--   * `poly_subscription_cursors` — `last_processed_block` per chain-event
--     subscription so the catch-up replay can resume after restart.
--
-- Invariants enforced at this layer:
--   - REDEEM_DEDUP_IS_PERSISTED — unique index on (funder, condition).
--   - REDEEM_REQUIRES_BURN_OBSERVATION — `receipt_burn_observed` flag is the
--     reaper's branch input at N=5 finality.
--   - FINALITY_IS_FIXED_N — `submitted_at_block` lets the reaper compare to
--     `head` without re-querying the chain.
--
-- Service-role only (no RLS) — operator funder writes for v0.2; per-tenant
-- funder support stays at the app layer until task.0318 Phase C.
-- ============================================================================

CREATE TABLE "poly_redeem_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "funder_address" text NOT NULL,
  "condition_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "flavor" text NOT NULL,
  "index_set" jsonb NOT NULL,
  "expected_shares" text NOT NULL,
  "expected_payout_usdc" text NOT NULL,
  "tx_hashes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "attempt_count" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "error_class" text,
  "lifecycle_state" text NOT NULL DEFAULT 'unresolved',
  "receipt_burn_observed" boolean,
  "submitted_at_block" bigint,
  "enqueued_at" timestamptz NOT NULL DEFAULT now(),
  "submitted_at" timestamptz,
  "confirmed_at" timestamptz,
  "abandoned_at" timestamptz,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "poly_redeem_jobs_funder_address_shape"
    CHECK ("funder_address" ~ '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT "poly_redeem_jobs_condition_id_shape"
    CHECK ("condition_id" ~ '^0x[a-fA-F0-9]{64}$'),
  CONSTRAINT "poly_redeem_jobs_status_shape"
    CHECK ("status" IN ('pending', 'submitted', 'confirmed', 'failed_transient', 'abandoned')),
  CONSTRAINT "poly_redeem_jobs_flavor_shape"
    CHECK ("flavor" IN ('binary', 'multi-outcome', 'neg-risk-parent', 'neg-risk-adapter')),
  CONSTRAINT "poly_redeem_jobs_error_class_shape"
    CHECK ("error_class" IS NULL OR "error_class" IN ('transient_exhausted', 'malformed')),
  CONSTRAINT "poly_redeem_jobs_lifecycle_state_shape"
    CHECK ("lifecycle_state" IN (
      'unresolved', 'open', 'closing', 'closed', 'resolving',
      'winner', 'redeem_pending', 'redeemed', 'loser', 'dust', 'abandoned'
    ))
);--> statement-breakpoint

-- Canonical dedup. Subscriber + manual-route + catchup all UPSERT on this key.
CREATE UNIQUE INDEX "poly_redeem_jobs_funder_condition_uq"
  ON "poly_redeem_jobs" ("funder_address", "condition_id");--> statement-breakpoint

-- Worker hot path: claimNextPending uses `FOR UPDATE SKIP LOCKED` over this slice.
CREATE INDEX "poly_redeem_jobs_pending_idx"
  ON "poly_redeem_jobs" ("enqueued_at")
  WHERE "status" = 'pending';--> statement-breakpoint

-- Reaper hot path: claimReaperCandidates compares `submitted_at_block + 5` to head.
CREATE INDEX "poly_redeem_jobs_submitted_finality_idx"
  ON "poly_redeem_jobs" ("submitted_at_block")
  WHERE "status" = 'submitted';--> statement-breakpoint

CREATE TABLE "poly_subscription_cursors" (
  "subscription_id" text PRIMARY KEY NOT NULL,
  "last_processed_block" bigint NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
