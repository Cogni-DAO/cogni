// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/users.ownership.v1.contract`
 * Purpose: Contract for reading the authenticated user's ownership summary.
 * Scope: Zod schemas and types for /api/v1/users/me/ownership. Does not
 *   implement business logic.
 * Invariants:
 *   - ALL_MATH_BIGINT: ownership unit totals are serialized as strings
 *   - OWNERSHIP_MATCHES_LINKED_IDENTITIES: summary includes claims matched
 *     through the user's current bindings, not only direct user_id claims
 * Side-effects: none
 * Links: /api/v1/users/me/ownership
 * @internal
 */

import { z } from "zod";

const attributionMatchSchema = z.object({
  epochId: z.string(),
  epochStatus: z.enum(["open", "review", "finalized"]),
  subjectRef: z.string(),
  source: z.string().nullable(),
  eventType: z.string().nullable(),
  units: z.string(),
  matchedBy: z.string(),
  eventTime: z.string().nullable(),
  artifactUrl: z.string().nullable(),
});

export const ownershipSummaryOperation = {
  id: "users.ownership.read.v1",
  summary: "Read current user ownership summary",
  input: z.object({}),
  output: z.object({
    totalUnits: z.string(),
    finalizedUnits: z.string(),
    pendingUnits: z.string(),
    finalizedSharePercent: z.number(),
    epochsMatched: z.number().int().nonnegative(),
    matchedAttributionCount: z.number().int().nonnegative(),
    linkedIdentityCount: z.number().int().nonnegative(),
    recentAttributions: z.array(attributionMatchSchema),
  }),
} as const;

export type OwnershipSummaryOutput = z.infer<
  typeof ownershipSummaryOperation.output
>;
