-- bug.5041 round-2 reset. PR with this migration also ships the
-- RPC-vs-chain-revert classifier in the redeem worker. Migration 0046
-- swept the original 34 conditions stuck in abandoned/transient_exhausted
-- from the 2026-05-09 00:32 UTC Polygon RPC instability window. A second
-- mass-abandonment of 64 conditions occurred 2026-05-10 00:00–11:44 UTC
-- with the same root cause (Alchemy "Missing or invalid parameters"
-- pre-broadcast errors consuming the 3-strike budget). The classifier
-- shipping in this PR prevents recurrence; this SQL recovers the rows
-- the prior code already wrote.
--
-- Idempotent: only touches rows the worker explicitly transient-failed.
-- `malformed`-class abandons (legitimate code defects, balance>0 bleed)
-- are left alone. Same predicate as 0046 — drizzle's __drizzle_migrations
-- ledger ensures each numbered migration runs exactly once, so this re-run
-- is the cheapest correct way to recover the new abandonment cohort.
UPDATE poly_redeem_jobs
SET
  status = 'pending',
  lifecycle_state = 'winner',
  attempt_count = 0,
  last_error = NULL,
  error_class = NULL,
  abandoned_at = NULL,
  updated_at = NOW()
WHERE status = 'abandoned'
  AND lifecycle_state = 'abandoned'
  AND error_class = 'transient_exhausted';
