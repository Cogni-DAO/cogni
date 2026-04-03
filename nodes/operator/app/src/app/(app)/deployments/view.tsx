// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/deployments/view`
 * Purpose: Deployment matrix — compact branch×environment grid with live status icons.
 * Scope: Client-side view. Polls deployment matrix API at 10s intervals.
 * Invariants: Polls at 10s; graceful degradation when data sources unavailable.
 * Side-effects: IO (via React Query)
 * Links: [fetchMatrix](./_api/fetchMatrix.ts), [API route](../../api/v1/deployments/matrix/route.ts)
 * @public
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  Circle,
  ExternalLink,
  GitBranch,
  Loader2,
  Radio,
  XCircle,
} from "lucide-react";
import type { ReactElement } from "react";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components";
import { cn } from "@/shared/util/cn";
import type { DeploymentMatrixResponse } from "./_api/fetchMatrix";
import { fetchDeploymentMatrix } from "./_api/fetchMatrix";

// ---------------------------------------------------------------------------
// Status icon helpers
// ---------------------------------------------------------------------------

type CiStatus = "success" | "failure" | "pending" | "unknown";
type HealthStatus = "healthy" | "degraded" | "down" | "unknown";
type DeployStatus = "success" | "failed" | "started" | "unknown";

function CiIcon({ status }: { status: CiStatus }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="size-4 text-success" />;
    case "failure":
      return <XCircle className="size-4 text-destructive" />;
    case "pending":
      return <Loader2 className="size-4 animate-spin text-warning" />;
    default:
      return <Circle className="size-3.5 text-muted-foreground" />;
  }
}

function HealthIcon({
  status,
  latencyMs,
}: {
  status: HealthStatus;
  latencyMs: number | null;
}) {
  const label = latencyMs !== null ? `${status} (${latencyMs}ms)` : status;
  switch (status) {
    case "healthy":
      return (
        <Tooltip>
          <TooltipTrigger>
            <Activity className="size-4 text-success" />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      );
    case "degraded":
      return (
        <Tooltip>
          <TooltipTrigger>
            <Activity className="size-4 text-warning" />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      );
    case "down":
      return (
        <Tooltip>
          <TooltipTrigger>
            <XCircle className="size-4 text-destructive" />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      );
    default:
      return <Circle className="size-3.5 text-muted-foreground" />;
  }
}

function DeployIcon({ status }: { status: DeployStatus }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="size-4 text-success" />;
    case "failed":
      return <XCircle className="size-4 text-destructive" />;
    case "started":
      return <Loader2 className="size-4 animate-spin text-primary" />;
    default:
      return <Circle className="size-3.5 text-muted-foreground" />;
  }
}

