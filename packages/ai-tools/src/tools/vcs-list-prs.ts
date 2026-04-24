// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/vcs-list-prs`
 * Purpose: AI tool that lists pull requests from a GitHub repository.
 * Scope: Read-only PR listing. Does not mutate PRs or import LangChain.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__vcs_list_prs`
 *   - EFFECT_TYPED: effect is `read_only`
 * Side-effects: IO (reads PRs via VcsCapability)
 * Links: task.0242
 * @public
 */

import { z } from "zod";

import type { VcsCapability } from "../capabilities/vcs";
import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const VcsListPrsInputSchema = z.object({
  owner: z.string().min(1).describe("Repository owner (e.g., 'Cogni-DAO')"),
  repo: z.string().min(1).describe("Repository name (e.g., 'node-template')"),
  state: z
    .enum(["open", "closed", "all"])
    .optional()
    .describe("PR state filter (default: 'open')"),
});
export type VcsListPrsInput = z.infer<typeof VcsListPrsInputSchema>;

const PrSummarySchema = z.object({
  number: z.number(),
  title: z.string(),
  author: z.string(),
  baseBranch: z.string(),
  headBranch: z.string(),
  labels: z.array(z.string()),
  draft: z.boolean(),
  mergeable: z.boolean().nullable(),
  updatedAt: z.string(),
});

export const VcsListPrsOutputSchema = z.object({
  prs: z.array(PrSummarySchema),
  count: z.number(),
});
export type VcsListPrsOutput = z.infer<typeof VcsListPrsOutputSchema>;

export type VcsListPrsRedacted = VcsListPrsOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const VCS_LIST_PRS_NAME = "core__vcs_list_prs" as const;

export const vcsListPrsContract: ToolContract<
  typeof VCS_LIST_PRS_NAME,
  VcsListPrsInput,
  VcsListPrsOutput,
  VcsListPrsRedacted
> = {
  name: VCS_LIST_PRS_NAME,
  description:
    "List pull requests from a GitHub repository. " +
    "Returns PR number, title, author, branches, labels, draft status, and mergeability. " +
    "Use this to survey open PRs before deciding which to inspect or merge.",
  effect: "read_only",
  inputSchema: VcsListPrsInputSchema,
  outputSchema: VcsListPrsOutputSchema,
  redact: (output: VcsListPrsOutput): VcsListPrsRedacted => output,
  allowlist: ["prs", "count"] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

export interface VcsListPrsDeps {
  readonly vcsCapability: VcsCapability;
}

export function createVcsListPrsImplementation(
  deps: VcsListPrsDeps
): ToolImplementation<VcsListPrsInput, VcsListPrsOutput> {
  return {
    execute: async (input: VcsListPrsInput): Promise<VcsListPrsOutput> => {
      const prs = await deps.vcsCapability.listPrs({
        owner: input.owner,
        repo: input.repo,
        state: input.state,
      });
      return { prs: prs as VcsListPrsOutput["prs"], count: prs.length };
    },
  };
}

export const vcsListPrsStubImplementation: ToolImplementation<
  VcsListPrsInput,
  VcsListPrsOutput
> = {
  execute: async (): Promise<VcsListPrsOutput> => {
    throw new Error("VcsCapability not configured.");
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool
// ─────────────────────────────────────────────────────────────────────────────

export const vcsListPrsBoundTool: BoundTool<
  typeof VCS_LIST_PRS_NAME,
  VcsListPrsInput,
  VcsListPrsOutput,
  VcsListPrsRedacted
> = {
  contract: vcsListPrsContract,
  implementation: vcsListPrsStubImplementation,
};
