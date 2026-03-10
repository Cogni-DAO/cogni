// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/work-items/transitions`
 * Purpose: Status transition table derived from docs/spec/development-lifecycle.md.
 * Scope: Pure data constant + validator. Does not perform I/O.
 * Invariants:
 * - TRANSITION_TABLE_COMPLETE: Every WorkItemStatus has an entry.
 * - Matches the mermaid workflow diagram in development-lifecycle.md.
 * Side-effects: none
 * Links: docs/spec/development-lifecycle.md
 * @public
 */

import type { WorkItemStatus } from "./types.js";

/**
 * Valid status transitions derived from development-lifecycle.md.
 * Key: current status. Value: allowed next statuses.
 *
 * Every needs_* status can also transition to "blocked" and "cancelled".
 * "blocked" can return to any needs_* status (escape hatch — adapter may
 * track pre-block status for stricter enforcement).
 * Terminal states ("done", "cancelled") have no outbound transitions.
 */
export const VALID_TRANSITIONS: ReadonlyMap<
  WorkItemStatus,
  readonly WorkItemStatus[]
> = new Map<WorkItemStatus, readonly WorkItemStatus[]>([
  // /triage dispatches from needs_triage
  [
    "needs_triage",
    [
      "needs_research",
      "needs_design",
      "needs_implement",
      "done",
      "blocked",
      "cancelled",
    ],
  ],
  // /research dispatches from needs_research
  ["needs_research", ["done", "blocked", "cancelled"]],
  // /design dispatches from needs_design
  ["needs_design", ["needs_implement", "blocked", "cancelled"]],
  // /implement dispatches from needs_implement
  ["needs_implement", ["needs_closeout", "blocked", "cancelled"]],
  // /closeout dispatches from needs_closeout
  ["needs_closeout", ["needs_merge", "blocked", "cancelled"]],
  // /review-implementation dispatches from needs_merge
  ["needs_merge", ["done", "needs_implement", "blocked", "cancelled"]],
  // Terminal states
  ["done", []],
  // Blocked can return to any needs_* status
  [
    "blocked",
    [
      "needs_triage",
      "needs_research",
      "needs_design",
      "needs_implement",
      "needs_closeout",
      "needs_merge",
      "cancelled",
    ],
  ],
  ["cancelled", []],
]);

/** Check whether a status transition is valid per the lifecycle spec. */
export function isValidTransition(
  from: WorkItemStatus,
  to: WorkItemStatus
): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed?.includes(to) ?? false;
}
