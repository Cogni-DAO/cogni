// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/work-item-query`
 * Purpose: AI tool that lists/searches work items with filters.
 * Scope: Read-only work item listing. Does not mutate items or import LangChain.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__work_item_query`
 *   - EFFECT_TYPED: effect is `read_only`
 * Side-effects: IO (reads work items via capability)
 * Links: docs/spec/development-lifecycle.md
 * @public
 */

import { z } from "zod";

import type { WorkItemCapability } from "../capabilities/work-item";
import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const WorkItemQueryInputSchema = z.object({
  statuses: z
    .array(
      z.enum([
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
    )
    .optional()
    .describe(
      "Filter by status. Omit for all actionable statuses. " +
        "Priority order: needs_merge > needs_closeout > needs_implement > needs_design > needs_research > needs_triage"
    ),
  types: z
    .array(z.enum(["task", "bug", "story", "spike", "subtask"]))
    .optional()
    .describe("Filter by work item type"),
  text: z
    .string()
    .optional()
    .describe("Free-text search across title and summary"),
  actor: z
    .enum(["human", "ai", "either"])
    .optional()
    .describe(
      "Eligibility filter. Pass 'ai' to see only items safe for autonomous AI handling."
    ),
  projectId: z
    .string()
    .optional()
    .describe("Filter by project ID (e.g., 'proj.agentic-interop')"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Max results to return (default 20, max 50)"),
});
export type WorkItemQueryInput = z.infer<typeof WorkItemQueryInputSchema>;

const WorkItemOutputSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  status: z.string(),
  actor: z.string().optional(),
  priority: z.number().optional(),
  rank: z.number().optional(),
  summary: z.string().optional(),
  projectId: z.string().optional(),
  labels: z.array(z.string()),
  assignees: z.array(z.object({ kind: z.string(), id: z.string() })),
  branch: z.string().optional(),
  pr: z.string().optional(),
  blockedBy: z.string().optional(),
  updatedAt: z.string(),
});

export const WorkItemQueryOutputSchema = z.object({
  items: z.array(WorkItemOutputSchema),
  count: z.number(),
});
export type WorkItemQueryOutput = z.infer<typeof WorkItemQueryOutputSchema>;

export type WorkItemQueryRedacted = WorkItemQueryOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const WORK_ITEM_QUERY_NAME = "core__work_item_query" as const;

export const workItemQueryContract: ToolContract<
  typeof WORK_ITEM_QUERY_NAME,
  WorkItemQueryInput,
  WorkItemQueryOutput,
  WorkItemQueryRedacted
> = {
  name: WORK_ITEM_QUERY_NAME,
  description:
    "Query the work item backlog. Returns items matching filters sorted by " +
    "priority (status weight, then priority field, then rank). Use this to " +
    "find actionable items, check item status, or search by text.",
  effect: "read_only",
  inputSchema: WorkItemQueryInputSchema,
  outputSchema: WorkItemQueryOutputSchema,

  redact: (output: WorkItemQueryOutput): WorkItemQueryRedacted => output,
  allowlist: ["items", "count"] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkItemQueryDeps {
  readonly workItemCapability: WorkItemCapability;
}

export function createWorkItemQueryImplementation(
  deps: WorkItemQueryDeps
): ToolImplementation<WorkItemQueryInput, WorkItemQueryOutput> {
  return {
    execute: async (
      input: WorkItemQueryInput
    ): Promise<WorkItemQueryOutput> => {
      const items = await deps.workItemCapability.query({
        statuses: input.statuses,
        types: input.types,
        text: input.text,
        actor: input.actor,
        projectId: input.projectId,
        limit: input.limit ?? 20,
      });

      return {
        items: items.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          status: item.status,
          actor: item.actor,
          priority: item.priority,
          rank: item.rank,
          summary: item.summary,
          projectId: item.projectId,
          labels: [...item.labels],
          assignees: item.assignees.map((a) => ({
            kind: a.kind,
            id: a.id,
          })),
          branch: item.branch,
          pr: item.pr,
          blockedBy: item.blockedBy,
          updatedAt: item.updatedAt,
        })),
        count: items.length,
      };
    },
  };
}

export const workItemQueryStubImplementation: ToolImplementation<
  WorkItemQueryInput,
  WorkItemQueryOutput
> = {
  execute: async (): Promise<WorkItemQueryOutput> => {
    throw new Error("WorkItemCapability not configured.");
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool
// ─────────────────────────────────────────────────────────────────────────────

export const workItemQueryBoundTool: BoundTool<
  typeof WORK_ITEM_QUERY_NAME,
  WorkItemQueryInput,
  WorkItemQueryOutput,
  WorkItemQueryRedacted
> = {
  contract: workItemQueryContract,
  implementation: workItemQueryStubImplementation,
};
