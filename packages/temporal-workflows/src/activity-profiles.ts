// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/workflows/activity-profiles`
 * Purpose: Shared proxyActivities timeout/retry config profiles.
 * Scope: Config constants only — no I/O, no imports of adapters.
 * Invariants:
 *   - Per PROXY_CONFIGS_DRY: Deduplicate configs that appear 2+ times across workflows.
 *   - Workflow-specific configs stay inline with rationale comments.
 * Side-effects: none
 * Links: docs/spec/temporal-patterns.md
 * @internal
 */

import type { ActivityOptions } from "@temporalio/workflow";

/** Standard activity profile: 2-min timeout, 5 retries with exponential backoff. */
export const STANDARD_ACTIVITY_OPTIONS = {
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "2 seconds",
    maximumInterval: "1 minute",
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
} as const satisfies ActivityOptions;

/** External API activity profile: 5-min timeout, 3 retries with longer backoff. */
export const EXTERNAL_API_ACTIVITY_OPTIONS = {
  startToCloseTimeout: "5 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "2 minutes",
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
} as const satisfies ActivityOptions;

/** Graph execution profile: 15-min timeout, no retry (idempotency collision risk). */
export const GRAPH_EXECUTION_ACTIVITY_OPTIONS = {
  startToCloseTimeout: "15 minutes",
  retry: { maximumAttempts: 1 },
} as const satisfies ActivityOptions;
