// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/broadcast.draft.v1.contract`
 * Purpose: Defines operation contracts for broadcasting message creation and listing.
 * Scope: Provides Zod schemas and types for broadcast draft wire format. Does not contain business logic.
 * Invariants:
 * - Contract remains stable; breaking changes require new version
 * - All consumers use z.infer types
 * - Per MESSAGE_IS_PLATFORM_AGNOSTIC: body has no platform-specific formatting
 * Side-effects: none
 * Links: /api/v1/broadcasting route, docs/spec/broadcasting.md
 * @internal
 */

import { PLATFORM_IDS } from "@cogni/broadcast-core";
import { z } from "zod";

export const BroadcastDraftInputSchema = z.object({
  body: z.string().min(1).max(50_000),
  title: z.string().max(500).optional(),
  targetPlatforms: z
    .array(z.enum(PLATFORM_IDS))
    .min(1)
    .max(PLATFORM_IDS.length),
  mediaUrls: z.array(z.string().url()).max(10).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ContentMessageResponseSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  title: z.string().nullable(),
  targetPlatforms: z.array(z.string()),
  mediaUrls: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  status: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ContentMessageListResponseSchema = z.object({
  messages: z.array(ContentMessageResponseSchema),
});

export const broadcastDraftOperation = {
  id: "broadcast.draft.v1",
  summary: "Create a new broadcast draft",
  description:
    "Creates a platform-agnostic content message for broadcasting. Returns the created draft.",
  input: BroadcastDraftInputSchema,
  output: ContentMessageResponseSchema,
} as const;

export const broadcastListOperation = {
  id: "broadcast.list.v1",
  summary: "List broadcast messages",
  description:
    "Lists all content messages for the authenticated user, optionally filtered by status.",
  input: z.object({}).optional(),
  output: ContentMessageListResponseSchema,
} as const;

// Export inferred types - all consumers MUST use these, never manual interfaces
export type BroadcastDraftInput = z.infer<typeof BroadcastDraftInputSchema>;
export type ContentMessageResponse = z.infer<
  typeof ContentMessageResponseSchema
>;
export type ContentMessageListResponse = z.infer<
  typeof ContentMessageListResponseSchema
>;
