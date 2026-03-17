// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/reservations.booking.v1.contract`
 * Purpose: Operation contracts for booking attempts.
 * Scope: Zod schemas and inferred types for booking attempt wire format.
 * Invariants:
 * - Contract remains stable; breaking changes require new version
 * - USER_APPROVAL_GATE: booking create only after user approval signal
 * Side-effects: none
 * Links: task.0166, /api/v1/reservations/watches/[id]/bookings route
 * @internal
 */

import { z } from "zod";

const BookingAttemptSchema = z.object({
  id: z.string().uuid(),
  watchRequestId: z.string().uuid(),
  status: z.enum([
    "pending",
    "in_progress",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  detailsJson: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const BookingListOutputSchema = z.object({
  attempts: z.array(BookingAttemptSchema),
});

export const BookingApproveInputSchema = z.object({
  /** Path to stored browser session state for authenticated booking */
  sessionStatePath: z.string().min(1),
  /** Optional target slot to book */
  targetSlot: z
    .object({
      date: z.string(),
      time: z.string(),
    })
    .optional(),
});

export const bookingListOperation = {
  id: "reservations.booking.list.v1",
  summary: "List booking attempts for a watch request",
  description:
    "Returns all booking attempts for a given watch request, ordered by creation time.",
  input: z.object({}),
  output: BookingListOutputSchema,
} as const;

export const bookingApproveOperation = {
  id: "reservations.booking.approve.v1",
  summary: "Approve and launch a booking attempt",
  description:
    "User explicitly approves booking assistance. Creates a booking attempt and launches the assist task. Requires stored session state for the platform.",
  input: BookingApproveInputSchema,
  output: BookingAttemptSchema,
} as const;

export type BookingAttemptResponse = z.infer<typeof BookingAttemptSchema>;
export type BookingListOutput = z.infer<typeof BookingListOutputSchema>;
export type BookingApproveInput = z.infer<typeof BookingApproveInputSchema>;
