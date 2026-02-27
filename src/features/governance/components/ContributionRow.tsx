// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/governance/components/ContributionRow`
 * Purpose: Single receipt row within a contributor card — source badge, type label.
 * Scope: Governance feature component. Does not perform data fetching or server-side logic.
 * Invariants: Event types map to display labels and emoji icons.
 * Side-effects: none
 * Links: src/features/governance/types.ts
 * @public
 */

"use client";

import type { ReactElement } from "react";

import type { IngestionReceipt } from "@/features/governance/types";

import { SourceBadge } from "./SourceBadge";

const TYPE_ICONS: Record<string, string> = {
  pr_merged: "⬆️",
  commit_pushed: "📝",
  review_submitted: "👁️",
  comment_created: "💬",
  message_sent: "🗨️",
  reaction_added: "👍",
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
  return (
    <div className="flex items-center justify-between rounded bg-secondary/30 px-2 py-1 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-xs">{TYPE_ICONS[receipt.eventType] ?? "📌"}</span>
        <SourceBadge source={receipt.source as "github" | "discord"} />
        <span className="text-muted-foreground text-xs">
          {TYPE_LABELS[receipt.eventType] ?? receipt.eventType}
        </span>
      </div>
    </div>
  );
}
