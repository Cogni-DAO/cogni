// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/attribution.epoch-statement.v1.contract`
 * Purpose: Defines operation contract for retrieving an epoch statement (entitlement plan).
 * Scope: Zod schemas and types for epoch statement wire format. Does not contain business logic.
 * Invariants:
 *   - ALL_MATH_BIGINT: BigInt values serialized as strings
 *   - Contract remains stable; breaking changes require new version
 *   - All consumers use z.infer types
 * Side-effects: none
 * Links: docs/spec/attribution-ledger.md
 * @public
 */

import { z } from "zod";

export const StatementLineItemSchema = z.object({
  user_id: z.string(),
  total_units: z.string(),
  share: z.string(),
  amount_credits: z.string(),
});

export const StatementSchema = z.object({
  id: z.string(),
  epochId: z.string(),
  allocationSetHash: z.string(),
  poolTotalCredits: z.string(),
  items: z.array(StatementLineItemSchema),
  supersedesStatementId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const EpochStatementOutputSchema = z.object({
  statement: StatementSchema.nullable(),
});

export const epochStatementOperation = {
  id: "ledger.epoch-statement.v1",
  summary: "Get statement for an epoch",
  description:
    "Returns the statement (entitlement plan) for the specified epoch. statement is null if none exists yet. Always 200.",
  input: z.object({}),
  output: EpochStatementOutputSchema,
} as const;

export type StatementLineItemDto = z.infer<typeof StatementLineItemSchema>;
export type StatementDto = z.infer<typeof StatementSchema>;
