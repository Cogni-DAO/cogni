// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

"use client";

import type { ReactElement } from "react";
import { useState } from "react";
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
} from "@/components";
import { Progress } from "@/components/kit/feedback/Progress";
import type { StreamEvent } from "@/features/node-stream";
import { useNodeStream } from "@/features/node-stream";
import { cn } from "@/shared/util/cn";

type HealthStatus = "healthy" | "degraded" | "down" | "unknown" | "no_data";
type Environment = "local" | "preview" | "production";

interface ServiceStatus {
  status: HealthStatus;
  label?: string;
}

interface ServiceRow {
  name: string;
  envStatus: Record<Environment, ServiceStatus>;
  hasLiveData: boolean;
}

interface DrillDownData {
  heapUsedMb: number;
  rssMb: number;
  uptimeSeconds: number;
  eventLoopDelayMs: number;
  environment: string;
}

const ENVIRONMENTS: { key: Environment; label: string }[] = [
  { key: "local", label: "Local" },
  { key: "preview", label: "Preview" },
  { key: "production", label: "Production" },
];

const NO_DATA: ServiceStatus = { status: "no_data" };

interface StreamSource {
  name: string;
  domain: string;
  maturity: number;
  hasAdapter: boolean;
  hasTemporal: boolean;
  hasRedis: boolean;
  hasSSE: boolean;
  hasUI: boolean;
  hasAgentRead: boolean;
  hasAgentMonitor: boolean;
  hasTriggers: boolean;
}

const STREAM_SOURCES: StreamSource[] = [
  {
    name: "GitHub (poll)",
    domain: "vcs",
    maturity: 20,
    hasAdapter: true,
    hasTemporal: true,
    hasRedis: false,
    hasSSE: false,
    hasUI: false,
    hasAgentRead: false,
    hasAgentMonitor: false,
    hasTriggers: false,
  },
  {
    name: "GitHub (webhook)",
    domain: "vcs",
    maturity: 50,
    hasAdapter: true,
    hasTemporal: false,
    hasRedis: true,
    hasSSE: true,
    hasUI: true,
    hasAgentRead: false,
    hasAgentMonitor: false,
    hasTriggers: false,
  },
  {
    name: "Alchemy",
    domain: "on-chain",
    maturity: 10,
    hasAdapter: true,
    hasTemporal: false,
    hasRedis: false,
    hasSSE: false,
    hasUI: false,
    hasAgentRead: false,
    hasAgentMonitor: false,
    hasTriggers: false,
  },
  {
    name: "Polymarket",
    domain: "prediction-market",
    maturity: 10,
    hasAdapter: true,
    hasTemporal: false,
    hasRedis: false,
    hasSSE: false,
    hasUI: false,
    hasAgentRead: false,
    hasAgentMonitor: false,
    hasTriggers: false,
  },
  {
    name: "Kalshi",
    domain: "prediction-market",
    maturity: 10,
    hasAdapter: true,
    hasTemporal: false,
    hasRedis: false,
    hasSSE: false,
    hasUI: false,
    hasAgentRead: false,
    hasAgentMonitor: false,
    hasTriggers: false,
  },
  {
    name: "Grafana/Mimir",
    domain: "observability",
    maturity: 10,
    hasAdapter: true,
    hasTemporal: false,
    hasRedis: false,
    hasSSE: false,
    hasUI: false,
    hasAgentRead: false,
    hasAgentMonitor: false,
    hasTriggers: false,
  },
  {
    name: "Cross-node health",
    domain: "operations",
    maturity: 0,
    hasAdapter: false,
    hasTemporal: false,
    hasRedis: false,
    hasSSE: false,
    hasUI: false,
    hasAgentRead: false,
    hasAgentMonitor: false,
    hasTriggers: false,
  },
  {
    name: "Discord",
    domain: "community",
    maturity: 0,
    hasAdapter: false,
    hasTemporal: false,
    hasRedis: false,
    hasSSE: false,
    hasUI: false,
    hasAgentRead: false,
    hasAgentMonitor: false,
    hasTriggers: false,
  },
  {
    name: "PostHog",
    domain: "analytics",
    maturity: 0,
    hasAdapter: false,
    hasTemporal: false,
    hasRedis: false,
    hasSSE: false,
    hasUI: false,
    hasAgentRead: false,
    hasAgentMonitor: false,
    hasTriggers: false,
  },
];

