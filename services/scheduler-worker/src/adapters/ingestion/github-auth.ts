// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `scheduler-worker/adapters/ingestion/github-auth`
 * Purpose: GitHub App authentication — implements VcsTokenProvider for GitHub App JWT + installation tokens.
 * Scope: Uses @octokit/auth-app for token management. Installation tokens auto-cached at 59min by the library.
 * Invariants:
 * - Installation ID resolved dynamically from repo if not provided.
 * - Cached installationId reused across calls.
 * Side-effects: HTTP (GitHub API for installation ID resolution)
 * Links: packages/ingestion-core/src/vcs-token-provider.ts
 * @internal
 */

import type { VcsTokenProvider, VcsTokenResult } from "@cogni/ingestion-core";
import { createAppAuth } from "@octokit/auth-app";

export interface GitHubAppConfig {
  readonly appId: string;
  /** PEM-encoded private key (decoded from base64 by caller) */
  readonly privateKey: string;
  /** Optional override; resolved dynamically from repoRef if omitted */
  readonly installationId?: number;
}

export class GitHubAppTokenProvider implements VcsTokenProvider {
  private readonly auth: ReturnType<typeof createAppAuth>;
  private installationId: number | undefined;

  constructor(config: GitHubAppConfig) {
    this.auth = createAppAuth({
      appId: config.appId,
      privateKey: config.privateKey,
    });
    this.installationId = config.installationId;
  }

  async getToken(params: {
    provider: string;
    capability: string;
    repoRef?: string;
  }): Promise<VcsTokenResult> {
    if (!this.installationId && params.repoRef) {
      this.installationId = await this.resolveInstallationId(params.repoRef);
    }
    if (!this.installationId) {
      throw new Error(
        "GitHub App installationId required — provide it in config or pass repoRef to resolve dynamically"
      );
    }
    const result = await this.auth({
      type: "installation",
      installationId: this.installationId,
    });
    return {
      token: result.token,
      expiresAt: new Date(result.expiresAt),
    };
  }

  private async resolveInstallationId(repoRef: string): Promise<number> {
    const { token } = await this.auth({ type: "app" });
    const [owner, repo] = repoRef.split("/");
    if (!owner || !repo) {
      throw new Error(
        `Invalid repoRef format "${repoRef}", expected "owner/repo"`
      );
    }
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/installation`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
    if (!response.ok) {
      throw new Error(
        `GitHub App not installed on ${repoRef} (HTTP ${response.status})`
      );
    }
    const data = (await response.json()) as { id: number };
    return data.id;
  }
}
