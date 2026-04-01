// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/work-item-transition`
 * Purpose: AI tool for transitioning work item status and patching fields.
 * Scope: State-changing work item mutations via WorkItemCapability. Does not import LangChain.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__work_item_transition`
 *   - EFFECT_TYPED: effect is `state_change`
 *   - NO_ONEOF_IN_SCHEMA: Uses flat z.object per tool-use.md #10
 *   - TRANSITION_TABLE_ENFORCED: Capability validates transitions via development-lifecycle.md
 * Side-effects: IO (mutates work items via capability)
 * Links: docs/spec/development-lifecycle.md, docs/spec/tool-use.md
 * @public
 */

import { z } from "zod";

import type { WorkItemCapability } from "../capabilities/work-item";
import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flat object schema for work item transitions.
 *
 * Per tool-use.md #10: inputSchema must compile to JSON Schema `type: "object"`.
 * action enum + all fields optional; implementation validates per-action.
 */
export const WorkItemTransitionInputSchema = z.object({
  action: z
    .enum(["transition", "patch"])
    .describe(
      "Action: 'transition' changes status, 'patch' updates fields (priority, labels, summary)"
    ),
  id: z
    .string()
    .min(1)
    .describe("Work item ID (e.g., 'task.0149', 'bug.0150')"),
  toStatus: z
    .enum([
      "needs_triage",
      "needs_research",
      "needs_design",
      "needs_implement",
      "needs_closeout",
      "needs_merge",
      "done",
      "blocked",
      "cancelled",
    ])
    .optional()
    .describe("Target status (required for transition action)"),
  reason: z
    .string()
    .optional()
    .describe("Reason for the transition — recorded in audit trail"),
  priority: z
    .number()
    .int()
    .min(0)
    .max(99)
    .optional()
    .describe("Priority (0=highest, used for patch action)"),
  labels: z
    .array(z.string())
    .optional()
    .describe("Labels to set (used for patch action)"),
  summary: z
    .string()
    .optional()
    .describe("Summary to set (used for patch action)"),
});
export type WorkItemTransitionInput = z.infer<
  typeof WorkItemTransitionInputSchema
>;

export const WorkItemTransitionOutputSchema = z.object({
  success: z.boolean(),
  action: z.string(),
  id: z.string(),
  message: z.string(),
  previousStatus: z.string().optional(),
  newStatus: z.string().optional(),
});
export type WorkItemTransitionOutput = z.infer<
  typeof WorkItemTransitionOutputSchema
>;

export type WorkItemTransitionRedacted = WorkItemTransitionOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const WORK_ITEM_TRANSITION_NAME = "core__work_item_transition" as const;

export const workItemTransitionContract: ToolContract<
  typeof WORK_ITEM_TRANSITION_NAME,
  WorkItemTransitionInput,
  WorkItemTransitionOutput,
  WorkItemTransitionRedacted
> = {
  name: WORK_ITEM_TRANSITION_NAME,
  description:
    "Modify a work item. Actions: " +
    "'transition' (requires id + toStatus, optional reason) changes the item's lifecycle status, " +
    "'patch' (requires id, optional priority/labels/summary) updates metadata fields. " +
    "Use core__work_item_query first to find items and check their current status.",
  effect: "state_change",
  inputSchema: WorkItemTransitionInputSchema,
  outputSchema: WorkItemTransitionOutputSchema,

  redact: (output: WorkItemTransitionOutput): WorkItemTransitionRedacted =>
    output,
  allowlist: [
    "success",
    "action",
    "id",
    "message",
    "previousStatus",
    "newStatus",
  ] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkItemTransitionDeps {
  readonly workItemCapability: WorkItemCapability;
}

export function createWorkItemTransitionImplementation(
  deps: WorkItemTransitionDeps
): ToolImplementation<WorkItemTransitionInput, WorkItemTransitionOutput> {
  const { workItemCapability } = deps;

  return {
    execute: async (
      input: WorkItemTransitionInput
    ): Promise<WorkItemTransitionOutput> => {
      switch (input.action) {
        case "transition": {
          if (!input.toStatus) {
            throw new Error("toStatus is required for action 'transition'");
          }
          const result = await workItemCapability.transitionStatus({
            id: input.id,
            toStatus: input.toStatus,
            reason: input.reason,
          });
          return {
            success: true,
            action: "transition",
            id: result.id,
            message: `Transitioned ${result.id} from ${result.previousStatus} to ${result.newStatus}`,
            previousStatus: result.previousStatus,
            newStatus: result.newStatus,
          };
        }
        case "patch": {
          const setFields: {
            priority?: number;
            labels?: string[];
            summary?: string;
          } = {};
          if (input.priority !== undefined) setFields.priority = input.priority;
          if (input.labels !== undefined) setFields.labels = input.labels;
          if (input.summary !== undefined) setFields.summary = input.summary;

          if (Object.keys(setFields).length === 0) {
            throw new Error(
              "At least one field (priority, labels, or summary) is required for action 'patch'"
            );
          }

          const result = await workItemCapability.patch({
            id: input.id,
            set: setFields,
          });
          return {
            success: true,
            action: "patch",
            id: result.id,
            message: `Patched ${result.id}: updated ${Object.keys(setFields).join(", ")}`,
          };
        }
      }
    },
  };
}

export const workItemTransitionStubImplementation: ToolImplementation<
  WorkItemTransitionInput,
  WorkItemTransitionOutput
> = {
  execute: async (): Promise<WorkItemTransitionOutput> => {
    throw new Error("WorkItemCapability not configured.");
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool
// ─────────────────────────────────────────────────────────────────────────────

export const workItemTransitionBoundTool: BoundTool<
  typeof WORK_ITEM_TRANSITION_NAME,
  WorkItemTransitionInput,
  WorkItemTransitionOutput,
  WorkItemTransitionRedacted
> = {
  contract: workItemTransitionContract,
  implementation: workItemTransitionStubImplementation,
};
