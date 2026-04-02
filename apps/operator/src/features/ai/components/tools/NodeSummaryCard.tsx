"use client";

/**
 * Module: `@features/ai/components/tools/NodeSummaryCard`
 * Purpose: Renders a completed node creation summary inline in the chat thread.
 * Scope: Display-only tool renderer for `core__present_node_summary`.
 *   Shows final status: name, mission, port, PR link, DNS, DAO address.
 * Invariants:
 *   - THREAD_REPLAY_SAFE: always renders the same (pure display)
 *   - UI_COMPONENT_PIPELINE: uses kit components only
 * Side-effects: none
 * Links: work/items/task.0260.node-creation-chat-orchestration.md
 */

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import type { PresentNodeSummaryInput } from "@cogni/ai-tools";
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  GlobeIcon,
  ServerIcon,
} from "lucide-react";
import { Badge } from "@/components/kit/data-display/Badge";

export const NodeSummaryCard: ToolCallMessagePartComponent<
  PresentNodeSummaryInput
> = ({ args }) => {
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-success/30 bg-card shadow-sm">
      {/* Header — success state */}
      <div className="flex items-center gap-2 border-success/20 border-b bg-success/5 px-4 py-3">
        <CheckCircle2Icon className="size-5 text-success" />
        <span className="font-semibold text-foreground">
          Node Created Successfully
        </span>
        <Badge intent="default" size="sm">
          Live
        </Badge>
      </div>

      {/* Body */}
      <div className="space-y-3 px-4 py-3">
        {/* Name + mission */}
        <div>
          <p className="font-bold text-foreground text-lg tracking-tight">
            cogni/<span className="text-primary">{args.name}</span>
          </p>
          <p className="text-muted-foreground text-sm">
            {args.displayName} — {args.mission}
          </p>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {/* Dev server */}
          <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
            <ServerIcon className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Dev</span>
            <code className="ml-auto font-mono text-foreground text-xs">
              :{args.port}
            </code>
          </div>

          {/* DNS */}
          {args.dnsRecord && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
              <GlobeIcon className="size-3.5 text-muted-foreground" />
              <span className="truncate font-medium text-foreground text-xs">
                {args.dnsRecord}
              </span>
            </div>
          )}

          {/* PR link */}
          {args.prUrl && (
            <a
              href={args.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="col-span-2 flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 transition-colors hover:bg-primary/10"
            >
              <ExternalLinkIcon className="size-3.5 text-primary" />
              <span className="font-medium text-primary text-sm">
                View Pull Request
              </span>
            </a>
          )}

          {/* DAO address */}
          {args.daoAddress && (
            <div className="col-span-2 rounded-lg bg-muted/40 px-3 py-2">
              <span className="text-muted-foreground text-xs">
                DAO Contract
              </span>
              <p className="font-mono text-foreground text-xs">
                {args.daoAddress}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
