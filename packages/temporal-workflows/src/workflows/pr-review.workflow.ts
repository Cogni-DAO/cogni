// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/temporal-workflows/workflows/pr-review`
 * Purpose: Temporal parent workflow for webhook-triggered PR review.
 * Scope: Deterministic orchestration only. Does not perform I/O — all external calls in Activities, LLM in GraphRunWorkflow child.
 * Invariants:
 *   - Per TEMPORAL_DETERMINISM: No I/O in workflow code
 *   - Per NORMATIVE_WEBHOOK_PATTERN: webhook starts workflow, exits immediately
 *   - Per ACTIVITY_IDEMPOTENCY: GitHub writes use stable business keys (repo/pr/headSha)
 *   - Per WORKFLOW_TOP_LEVEL_VISIBILITY: parent workflow is primary UI object; graph run is drill-down
 *   - TYPED_TERMINAL_ARTIFACT: GraphRunWorkflow child returns structuredOutput for parent consumption
 * Side-effects: none (deterministic orchestration only)
 * Links: docs/spec/temporal-patterns.md, task.0191
 * @public
 */

import { executeChild, proxyActivities, uuid4 } from "@temporalio/workflow";
import { EXTERNAL_API_ACTIVITY_OPTIONS } from "../activity-profiles.js";
import type { ReviewActivities } from "../activity-types.js";
import type { GraphRunResult } from "./graph-run.workflow.js";

// All review activities: GitHub API calls with 5-min timeout, 3 retries
const {
  createCheckRunActivity,
  fetchPrContextActivity,
  postReviewResultActivity,
} = proxyActivities<ReviewActivities>(EXTERNAL_API_ACTIVITY_OPTIONS);

/**
 * Input for PrReviewWorkflow.
 * All fields from the webhook payload + billing context — no secrets.
 */
export interface PrReviewWorkflowInput {
  /** Originating node ID from repo-spec. Routes execution to correct node. */
  nodeId: string;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  installationId: number;
  /** System principal user ID (COGNI_SYSTEM_PRINCIPAL_USER_ID from @cogni/ids constants). */
  actorUserId: string;
  /** System billing account ID (resolved by webhook handler from DB). */
  billingAccountId: string;
  /** System virtual key ID (resolved by webhook handler from DB). */
  virtualKeyId: string;
}

/**
 * PrReviewWorkflow — Temporal parent workflow for PR review.
 *
 * Flow:
 * 1. Activity: createCheckRun (GitHub "in_progress" — immediate UX feedback)
 * 2. Activity: fetchPrContext (GitHub API reads — evidence, repo-spec, rules)
 * 3. Child: GraphRunWorkflow(pr-review) → structured evaluation output
 * 4. Activity: postReviewResult (evaluate criteria, format markdown, GitHub writes)
 *
 * Idempotency: workflowId = pr-review:{owner}/{repo}/{prNumber}/{headSha}
 * Retries on the same headSha produce the same external result (idempotent check run + comment).
 */
export async function PrReviewWorkflow(
  input: PrReviewWorkflowInput
): Promise<void> {
  const {
    nodeId,
    owner,
    repo,
    prNumber,
    headSha,
    installationId,
    actorUserId,
    billingAccountId,
    virtualKeyId,
  } = input;

  // 1. Create Check Run immediately for UX feedback
  let checkRunId: number | undefined;
  try {
    checkRunId = await createCheckRunActivity({
      owner,
      repo,
      headSha,
      installationId,
    });
  } catch {
    // Continue without check run — non-fatal
  }

  // 2. Fetch PR context from GitHub API
  const context = await fetchPrContextActivity({
    owner,
    repo,
    prNumber,
    installationId,
  });

  // If no gates configured, mark check run as pass and exit
  if (context.gatesConfig.gates.length === 0) {
    if (checkRunId) {
      await postReviewResultActivity({
        owner,
        repo,
        prNumber,
        headSha,
        installationId,
        checkRunId,
        conclusion: "pass",
        gateResults: [],
        noGatesConfigured: true,
      });
    }
    return;
  }

  // 3. Execute pr-review graph as child workflow
  //    GraphRunWorkflow creates graph_runs record + publishes to Redis
  const runId = uuid4();
  let graphResult: GraphRunResult;
  try {
    graphResult = await executeChild("GraphRunWorkflow", {
      workflowId: `graph-run:system:pr-review:${owner}/${repo}/${prNumber}/${headSha}`,
      args: [
        {
          nodeId,
          graphId: `langgraph:pr-review`,
          executionGrantId: null,
          input: {
            messages: context.graphMessages,
            model: context.model,
            responseFormat: context.responseFormat,
            actorUserId,
            billingAccountId,
            virtualKeyId,
          },
          runKind: "system_webhook" as const,
          triggerSource: "webhook:github_pr",
          triggerRef: `pr-review:${owner}/${repo}/${prNumber}/${headSha}`,
          requestedBy: actorUserId,
          runId,
        },
      ],
    });
  } catch {
    // Graph child failed — still update check run to neutral so it doesn't hang
    graphResult = { ok: false, runId };
  }

  // 4. Post review results to GitHub
  await postReviewResultActivity({
    owner,
    repo,
    prNumber,
    headSha,
    installationId,
    checkRunId,
    graphResult,
    gatesConfig: context.gatesConfig,
    rules: context.rules,
    evidence: context.evidence,
    repoSpecYaml: context.repoSpecYaml,
  });
}
