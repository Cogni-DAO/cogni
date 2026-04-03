// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/deployments/matrix/route`
 * Purpose: Aggregates deployment status from GitHub Actions, Grafana Loki deployment events, and health probes.
 * Scope: Unauthenticated GET endpoint (deployment status is non-sensitive). Aggregates multiple data sources.
 * Invariants: GRACEFUL_DEGRADATION — returns partial data if any data source is unavailable.
 * Side-effects: IO (GitHub API, Loki API, HTTP health pings)
 * @public
 */

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import { NextResponse } from "next/server";
import { serverEnv } from "@/shared/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  head_branch: string;
  head_sha: string;
  head_commit: {
    message: string;
    author: { name: string };
    timestamp: string;
  } | null;
  created_at: string;
  updated_at: string;
  run_number: number;
}

interface HealthResult {
  status: "healthy" | "degraded" | "down" | "unknown";
  latencyMs: number | null;
}

interface LokiDeployEvent {
  environment: string;
  status: "success" | "failed" | "started";
  commit: string;
  actor: string;
  timestamp: string;
  app: string;
}

export interface DeploymentRow {
  branch: string;
  environment: string | null;
  ci: {
    status: "success" | "failure" | "pending" | "unknown";
    conclusion: string | null;
    url: string | null;
    workflowName: string | null;
    runNumber: number | null;
  };
  health: HealthResult;
  deploy: {
    status: "success" | "failed" | "started" | "unknown";
    actor: string | null;
    timestamp: string | null;
  };
  url: string | null;
  commit: {
    sha: string;
    message: string;
    author: string;
    timestamp: string;
  } | null;
}

interface RecentRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  branch: string;
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  runNumber: number;
}

