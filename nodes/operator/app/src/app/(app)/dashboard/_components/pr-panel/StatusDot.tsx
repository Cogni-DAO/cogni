// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/pr-panel/StatusDot`
 * Purpose: Colored status dot keyed to the PR panel UI-status enum.
 * Scope: Presentational.
 * Invariants: Semantic tokens only.
 * Side-effects: none
 * Links: [group-checks](./group-checks.ts)
 * @public
 */

import type { ReactElement } from "react";

import { cn } from "@/shared/util/cn";
import type { UiCheckStatus } from "./group-checks";

const STATUS_CLASS: Record<UiCheckStatus, string> = {
  passing: "bg-success",
  running: "bg-info animate-pulse",
  failed: "bg-destructive",
  pending: "bg-muted-foreground/40",
};

export function StatusDot({
  status,
  className,
}: {
  status: UiCheckStatus;
  className?: string;
}): ReactElement {
  return (
    <span
      role="img"
      aria-label={status}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        STATUS_CLASS[status],
        className
      )}
    />
  );
}
