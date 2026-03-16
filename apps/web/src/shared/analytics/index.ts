// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/analytics`
 * Purpose: Barrel export for product analytics capture.
 * Scope: Re-exports capture() and types. Does not contain logic.
 * Invariants: Pure re-exports only.
 * Side-effects: none
 * Notes: Single entry point for PostHog product analytics.
 * Links: Delegates to capture and events submodules.
 * @public
 */

export type {
  AnalyticsConfig,
  BufferedEvent,
  CaptureIdentity,
  CaptureParams,
  CaptureProperties,
  PostHogClient,
} from "./capture";
export {
  capture,
  getBuffer,
  initAnalytics,
  isAnalyticsInitialized,
  resetAnalytics,
  shutdownAnalytics,
} from "./capture";

export { AnalyticsEvents } from "./events";
