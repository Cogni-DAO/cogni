// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/users.profile.v1.contract`
 * Purpose: Defines operation contracts for user profile read and update.
 * Scope: Zod schemas and types for /api/v1/users/me endpoint. Does not implement business logic.
 * Invariants:
 *   - Contract remains stable; breaking changes require new version
 *   - All consumers use z.infer types
 *   - DISPLAY_NAME_FALLBACK: resolved_display_name applies fallback chain (profile → primary binding → any binding → wallet truncation)
 *   - DISPLAY_NAME_MAX_50: displayName input validated to max 50 chars
 *   - AVATAR_COLOR_HEX: avatarColor input validated to ^#[0-9a-fA-F]{6}$
 * Side-effects: none
 * Links: /api/v1/users/me route
 * @internal
 */

import { z } from "zod";

const LinkedProviderSchema = z.object({
  provider: z.enum(["wallet", "discord", "github", "google"]),
  providerLogin: z.string().nullable(),
});

export const profileReadOperation = {
  id: "users.profile.read.v1",
  summary: "Read current user profile",
  input: z.object({}),
  output: z.object({
    displayName: z.string().max(50).nullable(),
    avatarColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable(),
    resolvedDisplayName: z.string(),
    linkedProviders: z.array(LinkedProviderSchema),
  }),
} as const;

export const profileUpdateOperation = {
  id: "users.profile.update.v1",
  summary: "Update current user profile",
  input: z.object({
    displayName: z.string().max(50).nullable().optional(),
    avatarColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
  }),
  output: z.object({
    displayName: z.string().max(50).nullable(),
    avatarColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable(),
    resolvedDisplayName: z.string(),
  }),
} as const;

export type LinkedProvider = z.infer<typeof LinkedProviderSchema>;
export type ProfileReadOutput = z.infer<typeof profileReadOperation.output>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateOperation.input>;
export type ProfileUpdateOutput = z.infer<typeof profileUpdateOperation.output>;
