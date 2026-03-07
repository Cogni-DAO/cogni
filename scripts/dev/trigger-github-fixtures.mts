#!/usr/bin/env tsx

// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/dev/trigger-github-fixtures`
 * Purpose: Create real GitHub fixtures (merged PR, closed issue) on the test repo to trigger webhook events.
 * Scope: Uses `gh` CLI to create + merge a PR and create + close an issue. Intended for local dev with `dev:stack` + `dev:smee` running. Does not run in CI.
 * Invariants: Requires `gh` CLI authenticated with push access to the target repo.
 * Side-effects: IO (git push, GitHub API — creates PRs, issues on target repo)
 * Links: tests/external/ingestion/_github-fixture-helper.ts
 * @internal
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Config ──────────────────────────────────────────────────────

const TEST_REPO = process.env.E2E_GITHUB_REPO ?? "derekg1729/test-repo";

// ── Helpers ─────────────────────────────────────────────────────

function exec(cmd: string, opts?: { cwd?: string }): string {
  return execSync(cmd, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
}

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// ── Main ────────────────────────────────────────────────────────

function main(): void {
  log(`Target repo: ${TEST_REPO}`);

  // Verify gh CLI is available and authenticated
  try {
    exec("gh auth status");
  } catch {
    console.error(
      "Error: `gh` CLI not authenticated. Run `gh auth login` first."
    );
    process.exit(1);
  }

  const suffix = Date.now();
  const branch = `dev-fixture-${suffix}`;
  const tempDir = mkdtempSync(join(tmpdir(), "cogni-dev-fixture-"));

  try {
    // 1. Clone, branch, commit, push
    log("Cloning repo...");
    exec(`gh repo clone ${TEST_REPO} ${tempDir} -- --quiet`);
    exec(`git switch -c ${branch} --quiet`, { cwd: tempDir });

    const ts = new Date().toISOString();
    const fixtureFile = `.dev-fixture-${suffix}.txt`;
    execSync(`echo 'dev fixture ${ts}' > ${fixtureFile}`, { cwd: tempDir });
    exec(`git add ${fixtureFile}`, { cwd: tempDir });
    exec(
      `git -c user.name='cogni-dev' -c user.email='dev@cogni.dev' commit -m 'dev: fixture ${suffix}' --quiet`,
      { cwd: tempDir }
    );

    log("Pushing branch...");
    exec(`git push origin ${branch} --quiet`, { cwd: tempDir });

    // 2. Create PR
    log("Creating PR...");
    const prUrl = exec(
      `gh pr create -R ${TEST_REPO} --title "Dev Fixture ${suffix}" --body "Created by pnpm dev:trigger-github for local webhook testing." --base main --head ${branch}`
    );
    const prNumber = prUrl.match(/(\d+)$/)?.[1] ?? "0";
    log(`PR created: ${prUrl}`);

    // 3. Merge PR (retry loop for mergeability check)
    log("Merging PR...");
    for (let i = 0; i < 10; i++) {
      try {
        exec(
          `gh pr merge ${prNumber} -R ${TEST_REPO} --squash --delete-branch`
        );
        break;
      } catch (err) {
        if (i === 9) throw err;
        log(`  Waiting for mergeability (attempt ${i + 1}/10)...`);
        execSync("sleep 3");
      }
    }
    log(`PR #${prNumber} merged (webhook: pull_request.closed + merged=true)`);

    // 4. Create + close issue
    log("Creating issue...");
    const issueUrl = exec(
      `gh issue create -R ${TEST_REPO} --title "Dev Issue ${suffix}" --body "Created by pnpm dev:trigger-github for local webhook testing."`
    );
    const issueNumber = issueUrl.match(/(\d+)$/)?.[1] ?? "0";
    exec(`gh issue close ${issueNumber} -R ${TEST_REPO}`);
    log(`Issue #${issueNumber} created + closed (webhook: issues.closed)`);

    // 5. Summary
    console.log();
    console.log("Done! If dev:smee is running, these webhooks should fire:");
    console.log(
      `  - pull_request (closed/merged) -> receipt: github:pr:${TEST_REPO}:${prNumber}`
    );
    console.log(
      `  - issues (closed)              -> receipt: github:issue:${TEST_REPO}:${issueNumber}`
    );
    console.log();
    console.log(
      "Check /gov/epoch in the UI to see new receipts in the current epoch."
    );
  } finally {
    // Cleanup temp dir
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

main();
