// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/ledger.epoch-allocations.v1.contract`
 * Purpose: Defines operation contract for retrieving allocations for an epoch.
 * Scope: Zod schemas and types for epoch allocations wire format. Does not contain business logic.
 * Invariants:
 *   - ALL_MATH_BIGINT: BigInt values serialized as strings
 *   - Contract remains stable; breaking changes require new version
 *   - All consumers use z.infer types
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

import { z } from "zod";

export const AllocationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  proposedUnits: z.string(), // bigint as string
  finalUnits: z.string().nullable(), // bigint as string
  overrideReason: z.string().nullable(),
  activityCount: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const EpochAllocationsOutputSchema = z.object({
  allocations: z.array(AllocationSchema),
  epochId: z.string(),
});

export const epochAllocationsOperation = {
  id: "ledger.epoch-allocations.v1",
  summary: "Get allocations for an epoch",
  description:
    "Returns proposed and final allocations for the specified epoch. Public endpoint.",
  input: z.object({}),
  output: EpochAllocationsOutputSchema,
} as const;

export type AllocationDto = z.infer<typeof AllocationSchema>;
export type EpochAllocationsOutput = z.infer<
  typeof EpochAllocationsOutputSchema
>;
