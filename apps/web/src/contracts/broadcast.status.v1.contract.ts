// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/broadcast.status.v1.contract`
 * Purpose: Defines operation contract for querying broadcast message status.
 * Scope: Provides Zod schemas and types for broadcast status wire format. Does not contain business logic.
 * Invariants:
 * - Contract remains stable; breaking changes require new version
 * - All consumers use z.infer types
 * Side-effects: none
 * Links: /api/v1/broadcasting/[messageId] route, docs/spec/broadcasting.md
 * @internal
 */

import { z } from "zod";
import { ContentMessageResponseSchema } from "./broadcast.draft.v1.contract";
import { PlatformPostResponseSchema } from "./broadcast.review.v1.contract";

export const BroadcastStatusResponseSchema = z.object({
  message: ContentMessageResponseSchema,
  posts: z.array(PlatformPostResponseSchema),
});

export const broadcastStatusOperation = {
  id: "broadcast.status.v1",
  summary: "Get broadcast message status",
  description:
    "Returns a content message and all its platform posts, showing the full broadcast status.",
  input: z.object({}),
  output: BroadcastStatusResponseSchema,
} as const;

// Export inferred types - all consumers MUST use these, never manual interfaces
export type BroadcastStatusResponse = z.infer<
  typeof BroadcastStatusResponseSchema
>;
