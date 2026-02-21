// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/governance.epoch.v1.contract`
 * Purpose: Contract for epoch ledger endpoints — activity events, allocations, and payout data.
 * Scope: Read-only epoch data for governance UI. Matches activity_events model from epoch-ledger spec. Does not include write routes or admin operations.
 * Invariants:
 * - ALL_MATH_BIGINT: credit/unit values serialized as strings (BigInt)
 * - All timestamps ISO 8601
 * - Activity event IDs are deterministic from source data
 * Side-effects: none
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

import { z } from "zod";

export const activityEventSchema = z.object({
  id: z.string().describe("Deterministic ID, e.g. github:pr:owner/repo:42"),
  source: z.enum(["github", "discord"]),
  eventType: z
    .string()
    .describe("pr_merged, review_submitted, message_sent, etc."),
  platformLogin: z
    .string()
    .nullable()
    .describe("GitHub username or Discord handle"),
  artifactUrl: z.string().describe("Canonical link to the activity"),
  eventTime: z.string().datetime(),
});

export const epochContributorSchema = z.object({
  userId: z.string(),
  displayName: z.string().nullable(),
  avatar: z.string().describe("Emoji avatar identifier"),
  color: z.string().describe("HSL color string without hsl() wrapper"),
  proposedUnits: z.string().describe("BigInt as string — weighted score"),
  finalUnits: z
    .string()
    .nullable()
    .describe("Admin-adjusted units, null if not finalized"),
  creditShare: z.number().describe("Derived percentage 0-100"),
  activityCount: z.number().int(),
  activities: z.array(activityEventSchema),
});

export const epochSummarySchema = z.object({
  id: z.number(),
  status: z.enum(["open", "closed"]),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  poolTotalCredits: z
    .string()
    .nullable()
    .describe("BigInt as string, null while open"),
  contributors: z.array(epochContributorSchema),
  signedBy: z.string().nullable(),
  signedAt: z.string().datetime().nullable(),
});

export const currentEpochOperation = {
  id: "governance.epoch.current.v1",
  summary: "Get current open epoch with contributor activity and scores",
  input: z.object({}),
  output: z.object({ epoch: epochSummarySchema.nullable() }),
} as const;

export const epochHistoryOperation = {
  id: "governance.epoch.history.v1",
  summary: "List closed epochs with payout data",
  input: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
  output: z.object({ epochs: z.array(epochSummarySchema) }),
} as const;
