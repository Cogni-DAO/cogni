// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/reservations/services/watch-manager`
 * Purpose: Orchestration service for reservation watch request lifecycle.
 * Scope: Coordinates core domain rules, store port, and provider port for watch CRUD.
 * Invariants:
 * - USER_APPROVAL_GATE: booking only after explicit user approval
 * - AUDIT_TRAIL: all state changes recorded as watch_events
 * - OFFICIAL_CHANNELS_ONLY: delegates to provider adapters that use official channels
 * Side-effects: calls ports (DB, provider, Temporal)
 * Links: task.0166
 * @public
 */

import type { WatchRequestStatus } from "@/core";
import {
  assertValidDateRange,
  assertValidPartySize,
  InvalidStatusTransitionError,
  isValidStatusTransition,
} from "@/core";
import type {
  CreateWatchRequestParams,
  ReservationProviderPort,
  ReservationStorePort,
} from "@/ports";

export interface WatchManagerDeps {
  store: ReservationStorePort;
  providers: Map<string, ReservationProviderPort>;
}

export async function createWatch(
  userId: string,
  input: {
    platform: string;
    venue: string;
    partySize: string;
    dateStart: string;
    dateEnd: string;
    preferredTimeStart?: string | undefined;
    preferredTimeEnd?: string | undefined;
  },
  deps: WatchManagerDeps
) {
  const dateStart = new Date(input.dateStart);
  const dateEnd = new Date(input.dateEnd);

  // Validate domain rules
  assertValidDateRange(dateStart, dateEnd);
  assertValidPartySize(input.partySize);

  const params: CreateWatchRequestParams = {
    userId,
    platform: input.platform,
    venue: input.venue,
    partySize: input.partySize,
    dateStart,
    dateEnd,
    preferredTimeStart: input.preferredTimeStart,
    preferredTimeEnd: input.preferredTimeEnd,
  };

  const watch = await deps.store.createWatchRequest(params);

  // Record creation event
  await deps.store.appendEvent({
    watchRequestId: watch.id,
    source: "system",
    eventType: "created",
    payloadJson: { platform: input.platform, venue: input.venue },
  });

  // Set up provider alert if available
  const provider = deps.providers.get(input.platform);
  if (provider) {
    const alertResult = await provider.setupAlert(watch);
    await deps.store.appendEvent({
      watchRequestId: watch.id,
      source: input.platform as "resy" | "opentable",
      eventType: "created",
      payloadJson: {
        alertSetup: alertResult.success,
        userInstructions: alertResult.userInstructions,
        setupUrl: alertResult.setupUrl,
      },
    });
  }

  return watch;
}

export async function updateWatchStatus(
  watchId: string,
  newStatus: WatchRequestStatus,
  deps: WatchManagerDeps
) {
  const watch = await deps.store.getWatchRequest(watchId);
  if (!watch) {
    throw new Error(`Watch request not found: ${watchId}`);
  }

  if (!isValidStatusTransition(watch.status as WatchRequestStatus, newStatus)) {
    throw new InvalidStatusTransitionError(watch.status, newStatus);
  }

  const updated = await deps.store.updateWatchRequestStatus(watchId, newStatus);

  const eventType =
    newStatus === "paused"
      ? "paused"
      : newStatus === "active"
        ? "resumed"
        : "cancelled";

  await deps.store.appendEvent({
    watchRequestId: watchId,
    source: "system",
    eventType,
  });

  return updated;
}

export async function listWatches(userId: string, deps: WatchManagerDeps) {
  return deps.store.listWatchRequests(userId);
}

export async function getWatchTimeline(
  watchId: string,
  deps: WatchManagerDeps
) {
  return deps.store.listEvents(watchId);
}

export async function getWatchBookings(
  watchId: string,
  deps: WatchManagerDeps
) {
  return deps.store.listBookingAttempts(watchId);
}

export async function ingestAlert(
  watchId: string,
  source: "resy" | "opentable" | "email" | "webhook" | "manual",
  payload: Record<string, unknown>,
  deps: WatchManagerDeps
) {
  const watch = await deps.store.getWatchRequest(watchId);
  if (!watch) {
    throw new Error(`Watch request not found: ${watchId}`);
  }

  const event = await deps.store.appendEvent({
    watchRequestId: watchId,
    source,
    eventType: "alert_received",
    payloadJson: payload,
  });

  return event;
}

export async function approveBooking(
  watchId: string,
  sessionStatePath: string,
  targetSlot: { date: string; time: string } | undefined,
  deps: WatchManagerDeps
) {
  const watch = await deps.store.getWatchRequest(watchId);
  if (!watch) {
    throw new Error(`Watch request not found: ${watchId}`);
  }

  // Record user approval
  await deps.store.appendEvent({
    watchRequestId: watchId,
    source: "system",
    eventType: "user_approved",
  });

  // Create booking attempt
  const attempt = await deps.store.createBookingAttempt(watchId);

  // Attempt booking via provider
  const provider = deps.providers.get(watch.platform);
  if (!provider) {
    const updated = await deps.store.updateBookingAttemptStatus(
      attempt.id,
      "failed",
      { error: `No provider available for platform: ${watch.platform}` }
    );
    await deps.store.appendEvent({
      watchRequestId: watchId,
      source: "system",
      eventType: "booking_failed",
      payloadJson: { error: "No provider available" },
    });
    return updated;
  }

  // Mark as in progress
  await deps.store.updateBookingAttemptStatus(attempt.id, "in_progress");
  await deps.store.appendEvent({
    watchRequestId: watchId,
    source: "system",
    eventType: "booking_started",
  });

  const result = await provider.attemptBooking({
    watch,
    sessionStatePath,
    targetSlot,
  });

  if (result.success) {
    const updated = await deps.store.updateBookingAttemptStatus(
      attempt.id,
      "succeeded",
      {
        confirmationCode: result.confirmationCode,
        screenshotPath: result.screenshotPath,
      }
    );
    await deps.store.appendEvent({
      watchRequestId: watchId,
      source: "system",
      eventType: "booking_succeeded",
      payloadJson: { confirmationCode: result.confirmationCode },
    });
    await deps.store.updateWatchRequestStatus(watchId, "fulfilled");
    return updated;
  }

  const updated = await deps.store.updateBookingAttemptStatus(
    attempt.id,
    "failed",
    { error: result.error }
  );
  await deps.store.appendEvent({
    watchRequestId: watchId,
    source: "system",
    eventType: "booking_failed",
    payloadJson: { error: result.error },
  });
  return updated;
}
