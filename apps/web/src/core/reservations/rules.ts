// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@core/reservations/rules`
 * Purpose: Reservation domain validation and business rules.
 * Scope: Pure functions — no I/O, no infrastructure.
 * Invariants:
 * - USER_APPROVAL_GATE: booking assist requires explicit user approval
 * - Date range must be valid (start <= end)
 * - Party size must be a positive integer
 * Side-effects: none
 * @public
 */

import type { WatchRequestStatus } from "@cogni/db-schema/reservations";

export class InvalidDateRangeError extends Error {
  constructor() {
    super("date_start must be before or equal to date_end");
    this.name = "InvalidDateRangeError";
  }
}

export class InvalidPartySizeError extends Error {
  constructor(value: string) {
    super(`party_size must be a positive integer, got: ${value}`);
    this.name = "InvalidPartySizeError";
  }
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid status transition: ${from} → ${to}`);
    this.name = "InvalidStatusTransitionError";
  }
}

/** Valid status transitions for watch requests */
const VALID_TRANSITIONS: Record<WatchRequestStatus, WatchRequestStatus[]> = {
  active: ["paused", "fulfilled", "cancelled", "expired"],
  paused: ["active", "cancelled"],
  fulfilled: [],
  cancelled: [],
  expired: [],
};

export function isValidStatusTransition(
  from: WatchRequestStatus,
  to: WatchRequestStatus
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidDateRange(start: Date, end: Date): void {
  if (start > end) {
    throw new InvalidDateRangeError();
  }
}

export function assertValidPartySize(size: string): void {
  const n = Number.parseInt(size, 10);
  if (Number.isNaN(n) || n < 1 || String(n) !== size) {
    throw new InvalidPartySizeError(size);
  }
}

/** Watch request statuses that allow receiving new alerts */
export function isWatchable(status: WatchRequestStatus): boolean {
  return status === "active";
}
