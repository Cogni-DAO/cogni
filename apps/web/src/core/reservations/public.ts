// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/reservations/public`
 * Purpose: Public entry point for reservation domain types and rules.
 * Scope: Re-exports only. No logic here.
 * Side-effects: none
 * @public
 */

export type {
  BookingAttempt,
  BookingAttemptStatus,
  ReservationPlatform,
  WatchEvent,
  WatchEventSource,
  WatchEventType,
  WatchRequest,
  WatchRequestStatus,
} from "./model";
export {
  assertValidDateRange,
  assertValidPartySize,
  InvalidDateRangeError,
  InvalidPartySizeError,
  InvalidStatusTransitionError,
  isValidStatusTransition,
  isWatchable,
} from "./rules";