function RunStatusIcon({
  status,
  conclusion,
}: {
  status: string;
  conclusion: string | null;
}) {
  if (status === "completed") {
    if (conclusion === "success")
      return <CheckCircle2 className="size-3.5 text-success" />;
    if (conclusion === "cancelled")
      return <Circle className="size-3.5 text-muted-foreground" />;
    return <XCircle className="size-3.5 text-destructive" />;
  }
  if (status === "in_progress" || status === "queued")
    return <Loader2 className="size-3.5 animate-spin text-warning" />;
  return <Circle className="size-3.5 text-muted-foreground" />;
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function branchShort(branch: string): string {
  if (branch.length <= 20) return branch;
  // Show first significant part
  const parts = branch.split("/");
  if (parts.length > 1)
    return `${parts[0]}/${(parts[parts.length - 1] ?? "").slice(0, 12)}...`;
  return `${branch.slice(0, 18)}...`;
}

// ---------------------------------------------------------------------------
// Source indicator
// ---------------------------------------------------------------------------

function DataSources({
  sources,
}: {
  sources: DeploymentMatrixResponse["sources"];
}) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-1",
          sources.github ? "text-success" : "text-muted-foreground/40"
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            sources.github ? "bg-success" : "bg-muted-foreground/40"
          )}
        />
        GitHub
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-1",
          sources.loki ? "text-success" : "text-muted-foreground/40"
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            sources.loki ? "bg-success" : "bg-muted-foreground/40"
          )}
        />
        Loki
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-1",
          sources.health ? "text-success" : "text-muted-foreground/40"
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            sources.health ? "bg-success" : "bg-muted-foreground/40"
          )}
        />
        Health
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function DeploymentsView(): ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ["deployment-matrix"],
    queryFn: fetchDeploymentMatrix,
    refetchInterval: 10_000,
    staleTime: 5_000,
    gcTime: 60_000,
  });

  const rows = data?.rows ?? [];
  const recentRuns = data?.recentRuns ?? [];
  const allHealthy =
    rows.length > 0 && rows.every((r) => r.health.status === "healthy");

  return (
    <div className="flex flex-col gap-6 p-5 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-2xl tracking-tight">Deployments</h1>
          {data && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium text-sm",
                allHealthy
                  ? "bg-success/10 text-success"
                  : "bg-warning/10 text-warning"
              )}
            >
              <Radio className="size-3.5 animate-pulse" />
              {allHealthy ? "All healthy" : "Issues detected"}
            </span>
          )}
        </div>
        {data && <DataSources sources={data.sources} />}
      </div>

      {/* Environment Matrix */}
      <Card>
        <CardHeader className="px-5 py-3">
          <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Environment Matrix
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="animate-pulse space-y-px px-5 pb-4">
              <div className="h-12 rounded bg-muted" />
              <div className="h-12 rounded bg-muted" />
              <div className="h-12 rounded bg-muted" />
            </div>
          ) : rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Branch</TableHead>
                  <TableHead className="w-14 text-center">CI</TableHead>
                  <TableHead className="w-14 text-center">Deploy</TableHead>
                  <TableHead className="w-14 text-center">Health</TableHead>
                  <TableHead>Env</TableHead>
                  <TableHead>Commit</TableHead>
                  <TableHead className="text-right">URL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.branch}>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 font-mono text-sm">
                        <GitBranch className="size-3.5 text-muted-foreground" />
                        {row.branch}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {row.ci.url ? (
                        <a
                          href={row.ci.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex"
                        >
                          <CiIcon status={row.ci.status} />
                        </a>
                      ) : (
                        <CiIcon status={row.ci.status} />
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <DeployIcon status={row.deploy.status as DeployStatus} />
                    </TableCell>
                    <TableCell className="text-center">
                      <HealthIcon
                        status={row.health.status}
                        latencyMs={row.health.latencyMs}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge
                        intent={
                          row.environment === "production"
                            ? "default"
                            : "secondary"
                        }
                        size="sm"
                      >
                        {row.environment}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.commit ? (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="text-muted-foreground text-xs">
                              <span className="font-mono">
                                {row.commit.sha.slice(0, 7)}
                              </span>{" "}
                              {row.commit.message.slice(0, 40)}
                              {row.commit.message.length > 40 ? "..." : ""}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-80">
                            <p className="font-mono text-xs">
                              {row.commit.sha}
                            </p>
                            <p>{row.commit.message}</p>
                            <p className="text-muted-foreground">
                              {row.commit.author} ·{" "}
                              {timeAgo(row.commit.timestamp)} ago
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.url ? (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary text-xs hover:underline"
                        >
                          <ExternalLink className="size-3" />
                          Visit
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-5 py-6 text-center text-muted-foreground text-sm">
              No deployment data available. Configure GitHub App credentials to
              enable.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recent Workflow Runs */}
      <Card>
        <CardHeader className="px-5 py-3">
          <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Recent Runs
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="animate-pulse space-y-px px-5 pb-4">
              <div className="h-8 rounded bg-muted" />
              <div className="h-8 rounded bg-muted" />
              <div className="h-8 rounded bg-muted" />
            </div>
          ) : recentRuns.length > 0 ? (
            <div className="divide-y divide-border">
              {recentRuns.map((run) => (
                <a
                  key={run.id}
                  href={run.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-5 py-2 hover:bg-muted/50"
                >
                  <RunStatusIcon
                    status={run.status}
                    conclusion={run.conclusion}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {run.commitMessage || run.name}
                  </span>
                  <Badge
                    intent="secondary"
                    size="sm"
                    className="shrink-0 font-mono"
                  >
                    {branchShort(run.headBranch)}
                  </Badge>
                  <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                    {timeAgo(run.createdAt)}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="px-5 py-4 text-center text-muted-foreground text-sm">
              No recent workflow runs
            </p>
          )}
        </CardContent>
      </Card>

      {/* Footer — last refresh */}
      {data && (
        <p className="text-center text-muted-foreground text-xs">
          Last updated {timeAgo(data.fetchedAt)} ago · Refreshes every 10s
        </p>
      )}
    </div>
  );
}
