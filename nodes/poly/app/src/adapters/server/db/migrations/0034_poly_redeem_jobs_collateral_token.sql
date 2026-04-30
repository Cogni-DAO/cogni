-- ============================================================================
-- bug.0428 — Per-redeem-job collateralToken vintage capture.
--
-- Spec: docs/spec/poly-collateral-currency.md
--       work/items/bug.0428.poly-redeem-worker-hardcodes-usdce.md
--
-- Adds `collateral_token` to `poly_redeem_jobs` so the worker dispatches
-- `ConditionalTokens.redeemPositions(collateralToken, …)` with the correct
-- mint-collateral for each position. Pre-V2 positions were minted against
-- USDC.e; post-V2 (cutover 2026-04-28) positions are minted against pUSD.
-- Worker previously hardcoded USDC.e at all call sites, silently zero-burning
-- V2 vanilla-CTF redeems.
--
-- Default is USDC.e so existing rows enqueued before this migration retain
-- their legacy behavior. Column is non-null on insert; v0 fix path sets it at
-- enqueue time via on-chain probe (resolve-redeem-decision.ts).
-- ============================================================================

ALTER TABLE poly_redeem_jobs
  ADD COLUMN collateral_token TEXT NOT NULL
    DEFAULT '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

ALTER TABLE poly_redeem_jobs
  ADD CONSTRAINT poly_redeem_jobs_collateral_token_shape
    CHECK (collateral_token ~ '^0x[a-fA-F0-9]{40}$');
