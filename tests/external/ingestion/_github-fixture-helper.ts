// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/external/ingestion/_github-fixture-helper`
 * Purpose: Creates and cleans up real GitHub fixtures (PRs, issues) for external ingestion tests.
 * Scope: Uses `gh` CLI — requires authentication and push access to the target repo. Does not run in CI.
 * Invariants: Fixtures are self-contained — no hardcoded PR numbers.
 * Side-effects: IO (git push, GitHub API — creates PRs, issues on target repo)
 * Links: tests/external/ingestion/github-adapter.external.test.ts
 * @internal
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function exec(cmd: string, opts?: { cwd?: string }): string {
  return execSync(cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
}

export interface GitHubFixtures {
  repo: string;
  branch: string;
  prNumber: number;
  issueNumber: number;
  /** Timestamp just before fixtures were created — use as window.since */
  createdAfter: Date;
  /** Timestamp just after fixtures were created — use as window.until */
  createdBefore: Date;
  tempDir: string;
}

/**
 * Creates a merged PR and a closed issue on the target repo.
 * Returns fixture metadata for test assertions + cleanup.
 */
export function createFixtures(repo: string): GitHubFixtures {
  const suffix = Date.now();
  const branch = `test-fixture-${suffix}`;
  const createdAfter = new Date();

  // Clone, branch, push
  const tempDir = mkdtempSync(join(tmpdir(), "cogni-ext-test-"));
  exec(`gh repo clone ${repo} ${tempDir} -- --quiet`);
  exec(`git switch -c ${branch} --quiet`, { cwd: tempDir });

  const ts = new Date().toISOString();
  const fixtureFile = `.ext-test-fixture-${suffix}.txt`;
  execSync(`echo 'external test fixture ${ts}' > ${fixtureFile}`, {
    cwd: tempDir,
  });
  exec(`git add ${fixtureFile}`, { cwd: tempDir });
  exec(
    `git -c user.name='cogni-test' -c user.email='test@cogni.dev' commit -m 'test: external fixture ${suffix}' --quiet`,
    { cwd: tempDir }
  );
  exec(`git push origin ${branch} --quiet`, { cwd: tempDir });

  // Create PR
  const prUrl = exec(
    `gh pr create -R ${repo} --title "Test Fixture ${suffix}" --body "Auto-created by external ingestion tests." --base main --head ${branch}`
  );
  const prNumber = parseInt(prUrl.match(/(\d+)$/)?.[1] ?? "0", 10);

  // Wait for GitHub to compute mergeability before merging
  for (let i = 0; i < 10; i++) {
    try {
      exec(`gh pr merge ${prNumber} -R ${repo} --squash --delete-branch`);
      break;
    } catch (err) {
      if (i === 9) throw err;
      execSync("sleep 3");
    }
  }

  // Create + close issue
  const issueUrl = exec(
    `gh issue create -R ${repo} --title "Test Issue ${suffix}" --body "Auto-created by external ingestion tests."`
  );
  const issueNumber = parseInt(issueUrl.match(/(\d+)$/)?.[1] ?? "0", 10);
  exec(`gh issue close ${issueNumber} -R ${repo}`);

  // Small buffer so GitHub API indexes the data
  const createdBefore = new Date(Date.now() + 60_000);

  return {
    repo,
    branch,
    prNumber,
    issueNumber,
    createdAfter,
    createdBefore,
    tempDir,
  };
}

/**
 * Best-effort cleanup of test fixtures.
 */
export function cleanupFixtures(fixtures: GitHubFixtures): void {
  // Branch is already deleted by --delete-branch on merge.
  // Close issue if somehow still open.
  try {
    exec(
      `gh issue close ${fixtures.issueNumber} -R ${fixtures.repo} 2>/dev/null || true`
    );
  } catch {
    // best-effort
  }
  try {
    rmSync(fixtures.tempDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}
