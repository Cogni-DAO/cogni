// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `features/redeem`
 * Purpose: Barrel for the event-driven redeem feature (task.0388).
 * @public
 */

export {
  type RedeemCatchupDeps,
  runRedeemCatchup,
} from "./redeem-catchup";
export {
  computeRedeemDiff,
  REDEEM_DIFF_ENQUEUE_CONCURRENCY,
  REDEEM_DIFF_STALE_UNRESOLVED_MS,
  type RunDiffTickDeps,
  runRedeemDiffTick,
} from "./redeem-diff";
export {
  RedeemSubscriber,
  type RedeemSubscriberDeps,
} from "./redeem-subscriber";
export {
  RedeemWorker,
  type RedeemWorkerDeps,
} from "./redeem-worker";
export {
  type ResolvedRedeemCandidate,
  resolveRedeemCandidatesForCondition,
} from "./resolve-redeem-decision";
