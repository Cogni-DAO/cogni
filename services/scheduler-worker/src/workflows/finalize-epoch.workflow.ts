// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/workflows/finalize-epoch`
 * Purpose: Temporal Workflow for epoch finalization — sign-at-finalize V0.
 * Scope: Deterministic orchestration only. All I/O happens in Activities.
 * Invariants:
 *   - Per TEMPORAL_DETERMINISM: No I/O, network calls, or direct imports of adapters
 *   - Per WRITES_VIA_TEMPORAL: All writes execute in Temporal activities
 *   - Per EPOCH_FINALIZE_IDEMPOTENT: Returns existing statement if epoch already finalized
 *   - Per CONFIG_LOCKED_AT_REVIEW: Verifies allocation_algo_ref and weight_config_hash are set
 * Side-effects: none (deterministic orchestration only)
 * Links: docs/spec/attribution-ledger.md, docs/spec/temporal-patterns.md
 * @internal
 */

import { proxyActivities } from "@temporalio/workflow";

import type { LedgerActivities } from "../activities/ledger.js";

const { finalizeEpoch } = proxyActivities<LedgerActivities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "2 seconds",
    maximumInterval: "1 minute",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

/** Input for FinalizeEpochWorkflow */
export interface FinalizeEpochWorkflowInput {
  readonly epochId: string; // bigint serialized
  readonly signature: string; // EIP-191 hex
  readonly signerAddress: string; // from SIWE session
  readonly approvers: string[]; // EVM addresses (from repo-spec, lowercased)
}

/**
 * FinalizeEpochWorkflow — atomically finalizes an epoch with signature verification.
 *
 * Single compound activity: loads epoch, verifies config lock, verifies signature,
 * computes payouts, and atomically writes statement + signature.
 *
 * Deterministic workflow ID: ledger-finalize-{scopeId}-{epochId}
 * (set by the API route, not by this workflow)
 */
export async function FinalizeEpochWorkflow(
  input: FinalizeEpochWorkflowInput
): Promise<{ statementId: string }> {
  const result = await finalizeEpoch({
    epochId: input.epochId,
    signature: input.signature,
    signerAddress: input.signerAddress,
    approvers: input.approvers,
  });

  return { statementId: result.statementId };
}
