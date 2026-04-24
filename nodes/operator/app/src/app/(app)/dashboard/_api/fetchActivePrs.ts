// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchActivePrs`
 * Purpose: Data source for the Active Pull Requests panel. Phase 1 returns a
 *          typed mock shaped after `PrSummary` + `CiStatusResult` from
 *          `@cogni/ai-tools`. Phase 2 (task.0363 followup) swaps the body to
 *          call an operator-side route that composes:
 *            - `VcsCapability.listPrs()`
 *            - `VcsCapability.getCiStatus({ prNumber })` per PR
 *            - flight state (from the #1021 dispatch result + buildSha verify)
 * Scope: Data fetching only. Does not implement business logic.
 * Invariants: Return shape stable across phases — presenter never sees mock-only fields.
 * Side-effects: none in Phase 1 (mock); IO in Phase 2.
 * Links:
 *   - packages/ai-tools/src/capabilities/vcs.ts (PrSummary, CiStatusResult)
 *   - packages/node-contracts/src/vcs.flight.v1.contract.ts
 *   - work/items/task.0363.operator-pr-dashboard-v0.md
 * @public
 */

import type { CiStatusResult, PrSummary } from "@cogni/ai-tools";

import type {
  PrPanelEntry,
  PrPanelListResponse,
} from "../_components/pr-panel/pr-panel.types";

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

const MOCK_ENTRIES: PrPanelEntry[] = [
  {
    pr: pr({
      number: 1247,
      title: "feat: candidate-flight telemetry for operator dispatches",
      author: "alex-contributor",
      headBranch: "feat/flight-telemetry",
      labels: ["enhancement", "needs-review"],
      updatedAt: isoMinutesAgo(120),
    }),
    ci: ci({
      prNumber: 1247,
      headSha: "abc1234",
      allGreen: false,
      pending: true,
      checks: [
        { name: "Lint", status: "completed", conclusion: "success" },
        { name: "Typecheck", status: "completed", conclusion: "success" },
        { name: "Unit", status: "in_progress", conclusion: null },
        { name: "Component", status: "queued", conclusion: null },
        { name: "Build", status: "queued", conclusion: null },
      ],
    }),
    htmlUrl: "https://github.com/Cogni-DAO/node-template/pull/1247",
  },
  {
    pr: pr({
      number: 1245,
      title: "fix: loki-ci-telemetry path in verify-deploy (sub-checkout)",
      author: "sarah-dev",
      headBranch: "fix/loki-ci-telemetry",
      labels: ["bug", "priority-high"],
      updatedAt: isoMinutesAgo(300),
    }),
    ci: ci({
      prNumber: 1245,
      headSha: "def5678",
      allGreen: true,
      pending: false,
      checks: [
        { name: "Lint", status: "completed", conclusion: "success" },
        { name: "Typecheck", status: "completed", conclusion: "success" },
        { name: "Unit", status: "completed", conclusion: "success" },
        { name: "Component", status: "completed", conclusion: "success" },
        { name: "Build", status: "completed", conclusion: "success" },
        {
          name: "candidate-flight / build-image",
          status: "completed",
          conclusion: "success",
        },
        {
          name: "candidate-flight / argo-sync",
          status: "completed",
          conclusion: "success",
        },
        {
          name: "verify-buildsha",
          status: "completed",
          conclusion: "success",
        },
      ],
    }),
    flight: {
      workflowUrl:
        "https://github.com/Cogni-DAO/node-template/actions/runs/mock-1245",
      headSha: "def5678",
      deployVerified: true,
    },
    htmlUrl: "https://github.com/Cogni-DAO/node-template/pull/1245",
  },
  {
    pr: pr({
      number: 1243,
      title: "chore: upgrade dependencies and fix security vulnerabilities",
      author: "bot-renovate",
      headBranch: "renovate/weekly",
      labels: ["dependencies", "automated"],
      updatedAt: isoMinutesAgo(60 * 24),
    }),
    ci: ci({
      prNumber: 1243,
      headSha: "ghi9012",
      allGreen: false,
      pending: false,
      checks: [
        { name: "Lint", status: "completed", conclusion: "success" },
        { name: "Typecheck", status: "completed", conclusion: "success" },
        { name: "Unit", status: "completed", conclusion: "failure" },
        { name: "Component", status: "queued", conclusion: null },
        { name: "Build", status: "queued", conclusion: null },
      ],
    }),
    htmlUrl: "https://github.com/Cogni-DAO/node-template/pull/1243",
  },
  {
    pr: pr({
      number: 1241,
      title: "feat: implement OAuth2 login flow with GitHub",
      author: "mike-auth",
      headBranch: "feat/github-oauth",
      labels: ["feature", "wip"],
      updatedAt: isoMinutesAgo(60 * 48),
      draft: true,
    }),
    ci: ci({
      prNumber: 1241,
      headSha: "jkl3456",
      allGreen: true,
      pending: false,
      checks: [
        { name: "Lint", status: "completed", conclusion: "success" },
        { name: "Typecheck", status: "completed", conclusion: "success" },
        { name: "Unit", status: "completed", conclusion: "success" },
        { name: "Component", status: "completed", conclusion: "success" },
        { name: "Build", status: "completed", conclusion: "success" },
        {
          name: "candidate-flight / build-image",
          status: "in_progress",
          conclusion: null,
        },
        {
          name: "candidate-flight / argo-sync",
          status: "queued",
          conclusion: null,
        },
      ],
    }),
    flight: {
      workflowUrl:
        "https://github.com/Cogni-DAO/node-template/actions/runs/mock-1241",
      headSha: "jkl3456",
      deployVerified: false,
    },
    htmlUrl: "https://github.com/Cogni-DAO/node-template/pull/1241",
  },
];

/**
 * Phase 1: return mock data.
 * Phase 2: call the operator route that composes VcsCapability methods.
 */
export async function fetchActivePrs(): Promise<PrPanelListResponse> {
  return {
    entries: MOCK_ENTRIES,
    syncedAt: new Date().toISOString(),
  };
}

// ────────────────────────────────────────────────────────────
// Mock helpers — exist only to keep fixtures readable.
// ────────────────────────────────────────────────────────────

function pr(overrides: Partial<PrSummary> & { number: number }): PrSummary {
  return {
    number: overrides.number,
    title: overrides.title ?? "",
    author: overrides.author ?? "unknown",
    baseBranch: overrides.baseBranch ?? "main",
    headBranch: overrides.headBranch ?? "feat/branch",
    labels: overrides.labels ?? [],
    draft: overrides.draft ?? false,
    mergeable: overrides.mergeable ?? true,
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

function ci(
  overrides: Partial<CiStatusResult> & { prNumber: number; headSha: string }
): CiStatusResult {
  return {
    prNumber: overrides.prNumber,
    prTitle: overrides.prTitle ?? "",
    author: overrides.author ?? "unknown",
    baseBranch: overrides.baseBranch ?? "main",
    headSha: overrides.headSha,
    mergeable: overrides.mergeable ?? true,
    reviewDecision: overrides.reviewDecision ?? null,
    labels: overrides.labels ?? [],
    draft: overrides.draft ?? false,
    allGreen: overrides.allGreen ?? false,
    pending: overrides.pending ?? false,
    checks: overrides.checks ?? [],
  };
}
