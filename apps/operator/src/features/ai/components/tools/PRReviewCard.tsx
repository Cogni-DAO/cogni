"use client";

/**
 * Module: `@features/ai/components/tools/PRReviewCard`
 * Purpose: Renders a pull request review card inline in the chat thread.
 * Scope: Display-only tool renderer for `core__present_pr`.
 *   Shows PR title, diff stats, and link. User reviews externally and replies.
 * Invariants:
 *   - THREAD_REPLAY_SAFE: always renders the same (no interactive state)
 *   - UI_COMPONENT_PIPELINE: uses kit components only
 * Side-effects: none
 * Links: work/items/task.0260.node-creation-chat-orchestration.md
 */

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import type { PresentPrInput } from "@cogni/ai-tools";
import {
  ExternalLinkIcon,
  FileDiffIcon,
  GitPullRequestIcon,
  MinusIcon,
  PlusIcon,
} from "lucide-react";

export const PRReviewCard: ToolCallMessagePartComponent<PresentPrInput> = ({
  args,
}) => {
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-border border-b bg-muted/30 px-4 py-2.5">
        <GitPullRequestIcon className="size-4 text-primary" />
        <span className="font-semibold text-foreground text-sm">
          Pull Request
        </span>
      </div>

      {/* Body */}
      <div className="space-y-3 px-4 py-3">
        {/* Title + link */}
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-foreground">{args.title}</p>
          {args.url && (
            <a
              href={args.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLinkIcon className="size-4" />
            </a>
          )}
        </div>

        {/* Summary */}
        <p className="text-muted-foreground text-sm">{args.summary}</p>

        {/* Diff stats */}
        <div className="flex items-center gap-4 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <FileDiffIcon className="size-3.5" />
            <span className="font-medium text-foreground">
              {args.filesChanged}
            </span>{" "}
            files
          </div>
          <div className="flex items-center gap-1 text-success">
            <PlusIcon className="size-3.5" />
            <span className="font-medium">{args.additions}</span>
          </div>
          <div className="flex items-center gap-1 text-destructive">
            <MinusIcon className="size-3.5" />
            <span className="font-medium">{args.deletions}</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-border border-t bg-muted/20 px-4 py-2.5">
        <p className="text-muted-foreground text-xs">
          Review the PR and reply with your approval or feedback.
        </p>
      </div>
    </div>
  );
};
