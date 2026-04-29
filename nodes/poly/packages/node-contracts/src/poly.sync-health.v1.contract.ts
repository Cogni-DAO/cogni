// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/poly.sync-health.v1.contract`
 * Purpose: Contract for the aggregate sync-health read — freshness stats for the order reconciler. Suitable for a dashboard banner and a Grafana alert rule.
 * Scope: GET /api/v1/poly/internal/sync-health. Does not require auth — aggregate-only, no PII, no wallet addresses. Does not support filters.
 * Invariants:
 *   - SYNC_HEALTH_IS_PUBLIC — shape is stable; consumers (Grafana, dashboard) may rely on field names.
 *   - oldest_synced_row_age_ms is null when no row has a non-null synced_at (never-synced rows have no age — use rows_never_synced for that signal).
 * Side-effects: none
 * Notes: reconciler_last_tick_at is null when the reconciler has not ticked in this process yet (e.g. Polymarket creds absent).
 * Links: work/items/task.0328.md, docs/spec/poly-copy-trade-phase1.md
 * @public
 */

import { z } from "zod";

export const PolySyncHealthResponseSchema = z.object({
  oldest_synced_row_age_ms: z.number().int().min(0).nullable(),
  rows_stale_over_60s: z.number().int().min(0),
  rows_never_synced: z.number().int().min(0),
  reconciler_last_tick_at: z.string().datetime().nullable(),
});

export type PolySyncHealthResponse = z.infer<
  typeof PolySyncHealthResponseSchema
>;
