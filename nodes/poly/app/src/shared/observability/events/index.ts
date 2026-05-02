// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@shared/observability/events`
 * Purpose: App-local event registry for structured logging.
 * Scope: Extends shared node event names with Poly app events that are not
 *   exported from `@cogni/node-shared`.
 * Invariants: New app log event names are registered here; callsites do not
 *   inline event strings.
 * Side-effects: none
 * @public
 */

import {
  type EventBase,
  EVENT_NAMES as SHARED_EVENT_NAMES,
} from "@cogni/node-shared";

export const EVENT_NAMES = {
  ...SHARED_EVENT_NAMES,

  // Poly redeem lifecycle bridge (task.5006)
  POLY_REDEEM_LIFECYCLE_MIRRORED: "feature.poly_redeem.lifecycle_mirrored",
  POLY_REDEEM_LIFECYCLE_MIRROR_FAILED:
    "feature.poly_redeem.lifecycle_mirror_failed",
} as const;

export type EventName = (typeof EVENT_NAMES)[keyof typeof EVENT_NAMES];
export type { EventBase };
