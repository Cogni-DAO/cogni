// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/activities/review`
 * Purpose: Temporal Activities for PR review — GitHub I/O and review orchestration.
 * Scope: Activities perform I/O (GitHub API). Domain logic delegated to domain/review.ts.
 * Invariants:
 *   - Per ACTIVITY_IDEMPOTENCY: GitHub writes use stable business keys (repo/pr/headSha)
 *   - Per EXECUTION_VIA_SERVICE_API: graph execution goes through GraphRunWorkflow child, not activities
 *   - Activities resolve GitHub App creds from worker env (never from workflow input)
 *   - Domain logic (criteria evaluation, formatting) in domain/review.ts, not here
 * Side-effects: IO (GitHub API via Octokit)
 * Links: task.0191, docs/spec/temporal-patterns.md
 * @internal
 */

import {
  extractDaoConfig,
  extractGatesConfig,
  type GateConfig,
  type GatesConfig,
  parseRepoSpec,
  parseRule,
  type Rule,
} from "@cogni/repo-spec";
import type { GraphRunResult } from "@cogni/temporal-workflows";
import {
  aggregateGateStatuses,
  buildReviewUserMessage,
  type EvaluationOutput,
  type EvidenceBundle,
  evaluateCriteria,
  findRequirement,
  formatCheckRunSummary,
  formatPrComment,
  type GateResult,
  type GateStatus,
  type ReviewResult,
} from "@cogni/temporal-workflows";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import { parse as parseYaml } from "yaml";
import type { Logger } from "../observability/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewActivityDeps {
  /** GitHub App ID (from worker env) */
  ghAppId: string;
  /** GitHub App private key PEM (decoded from base64, from worker env) */
  ghPrivateKey: string;
  logger: Logger;
}

export interface CreateCheckRunInput {
  owner: string;
  repo: string;
  headSha: string;
  installationId: number;
}

export interface FetchPrContextInput {
  owner: string;
  repo: string;
  prNumber: number;
  installationId: number;
}

export interface FetchPrContextOutput {
  evidence: EvidenceBundle;
  gatesConfig: GatesConfig;
  rules: Record<string, Rule>;
  graphMessages: Array<{ role: string; content: string }>;
  responseFormat: { prompt: string; schemaId: string };
  modelRef: { providerKey: string; modelId: string; connectionId?: string };
  /** Raw repo-spec YAML for DAO config extraction in postReviewResult */
  repoSpecYaml?: string;
}

export interface PostReviewResultInput {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  installationId: number;
  checkRunId?: number;
  // When no gates configured — simple pass
  noGatesConfigured?: boolean;
  conclusion?: GateStatus;
  gateResults?: readonly GateResult[];
  // When graph ran — full evaluation
  graphResult?: GraphRunResult;
  gatesConfig?: GatesConfig;
  rules?: Record<string, Rule>;
  evidence?: EvidenceBundle;
  /** Raw repo-spec YAML for DAO config extraction */
  repoSpecYaml?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHECK_RUN_NAME = "Cogni Git PR Review";
// vNext (task.0395): per-node/per-rule modelRef from repo-spec. For now, system actor
// uses the platform provider (LiteLLM-backed, no per-user connection required).
const DEFAULT_REVIEW_MODELREF = {
  providerKey: "platform",
  modelId: "gpt-4o-mini",
} as const;
const MAX_PATCH_BYTES_PER_FILE = 100_000;
const MAX_TOTAL_PATCH_BYTES = 500_000;
const MAX_FILES_WITH_PATCHES = 30;

// ---------------------------------------------------------------------------
// Octokit factory + helpers
// ---------------------------------------------------------------------------

function createOctokit(
  deps: ReviewActivityDeps,
  installationId: number
): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: deps.ghAppId,
      privateKey: deps.ghPrivateKey,
      installationId,
    },
  });
}

/** Fetch a file from a GitHub repo as raw text. Handles both raw and base64 responses. */
async function fetchRepoFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string> {
  const response = await octokit.request(
    "GET /repos/{owner}/{repo}/contents/{path}",
    {
      owner,
      repo,
      path,
      ref,
      headers: { accept: "application/vnd.github.raw+json" },
    }
  );
  return typeof response.data === "string"
    ? response.data
    : Buffer.from(
        (response.data as { content?: string }).content ?? "",
        "base64"
      ).toString("utf-8");
}

// ---------------------------------------------------------------------------
// Activity factory
// ---------------------------------------------------------------------------

