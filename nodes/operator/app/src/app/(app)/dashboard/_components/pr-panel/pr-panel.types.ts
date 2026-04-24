// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/pr-panel/pr-panel.types`
 * Purpose: Shapes consumed by the operator PR panel. Extends the canonical
 *          `PrSummary` + `CiStatusResult` from `@cogni/ai-tools` with
 *          operator-side deltas (flight workflow URL, deploy_verified).
 * Scope: Type declarations only.
 * Invariants:
 *   - CONTRACTS_ARE_TRUTH: Upstream shapes come from `@cogni/ai-tools`;
 *     this module only *extends* them and does not redeclare their fields.
 * Side-effects: none
 * Links:
 *   - packages/ai-tools/src/capabilities/vcs.ts (PrSummary, CiStatusResult)
 *   - packages/node-contracts/src/vcs.flight.v1.contract.ts
 * @public
 */

import type { CiStatusResult, PrSummary } from "@cogni/ai-tools";

/** Flight info surfaced from `DispatchCandidateFlightResult` + downstream verify signal. */
export interface FlightInfo {
  /** GitHub Actions workflow URL for the candidate-flight run. */
  workflowUrl: string;
  /** Head SHA GitHub dispatched against. */
  headSha: string | null;
  /** True once the operator has observed `/version.buildSha` match on candidate-a. */
  deployVerified: boolean;
}

/**
 * One row in the operator PR panel.
 * Composes the canonical contracts with operator-side augmentation.
 */
export interface PrPanelEntry {
  pr: PrSummary;
  ci: CiStatusResult;
  /** Present once a candidate-flight dispatch has happened for this PR. */
  flight?: FlightInfo;
  /** GitHub UI URL for the PR (computed in the adapter; not on the contract). */
  htmlUrl: string;
}

export interface PrPanelListResponse {
  entries: PrPanelEntry[];
  /** Server-side timestamp of this response. */
  syncedAt: string;
}
