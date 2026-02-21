// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/governance.holdings.v1.contract`
 * Purpose: Contract for cumulative credit holdings across all closed epochs.
 * Scope: Read-only holdings summary for governance UI. Does not include write routes or mutation operations.
 * Invariants:
 * - ALL_MATH_BIGINT: credit values serialized as strings (BigInt)
 * - All timestamps ISO 8601
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

import { z } from "zod";

export const holdingSchema = z.object({
  userId: z.string(),
  displayName: z.string().nullable(),
  avatar: z.string().describe("Emoji avatar identifier"),
  color: z.string().describe("HSL color string without hsl() wrapper"),
  totalCredits: z
    .string()
    .describe("BigInt as string — sum across all closed epochs"),
  ownershipPercent: z
    .number()
    .describe("Percentage of all credits ever issued, 0-100"),
  epochsContributed: z.number().int(),
});

export const holdingsOperation = {
  id: "governance.holdings.v1",
  summary: "Get cumulative credit holdings across all closed epochs",
  input: z.object({}),
  output: z.object({
    holdings: z.array(holdingSchema),
    totalCreditsIssued: z.string().describe("BigInt as string"),
    totalContributors: z.number().int(),
    epochsCompleted: z.number().int(),
  }),
} as const;