export interface DeploymentMatrixResponse {
  rows: DeploymentRow[];
  recentRuns: RecentRun[];
  lokiEvents: LokiDeployEvent[];
  sources: { github: boolean; loki: boolean; health: boolean };
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Config — branch → environment topology
// ---------------------------------------------------------------------------

const OWNER = "cogni-dao";
const REPO = "cogni-template";

interface EnvConfig {
  branch: string;
  environment: string;
  healthUrl: string;
}

function getTopology(env: ReturnType<typeof serverEnv>): EnvConfig[] {
  const domain = env.DOMAIN ?? "cognidao.org";
  return [
    {
      branch: "canary",
      environment: "canary",
      healthUrl: `https://canary.${domain}/livez`,
    },
    {
      branch: "staging",
      environment: "preview",
      healthUrl: `https://preview.${domain}/livez`,
    },
    {
      branch: "main",
      environment: "production",
      healthUrl: `https://${domain}/livez`,
    },
  ];
}

// ---------------------------------------------------------------------------
// GitHub Actions — uses same auth pattern as VCS adapter
// ---------------------------------------------------------------------------

async function getOctokit(
  env: ReturnType<typeof serverEnv>
): Promise<Octokit | null> {
  const appId = env.GH_REVIEW_APP_ID;
  const privateKeyBase64 = env.GH_REVIEW_APP_PRIVATE_KEY_BASE64;
  if (!appId || !privateKeyBase64) return null;

  const privateKey = Buffer.from(privateKeyBase64, "base64").toString("utf-8");
  const auth = createAppAuth({ appId, privateKey });

  const { token } = await auth({ type: "app" });
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/installation`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );
  if (!res.ok) return null;

  const { id: installationId } = (await res.json()) as { id: number };
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
  });
}

async function fetchWorkflowRuns(
  octokit: Octokit,
  branch?: string
): Promise<WorkflowRun[]> {
  const { data } = await octokit.request(
    "GET /repos/{owner}/{repo}/actions/runs",
    {
      owner: OWNER,
      repo: REPO,
      per_page: branch ? 5 : 20,
      ...(branch ? { branch } : {}),
    }
  );
  return data.workflow_runs as WorkflowRun[];
}

// ---------------------------------------------------------------------------
// Grafana Cloud Loki — deployment event queries
// ---------------------------------------------------------------------------

async function queryLokiDeployEvents(
  env: ReturnType<typeof serverEnv>
): Promise<LokiDeployEvent[]> {
  const lokiUrl = env.LOKI_WRITE_URL;
  const lokiUser = env.LOKI_USERNAME;
  const lokiPassword = env.LOKI_PASSWORD;
  if (!lokiUrl || !lokiUser || !lokiPassword) return [];

  try {
    const query = `{service="deployment"} |= "deployment" | json`;
    const end = Date.now();
    const start = end - 24 * 60 * 60 * 1000; // last 24h

    // LOKI_WRITE_URL may include /loki/api/v1/push — strip to base
    const baseUrl = lokiUrl.replace(/\/loki\/api\/v1\/push\/?$/, "");
    const url = new URL(`${baseUrl}/loki/api/v1/query_range`);
    url.searchParams.set("query", query);
    url.searchParams.set("start", String(start * 1_000_000)); // nanoseconds
    url.searchParams.set("end", String(end * 1_000_000));
    url.searchParams.set("limit", "50");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${Buffer.from(`${lokiUser}:${lokiPassword}`).toString("base64")}`,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = (await res.json()) as {
      data: {
        result: Array<{
          values: Array<[string, string]>;
        }>;
      };
    };

    const events: LokiDeployEvent[] = [];
    for (const stream of data.data.result) {
      for (const [ts, line] of stream.values) {
        try {
          const parsed = JSON.parse(line) as Record<string, string>;
          events.push({
            environment: parsed.env ?? "unknown",
            status: (parsed.status as LokiDeployEvent["status"]) ?? "unknown",
            commit: parsed.commit ?? "",
            actor: parsed.actor ?? "",
            timestamp: new Date(Number(ts) / 1_000_000).toISOString(),
            app: parsed.app ?? "operator",
          });
        } catch {
          // Skip unparseable lines
        }
      }
    }
    return events.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Health probe
// ---------------------------------------------------------------------------

async function probeHealth(url: string): Promise<HealthResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (res.ok) return { status: "healthy", latencyMs };
    if (res.status >= 500) return { status: "degraded", latencyMs };
    return { status: "down", latencyMs };
  } catch {
    return { status: "down", latencyMs: null };
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse<DeploymentMatrixResponse>> {
  const env = serverEnv();
  const topology = getTopology(env);
  const octokit = await getOctokit(env);

  // Fetch all data sources in parallel
  const branchRunsPromises = topology.map(async (env) => {
    if (!octokit) return { env, runs: [] as WorkflowRun[] };
    try {
      const runs = await fetchWorkflowRuns(octokit, env.branch);
      return { env, runs };
    } catch {
      return { env, runs: [] as WorkflowRun[] };
    }
  });

  const recentRunsPromise = octokit
    ? fetchWorkflowRuns(octokit).catch(() => [] as WorkflowRun[])
    : Promise.resolve([] as WorkflowRun[]);

  const healthPromises = topology.map((env) => probeHealth(env.healthUrl));
  const lokiPromise = queryLokiDeployEvents(env);

  const [branchResults, recentWorkflowRuns, healthResults, lokiEvents] =
    await Promise.all([
      Promise.all(branchRunsPromises),
      recentRunsPromise,
      Promise.all(healthPromises),
      lokiPromise,
    ]);

  // Index latest Loki deploy event per environment
  const latestDeployByEnv = new Map<string, LokiDeployEvent>();
  for (const event of lokiEvents) {
    if (!latestDeployByEnv.has(event.environment)) {
      latestDeployByEnv.set(event.environment, event);
    }
  }

  // Build matrix rows
  const rows: DeploymentRow[] = branchResults.map(({ env, runs }, i) => {
    const latest = runs[0] ?? null;
    const health = healthResults[i] ?? {
      status: "unknown" as const,
      latencyMs: null,
    };
    const lokiDeploy = latestDeployByEnv.get(env.environment);

    let ciStatus: DeploymentRow["ci"]["status"] = "unknown";
    if (latest) {
      if (latest.status === "completed") {
        ciStatus = latest.conclusion === "success" ? "success" : "failure";
      } else {
        ciStatus = "pending";
      }
    }

    return {
      branch: env.branch,
      environment: env.environment,
      ci: {
        status: ciStatus,
        conclusion: latest?.conclusion ?? null,
        url: latest?.html_url ?? null,
        workflowName: latest?.name ?? null,
        runNumber: latest?.run_number ?? null,
      },
      health,
      deploy: {
        status: lokiDeploy?.status ?? "unknown",
        actor: lokiDeploy?.actor ?? null,
        timestamp: lokiDeploy?.timestamp ?? null,
      },
      url: env.healthUrl.replace("/livez", ""),
      commit: latest?.head_commit
        ? {
            sha: latest.head_sha,
            message: (latest.head_commit.message ?? "").split("\n")[0] ?? "",
            author: latest.head_commit.author.name,
            timestamp: latest.created_at,
          }
        : null,
    };
  });

  // Build recent runs feed
  const recentRuns: RecentRun[] = recentWorkflowRuns
    .slice(0, 15)
    .map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
      branch: run.head_branch,
      sha: run.head_sha.slice(0, 7),
      message: (run.head_commit?.message ?? "").split("\n")[0] ?? "",
      author: run.head_commit?.author.name ?? "unknown",
      timestamp: run.created_at,
      runNumber: run.run_number,
    }));

  return NextResponse.json({
    rows,
    recentRuns,
    lokiEvents: lokiEvents.slice(0, 20),
    sources: {
      github: octokit !== null,
      loki: lokiEvents.length > 0,
      health: true,
    },
    fetchedAt: new Date().toISOString(),
  });
}
