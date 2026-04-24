// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/pr-panel/PrPanelRow`
 * Purpose: Collapsible row rendering a single PR summary with expandable check groups.
 * Scope: Client-side UI state only (expand/collapse). Does not fetch data.
 * Invariants:
 *   - Labels render as outline chips (no per-label hue)
 *   - Status dots use semantic tokens only
 *   - Consumes `PrSummary` + `CiStatusResult` from `@cogni/ai-tools` verbatim
 * Side-effects: none
 * Links: [group-checks](./group-checks.ts), [CheckGroupCard](./CheckGroupCard.tsx)
 * @public
 */

"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
} from "lucide-react";
import Link from "next/link";
import type { ReactElement } from "react";
import { useMemo, useState } from "react";

import { Badge } from "@/components";
import { cn } from "@/shared/util/cn";
import { CheckGroupCard } from "./CheckGroupCard";
import { groupChecks, overallStatus, type UiCheckStatus } from "./group-checks";
import type { PrPanelEntry } from "./pr-panel.types";
import { StatusDot } from "./StatusDot";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.max(1, Math.floor(diff / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusIntent(
  status: UiCheckStatus
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed") return "destructive";
  if (status === "running") return "default";
  if (status === "passing") return "secondary";
  return "outline";
}

function statusLabel(entry: PrPanelEntry, overall: UiCheckStatus): string {
  if (entry.flight?.deployVerified) return "Deploy Verified";
  if (overall === "failed") return "Failed";
  if (overall === "running") return "In Progress";
  if (overall === "passing") return "Passing";
  if (entry.ci.pending) return "Pending";
  return "Queued";
}

export function PrPanelRow({ entry }: { entry: PrPanelEntry }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  const groups = useMemo(() => groupChecks(entry.ci.checks), [entry.ci.checks]);
  const ciGroup = groups.find((g) => g.id === "ci");
  const flightGroup = groups.find((g) => g.id === "flight");

  const overall = overallStatus({
    ci: ciGroup?.status ?? "pending",
    flight: flightGroup?.status,
    deployVerified: entry.flight?.deployVerified ?? false,
  });

  return (
    <div className={cn("border-b last:border-b-0", expanded && "bg-muted/20")}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-muted/30"
      >
        <Chevron className="size-4 shrink-0 text-muted-foreground" />
        <StatusDot status={overall} />
        <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-medium text-sm">
              {entry.pr.title}
            </span>
            <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
              #{entry.pr.number}
            </span>
            {entry.pr.draft && (
              <Badge intent="outline" size="sm">
                draft
              </Badge>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-muted-foreground text-xs">
            <span>{entry.pr.author}</span>
            <span>·</span>
            <span>{timeAgo(entry.pr.updatedAt)}</span>
            <span>·</span>
            <span className="font-mono text-xs">
              {entry.pr.headBranch} → {entry.pr.baseBranch}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {entry.pr.labels.map((label) => (
            <Badge key={label} intent="outline" size="sm">
              {label}
            </Badge>
          ))}
        </div>
        {entry.flight?.deployVerified && (
          <CheckCircle2
            className="size-4 shrink-0 text-success"
            aria-label="Deploy verified"
          />
        )}
        <Badge intent={statusIntent(overall)} size="sm">
          {statusLabel(entry, overall)}
        </Badge>
        <Link
          href={entry.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground"
          aria-label={`Open PR #${entry.pr.number} on GitHub`}
        >
          <ExternalLink className="size-4" />
        </Link>
      </button>
      {expanded && (
        <div className="flex flex-col gap-3 px-5 pb-5">
          {groups.map((group) => (
            <CheckGroupCard key={group.id} group={group} />
          ))}
          {entry.flight && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Flight workflow:</span>
              <Link
                href={entry.flight.workflowUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-info hover:underline"
              >
                {entry.flight.headSha?.slice(0, 7) ?? "dispatched"}
              </Link>
              {entry.flight.deployVerified ? (
                <Badge intent="secondary" size="sm">
                  deploy_verified
                </Badge>
              ) : (
                <Badge intent="outline" size="sm">
                  awaiting verify
                </Badge>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
