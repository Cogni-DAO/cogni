// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/contributor-cli/git`
 * Purpose: Git + GitHub CLI helpers for the contributor CLI.
 * Scope: Wraps git and gh shell commands for read-only status queries. Does not modify the working tree or push code.
 * Invariants: All commands have 30s timeout.
 * Side-effects: IO (shell exec)
 * Links: docs/spec/development-lifecycle.md
 * @internal
 */

import { execSync } from "node:child_process";

function run(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", timeout: 30_000 }).trim();
}

function runOrNull(cmd: string): string | null {
  try {
    return run(cmd);
  } catch {
    return null;
  }
}

export function getCurrentBranch(): string {
  return run("git branch --show-current");
}

export function getPrStatus(prUrl: string): {
  state: string;
  mergeable: string;
  reviewDecision: string;
  checksPass: boolean;
} {
  const json = run(
    `gh pr view "${prUrl}" --json state,mergeable,reviewDecision,statusCheckRollup`
  );
  const data = JSON.parse(json);
  const checks = (data.statusCheckRollup ?? []) as Array<{
    conclusion: string;
    status: string;
  }>;
  const checksPass =
    checks.length > 0 &&
    checks.every((c) => c.status === "COMPLETED" && c.conclusion === "SUCCESS");
  return {
    state: data.state,
    mergeable: data.mergeable,
    reviewDecision: data.reviewDecision,
    checksPass,
  };
}

export function isGhAuthenticated(): boolean {
  return runOrNull("gh auth status") !== null;
}
