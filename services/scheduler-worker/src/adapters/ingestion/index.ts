// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `scheduler-worker/adapters/ingestion`
 * Purpose: Barrel export for activity ingestion adapters — poll and webhook implementations.
 * Scope: Re-exports adapter implementations (GitHubSourceAdapter, auth, client). New adapters added here.
 * Side-effects: none
 * @internal
 */

export {
  type GitHubAdapterConfig,
  GitHubSourceAdapter,
} from "./github.js";

export {
  type GitHubAppConfig,
  GitHubAppTokenProvider,
} from "./github-auth.js";

export { createGitHubClient, type GitHubClient } from "./octokit-client.js";
