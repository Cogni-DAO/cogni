// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/temporal-workflows/domain/review`
 * Purpose: Pure domain logic for PR review — criteria evaluation and markdown formatting.
 * Scope: Deterministic functions over serializable data. Does not perform I/O or side effects.
 * Invariants:
 *   - Per WORKER_IS_DUMB: domain logic lives here, not in activities
 *   - All inputs/outputs are plain serializable objects
 *   - Formatting matches cogni-git-review markdown conventions
 * Side-effects: none
 * Links: task.0191, docs/spec/temporal-patterns.md
 * @internal
 */

import type { SuccessCriteria, ThresholdCriterion } from "@cogni/repo-spec";

// ---------------------------------------------------------------------------
// Types (serializable — used by workflow and activities)
// ---------------------------------------------------------------------------

export type GateStatus = "pass" | "fail" | "neutral";

export interface GateResult {
  readonly gateId: string;
  readonly gateType: string;
  readonly status: GateStatus;
  readonly summary: string;
  readonly metrics?: ReadonlyArray<{
    readonly metric: string;
    readonly score: number;
    readonly requirement?: string;
    readonly observation: string;
  }>;
}

export interface ReviewResult {
  readonly conclusion: GateStatus;
  readonly gateResults: readonly GateResult[];
}

export interface EvidenceBundle {
  readonly prNumber: number;
  readonly prTitle: string;
  readonly prBody: string;
  readonly headSha: string;
  readonly baseBranch: string;
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
  readonly patches: ReadonlyArray<{
    readonly filename: string;
    readonly patch: string;
  }>;
  readonly totalDiffBytes: number;
}

/** Structured output from the pr-review graph's LLM evaluation. */
export interface EvaluationOutput {
  metrics: Array<{
    metric: string;
    value: number;
    observations: string[];
  }>;
  summary: string;
}

// ---------------------------------------------------------------------------
// LLM Message Building (pure string concatenation)
// ---------------------------------------------------------------------------

/** Build the user message for a PR review evaluation. */
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

// ---------------------------------------------------------------------------
// Criteria Evaluation (deterministic threshold comparison)
// ---------------------------------------------------------------------------

const OP_SYMBOLS: Record<string, string> = {
  gte: "\u2265",
  gt: ">",
  lte: "\u2264",
  lt: "<",
  eq: "=",
};

export function formatThreshold(
  threshold: ThresholdCriterion
): string | undefined {
  for (const op of Object.keys(OP_SYMBOLS)) {
    if (
      op in threshold &&
      typeof (threshold as Record<string, unknown>)[op] === "number"
    ) {
      const value = (threshold as Record<string, unknown>)[op] as number;
      return `${OP_SYMBOLS[op]} ${value.toFixed(2)}`;
    }
  }
  return undefined;
}

export function findRequirement(
  metricName: string,
  criteria: SuccessCriteria
): string | undefined {
  const reqMatch = (criteria.require ?? []).find(
    (t) => t.metric === metricName
  );
  if (reqMatch) {
    const formatted = formatThreshold(reqMatch);
    return formatted ? `${formatted} (all)` : undefined;
  }
  const anyMatch = (criteria.any_of ?? []).find((t) => t.metric === metricName);
  if (anyMatch) {
    const formatted = formatThreshold(anyMatch);
    return formatted ? `${formatted} (any)` : undefined;
  }
  return undefined;
}

export function evaluateCriteria(
  scores: ReadonlyMap<string, number>,
  criteria: SuccessCriteria
): GateStatus {
  const { require, any_of, neutral_on_missing_metrics } = criteria;

  if (require && require.length > 0) {
    for (const threshold of require) {
      const result = evaluateThreshold(
        scores,
        threshold,
        neutral_on_missing_metrics
      );
      if (result === "fail") return "fail";
      if (result === "neutral") return "neutral";
    }
  }

  if (any_of && any_of.length > 0) {
    let hasPass = false;
    let hasNeutral = false;
    for (const threshold of any_of) {
      const result = evaluateThreshold(
        scores,
        threshold,
        neutral_on_missing_metrics
      );
      if (result === "pass") {
        hasPass = true;
        break;
      }
      if (result === "neutral") hasNeutral = true;
    }
    if (!hasPass) {
      return hasNeutral ? "neutral" : "fail";
    }
  }

  return "pass";
}

