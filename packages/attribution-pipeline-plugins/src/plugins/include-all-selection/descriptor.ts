// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-plugins/plugins/include-all-selection/descriptor`
 * Purpose: Trivial selection policy — includes all receipts unconditionally.
 * Scope: Pure selection logic. Does not perform I/O.
 * Invariants:
 * - SELECTION_POLICY_PURE: receives context, returns decisions — no store writes.
 * Side-effects: none
 * Links: packages/attribution-pipeline-contracts/src/selection.ts
 * @public
 */

import type {
  SelectionContext,
  SelectionDecision,
  SelectionPolicyDescriptor,
} from "@cogni/attribution-pipeline-contracts";

export const INCLUDE_ALL_SELECTION_POLICY_REF =
  "cogni.include-all-selection.v0" as const;

export const INCLUDE_ALL_SELECTION_POLICY: SelectionPolicyDescriptor = {
  policyRef: INCLUDE_ALL_SELECTION_POLICY_REF,
  select(context: SelectionContext): SelectionDecision[] {
    return context.receiptsToSelect.map((receipt) => ({
      receiptId: receipt.receiptId,
      included: true,
    }));
  },
};
