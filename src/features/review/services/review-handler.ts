// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/review/services/review-handler`
 * Purpose: Orchestrate the full PR review flow: evidence → gates → check run → comment.
 * Scope: Top-level review handler called from facade. Does not import adapters or bootstrap.
 * Invariants: Fire-and-forget — errors logged, never block webhook response. System tenant billing.
 *   ARCHITECTURE_ALIGNMENT — deps injected, no adapter imports.
 * Side-effects: IO (GitHub API via injected deps, LLM via graph executor)
 * Links: task.0149
 * @public
 */

import { randomUUID } from "node:crypto";
import type { Rule } from "@cogni/repo-spec";
import { extractGatesConfig, parseRepoSpec, parseRule } from "@cogni/repo-spec";
import type { Logger } from "pino";

import type { GraphExecutorPort, LlmCaller } from "@/ports";
import {
  COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  COGNI_SYSTEM_PRINCIPAL_USER_ID,
} from "@/shared/constants/system-tenant";

import { runGates } from "../gate-orchestrator";
import { formatCheckRunSummary, formatPrComment } from "../summary-formatter";
import type { EvidenceBundle, ReviewContext } from "../types";

/** Default model for PR review. */
const DEFAULT_REVIEW_MODEL = "gpt-4o-mini";

/**
 * Dependencies for the review handler.
 * Adapter functions are injected by the facade — feature layer never imports adapters.
 */
export interface ReviewHandlerDeps {
  readonly executor: GraphExecutorPort;
  readonly log: Logger;
  /** System tenant's default virtual key ID (looked up from DB). */
  readonly virtualKeyId: string;
  readonly reviewModel?: string;

  // --- Injected adapter functions (facade provides concrete implementations) ---

  readonly createCheckRun: (
    owner: string,
    repo: string,
    headSha: string
  ) => Promise<number>;
  readonly updateCheckRun: (
    owner: string,
    repo: string,
    checkRunId: number,
    conclusion: string,
    summary: string
  ) => Promise<void>;
  readonly gatherEvidence: (
    owner: string,
    repo: string,
    prNumber: number
  ) => Promise<EvidenceBundle>;
  readonly postPrComment: (
    owner: string,
    repo: string,
    prNumber: number,
    expectedHeadSha: string,
    body: string
  ) => Promise<boolean>;
  readonly readRepoSpec: () => string;
  readonly readRuleFile: (ruleFile: string) => string;
}

/**
 * Run a full PR review.
 * Called as fire-and-forget from the facade/webhook route.
 */
export async function handlePrReview(
  ctx: ReviewContext,
  deps: ReviewHandlerDeps
): Promise<void> {
  const { owner, repo, prNumber, headSha } = ctx;
  const log = deps.log.child({
    component: "pr-review",
    owner,
    repo,
    prNumber,
    headSha,
  });

  log.info("Starting PR review");

  // 1. Create Check Run (in_progress)
  let checkRunId: number | undefined;
  try {
    checkRunId = await deps.createCheckRun(owner, repo, headSha);
    log.info({ checkRunId }, "Check run created");
  } catch (error) {
    log.error(
      { error: String(error) },
      "Failed to create check run — continuing without it"
    );
  }

  try {
    // 2. Gather evidence
    const evidence = await deps.gatherEvidence(owner, repo, prNumber);
    log.info(
      {
        changedFiles: evidence.changedFiles,
        diffKb: Math.round(evidence.totalDiffBytes / 1024),
      },
      "Evidence gathered"
    );

    // 3. Load gates config from local repo-spec
    const repoSpecYaml = deps.readRepoSpec();
    const repoSpec = parseRepoSpec(repoSpecYaml);
    const gatesConfig = extractGatesConfig(repoSpec);

    if (gatesConfig.gates.length === 0) {
      log.info("No gates configured — skipping review");
      if (checkRunId) {
        await deps.updateCheckRun(
          owner,
          repo,
          checkRunId,
          "pass",
          "No review gates configured."
        );
      }
      return;
    }

    // 4. Build system tenant caller
    const runId = randomUUID();
    const model = deps.reviewModel ?? DEFAULT_REVIEW_MODEL;

    const caller: LlmCaller = {
      billingAccountId: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
      virtualKeyId: deps.virtualKeyId,
      requestId: runId,
      traceId: runId,
      userId: COGNI_SYSTEM_PRINCIPAL_USER_ID,
      sessionId: `review:${owner}/${repo}:${prNumber}`,
    };

    // 5. Rule loader
    const ruleCache = new Map<string, Rule>();
    const loadRule = (ruleFile: string): Rule => {
      let rule = ruleCache.get(ruleFile);
      if (!rule) {
        const ruleYaml = deps.readRuleFile(ruleFile);
        rule = parseRule(ruleYaml);
        ruleCache.set(ruleFile, rule);
      }
      return rule;
    };

    // 6. Run gate orchestrator
    const result = await runGates(gatesConfig.gates, evidence, {
      executor: deps.executor,
      caller,
      model,
      log,
      loadRule,
    });

    log.info(
      { conclusion: result.conclusion, gateCount: result.gateResults.length },
      "Gate orchestration complete"
    );

    // 7. Update Check Run
    if (checkRunId) {
      const summary = formatCheckRunSummary(result);
      await deps.updateCheckRun(
        owner,
        repo,
        checkRunId,
        result.conclusion,
        summary
      );
    }

    // 8. Post PR Comment (with staleness guard)
    const daoBaseUrl =
      "cogni_dao" in repoSpec &&
      repoSpec.cogni_dao &&
      typeof repoSpec.cogni_dao === "object" &&
      "base_url" in repoSpec.cogni_dao
        ? (repoSpec.cogni_dao.base_url as string)
        : undefined;

    const commentBody = formatPrComment(result, {
      ...(daoBaseUrl !== undefined && { daoBaseUrl }),
      headSha,
    });
    const posted = await deps.postPrComment(
      owner,
      repo,
      prNumber,
      headSha,
      commentBody
    );

    if (posted) {
      log.info("PR comment posted");
    } else {
      log.info("PR comment skipped — HEAD SHA changed during review (stale)");
    }
  } catch (error) {
    log.error({ error: String(error) }, "PR review failed");

    // Update check run to failure if possible
    if (checkRunId) {
      try {
        await deps.updateCheckRun(
          owner,
          repo,
          checkRunId,
          "neutral",
          `Review encountered an error: ${error instanceof Error ? error.message : String(error)}`
        );
      } catch {
        // Best-effort — don't throw from error handler
      }
    }
  }
}
