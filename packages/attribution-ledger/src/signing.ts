// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-ledger/signing`
 * Purpose: EIP-191 canonical message builder and approver set hashing for payout statement signing.
 * Scope: Pure functions. Does not perform network I/O or hold secrets.
 * Invariants:
 * - SIGNATURE_SCOPE_BOUND: Message includes node_id + scope_id + epoch_id + allocation_set_hash + pool_total_credits.
 * - APPROVERS_PINNED_AT_REVIEW: computeApproverSetHash produces a deterministic SHA-256 from sorted, lowercased addresses.
 * - Newline separator is always \n (no \r). Tests must assert exact byte output.
 * Side-effects: none
 * Links: docs/spec/attribution-ledger.md
 * @public
 */

import { createHash } from "node:crypto";

export interface CanonicalMessageParams {
  readonly nodeId: string;
  readonly scopeId: string;
  /** Epoch ID as string (bigint serialized) */
  readonly epochId: string;
  readonly allocationSetHash: string;
  /** Pool total credits as string (bigint serialized) */
  readonly poolTotalCredits: string;
}

/**
 * Build the EIP-191 canonical message for payout statement signing.
 * Newline is always \n (no \r). Tests must assert exact bytes.
 */
export function buildCanonicalMessage(params: CanonicalMessageParams): string {
  return [
    "Cogni Payout Statement v1",
    `Node: ${params.nodeId}`,
    `Scope: ${params.scopeId}`,
    `Epoch: ${params.epochId}`,
    `Allocation Hash: ${params.allocationSetHash}`,
    `Pool Total: ${params.poolTotalCredits}`,
  ].join("\n");
}

/**
 * Compute deterministic hash of an approver set for pinning at closeIngestion.
 * Sorted, lowercased, SHA-256.
 */
export function computeApproverSetHash(approvers: readonly string[]): string {
  const canonical = [...approvers]
    .map((a) => a.toLowerCase())
    .sort()
    .join(",");
  return createHash("sha256").update(canonical).digest("hex");
}
