// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/observability/github-actions-client`
 * Purpose: GitHub Actions workflow run client via GitHub App auth. Caches installation IDs.
 * Scope: Infrastructure client. Constructor injection. Same auth pattern as GitHubVcsAdapter.
 * Invariants: Installation ID cached per owner/repo. Returns empty on auth failure.
 * Side-effects: IO (GitHub REST API)
 * Links: adapters/server/vcs/github-vcs.adapter.ts
 * @public
 */

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  headBranch: string;
  headSha: string;
  commitMessage: string;
  commitAuthor: string;
  createdAt: string;
  runNumber: number;
}

export class GitHubActionsClient {
  private readonly appId: string;
  private readonly privateKey: string;
  private readonly appAuth: ReturnType<typeof createAppAuth>;
  private readonly installationCache = new Map<string, number>();

  constructor(config: { appId: string; privateKey: string }) {
    this.appId = config.appId;
    this.privateKey = config.privateKey;
    this.appAuth = createAppAuth({
      appId: config.appId,
      privateKey: config.privateKey,
    });
  }

  async listWorkflowRuns(
    owner: string,
    repo: string,
    opts?: { branch?: string; perPage?: number }
  ): Promise<WorkflowRun[]> {
    try {
      const octokit = await this.getOctokit(owner, repo);
      if (!octokit) return [];

      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/actions/runs",
        {
          owner,
          repo,
          per_page: opts?.perPage ?? 10,
          ...(opts?.branch ? { branch: opts.branch } : {}),
        }
      );

      return (
        data.workflow_runs as Array<{
          id: number;
          name: string;
          status: string;
          conclusion: string | null;
          html_url: string;
          head_branch: string;
          head_sha: string;
          head_commit: { message: string; author: { name: string } } | null;
          created_at: string;
          run_number: number;
        }>
      ).map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        htmlUrl: r.html_url,
        headBranch: r.head_branch,
        headSha: r.head_sha,
        commitMessage: (r.head_commit?.message ?? "").split("\n")[0] ?? "",
        commitAuthor: r.head_commit?.author.name ?? "unknown",
        createdAt: r.created_at,
        runNumber: r.run_number,
      }));
    } catch {
      return [];
    }
  }

  private async getOctokit(
    owner: string,
    repo: string
  ): Promise<Octokit | null> {
    const installationId = await this.resolveInstallationId(owner, repo);
    if (!installationId) return null;
    return new Octokit({
      authStrategy: createAppAuth,
      auth: { appId: this.appId, privateKey: this.privateKey, installationId },
    });
  }

  private async resolveInstallationId(
    owner: string,
    repo: string
  ): Promise<number | null> {
    const key = `${owner}/${repo}`;
    const cached = this.installationCache.get(key);
    if (cached) return cached;

    try {
      const { token } = await this.appAuth({ type: "app" });
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/installation`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
        }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { id: number };
      this.installationCache.set(key, data.id);
      return data.id;
    } catch {
      return null;
    }
  }
}
