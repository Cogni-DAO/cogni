// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/node-schedules-sync.internal.v1.contract`
 * Purpose: Contract for the internal node-schedules sync trigger endpoint.
 * Scope: Defines response shape for POST /api/internal/ops/node-schedules/sync. Does not contain business logic.
 * Invariants:
 *   - Internal endpoint only
 *   - Bearer token auth required (INTERNAL_OPS_TOKEN)
 *   - Response shape mirrors the governance-schedules-sync summary
 * Side-effects: none
 * Links: /api/internal/ops/node-schedules/sync route, docs/spec/temporal-patterns.md
 * @internal
 */

import { z } from "zod";

export const NodeSchedulesSyncSummarySchema = z.object({
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  resumed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  paused: z.number().int().min(0),
});

export const nodeSchedulesSyncOperation = {
  id: "node.schedules.sync.internal.v1",
  summary:
    "Sync this node's repo-spec recurring schedules via internal ops endpoint",
  description:
    "Internal endpoint that reconciles the node's declarative repo-spec `schedules` into Temporal Schedules under the system principal (mirror of governance schedule sync, for the node-as-tenant path).",
  input: z.object({}).strict(),
  output: NodeSchedulesSyncSummarySchema,
} as const;

export type NodeSchedulesSyncSummary = z.infer<
  typeof NodeSchedulesSyncSummarySchema
>;
