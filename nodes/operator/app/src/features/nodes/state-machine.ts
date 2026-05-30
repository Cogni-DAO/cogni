// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/nodes/state-machine`
 * Purpose: Pure state-machine transitions for the operator node-registry wizard.
 * Scope: Total function `(currentStatus, event) → nextStatus | InvalidTransition`. No IO, no env.
 * Invariants: STATE_MACHINE_TOTAL — every (status, event) pair returns a defined result; transitions are linear with a single `fail` escape hatch.
 * Side-effects: none
 * Links: docs/spec/node-formation.md, task.5083
 * @public
 */

import type { NodeStatus } from "@/shared/db/nodes";

export type NodeEvent =
  | { type: "dao_verified" }
  | { type: "spec_published" }
  | { type: "fail"; reason: string };

export type TransitionResult =
  | { ok: true; nextStatus: NodeStatus }
  | { ok: false; reason: string };

const TRANSITIONS: Record<
  NodeStatus,
  Partial<Record<NodeEvent["type"], NodeStatus>>
> = {
  dao_pending: { dao_verified: "dao_formed", fail: "failed" },
  dao_formed: { spec_published: "active", fail: "failed" },
  wallet_ready: { fail: "failed" },
  payments_ready: { fail: "failed" },
  active: {},
  failed: {},
};

export function transition(
  current: NodeStatus,
  event: NodeEvent
): TransitionResult {
  const next = TRANSITIONS[current]?.[event.type];
  if (!next) {
    return {
      ok: false,
      reason: `Invalid transition: ${current} cannot handle event ${event.type}`,
    };
  }
  return { ok: true, nextStatus: next };
}

/**
 * Ordered milestones for the progress bar. Each entry is the state reached once that
 * milestone is complete. `failed` is not a milestone — it is rendered as an error overlay.
 */
export const NODE_PROGRESS_STEPS: ReadonlyArray<{
  status: NodeStatus;
  label: string;
}> = [
  { status: "dao_pending", label: "Register" },
  { status: "dao_formed", label: "DAO" },
  { status: "active", label: "Published" },
];

/**
 * Index of the node's current state within `NODE_PROGRESS_STEPS`. A step is "complete"
 * when its index is <= this. Returns the last completed index for `failed` (where the
 * failure happened is not tracked, so we surface the furthest-reached milestone as -1-safe 0).
 */
export function progressIndexForStatus(status: NodeStatus): number {
  const idx = NODE_PROGRESS_STEPS.findIndex((s) => s.status === status);
  return idx; // -1 for `failed` (no milestone) — the bar renders all steps as not-complete
}

/**
 * Returns the canonical wizard URL for a node at its current status — used by
 * page-level `redirect()` calls so reload always lands at the right step.
 */
export function wizardUrlForStatus(nodeId: string, status: NodeStatus): string {
  switch (status) {
    case "dao_pending":
      return `/setup/dao?nodeId=${nodeId}`;
    case "dao_formed":
    case "wallet_ready":
    case "payments_ready":
    case "active":
    case "failed":
      return `/setup/nodes/${nodeId}`;
  }
}
