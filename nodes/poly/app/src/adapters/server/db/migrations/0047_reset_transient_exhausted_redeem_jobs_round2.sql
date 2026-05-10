-- Idempotent reset of transient-exhausted abandons. Same predicate as
-- 0046; drizzle's migration ledger gates each numbered migration to
-- exactly one apply. Leaves `malformed`-class abandons untouched.
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
