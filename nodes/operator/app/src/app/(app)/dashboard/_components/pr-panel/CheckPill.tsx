// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/pr-panel/CheckPill`
 * Purpose: Single check rendered as a rounded pill with status dot + name.
 * Scope: Presentational.
 * Invariants: Uses semantic tokens only.
 * Side-effects: none
 * Links: [StatusDot](./StatusDot.tsx)
 * @public
 */

import type { ReactElement } from "react";

import { cn } from "@/shared/util/cn";
import type { UiCheck } from "./group-checks";
import { StatusDot } from "./StatusDot";

const STATUS_RING: Record<UiCheck["status"], string> = {
  passing: "border-success/30 bg-success/5",
  running: "border-info/40 bg-info/5",
  failed: "border-destructive/40 bg-destructive/5",
  pending: "border-border bg-muted/30",
};

export function CheckPill({ check }: { check: UiCheck }): ReactElement {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs",
        STATUS_RING[check.status]
      )}
    >
      <StatusDot status={check.status} />
      <span className="font-medium">{check.name}</span>
    </div>
  );
}
