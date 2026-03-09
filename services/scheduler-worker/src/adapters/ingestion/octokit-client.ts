// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `scheduler-worker/adapters/ingestion/octokit-client`
 * Purpose: Unified Octokit factory with retry + throttling plugins.
 * Scope: Creates configured @octokit/core instances. Single place to change GitHub client defaults.
 * Invariants:
 * - All GitHub API calls go through clients created by this factory.
 * - Retry: up to 2 retries on 5xx.
 * - Throttling: GitHub-recommended rate limit + secondary rate limit handling.
 * Side-effects: none (factory only)
 * Links: services/scheduler-worker/src/adapters/ingestion/github.ts
 * @internal
 */

import { Octokit } from "@octokit/core";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";

const OctokitWithPlugins = Octokit.plugin(retry, throttling);

export type GitHubClient = InstanceType<typeof OctokitWithPlugins>;

export function createGitHubClient(token: string): GitHubClient {
  return new OctokitWithPlugins({
    auth: token,
    throttle: {
      onRateLimit: (
        retryAfter: number,
        _options: object,
        octokit: Octokit,
        retryCount: number
      ) => {
        octokit.log.warn(
          `Rate limit hit, retrying after ${retryAfter}s (attempt ${retryCount + 1})`
        );
        return retryCount < 2;
      },
      onSecondaryRateLimit: (
        retryAfter: number,
        _options: object,
        octokit: Octokit
      ) => {
        octokit.log.warn(
          `Secondary rate limit hit, retrying after ${retryAfter}s`
        );
        return true;
      },
    },
  });
}
