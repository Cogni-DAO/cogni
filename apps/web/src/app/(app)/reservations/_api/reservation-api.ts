// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/reservations/_api/reservation-api`
 * Purpose: Client-side fetch wrappers for reservation API endpoints.
 * Scope: Type-safe fetch helpers for watches, events, bookings, and alert ingestion.
 * Invariants: Returns typed contract responses or throws
 * Side-effects: IO
 * Links: @contracts/reservations.*.v1.contract
 * @internal
 */

import type { z } from "zod";
import type { bookingListOperation } from "@/contracts/reservations.booking.v1.contract";
import type { eventsListOperation } from "@/contracts/reservations.events.v1.contract";
import type {
  IngestAlertInput,
  ingestAlertOperation,
} from "@/contracts/reservations.ingest.v1.contract";
import type {
  WatchCreateInput,
  WatchStatusUpdateInput,
  watchCreateOperation,
  watchListOperation,
} from "@/contracts/reservations.watch.v1.contract";

type WatchResponse = z.infer<typeof watchCreateOperation.output>;
type WatchListResponse = z.infer<typeof watchListOperation.output>;
type EventListResponse = z.infer<typeof eventsListOperation.output>;
type BookingListResponse = z.infer<typeof bookingListOperation.output>;
type IngestResponse = z.infer<typeof ingestAlertOperation.output>;

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    credentials: "same-origin",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({
      error: `HTTP ${response.status}`,
    }));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export function fetchWatches(): Promise<WatchListResponse> {
  return apiFetch("/api/v1/reservations/watches");
}

export function createWatch(input: WatchCreateInput): Promise<WatchResponse> {
  return apiFetch("/api/v1/reservations/watches", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWatchStatus(
  watchId: string,
  input: WatchStatusUpdateInput
): Promise<WatchResponse> {
  return apiFetch(`/api/v1/reservations/watches/${watchId}/status`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function fetchEvents(watchId: string): Promise<EventListResponse> {
  return apiFetch(`/api/v1/reservations/watches/${watchId}/events`);
}

export function fetchBookings(watchId: string): Promise<BookingListResponse> {
  return apiFetch(`/api/v1/reservations/watches/${watchId}/bookings`);
}

export function ingestAlert(input: IngestAlertInput): Promise<IngestResponse> {
  return apiFetch("/api/v1/reservations/ingest", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