function evaluateThreshold(
  scores: ReadonlyMap<string, number>,
  threshold: Record<string, unknown>,
  neutralOnMissing: boolean
): GateStatus {
  const metric = threshold.metric as string;
  const score = scores.get(metric);

  if (score === undefined) {
    return neutralOnMissing ? "neutral" : "fail";
  }

  if ("gte" in threshold && typeof threshold.gte === "number") {
    return score >= threshold.gte ? "pass" : "fail";
  }
  if ("gt" in threshold && typeof threshold.gt === "number") {
    return score > threshold.gt ? "pass" : "fail";
  }
  if ("lte" in threshold && typeof threshold.lte === "number") {
    return score <= threshold.lte ? "pass" : "fail";
  }
  if ("lt" in threshold && typeof threshold.lt === "number") {
    return score < threshold.lt ? "pass" : "fail";
  }
  if ("eq" in threshold && typeof threshold.eq === "number") {
    return Math.abs(score - threshold.eq) < 0.001 ? "pass" : "fail";
  }

  return "neutral";
}

export function aggregateGateStatuses(
  statuses: readonly GateStatus[]
): GateStatus {
  if (statuses.some((s) => s === "fail")) return "fail";
  if (statuses.some((s) => s === "neutral")) return "neutral";
  return "pass";
}

// ---------------------------------------------------------------------------
// Markdown Formatting (pure string rendering)
// ---------------------------------------------------------------------------

function verdictLabel(status: GateStatus): string {
  switch (status) {
    case "pass":
      return "\u2705 PASS";
    case "fail":
      return "\u274C FAIL";
    default:
      return "\u26A0\uFE0F NEUTRAL";
  }
}

function statusEmoji(status: GateStatus): string {
  switch (status) {
    case "pass":
      return "\u2705";
    case "fail":
      return "\u274C";
    default:
      return "\u26A0\uFE0F";
  }
}

function countsLine(gates: readonly GateResult[]): string {
  const pass = gates.filter((g) => g.status === "pass").length;
  const fail = gates.filter((g) => g.status === "fail").length;
  const neutral = gates.filter((g) => g.status === "neutral").length;
  return `\u2705 ${pass} passed | \u274C ${fail} failed | \u26A0\uFE0F ${neutral} neutral`;
}

function sortedGates(gates: readonly GateResult[]): readonly GateResult[] {
  const order: Record<string, number> = { fail: 0, pass: 1, neutral: 2 };
  return [...gates].sort(
    (a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3)
  );
}

function formatGateSection(gate: GateResult): string {
  const lines: string[] = [];
  const emoji = statusEmoji(gate.status);

  lines.push(`### ${emoji} ${gate.gateId}\n`);
  lines.push(`${gate.summary}\n`);

  if (gate.metrics && gate.metrics.length > 0) {
    lines.push("| Metric | Score | Requirement | Observation |");
    lines.push("|--------|-------|-------------|-------------|");
    for (const m of gate.metrics) {
      const scoreBar = `${(m.score * 100).toFixed(0)}%`;
      const req = m.requirement ?? "\u2014";
      lines.push(
        `| ${m.metric} | ${scoreBar} | ${req} | ${m.observation.slice(0, 120)} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatCheckRunSummary(
  result: ReviewResult,
  opts?: { daoBaseUrl?: string }
): string {
  const lines: string[] = [];

  if (opts?.daoBaseUrl && result.conclusion === "fail") {
    lines.push(`[Propose DAO Vote to Merge](${opts.daoBaseUrl})\n\n---\n`);
  }

  lines.push(`**${verdictLabel(result.conclusion)}**\n`);
  lines.push(countsLine(result.gateResults));
  lines.push("");

  for (const gate of sortedGates(result.gateResults)) {
    lines.push(formatGateSection(gate));
  }

  return lines.join("\n");
}

export function formatPrComment(
  result: ReviewResult,
  opts?: { headSha?: string; checkRunUrl?: string }
): string {
  const lines: string[] = [];

  lines.push(`## Cogni Review \u2014 ${verdictLabel(result.conclusion)}\n`);
  lines.push(`**Gates:** ${countsLine(result.gateResults)}\n`);

  const failed = result.gateResults.filter((g) => g.status === "fail");
  if (failed.length > 0) {
    lines.push("**Blockers:**");
    for (const gate of failed.slice(0, 3)) {
      lines.push(`- **${gate.gateId}**:`);
      if (gate.metrics && gate.metrics.length > 0) {
        lines.push("");
        lines.push("  | Metric | Score | Requirement | Observation |");
        lines.push("  |--------|-------|-------------|-------------|");
        for (const m of gate.metrics) {
          const req = m.requirement ?? "\u2014";
          lines.push(
            `  | ${m.metric} | ${m.score.toFixed(2)} | ${req} | ${m.observation.slice(0, 100)} |`
          );
        }
      } else {
        lines.push(`  - ${gate.summary}`);
      }
    }
    lines.push("");
  }

  if (opts?.checkRunUrl) {
    lines.push(`\n[View Details](${opts.checkRunUrl})`);
  }

  if (opts?.headSha) {
    lines.push(
      `\n<!-- cogni:summary v1 sha=${opts.headSha.slice(0, 7)} ts=${Date.now()} -->`
    );
  }

  return lines.join("\n");
}
