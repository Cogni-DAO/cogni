-- bug.5040 + bug.5041: reset poly_redeem_jobs rows that were marked
-- abandoned via `transient_exhausted` so the worker re-attempts. The
-- companion code change in this PR raises REDEEM_MAX_TRANSIENT_ATTEMPTS
-- (3 → 50) and adds pre-flight `simulateContract` so the next retry
-- captures the actual revert reason in Loki under
-- `poly.ctf.redeem.simulate_reverted`.
--
-- Without this reset, the existing abandoned rows stay stuck forever —
-- the diff loop's `(api ∖ known)` set excludes anything already in
-- poly_redeem_jobs, and abandoned is no longer in the
-- stale_unresolved re-classify path.
--
-- Idempotent: only touches rows the worker explicitly transient-failed.
-- `malformed`-class abandons (legitimate code defects) are left alone.
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
