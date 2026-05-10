-- ============================================================================
-- task.0355 — Per-tenant Polymarket token-approval readiness stamp.
--
-- Spec: docs/spec/poly-tenant-and-collateral.md (APPROVALS_BEFORE_PLACE)
--       work/items/task.0355.poly-trading-wallet-enable-trading.md
--
-- Polymarket's EOA trading path needs FIVE on-chain approvals before any
-- order can be filled: USDC.e `approve(MaxUint256)` on Exchange + Neg-Risk
-- Exchange + Neg-Risk Adapter, plus CTF `setApprovalForAll(true)` on
-- Exchange + Neg-Risk Exchange. Without them every BUY empty-rejects at the
-- CLOB and every SELL on neg_risk markets fails (the bug.0335 surface).
--
-- We stamp `trading_approvals_ready_at` on the connection row when all five
-- are confirmed on-chain. `authorizeIntent` reads this stamp and fails-closed
-- with `trading_not_ready` if NULL, so a fresh tenant cannot silently
-- empty-reject at the CLOB.
--
-- Cleared on revoke by app logic (same transaction as `revoked_at`), matching
-- the REVOKE_CASCADES_FROM_CONNECTION invariant: a new post-revoke connection
-- row starts NULL and must re-run the approvals flow.
-- ============================================================================

ALTER TABLE "poly_wallet_connections"
  ADD COLUMN "trading_approvals_ready_at" timestamptz;--> statement-breakpoint

-- Hot path: authorizeIntent reads connection + stamp on every intent. Partial
-- index over active, approved connections keeps the lookup index-only.
CREATE INDEX "poly_wallet_connections_trading_ready_idx"
  ON "poly_wallet_connections"("billing_account_id")
  WHERE "revoked_at" IS NULL AND "trading_approvals_ready_at" IS NOT NULL;--> statement-breakpoint
