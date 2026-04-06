// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/vcs-get-ci-status`
 * Purpose: AI tool that gets CI/review status for a specific pull request.
 * Scope: Read-only PR + CI status check. Does not mutate PRs or import LangChain.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__vcs_get_ci_status`
 *   - EFFECT_TYPED: effect is `read_only`
 * Side-effects: IO (reads PR + check status via VcsCapability)
 * Links: task.0242
 * @public
 */

import { z } from "zod";

import type { VcsCapability } from "../capabilities/vcs";
import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const VcsGetCiStatusInputSchema = z.object({
  owner: z.string().min(1).describe("Repository owner (e.g., 'Cogni-DAO')"),
  repo: z.string().min(1).describe("Repository name (e.g., 'cogni-template')"),
  prNumber: z.number().int().min(1).describe("Pull request number"),
});
export type VcsGetCiStatusInput = z.infer<typeof VcsGetCiStatusInputSchema>;

const CheckInfoSchema = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
});

export const VcsGetCiStatusOutputSchema = z.object({
  prNumber: z.number(),
  prTitle: z.string(),
  author: z.string(),
  baseBranch: z.string(),
  headSha: z.string(),
  mergeable: z.boolean().nullable(),
  reviewDecision: z.string().nullable(),
  labels: z.array(z.string()),
  draft: z.boolean(),
  allGreen: z.boolean(),
  pending: z.boolean(),
  checks: z.array(CheckInfoSchema),
});
export type VcsGetCiStatusOutput = z.infer<typeof VcsGetCiStatusOutputSchema>;

export type VcsGetCiStatusRedacted = VcsGetCiStatusOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const VCS_GET_CI_STATUS_NAME = "core__vcs_get_ci_status" as const;

export const vcsGetCiStatusContract: ToolContract<
  typeof VCS_GET_CI_STATUS_NAME,
  VcsGetCiStatusInput,
  VcsGetCiStatusOutput,
  VcsGetCiStatusRedacted
> = {
  name: VCS_GET_CI_STATUS_NAME,
  description:
    "Get detailed CI and review status for a pull request. " +
    "Returns PR metadata (title, author, base branch, labels, draft status), " +
    "review decision (approved/changes_requested/none), " +
    "and all CI check results with pass/fail/pending status. " +
    "Use this before merging to verify a PR is ready.",
  effect: "read_only",
  inputSchema: VcsGetCiStatusInputSchema,
  outputSchema: VcsGetCiStatusOutputSchema,
  redact: (output: VcsGetCiStatusOutput): VcsGetCiStatusRedacted => output,
  allowlist: [
    "prNumber",
    "prTitle",
    "author",
    "baseBranch",
    "headSha",
    "mergeable",
    "reviewDecision",
    "labels",
    "draft",
    "allGreen",
    "pending",
    "checks",
  ] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

export interface VcsGetCiStatusDeps {
  readonly vcsCapability: VcsCapability;
}

export function createVcsGetCiStatusImplementation(
  deps: VcsGetCiStatusDeps
): ToolImplementation<VcsGetCiStatusInput, VcsGetCiStatusOutput> {
  return {
    execute: async (
      input: VcsGetCiStatusInput
    ): Promise<VcsGetCiStatusOutput> => {
      const result = await deps.vcsCapability.getCiStatus({
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
      });
      return result as VcsGetCiStatusOutput;
    },
  };
}

export const vcsGetCiStatusStubImplementation: ToolImplementation<
  VcsGetCiStatusInput,
  VcsGetCiStatusOutput
> = {
  execute: async (): Promise<VcsGetCiStatusOutput> => {
    throw new Error("VcsCapability not configured.");
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool
// ─────────────────────────────────────────────────────────────────────────────

export const vcsGetCiStatusBoundTool: BoundTool<
  typeof VCS_GET_CI_STATUS_NAME,
  VcsGetCiStatusInput,
  VcsGetCiStatusOutput,
  VcsGetCiStatusRedacted
> = {
  contract: vcsGetCiStatusContract,
  implementation: vcsGetCiStatusStubImplementation,
};
