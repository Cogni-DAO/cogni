// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/ledger.finalize-epoch.v1.contract`
 * Purpose: Defines operation contract for the review → finalized epoch transition (sign-at-finalize V0).
 * Scope: Zod schemas and types for finalize-epoch wire format. Does not contain business logic.
 * Invariants:
 *   - WRITE_ROUTES_AUTHED: requires SIWE session
 *   - WRITE_ROUTES_APPROVER_GATED: requires wallet in ledger approvers
 *   - WRITES_VIA_TEMPORAL: returns 202 + workflowId (async)
 *   - Contract remains stable; breaking changes require new version
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

import { z } from "zod";

export const FinalizeEpochInputSchema = z.object({
  /** EIP-191 hex signature of the canonical finalize message */
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/, "Signature must be hex-encoded with 0x prefix"),
});

export const FinalizeEpochOutputSchema = z.object({
  /** Temporal workflow ID for tracking finalization progress */
  workflowId: z.string(),
});

export const finalizeEpochOperation = {
  id: "ledger.finalize-epoch.v1",
  summary: "Finalize epoch with signature",
  description:
    "Transitions an epoch from review → finalized. Requires EIP-191 signature of the canonical statement message. SIWE-protected, approver-gated. Returns 202 with workflow ID (WRITES_VIA_TEMPORAL).",
  input: FinalizeEpochInputSchema,
  output: FinalizeEpochOutputSchema,
} as const;

export type FinalizeEpochInput = z.infer<typeof FinalizeEpochInputSchema>;
export type FinalizeEpochOutput = z.infer<typeof FinalizeEpochOutputSchema>;