function statusDotColor(status: HealthStatus): string {
  switch (status) {
    case "healthy":
      return "bg-success";
    case "degraded":
      return "bg-warning";
    case "down":
      return "bg-destructive";
    case "unknown":
      return "bg-muted-foreground/40";
    case "no_data":
      return "bg-muted-foreground/20";
  }
}

function statusLabel(s: ServiceStatus): string {
  if (s.label) return s.label;
  switch (s.status) {
    case "healthy":
      return "healthy";
    case "degraded":
      return "degraded";
    case "down":
      return "down";
    case "unknown":
      return "unknown";
    case "no_data":
      return "\u2014";
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function heapPercent(heapMb: number): number {
  return Math.min(100, Math.round((heapMb / 512) * 100));
}

function elColor(elMs: number): string {
  if (elMs < 50) return "text-success";
  if (elMs < 100) return "text-warning";
  return "text-destructive";
}

function maturityColor(pct: number): string {
  if (pct >= 70) return "bg-success";
  if (pct > 0) return "bg-warning";
  return "bg-muted-foreground/20";
}

function StatusCell({ s }: { s: ServiceStatus }): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "h-2.5 w-2.5 shrink-0 rounded-full",
          statusDotColor(s.status)
        )}
      />
      <span
        className={cn(
          "text-xs",
          s.status === "no_data"
            ? "text-muted-foreground/50"
            : "text-muted-foreground"
        )}
      >
        {statusLabel(s)}
      </span>
    </div>
  );
}

function DrillDown({ data }: { data: DrillDownData }): ReactElement {
  const hp = heapPercent(data.heapUsedMb);
  return (
    <div className="space-y-2.5 py-2 pl-4 text-sm">
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-muted-foreground text-xs">
          Heap
        </span>
        <div className="flex-1">
          <Progress value={hp} className="h-2" />
        </div>
        <span className="w-28 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
          {data.heapUsedMb}MB / 512MB
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-muted-foreground text-xs">RSS</span>
        <div className="flex-1">
          <Progress
            value={Math.min(100, Math.round((data.rssMb / 1024) * 100))}
            className="h-2"
          />
        </div>
        <span className="w-28 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
          {data.rssMb}MB
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-muted-foreground text-xs">EL</span>
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            elColor(data.eventLoopDelayMs)
          )}
        >
          {data.eventLoopDelayMs}ms
        </span>
        <span className="text-muted-foreground/60 text-xs">(p99)</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-12 shrink-0 text-muted-foreground text-xs">Up</span>
        <span className="font-mono text-muted-foreground text-xs tabular-nums">
          {formatUptime(data.uptimeSeconds)}
        </span>
      </div>
    </div>
  );
}

const PIPELINE_STAGES = [
  "Adapter",
  "Temporal",
  "Redis",
  "SSE",
  "UI",
  "Agent Read",
  "Monitor",
  "Triggers",
] as const;

