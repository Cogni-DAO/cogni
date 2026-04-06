// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/work.items.get.v1.contract`
 * Purpose: Defines operation contract for getting a single work item by ID.
 * Scope: Provides Zod schema and types for work item get wire format. Does not contain business logic.
 * Invariants:
 *   - Contract remains stable; breaking changes require new version
 *   - All consumers use z.infer types
 * Side-effects: none
 * Links: /api/v1/work/items/[id] route, docs/spec/work-items-port.md
 * @internal
 */

import { z } from "zod";

import { WorkItemDtoSchema } from "./work.items.list.v1.contract";

export const workItemsGetOperation = {
  id: "work.items.get.v1",
  summary: "Get a work item by ID",
  description: "Returns a single work item by its ID, or 404 if not found.",
  input: z.object({
    id: z.string(),
  }),
  output: WorkItemDtoSchema,
} as const;

// Export inferred types
export type WorkItemsGetInput = z.infer<typeof workItemsGetOperation.input>;
export type WorkItemsGetOutput = z.infer<typeof workItemsGetOperation.output>;
