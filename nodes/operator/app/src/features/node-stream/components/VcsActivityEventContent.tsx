// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/node-stream/components/VcsActivityEventContent`
 * Purpose: Renders VCS activity event details — event type, action, PR number, actor, repo.
 * Scope: Presentational only. Does not fetch data.
 * Invariants:
 *   - PRESENTATIONAL_CARDS: Typed event as props, no hooks
 * Side-effects: none
 * Links: @cogni/node-streams VcsActivityEvent
 * @public
 */

import type { ReactElement } from "react";
import { Badge } from "@/components";

interface VcsActivityData {
  eventType: string;
  action: string;
  prNumber: number | null;
  title: string;
  actor: string;
  repo: string;
}

const ACTION_INTENT: Record<string, "default" | "secondary" | "destructive"> = {
  opened: "default",
  merged: "default",
  closed: "secondary",
  submitted: "default",
  synchronize: "secondary",
  reopened: "default",
};

export function VcsActivityEventContent({
  event,
}: {
  event: VcsActivityData;
}): ReactElement {
  const intent = ACTION_INTENT[event.action] ?? "secondary";
  const label = event.prNumber ? `#${event.prNumber}` : event.eventType;

  return (
    <div className="flex items-center gap-2 text-sm">
      <Badge intent={intent} size="sm">
        {event.action}
      </Badge>
      <span className="font-mono text-muted-foreground text-xs">{label}</span>
      <span className="truncate text-muted-foreground">{event.title}</span>
      <span className="ml-auto shrink-0 text-muted-foreground text-xs">
        {event.actor}
      </span>
    </div>
  );
}
