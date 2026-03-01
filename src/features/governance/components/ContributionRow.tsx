// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/components/ContributionRow`
 * Purpose: Single receipt row within a contributor's expanded detail — source badge, type icon, label.
 * Scope: Governance feature component. Does not perform data fetching or server-side logic.
 * Invariants: Event types map to Lucide icons and display labels.
 * Side-effects: none
 * Links: src/features/governance/types.ts
 * @public
 */

"use client";

import type { LucideIcon } from "lucide-react";
import {
  Eye,
  GitCommit,
  GitPullRequest,
  MessageCircle,
  MessageSquare,
  Pin,
  ThumbsUp,
} from "lucide-react";
import type { ReactElement } from "react";

import type { IngestionReceipt } from "@/features/governance/types";

import { SourceBadge } from "./SourceBadge";

const TYPE_ICONS: Record<string, LucideIcon> = {
  pr_merged: GitPullRequest,
  commit_pushed: GitCommit,
  review_submitted: Eye,
  comment_created: MessageCircle,
  message_sent: MessageSquare,
  reaction_added: ThumbsUp,
};

const TYPE_LABELS: Record<string, string> = {
  pr_merged: "PR",
  commit_pushed: "Commit",
  review_submitted: "Review",
  comment_created: "Comment",
  message_sent: "Message",
  reaction_added: "Reaction",
};

export function ContributionRow({
  receipt,
}: {
  receipt: IngestionReceipt;
}): ReactElement {
  const Icon = TYPE_ICONS[receipt.eventType] ?? Pin;
  const score = receipt.units ? Math.round(Number(receipt.units) / 1000) : null;

  return (
    <div className="flex items-center justify-between rounded bg-secondary/30 px-2 py-1 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <SourceBadge source={receipt.source as "github" | "discord"} />
        <span className="text-muted-foreground text-xs">
          {TYPE_LABELS[receipt.eventType] ?? receipt.eventType}
        </span>
      </div>
      {score != null && (
        <span className="font-mono text-muted-foreground text-xs">{score}</span>
      )}
    </div>
  );
}
