// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/vcs-flight-candidate`
 * Purpose: AI tool that dispatches a candidate-flight workflow for a specific build SHA.
 * Scope: SHA-first candidate slot dispatch. Does not import LangChain.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__vcs_flight_candidate`
 *   - EFFECT_TYPED: effect is `state_change`
 *   - NO_AUTO_FLIGHT: caller must explicitly choose a SHA to flight (spec: candidate-slot-controller.md)
 *   - NO_QUEUE: if slot busy the workflow fails fast; agent reports and stops (spec: candidate-slot-controller.md)
 * Side-effects: IO (dispatches GitHub Actions workflow via VcsCapability)
 * Links: task.0297, docs/guides/candidate-flight-v0.md, docs/spec/candidate-slot-controller.md
 * @public
 */

import { z } from "zod";

import type { VcsCapability } from "../capabilities/vcs";
import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const VcsFlightCandidateInputSchema = z.object({
  owner: z.string().min(1).describe("Repository owner (e.g., 'Cogni-DAO')"),
  repo: z.string().min(1).describe("Repository name (e.g., 'node-template')"),
  sha: z
    .string()
    .min(7)
    .describe(
      "Full or abbreviated commit SHA of the build artifact to flight. " +
        "This is the primary identifier — a PR may have many builds; you are flying a specific one. " +
        "Wait for PR Build to complete on this SHA before dispatching."
    ),
  prNumber: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Pull request number associated with this SHA. " +
        "If omitted, the adapter resolves it from the SHA via the GitHub API."
    ),
});
export type VcsFlightCandidateInput = z.infer<
  typeof VcsFlightCandidateInputSchema
>;

export const VcsFlightCandidateOutputSchema = z.object({
  dispatched: z.boolean(),
  sha: z.string(),
  prNumber: z.number(),
  workflowUrl: z.string(),
  message: z.string(),
});
export type VcsFlightCandidateOutput = z.infer<
  typeof VcsFlightCandidateOutputSchema
>;

export type VcsFlightCandidateRedacted = VcsFlightCandidateOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

export const VCS_FLIGHT_CANDIDATE_NAME = "core__vcs_flight_candidate" as const;

export const vcsFlightCandidateContract: ToolContract<
  typeof VCS_FLIGHT_CANDIDATE_NAME,
  VcsFlightCandidateInput,
  VcsFlightCandidateOutput,
  VcsFlightCandidateRedacted
> = {
  name: VCS_FLIGHT_CANDIDATE_NAME,
  description:
    "Dispatch the candidate-flight workflow for a specific build SHA. " +
    "SHA is the primary identifier — you are flying a build artifact, not just a PR. " +
    "A PR may have many builds (one per push); always specify the exact SHA you want to validate. " +
    "Wait for PR Build to complete on the target SHA before calling this. " +
    "If the candidate slot is busy, the workflow fails fast — check core__vcs_get_ci_status " +
    "after dispatch to see the candidate-flight result. " +
    "IMPORTANT: Never queue, auto-retry, or flight more than one PR per run.",
  effect: "state_change",
  inputSchema: VcsFlightCandidateInputSchema,
  outputSchema: VcsFlightCandidateOutputSchema,
  redact: (output: VcsFlightCandidateOutput): VcsFlightCandidateRedacted =>
    output,
  allowlist: [
    "dispatched",
    "sha",
    "prNumber",
    "workflowUrl",
    "message",
  ] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

export interface VcsFlightCandidateDeps {
  readonly vcsCapability: VcsCapability;
}

export function createVcsFlightCandidateImplementation(
  deps: VcsFlightCandidateDeps
): ToolImplementation<VcsFlightCandidateInput, VcsFlightCandidateOutput> {
  return {
    execute: async (
      input: VcsFlightCandidateInput
    ): Promise<VcsFlightCandidateOutput> => {
      return deps.vcsCapability.flightCandidate({
        owner: input.owner,
        repo: input.repo,
        sha: input.sha,
        prNumber: input.prNumber,
      });
    },
  };
}

export const vcsFlightCandidateStubImplementation: ToolImplementation<
  VcsFlightCandidateInput,
  VcsFlightCandidateOutput
> = {
  execute: async (): Promise<VcsFlightCandidateOutput> => {
    throw new Error("VcsCapability not configured.");
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool
// ─────────────────────────────────────────────────────────────────────────────

export const vcsFlightCandidateBoundTool: BoundTool<
  typeof VCS_FLIGHT_CANDIDATE_NAME,
  VcsFlightCandidateInput,
  VcsFlightCandidateOutput,
  VcsFlightCandidateRedacted
> = {
  contract: vcsFlightCandidateContract,
  implementation: vcsFlightCandidateStubImplementation,
};
