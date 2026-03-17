// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/reservations.events.v1.contract`
 * Purpose: Operation contract for watch event timeline.
 * Scope: Zod schemas and inferred types for event listing wire format.
 * Invariants:
 * - Contract remains stable; breaking changes require new version
 * - All consumers use z.infer types
 * Side-effects: none
 * Links: task.0166, /api/v1/reservations/watches/[id]/events route
 * @internal
 */

import { z } from "zod";

const WatchEventSchema = z.object({
  id: z.string().uuid(),
  watchRequestId: z.string().uuid(),
  source: z.string(),
  eventType: z.string(),
  payloadJson: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});

export const EventListOutputSchema = z.object({
  events: z.array(WatchEventSchema),
});

export const eventsListOperation = {
  id: "reservations.events.list.v1",
  summary: "List events for a watch request",
  description:
    "Returns the full event timeline for a given watch request, ordered by creation time.",
  input: z.object({}),
  output: EventListOutputSchema,
} as const;

export type WatchEventResponse = z.infer<typeof WatchEventSchema>;
export type EventListOutput = z.infer<typeof EventListOutputSchema>;
