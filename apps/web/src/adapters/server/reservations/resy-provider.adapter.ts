// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/reservations/resy-provider`
 * Purpose: Resy platform integration via official channels only.
 * Scope: Implements ReservationProviderPort for Resy — alert setup instructions and booking assist.
 * Invariants:
 * - NO_SCRAPING: Never scrape protected endpoints or bypass anti-bot systems
 * - OFFICIAL_CHANNELS_ONLY: All interactions through official Resy UX/pages
 * - USER_APPROVAL_GATE: attemptBooking only called after explicit user approval
 * - TERMS_COMPLIANT: Playwright usage limited to user-authorized browser assistance
 * Side-effects: IO (browser automation via Playwright — user-authorized only)
 * Links: task.0166
 * @public
 */

import type {
  AlertSetupResult,
  BookingAssistParams,
  BookingAssistResult,
  ReservationProviderPort,
  WatchRequest,
} from "@/ports";

/**
 * ResyProviderAdapter — implements reservation provider for Resy.
 *
 * COMPLIANCE GUARDRAILS:
 * - Alert setup returns user instructions to enable Resy's native Notify feature
 * - Booking assist uses Playwright with stored authenticated session only
 * - No API scraping, credential rotation, or anti-bot bypass
 * - All actions logged for audit trail
 */
export class ResyProviderAdapter implements ReservationProviderPort {
  readonly platformId = "resy";

  /**
   * Set up alert via Resy's native Notify feature.
   * Returns instructions for the user to manually enable notifications
   * through the official Resy app/website.
   */
  async setupAlert(watch: WatchRequest): Promise<AlertSetupResult> {
    // Resy's Notify feature is user-initiated through their app.
    // We return instructions for the user to set it up manually.
    const setupUrl = `https://resy.com/cities/ny/${encodeURIComponent(watch.venue.toLowerCase().replace(/\s+/g, "-"))}`;

    return {
      success: true,
      userInstructions: [
        `To set up Resy notifications for ${watch.venue}:`,
        `1. Open the Resy app or visit ${setupUrl}`,
        `2. Find the restaurant page for "${watch.venue}"`,
        `3. Tap/click the "Notify" button for your desired date(s)`,
        `4. Resy will send you a push notification when a table becomes available`,
        `5. Forward the notification to this system or use the manual ingest endpoint`,
        "",
        `Date range: ${watch.dateStart.toISOString().split("T")[0]} to ${watch.dateEnd.toISOString().split("T")[0]}`,
        `Party size: ${watch.partySize}`,
        watch.preferredTimeStart
          ? `Preferred time: ${watch.preferredTimeStart} - ${watch.preferredTimeEnd ?? "any"}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      setupUrl,
    };
  }

  /**
   * Attempt booking via Playwright with stored authenticated session.
   *
   * INVARIANT: USER_APPROVAL_GATE — caller verified approval before invoking.
   * INVARIANT: OFFICIAL_CHANNELS_ONLY — navigates official Resy booking pages only.
   * INVARIANT: TERMS_COMPLIANT — uses stored session state, no credential injection.
   *
   * MVP: Returns a stub result. Full Playwright implementation deferred to
   * avoid shipping browser automation before compliance review.
   */
  async attemptBooking(
    params: BookingAssistParams
  ): Promise<BookingAssistResult> {
    // MVP STUB: Log intent and return pending status.
    // Full Playwright implementation requires:
    // 1. Compliance review of Resy's Terms of Service
    // 2. Stored session state validation
    // 3. Screenshot capture for audit trail
    // 4. Rate limiting to avoid abuse
    const { watch, sessionStatePath, targetSlot } = params;

    // Validate session state path exists
    if (!sessionStatePath) {
      return {
        success: false,
        error: "No session state path provided. User must authenticate first.",
      };
    }

    // MVP: Return instructions rather than automated booking
    return {
      success: false,
      error: [
        "Booking assist is in manual mode for MVP.",
        `Platform: ${this.platformId}`,
        `Venue: ${watch.venue}`,
        targetSlot
          ? `Target slot: ${targetSlot.date} at ${targetSlot.time}`
          : "No specific slot targeted",
        "",
        "To complete booking manually:",
        "1. Open Resy app/website",
        "2. Navigate to the restaurant page",
        "3. Select the available time slot",
        "4. Confirm the reservation",
        "",
        "Full Playwright-assisted booking will be available after compliance review.",
      ].join("\n"),
    };
  }
}