function DataStreamScorecard(): ReactElement {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
        Data Streams Pipeline
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-36">Source</TableHead>
            <TableHead className="w-20">Domain</TableHead>
            {PIPELINE_STAGES.map((stage) => (
              <TableHead key={stage} className="w-16 text-center">
                {stage}
              </TableHead>
            ))}
            <TableHead className="w-12 text-right">Ready</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {STREAM_SOURCES.map((src) => {
            const stages = [
              src.hasAdapter,
              src.hasTemporal,
              src.hasRedis,
              src.hasSSE,
              src.hasUI,
              src.hasAgentRead,
              src.hasAgentMonitor,
              src.hasTriggers,
            ];
            return (
              <TableRow key={src.name}>
                <TableCell className="py-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        maturityColor(src.maturity)
                      )}
                    />
                    <span className="truncate text-xs">{src.name}</span>
                  </div>
                </TableCell>
                <TableCell className="py-1.5 text-muted-foreground text-xs">
                  {src.domain}
                </TableCell>
                {stages.map((done, i) => (
                  <TableCell
                    key={PIPELINE_STAGES[i]}
                    className="py-1.5 text-center"
                  >
                    <span
                      className={cn(
                        "text-xs",
                        done ? "text-success" : "text-muted-foreground/30"
                      )}
                    >
                      {done ? "\u2713" : "\u2715"}
                    </span>
                  </TableCell>
                ))}
                <TableCell className="py-1.5 text-right font-mono text-muted-foreground text-xs tabular-nums">
                  {src.maturity}%
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Map VcsActivityEvent fields to a human-readable activity label. */
function vcsActivityLabel(eventType: string, action: string): string {
  switch (eventType) {
    case "pull_request":
      if (action === "merged") return "PR merged";
      if (action === "opened") return "PR opened";
      if (action === "closed") return "PR closed";
      return `PR ${action}`;
    case "push":
      return "Push";
    case "pull_request_review":
      return "Review";
    case "issues":
      if (action === "opened") return "Issue opened";
      if (action === "closed") return "Issue closed";
      return `Issue ${action}`;
    case "issue_comment":
      return "Comment";
    default:
      return eventType;
  }
}

/** Map action to a Badge intent for state display. */
function vcsStateBadgeIntent(
  action: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (action) {
    case "merged":
    case "submitted":
    case "approved":
      return "default";
    case "opened":
      return "secondary";
    case "closed":
      return "destructive";
    default:
      return "outline";
  }
}

/** Format an ISO timestamp as a relative time string (e.g. "2m ago"). */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Derive a short ref string for a VCS event (PR number, branch, or title). */
function vcsRef(event: StreamEvent): string {
  const prNumber = event.prNumber as number | null;
  if (prNumber) return `#${prNumber}`;
  const title = event.title as string | undefined;
  if (title) return title.length > 30 ? `${title.slice(0, 27)}...` : title;
  return "\u2014";
}

function GitActivityFeed({
  events,
}: {
  events: readonly StreamEvent[];
}): ReactElement {
  const vcsEvents = events
    .filter((e) => e.type === "vcs_activity")
    .slice(-8)
    .reverse();

  if (vcsEvents.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
          Git Activity
        </h3>
        <p className="py-3 text-center text-muted-foreground/60 text-xs">
          No git activity yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
        Git Activity
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Activity</TableHead>
            <TableHead className="w-28">Ref</TableHead>
            <TableHead className="w-24">Actor</TableHead>
            <TableHead className="w-20">State</TableHead>
            <TableHead className="w-16 text-right">Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vcsEvents.map((ev, i) => {
            const eventType = String(ev.eventType ?? "");
            const action = String(ev.action ?? "");
            const actor = String(ev.actor ?? "\u2014");
            return (
              <TableRow key={`${ev.timestamp}-${i}`}>
                <TableCell className="py-1.5 text-xs">
                  {vcsActivityLabel(eventType, action)}
                </TableCell>
                <TableCell className="py-1.5 font-mono text-xs">
                  {vcsRef(ev)}
                </TableCell>
                <TableCell className="py-1.5 text-muted-foreground text-xs">
                  {actor}
                </TableCell>
                <TableCell className="py-1.5">
                  {eventType !== "push" ? (
                    <Badge intent={vcsStateBadgeIntent(action)} size="sm">
                      {action}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground/50 text-xs">
                      {"\u2014"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="py-1.5 text-right text-muted-foreground text-xs tabular-nums">
                  {relativeTime(ev.timestamp)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function InfraOverview(): ReactElement {
  const { latest, events, status: connectionStatus } = useNodeStream();
  const [expanded, setExpanded] = useState<string | null>(null);

  const ph = latest.get("process_health");

  const operatorLocal: ServiceStatus = ph
    ? { status: "healthy", label: "healthy" }
    : connectionStatus === "connecting"
      ? { status: "unknown", label: "connecting\u2026" }
      : { status: "unknown", label: "no stream" };

  const operatorDrill: DrillDownData | null = ph
    ? {
        heapUsedMb: (ph.heapUsedMb as number) ?? 0,
        rssMb: (ph.rssMb as number) ?? 0,
        uptimeSeconds: (ph.uptimeSeconds as number) ?? 0,
        eventLoopDelayMs: (ph.eventLoopDelayMs as number) ?? 0,
        environment: String(ph.environment ?? "local"),
      }
    : null;

  const services: ServiceRow[] = [
    {
      name: "Operator",
      envStatus: {
        local: operatorLocal,
        preview: NO_DATA,
        production: NO_DATA,
      },
      hasLiveData: !!ph,
    },
    {
      name: "Poly",
      envStatus: { local: NO_DATA, preview: NO_DATA, production: NO_DATA },
      hasLiveData: false,
    },
    {
      name: "Resy",
      envStatus: { local: NO_DATA, preview: NO_DATA, production: NO_DATA },
      hasLiveData: false,
    },
    {
      name: "Redis",
      envStatus: { local: NO_DATA, preview: NO_DATA, production: NO_DATA },
      hasLiveData: false,
    },
    {
      name: "Postgres",
      envStatus: { local: NO_DATA, preview: NO_DATA, production: NO_DATA },
      hasLiveData: false,
    },
    {
      name: "Temporal",
      envStatus: { local: NO_DATA, preview: NO_DATA, production: NO_DATA },
      hasLiveData: false,
    },
  ];

  return (
    <Card>
      <CardHeader className="px-5 py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Infrastructure Overview
          </CardTitle>
          <ConnectionBadge status={connectionStatus} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5 px-5 pt-0 pb-5">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Service</TableHead>
              {ENVIRONMENTS.map((env) => (
                <TableHead key={env.key}>{env.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.map((svc) => {
              const isExpanded = expanded === svc.name;
              const canExpand = svc.hasLiveData;
              return (
                <TableRow
                  key={svc.name}
                  className={cn(
                    canExpand && "cursor-pointer hover:bg-muted/50"
                  )}
                  onClick={() => {
                    if (canExpand) setExpanded(isExpanded ? null : svc.name);
                  }}
                >
                  <TableCell className="py-2">
                    <div className="flex items-center gap-1.5">
                      {canExpand && (
                        <span
                          className={cn(
                            "text-muted-foreground text-xs transition-transform",
                            isExpanded && "rotate-90"
                          )}
                        >
                          &#9654;
                        </span>
                      )}
                      <span
                        className={cn(
                          "font-medium text-sm",
                          !svc.hasLiveData && "text-muted-foreground"
                        )}
                      >
                        {svc.name}
                      </span>
                    </div>
                  </TableCell>
                  {ENVIRONMENTS.map((env) => (
                    <TableCell key={env.key} className="py-2">
                      <StatusCell s={svc.envStatus[env.key]} />
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {expanded === "Operator" && operatorDrill && (
          <div className="rounded-lg border bg-muted/30 px-4 py-2">
            <div className="mb-2 flex items-center gap-2">
              <span className="font-medium text-sm">Operator</span>
              <Badge intent="default" size="sm">
                {operatorDrill.environment}
              </Badge>
            </div>
            <DrillDown data={operatorDrill} />
          </div>
        )}

        <GitActivityFeed events={events} />

        <DataStreamScorecard />
      </CardContent>
    </Card>
  );
}

function ConnectionBadge({ status }: { status: string }): ReactElement {
  const isConnected = status === "open";
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isConnected ? "bg-success" : "animate-pulse bg-muted-foreground/40"
        )}
      />
      <span className="text-muted-foreground text-xs uppercase tracking-wider">
        {isConnected ? "Live" : status}
      </span>
    </div>
  );
}
