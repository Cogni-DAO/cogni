// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/observability`
 * Purpose: Factory for observability clients — GitHub Actions, Loki, health probes.
 * Scope: Creates singleton clients from server environment. Graceful degradation when not configured.
 * Invariants: GRACEFUL_DEGRADATION — returns null clients when credentials missing.
 * Side-effects: none (factory only)
 * @internal
 */

import { GitHubActionsClient } from "@/adapters/server/observability/github-actions-client";
import { probeHealth } from "@/adapters/server/observability/health-probe";
import { LokiQueryClient } from "@/adapters/server/observability/loki-query-client";
import type { ServerEnv } from "@/shared/env";

// Re-export types + health probe for consumption by app layer (which can't import adapters directly)
export type { WorkflowRun } from "@/adapters/server/observability/github-actions-client";
export type { HealthProbeResult } from "@/adapters/server/observability/health-probe";
export { probeHealth };

let ghClient: GitHubActionsClient | null | undefined;
let lokiClient: LokiQueryClient | null | undefined;

export function getGitHubActionsClient(
  env: ServerEnv
): GitHubActionsClient | null {
  if (ghClient !== undefined) return ghClient;
  const appId = env.GH_REVIEW_APP_ID;
  const pkB64 = env.GH_REVIEW_APP_PRIVATE_KEY_BASE64;
  if (!appId || !pkB64) {
    ghClient = null;
    return null;
  }
  ghClient = new GitHubActionsClient({
    appId,
    privateKey: Buffer.from(pkB64, "base64").toString("utf-8"),
  });
  return ghClient;
}

export function getLokiQueryClient(env: ServerEnv): LokiQueryClient | null {
  if (lokiClient !== undefined) return lokiClient;
  const url = env.LOKI_WRITE_URL;
  const user = env.LOKI_USERNAME;
  const pass = env.LOKI_PASSWORD;
  if (!url || !user || !pass) {
    lokiClient = null;
    return null;
  }
  lokiClient = new LokiQueryClient({
    baseUrl: url,
    username: user,
    password: pass,
  });
  return lokiClient;
}
