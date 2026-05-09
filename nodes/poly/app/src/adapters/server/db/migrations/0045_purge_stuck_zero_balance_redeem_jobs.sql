-- bug.5040: purge poly_redeem_jobs rows that became stuck after the wallet
-- re-acquired shares against a `lifecycle=redeemed` row written from a
-- transient `skip:zero_balance` decision. The companion code change in
-- `decision-to-enqueue-input.ts` stops this from happening going forward
-- (zero_balance now returns null instead of persisting a terminal row);
-- this DELETE clears the existing population so the dashboard MTM stops
-- excluding ~$500 of real on-chain redeemable winnings on affected wallets.
--
-- Idempotent: runs once via drizzle journal. After a few diff-loop ticks,
-- conditions where the wallet truly has shares are re-classified as
-- `lifecycle=winner` (redeemable on dashboard); conditions where the wallet
-- holds losing shares get re-classified as `lifecycle=loser` (terminal,
-- correct).
DELETE FROM poly_redeem_jobs
WHERE status = 'skipped'
  AND lifecycle_state = 'redeemed';
