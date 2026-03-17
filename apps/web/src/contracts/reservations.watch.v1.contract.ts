// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/reservations.watch.v1.contract`
 * Purpose: Operation contracts for watch request CRUD.
 * Scope: Zod schemas and inferred types for watch request wire format.
 * Invariants:
 * - Contract remains stable; breaking changes require new version
 * - All consumers use z.infer types
 * Side-effects: none
 * Links: task.0166, /api/v1/reservations/watches route
 * @internal
 */

import { z } from "zod";

/* ─── Shared Response Schemas ─────────────────────────────────────── */

const WatchRequestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  platform: z.enum(["resy", "opentable", "other"]),
  venue: z.string(),
  partySize: z.string(),
  dateStart: z.string().datetime(),
  dateEnd: z.string().datetime(),
  preferredTimeStart: z.string().nullable(),
  preferredTimeEnd: z.string().nullable(),
  status: z.enum(["active", "paused", "fulfilled", "cancelled", "expired"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/* ─── Create Watch ────────────────────────────────────────────────── */

export const WatchCreateInputSchema = z.object({
  platform: z.enum(["resy", "opentable", "other"]),
  venue: z.string().min(1),
  partySize: z.string().regex(/^\d+$/, "Must be a positive integer"),
  dateStart: z.string().datetime(),
  dateEnd: z.string().datetime(),
  preferredTimeStart: z.string().optional(),
  preferredTimeEnd: z.string().optional(),
});

export const watchCreateOperation = {
  id: "reservations.watch.create.v1",
  summary: "Create a new watch request",
  description:
    "Creates a watch request to monitor a restaurant for availability on a given platform.",
  input: WatchCreateInputSchema,
  output: WatchRequestSchema,
} as const;

/* ─── List Watches ────────────────────────────────────────────────── */

export const WatchListOutputSchema = z.object({
  watches: z.array(WatchRequestSchema),
});

export const watchListOperation = {
  id: "reservations.watch.list.v1",
  summary: "List watch requests for current user",
  description: "Returns all watch requests for the authenticated user.",
  input: z.object({}),
  output: WatchListOutputSchema,
} as const;

/* ─── Update Watch Status ─────────────────────────────────────────── */

export const WatchStatusUpdateInputSchema = z.object({
  status: z.enum(["active", "paused", "cancelled"]),
});

export const watchStatusUpdateOperation = {
  id: "reservations.watch.update-status.v1",
  summary: "Pause or cancel a watch request",
  description:
    "Updates the status of a watch request. Valid transitions: active→paused, active→cancelled, paused→active, paused→cancelled.",
  input: WatchStatusUpdateInputSchema,
  output: WatchRequestSchema,
} as const;

/* ─── Inferred Types ──────────────────────────────────────────────── */

export type WatchCreateInput = z.infer<typeof WatchCreateInputSchema>;
export type WatchRequestResponse = z.infer<typeof WatchRequestSchema>;
export type WatchListOutput = z.infer<typeof WatchListOutputSchema>;
export type WatchStatusUpdateInput = z.infer<
  typeof WatchStatusUpdateInputSchema
>;
