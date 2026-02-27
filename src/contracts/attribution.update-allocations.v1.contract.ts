// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/attribution.update-allocations.v1.contract`
 * Purpose: Defines operation contract for adjusting allocation final_units on an epoch.
 * Scope: Zod schemas and types for allocation adjustment wire format. Does not contain business logic.
 * Invariants:
 *   - ALL_MATH_BIGINT: BigInt values serialized as strings
 *   - WRITE_ROUTES_AUTHED: requires SIWE session
 *   - Contract remains stable; breaking changes require new version
 *   - All consumers use z.infer types
 * Side-effects: none
 * Links: docs/spec/attribution-ledger.md
 * @public
 */

import { z } from "zod";

/** Validates a string is a valid integer and transforms to bigint at parse time. */
const zBigint = z
  .string()
  .regex(/^-?\d+$/, "Must be a valid integer string")
  .transform(BigInt);

export const UpdateAllocationInputSchema = z.object({
  adjustments: z.array(
    z.object({
      userId: z.string(),
      finalUnits: zBigint,
      overrideReason: z.string().optional(),
    })
  ),
});

export const UpdateAllocationsOutputSchema = z.object({
  updated: z.number(),
});

export const updateAllocationsOperation = {
  id: "ledger.update-allocations.v1",
  summary: "Adjust allocation final_units",
  description:
    "Updates final_units for one or more allocations in the specified epoch. SIWE-protected.",
  input: UpdateAllocationInputSchema,
  output: UpdateAllocationsOutputSchema,
} as const;

export type UpdateAllocationInput = z.infer<typeof UpdateAllocationInputSchema>;
export type UpdateAllocationsOutput = z.infer<
  typeof UpdateAllocationsOutputSchema
>;