export function createReviewActivities(deps: ReviewActivityDeps) {
  const { logger } = deps;

  /** Create a GitHub Check Run in "in_progress" state. */
  async function createCheckRunActivity(
    input: CreateCheckRunInput
  ): Promise<number> {
    const octokit = createOctokit(deps, input.installationId);
    const response = await octokit.request(
      "POST /repos/{owner}/{repo}/check-runs",
      {
        owner: input.owner,
        repo: input.repo,
        name: CHECK_RUN_NAME,
        head_sha: input.headSha,
        status: "in_progress",
        started_at: new Date().toISOString(),
      }
    );
    return response.data.id;
  }

  /** Fetch PR evidence, repo-spec, and rules from GitHub API. */
  async function fetchPrContextActivity(
    input: FetchPrContextInput
  ): Promise<FetchPrContextOutput> {
    const octokit = createOctokit(deps, input.installationId);

    // Fetch PR metadata + files in parallel
    const [prResponse, filesResponse] = await Promise.all([
      octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner: input.owner,
        repo: input.repo,
        pull_number: input.prNumber,
      }),
      octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
        owner: input.owner,
        repo: input.repo,
        pull_number: input.prNumber,
        per_page: 100,
      }),
    ]);

    const pr = prResponse.data;
    const files = filesResponse.data;

    // Budget-aware diff truncation
    let totalDiffBytes = 0;
    for (const file of files) {
      totalDiffBytes += file.patch?.length ?? 0;
    }

    const patches: Array<{ filename: string; patch: string }> = [];
    let usedBytes = 0;
    for (const file of files.slice(0, MAX_FILES_WITH_PATCHES)) {
      if (!file.patch) continue;
      let patch = file.patch;
      if (patch.length > MAX_PATCH_BYTES_PER_FILE) {
        patch = `${patch.slice(0, MAX_PATCH_BYTES_PER_FILE)}\n... (truncated)`;
      }
      if (usedBytes + patch.length > MAX_TOTAL_PATCH_BYTES) {
        patches.push({
          filename: file.filename,
          patch: "... (budget exceeded, patch omitted)",
        });
        continue;
      }
      usedBytes += patch.length;
      patches.push({ filename: file.filename, patch });
    }

    const evidence: EvidenceBundle = {
      prNumber: pr.number,
      prTitle: pr.title,
      prBody: pr.body ?? "",
      headSha: pr.head.sha,
      baseBranch: pr.base.ref,
      changedFiles: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
      patches,
      totalDiffBytes,
    };

    // Fetch repo-spec from target repo (base branch)
    let repoSpecYaml: string;
    try {
      repoSpecYaml = await fetchRepoFile(
        octokit,
        input.owner,
        input.repo,
        ".cogni/repo-spec.yaml",
        pr.base.ref
      );
    } catch {
      // No repo-spec — return empty gates
      return {
        evidence,
        gatesConfig: { gates: [], failOnError: false },
        rules: {},
        graphMessages: [],
        responseFormat: { prompt: "", schemaId: "" },
        modelRef: DEFAULT_REVIEW_MODELREF,
      };
    }

    // Parse leniently — target repo may not have full node_id/scope_id fields.
    // We only need gates config, so try full parse first, fall back to lenient extraction.
    let gatesConfig: GatesConfig;
    try {
      const repoSpec = parseRepoSpec(repoSpecYaml);
      gatesConfig = extractGatesConfig(repoSpec);
    } catch {
      // Full parse failed (missing node_id, etc.) — extract gates from raw YAML
      const raw = parseYaml(repoSpecYaml) as Record<string, unknown>;
      const gates = Array.isArray(raw.gates) ? raw.gates : [];
      gatesConfig = {
        gates: gates as GateConfig[],
        failOnError: raw.fail_on_error === true,
      };
    }

    // Fetch rule files referenced by ai-rule gates
    const rules: Record<string, Rule> = {};
    for (const gate of gatesConfig.gates) {
      if (gate.type === "ai-rule" && gate.with?.rule_file) {
        const ruleFile = gate.with.rule_file as string;
        if (!rules[ruleFile]) {
          try {
            const ruleYaml = await fetchRepoFile(
              octokit,
              input.owner,
              input.repo,
              `.cogni/rules/${ruleFile}`,
              pr.base.ref
            );
            rules[ruleFile] = parseRule(ruleYaml);
          } catch (error) {
            logger.warn(
              { ruleFile, error: String(error) },
              "Failed to fetch rule file from repo"
            );
          }
        }
      }
    }

    // Build graph input for ai-rule gates
    // Collect all evaluations across all ai-rule gates
    const allEvaluations: Array<{ metric: string; prompt: string }> = [];
    for (const gate of gatesConfig.gates) {
      if (gate.type === "ai-rule" && gate.with?.rule_file) {
        const rule = rules[gate.with.rule_file as string];
        if (rule?.evaluations) {
          for (const entry of rule.evaluations) {
            const entries = Object.entries(entry);
            const [metric, prompt] = entries[0] as [string, string];
            allEvaluations.push({ metric, prompt });
          }
        }
      }
    }

    const diffSummary = evidence.patches
      .map((p) => `### ${p.filename}\n${p.patch}`)
      .join("\n\n");

    const userMessage =
      allEvaluations.length > 0
        ? buildReviewUserMessage({
            prTitle: evidence.prTitle,
            prBody: evidence.prBody,
            diffSummary,
            evaluations: allEvaluations,
          })
        : "";

    // Use schemaId for Zod schema resolution in the internal API route.
    // Zod schemas are not JSON-serializable; the route resolves "evaluation-output"
    // to the matching Zod schema at runtime.
    const responseFormat = {
      prompt:
        "Respond with a JSON object containing a `metrics` array and a `summary` string. " +
        "Each metric entry must have: `metric` (name), `value` (0.0-1.0), `observations` (string array).",
      schemaId: "evaluation-output",
    };

    return {
      evidence,
      gatesConfig,
      rules,
      graphMessages: userMessage
        ? [{ role: "user", content: userMessage }]
        : [],
      responseFormat,
      modelRef: DEFAULT_REVIEW_MODELREF,
      repoSpecYaml,
    };
  }

  /** Evaluate graph results, format markdown, and post to GitHub. */
  async function postReviewResultActivity(
    input: PostReviewResultInput
  ): Promise<void> {
    const octokit = createOctokit(deps, input.installationId);

    let conclusion: GateStatus;
    let gateResults: readonly GateResult[];

    if (input.noGatesConfigured) {
      conclusion = "pass";
      gateResults = [];
    } else if (input.graphResult && input.gatesConfig && input.rules) {
      // Evaluate graph structured output against gate criteria
      const evaluated = evaluateGraphResult(
        input.graphResult,
        input.gatesConfig,
        input.rules,
        input.evidence
      );
      conclusion = evaluated.conclusion;
      gateResults = evaluated.gateResults;
    } else {
      conclusion = input.conclusion ?? "neutral";
      gateResults = input.gateResults ?? [];
    }

    const reviewResult: ReviewResult = { conclusion, gateResults };

    // Build DAO deep link from repo-spec (for Check Run "View Details" page)
    let daoBaseUrl: string | undefined;
    if (input.repoSpecYaml) {
      try {
        const spec = parseRepoSpec(input.repoSpecYaml);
        const dao = extractDaoConfig(spec);
        if (dao) {
          const url = new URL("/propose/merge", dao.base_url);
          url.searchParams.set("dao", dao.dao_contract);
          url.searchParams.set("plugin", dao.plugin_contract);
          url.searchParams.set("signal", dao.signal_contract);
          url.searchParams.set("chainId", dao.chain_id);
          url.searchParams.set("action", "merge");
          url.searchParams.set("target", "change");
          url.searchParams.set("resource", String(input.prNumber));
          url.searchParams.set("vcs", "github");
          url.searchParams.set(
            "repoUrl",
            `https://github.com/${input.owner}/${input.repo}`
          );
          daoBaseUrl = url.toString();
        }
      } catch {
        // Best-effort — no DAO link if parsing fails
      }
    }

    // Format markdown
    const checkRunSummary = formatCheckRunSummary(reviewResult, {
      daoBaseUrl,
    });

    const checkRunUrl = input.checkRunId
      ? `https://github.com/${input.owner}/${input.repo}/runs/${input.checkRunId}`
      : undefined;

    const prCommentBody = formatPrComment(reviewResult, {
      headSha: input.headSha,
      checkRunUrl,
    });

    // Update check run (if we have one)
    if (input.checkRunId) {
      try {
        await octokit.request(
          "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
          {
            owner: input.owner,
            repo: input.repo,
            check_run_id: input.checkRunId,
            status: "completed",
            conclusion: mapConclusion(conclusion),
            completed_at: new Date().toISOString(),
            output: {
              title: `PR Review: ${conclusion.toUpperCase()}`,
              summary: checkRunSummary,
            },
          }
        );
      } catch (error) {
        logger.warn(
          { checkRunId: input.checkRunId, error: String(error) },
          "Failed to update check run"
        );
      }
    }

    // Post PR comment with staleness guard
    const prResponse = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner: input.owner,
        repo: input.repo,
        pull_number: input.prNumber,
      }
    );
    const currentSha = prResponse.data.head.sha;
    if (currentSha !== input.headSha) {
      logger.info(
        {
          prNumber: input.prNumber,
          expectedSha: input.headSha,
          currentSha,
        },
        "PR updated during review — skipping comment"
      );
      return;
    }

    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: input.owner,
        repo: input.repo,
        issue_number: input.prNumber,
        body: prCommentBody,
      }
    );
  }

  return {
    createCheckRunActivity,
    fetchPrContextActivity,
    postReviewResultActivity,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Evaluate graph structured output against all gate criteria.
 * Domain logic from domain/review.ts — this function bridges graph output to gate results.
 */
function evaluateGraphResult(
  graphResult: GraphRunResult,
  gatesConfig: GatesConfig,
  rules: Record<string, Rule>,
  evidence?: EvidenceBundle
): ReviewResult {
  const gateResults: GateResult[] = [];

  for (const gate of gatesConfig.gates) {
    if (gate.type === "review-limits") {
      // Pure deterministic gate — evaluate without LLM
      gateResults.push(evaluateReviewLimitsGate(gate, evidence));
    } else if (gate.type === "ai-rule") {
      const ruleFile = gate.with?.rule_file as string | undefined;
      const rule = ruleFile ? rules[ruleFile] : undefined;
      if (!rule || !graphResult.ok || !graphResult.structuredOutput) {
        gateResults.push({
          gateId: rule?.id ?? gate.type,
          gateType: "ai-rule",
          status: "neutral",
          summary: graphResult.ok
            ? "No structured output from graph"
            : `Graph execution failed`,
        });
        continue;
      }

      const structured = graphResult.structuredOutput as EvaluationOutput;
      const evaluations = rule.evaluations.map((entry) => {
        const entries = Object.entries(entry);
        return entries[0] as [string, string];
      });
      const metricNames = evaluations.map(([name]) => name);

      // Build scores map
      const scores = new Map<string, number>();
      const metrics: Array<{
        metric: string;
        score: number;
        requirement?: string;
        observation: string;
      }> = [];

      if (structured?.metrics) {
        for (const entry of structured.metrics) {
          if (metricNames.includes(entry.metric)) {
            scores.set(entry.metric, entry.value);
            const req = findRequirement(entry.metric, rule.success_criteria);
            metrics.push({
              metric: entry.metric,
              score: entry.value,
              ...(req != null ? { requirement: req } : {}),
              observation: entry.observations.join("; "),
            });
          }
        }
      }

      const status = evaluateCriteria(scores, rule.success_criteria);
      gateResults.push({
        gateId: rule.id,
        gateType: "ai-rule",
        status,
        summary:
          status === "pass"
            ? `Rule "${rule.id}" passed`
            : status === "fail"
              ? `Rule "${rule.id}" failed threshold checks`
              : `Rule "${rule.id}" neutral`,
        metrics,
      });
    }
  }

  const conclusion = aggregateGateStatuses(gateResults.map((r) => r.status));
  return { conclusion, gateResults };
}

/** Evaluate review-limits gate (pure deterministic, no LLM). */
function evaluateReviewLimitsGate(
  gate: GateConfig,
  evidence?: EvidenceBundle
): GateResult {
  const gateId =
    "id" in gate && gate.id ? (gate.id as string) : "review-limits";
  if (!evidence) {
    return {
      gateId,
      gateType: "review-limits",
      status: "neutral",
      summary: "No evidence available",
    };
  }

  const limits = gate.type === "review-limits" ? gate.with : undefined;

  let status: GateStatus = "pass";
  const reasons: string[] = [];

  if (
    limits?.max_changed_files !== undefined &&
    evidence.changedFiles > limits.max_changed_files
  ) {
    status = "fail";
    reasons.push(
      `Changed files (${evidence.changedFiles}) exceeds limit (${limits.max_changed_files})`
    );
  }
  if (
    limits?.max_total_diff_kb !== undefined &&
    evidence.totalDiffBytes / 1024 > limits.max_total_diff_kb
  ) {
    status = "fail";
    reasons.push(
      `Total diff (${Math.round(evidence.totalDiffBytes / 1024)}KB) exceeds limit (${limits.max_total_diff_kb}KB)`
    );
  }

  return {
    gateId,
    gateType: "review-limits",
    status,
    summary: reasons.length > 0 ? reasons.join("; ") : "Within limits",
  };
}

type CheckRunConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "stale";

function mapConclusion(status: string): CheckRunConclusion {
  switch (status) {
    case "pass":
      return "success";
    case "fail":
      return "failure";
    case "neutral":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Export type for proxyActivities<ReviewActivities>() in workflows. */
export type ReviewActivities = ReturnType<typeof createReviewActivities>;
