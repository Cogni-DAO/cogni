-- ============================================================================
-- task.0429 — Poly auto-wrap consent loop.
--
-- Spec: docs/spec/poly-trader-wallet-port.md
--       work/items/task.0429.poly-auto-wrap-consent-loop.md
--
-- Adds five columns to `poly_wallet_connections` so the auto-wrap job can scan
-- consenting wallets and convert idle USDC.e at the funder address to pUSD on
-- a 60-second cycle. Closes the deposit / V1-redeem / direct-transfer leaks
-- that today strand cash as USDC.e (only pUSD funds CLOB BUYs).
--
-- - auto_wrap_consent_at      : NULL = no consent, the job MUST skip the row.
-- - auto_wrap_consent_actor_* : 'user'|'agent' + principal id. Trio: all-null
--                               or all-non-null (CHECK constraint).
-- - auto_wrap_floor_usdce_6dp : DUST_GUARD floor in 6-dp base units. Default
--                               1_000_000 = 1.00 USDC.e. Below floor → skip,
--                               prevents gas-on-dust drain.
-- - auto_wrap_revoked_at      : Independent revoke marker. Lets a tenant turn
--                               auto-wrap off without killing the connection.
-- ============================================================================

ALTER TABLE poly_wallet_connections
  ADD COLUMN auto_wrap_consent_at        TIMESTAMPTZ NULL,
  ADD COLUMN auto_wrap_consent_actor_kind TEXT       NULL,
  ADD COLUMN auto_wrap_consent_actor_id  TEXT        NULL,
  ADD COLUMN auto_wrap_floor_usdce_6dp   BIGINT      NOT NULL DEFAULT 1000000,
  ADD COLUMN auto_wrap_revoked_at        TIMESTAMPTZ NULL;

ALTER TABLE poly_wallet_connections
  ADD CONSTRAINT poly_wallet_connections_auto_wrap_consent_actor_kind
    CHECK (auto_wrap_consent_actor_kind IS NULL
           OR auto_wrap_consent_actor_kind IN ('user', 'agent'));

ALTER TABLE poly_wallet_connections
  ADD CONSTRAINT poly_wallet_connections_auto_wrap_consent_trio
    CHECK (
      (auto_wrap_consent_at IS NULL
       AND auto_wrap_consent_actor_kind IS NULL
       AND auto_wrap_consent_actor_id IS NULL)
      OR
      (auto_wrap_consent_at IS NOT NULL
       AND auto_wrap_consent_actor_kind IS NOT NULL
       AND auto_wrap_consent_actor_id IS NOT NULL)
    );

ALTER TABLE poly_wallet_connections
  ADD CONSTRAINT poly_wallet_connections_auto_wrap_floor_positive
    CHECK (auto_wrap_floor_usdce_6dp > 0);

CREATE INDEX poly_wallet_connections_auto_wrap_eligible_idx
  ON poly_wallet_connections (billing_account_id)
  WHERE revoked_at IS NULL
    AND auto_wrap_consent_at IS NOT NULL
    AND auto_wrap_revoked_at IS NULL;
