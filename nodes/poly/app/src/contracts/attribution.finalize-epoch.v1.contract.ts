// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/attribution.finalize-epoch.v1.contract`
 * Purpose: Defines operation contract for the review → finalized epoch transition (sign-at-finalize V0).
 * Scope: Zod schemas and types for finalize-epoch wire format. Does not contain business logic.
 * Invariants:
 *   - WRITE_ROUTES_AUTHED: requires SIWE session
 *   - WRITE_ROUTES_APPROVER_GATED: requires wallet in ledger approvers
 *   - WRITES_VIA_TEMPORAL: returns 202 + {workflowId, created} (async)
 *   - Contract remains stable; breaking changes require new version
 * Side-effects: none
 * Links: docs/spec/attribution-ledger.md
 * @public
 */

import { z } from "zod";

export const FinalizeEpochInputSchema = z.object({
  /** EIP-712 hex signature of the typed payout statement */
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/, "Signature must be hex-encoded with 0x prefix"),
});

export const FinalizeEpochOutputSchema = z.object({
  /** Temporal workflow ID for tracking finalization progress */
  workflowId: z.string(),
  /** Whether a new workflow was started (true) or an existing one was found (false) */
  created: z.boolean(),
});

export const finalizeEpochOperation = {
  id: "ledger.finalize-epoch.v1",
  summary: "Finalize epoch with signature",
  description:
    "Transitions an epoch from review → finalized. Requires an EIP-712 signature of the typed payout statement. SIWE-protected, approver-gated. Returns 202 with workflow ID (WRITES_VIA_TEMPORAL).",
  input: FinalizeEpochInputSchema,
  output: FinalizeEpochOutputSchema,
} as const;

export type FinalizeEpochInput = z.infer<typeof FinalizeEpochInputSchema>;
export type FinalizeEpochOutput = z.infer<typeof FinalizeEpochOutputSchema>;
