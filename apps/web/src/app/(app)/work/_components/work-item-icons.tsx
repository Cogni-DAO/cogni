// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

"use client";

import {
  Ban,
  BookOpen,
  Bug,
  CheckCircle,
  CheckSquare,
  CircleDashed,
  ClipboardCheck,
  Code,
  CornerDownRight,
  FlaskConical,
  GitMerge,
  Pencil,
  Search,
  XCircle,
} from "lucide-react";
import type { ReactElement } from "react";

import { cn } from "@/shared/util/cn";

// --- Type icons ---

const TYPE_ICON_MAP: Record<string, { icon: typeof Bug; label: string }> = {
  task: { icon: CheckSquare, label: "Task" },
  bug: { icon: Bug, label: "Bug" },
  story: { icon: BookOpen, label: "Story" },
  spike: { icon: FlaskConical, label: "Spike" },
  subtask: { icon: CornerDownRight, label: "Subtask" },
};

export function TypeIcon({
  type,
  className,
}: {
  readonly type: string;
  readonly className?: string;
}): ReactElement {
  const entry = TYPE_ICON_MAP[type];
  if (!entry) return <span className={cn("text-xs", className)}>{type}</span>;
  const Icon = entry.icon;
  return (
    <Icon
      className={cn("size-4 text-muted-foreground", className)}
      aria-label={entry.label}
    />
  );
}

// --- Status icons ---

const STATUS_ICON_MAP: Record<
  string,
  { icon: typeof Bug; colorClass: string; label: string }
> = {
  needs_triage: {
    icon: CircleDashed,
    colorClass: "text-muted-foreground",
    label: "Needs triage",
  },
  needs_research: {
    icon: Search,
    colorClass: "text-amber-500",
    label: "Needs research",
  },
  needs_design: {
    icon: Pencil,
    colorClass: "text-amber-500",
    label: "Needs design",
  },
  needs_implement: {
    icon: Code,
    colorClass: "text-blue-500",
    label: "Needs implement",
  },
  needs_closeout: {
    icon: ClipboardCheck,
    colorClass: "text-blue-500",
    label: "Needs closeout",
  },
  needs_merge: {
    icon: GitMerge,
    colorClass: "text-green-500",
    label: "Needs merge",
  },
  done: { icon: CheckCircle, colorClass: "text-green-500", label: "Done" },
  blocked: { icon: Ban, colorClass: "text-red-500", label: "Blocked" },
  cancelled: {
    icon: XCircle,
    colorClass: "text-muted-foreground",
    label: "Cancelled",
  },
};

export function StatusIcon({
  status,
  className,
}: {
  readonly status: string;
  readonly className?: string;
}): ReactElement {
  const entry = STATUS_ICON_MAP[status];
  if (!entry) return <span className={cn("text-xs", className)}>{status}</span>;
  const Icon = entry.icon;
  return (
    <Icon
      className={cn("size-4", entry.colorClass, className)}
      aria-label={entry.label}
    />
  );
}

/** Status text with tinted background pill. */
export function StatusPill({
  status,
  className,
}: {
  readonly status: string;
  readonly className?: string;
}): ReactElement {
  const entry = STATUS_ICON_MAP[status];
  const Icon = entry?.icon;
  const colorClass = entry?.colorClass ?? "text-muted-foreground";
  const label = status.replace("needs_", "").replaceAll("_", " ");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium text-xs capitalize",
        colorClass,
        className
      )}
    >
      {Icon && <Icon className="size-3.5" />}
      {label}
    </span>
  );
}
