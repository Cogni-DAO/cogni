// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@ports/recurring-work`
 * Purpose: The 2-method seam a node binds to register recurring work, so a node-local cron impl (the day-1 fallback) and the node-direct Temporal substrate are swappable behind one interface with zero product-code change.
 * Scope: Interface + input/result types only. Does not contain implementations, cron/Temporal/vendor imports, or I/O.
 * Invariants:
 *   - SWAP_IS_ZERO_PRODUCT_CHANGE: a node binds exactly one impl (node-local cron MVP, or the
 *     node-direct Temporal substrate); switching impls never touches the node's product code.
 *   - INPUT_IS_REPO_SPEC_SHAPE: `schedule()` input is the `NodeScheduleEntry` shape
 *     (`extractNodeSchedules` output) so the cron→Temporal swap stays wire-compatible.
 *   - PLATFORM_KNOBS_EXCLUDED: `overlap`/`catchupWindow` are operator-fixed platform invariants
 *     (PLATFORM_OVERLAP_AND_CATCHUP), never node-tunable — they are NOT on this port.
 * Side-effects: none (interface definition only)
 * Links: docs/spec/substrate-temporal.md, docs/spec/temporal-patterns.md (§ Node-as-tenant)
 * @public
 */

import type { NodeScheduleEntry } from "../services/syncNodeSchedules";

/**
 * The desired recurring job a node registers. Anchored to `NodeScheduleEntry` (the
 * `extractNodeSchedules` output) so a node can pass its repo-spec-derived schedules straight
 * through, and so swapping the cron impl for the Temporal substrate is wire-compatible.
 */
export type RecurringWorkInput = NodeScheduleEntry;

/** Durable handle returned by `schedule()`, used to `cancel()`. */
export interface RecurringWorkHandle {
  /**
   * Stable schedule id. The Temporal impl uses `node-task:{nodeId}:{id}`; the cron impl uses
   * an impl-stable id derived from the same `nodeId`/`id` pair. Stable across re-registration
   * of the same logical schedule.
   */
  readonly scheduleId: string;
}

/**
 * Vendor-agnostic recurring-work seam. A node binds one implementation at composition time.
 * `schedule` is idempotent on the logical schedule (`nodeId` + `id`): re-registering updates
 * in place rather than duplicating.
 */
export interface RecurringWorkPort {
  /** Register (or idempotently re-register) a recurring job; returns its durable handle. */
  schedule: (input: RecurringWorkInput) => Promise<RecurringWorkHandle>;
  /** Cancel a scheduled job by its `scheduleId`. Idempotent — a no-op if it does not exist. */
  cancel: (scheduleId: string) => Promise<void>;
}
