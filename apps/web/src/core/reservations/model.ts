// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/reservations/model`
 * Purpose: Reservation domain entities — watch requests, events, booking attempts.
 * Scope: Pure domain types. No I/O, no infrastructure dependencies.
 * Invariants:
 * - Status enums sourced from @cogni/db-schema/reservations (single source of truth)
 * - All dates are ISO 8601 strings at the domain level
 * Side-effects: none
 * @public
 */

export type {
  BookingAttemptStatus,
  ReservationPlatform,
  WatchEventSource,
  WatchEventType,
  WatchRequestStatus,
} from "@cogni/db-schema/reservations";

export interface WatchRequest {
  id: string;
  userId: string;
  platform: string;
  venue: string;
  partySize: string;
  dateStart: Date;
  dateEnd: Date;
  preferredTimeStart: string | null;
  preferredTimeEnd: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WatchEvent {
  id: string;
  watchRequestId: string;
  source: string;
  eventType: string;
  payloadJson: Record<string, unknown> | null;
  createdAt: Date;
}

export interface BookingAttempt {
  id: string;
  watchRequestId: string;
  status: string;
  detailsJson: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}
