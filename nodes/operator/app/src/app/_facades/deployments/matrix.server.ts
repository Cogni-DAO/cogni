// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/deployments/matrix.server`
 * Purpose: Server-side facade for deployment matrix — wires observability adapters + caching.
 * Scope: Orchestrates GitHub Actions, Loki, and health probes into a unified matrix. No business logic.
 * Invariants: GRACEFUL_DEGRADATION — returns partial data if any source is unavailable. TTL-cached (30s).
 * Side-effects: IO (via adapters)
 * Links: adapters/server/observability/
 * @internal
 */

import {
  GitHubActionsClient,
  type WorkflowRun,
} from "@/adapters/server/observability/github-actions-client";
import { probeHealth } from "@/adapters/server/observability/health-probe";
import { LokiQueryClient } from "@/adapters/server/observability/loki-query-client";
import { serverEnv } from "@/shared/env";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type { WorkflowRun };

export interface DeploymentRow {
  branch: string;
  environment: string;
  ci: {
    status: "success" | "failure" | "pending" | "unknown";
    url: string | null;
    workflowName: string | null;
  };
  health: {
    status: "healthy" | "degraded" | "down" | "unknown";
    latencyMs: number | null;
  };
  deploy: { status: string; actor: string | null; timestamp: string | null };
  url: string;
  commit: {
    sha: string;
    message: string;
    author: string;
    timestamp: string;
  } | null;
}

export interface DeploymentMatrixResponse {
  rows: DeploymentRow[];
  recentRuns: WorkflowRun[];
  sources: { github: boolean; loki: boolean; health: boolean };
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Topology — branch → environment → health URL
// ---------------------------------------------------------------------------

const OWNER = "cogni-dao";
const REPO = "cogni-template";

interface EnvTarget {
  branch: string;
  environment: string;
  healthUrl: string;
}

const TOPOLOGY: EnvTarget[] = [
  {
    branch: "canary",
    environment: "canary",
    healthUrl: "https://test.cognidao.org/livez",
  },
  {
    branch: "canary",
    environment: "canary-poly",
    healthUrl: "https://poly-test.cognidao.org/livez",
  },
  {
    branch: "canary",
    environment: "canary-resy",
    healthUrl: "https://resy-test.cognidao.org/livez",
  },
  {
    branch: "staging",
    environment: "preview",
    healthUrl: "https://preview.cognidao.org/livez",
  },
  {
    branch: "main",
    environment: "production",
    healthUrl: "https://cognidao.org/livez",
  },
];

// ---------------------------------------------------------------------------
// Singleton clients (created once per process)
// ---------------------------------------------------------------------------

let ghClient: GitHubActionsClient | null | undefined;
let lokiClient: LokiQueryClient | null | undefined;

function getGitHubClient(
  env: ReturnType<typeof serverEnv>
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

function getLokiClient(
  env: ReturnType<typeof serverEnv>
): LokiQueryClient | null {
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

// ---------------------------------------------------------------------------
// TTL cache — one response per 30s regardless of viewer count
// ---------------------------------------------------------------------------

let cache: { data: DeploymentMatrixResponse; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchDeploymentMatrix(): Promise<DeploymentMatrixResponse> {
  if (cache && Date.now() < cache.expiresAt) return cache.data;

  const env = serverEnv();
  const gh = getGitHubClient(env);
  const loki = getLokiClient(env);

  const uniqueBranches = [...new Set(TOPOLOGY.map((t) => t.branch))];

  const [branchRunMap, recentRuns, healthResults, lokiEntries] =
    await Promise.all([
      (async () => {
        if (!gh) return new Map<string, WorkflowRun[]>();
        const entries = await Promise.all(
          uniqueBranches.map(async (branch) => {
            const runs = await gh.listWorkflowRuns(OWNER, REPO, {
              branch,
              perPage: 5,
            });
            return [branch, runs] as const;
          })
        );
        return new Map(entries);
      })(),
      gh?.listWorkflowRuns(OWNER, REPO, { perPage: 15 }) ?? Promise.resolve([]),
      Promise.all(TOPOLOGY.map((t) => probeHealth(t.healthUrl))),
      (async () => {
        if (!loki) return [];
        const now = Date.now();
        return loki.queryRange(
          `{service="deployment"} |= "deployment" | json`,
          now - 86_400_000,
          now,
          50
        );
      })(),
    ]);

  const latestDeploy = new Map<
    string,
    { status: string; actor: string; timestamp: string }
  >();
  for (const entry of lokiEntries) {
    if (!entry.parsed) continue;
    const envName = entry.parsed.env ?? "unknown";
    if (!latestDeploy.has(envName)) {
      latestDeploy.set(envName, {
        status: entry.parsed.status ?? "unknown",
        actor: entry.parsed.actor ?? "",
        timestamp: entry.timestamp,
      });
    }
  }

  const rows: DeploymentRow[] = TOPOLOGY.map((target, i) => {
    const runs = branchRunMap.get(target.branch) ?? [];
    const latest = runs[0] ?? null;
    const health = healthResults[i];
    const deploy = latestDeploy.get(target.environment);

    let ciStatus: DeploymentRow["ci"]["status"] = "unknown";
    if (latest) {
      ciStatus =
        latest.status === "completed"
          ? latest.conclusion === "success"
            ? "success"
            : "failure"
          : "pending";
    }

    return {
      branch: target.branch,
      environment: target.environment,
      ci: {
        status: ciStatus,
        url: latest?.htmlUrl ?? null,
        workflowName: latest?.name ?? null,
      },
      health: {
        status: health?.status ?? "unknown",
        latencyMs: health?.latencyMs ?? null,
      },
      deploy: {
        status: deploy?.status ?? "unknown",
        actor: deploy?.actor ?? null,
        timestamp: deploy?.timestamp ?? null,
      },
      url: target.healthUrl.replace("/livez", ""),
      commit: latest
        ? {
            sha: latest.headSha,
            message: latest.commitMessage,
            author: latest.commitAuthor,
            timestamp: latest.createdAt,
          }
        : null,
    };
  });

  const result: DeploymentMatrixResponse = {
    rows,
    recentRuns,
    sources: {
      github: gh !== null,
      loki: lokiEntries.length > 0,
      health: true,
    },
    fetchedAt: new Date().toISOString(),
  };

  cache = { data: result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
}
