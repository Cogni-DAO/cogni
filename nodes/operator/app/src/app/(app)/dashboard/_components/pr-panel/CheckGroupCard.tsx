// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/pr-panel/CheckGroupCard`
 * Purpose: Grouped card listing ordered check pills for a presentation bucket.
 * Scope: Presentational.
 * Invariants: Bucket status from `group-checks` rollup — no recomputation here.
 * Side-effects: none
 * Links: [CheckPill](./CheckPill.tsx), [group-checks](./group-checks.ts)
 * @public
 */

import type { ReactElement } from "react";

import { Badge } from "@/components";
import { CheckPill } from "./CheckPill";
import type { CheckGroup, UiCheckStatus } from "./group-checks";

const STATUS_LABEL: Record<UiCheckStatus, string> = {
  passing: "Passing",
  running: "In Progress",
  failed: "Failed",
  pending: "Pending",
};

function statusIntent(
  status: UiCheckStatus
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed") return "destructive";
  if (status === "running") return "default";
  if (status === "passing") return "secondary";
  return "outline";
}

export function CheckGroupCard({ group }: { group: CheckGroup }): ReactElement {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-semibold text-sm">{group.title}</h4>
        <Badge intent={statusIntent(group.status)} size="sm">
          {STATUS_LABEL[group.status]}
        </Badge>
      </div>
      {group.checks.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {group.checks.map((check) => (
            <CheckPill key={check.name} check={check} />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">No checks yet.</p>
      )}
    </div>
  );
}
