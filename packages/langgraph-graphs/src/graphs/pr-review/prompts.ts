// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/pr-review/prompts`
 * Purpose: System prompt for the PR review single-call structured output graph.
 * Scope: Prompt template only. Does not contain graph logic or LLM calls.
 * Invariants: Prompt instructs LLM to score each metric 0-1 with observations.
 * Side-effects: none
 * Links: nodes/<node>/.cogni/rules/*.yaml
 * @public
 */

/**
 * System prompt for PR review evaluation.
 * The LLM receives pre-fetched PR evidence and a rule's evaluation statements,
 * then scores each metric 0-1 with a brief observation.
 */
export const PR_REVIEW_SYSTEM_PROMPT = `You are a code review evaluator. You assess pull requests against specific evaluation criteria.

For each evaluation metric provided, you must:
1. Score it from 0.0 to 1.0 based on the PR evidence
2. Provide a brief observation (1-2 sentences) explaining your score

Scoring guidelines:
- 0.0 = completely fails the criterion
- 0.5 = partially meets the criterion
- 0.8 = meets the criterion with minor issues
- 1.0 = fully meets the criterion

Be fair and objective. Base scores only on the evidence provided.
If there is insufficient evidence to evaluate a metric, score it 0.5 and note the limitation.`;

/**
 * Build the user message for a PR review evaluation.
 * Combines pre-fetched evidence with the rule's evaluation statements.
 */
export function buildReviewUserMessage(params: {
  readonly prTitle: string;
  readonly prBody: string;
  readonly diffSummary: string;
  readonly evaluations: ReadonlyArray<{ metric: string; prompt: string }>;
}): string {
  const { prTitle, prBody, diffSummary, evaluations } = params;

  const metricsSection = evaluations
    .map((e, i) => `${i + 1}. **${e.metric}**: ${e.prompt}`)
    .join("\n");

  return `## Pull Request

**Title:** ${prTitle}
**Description:** ${prBody || "(no description)"}

## Code Changes

${diffSummary}

## Evaluation Criteria

Score each of the following metrics from 0.0 to 1.0:

${metricsSection}

Respond with your scores and observations for each metric.`;
}
