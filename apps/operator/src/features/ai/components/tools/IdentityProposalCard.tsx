"use client";

/**
 * Module: `@features/ai/components/tools/IdentityProposalCard`
 * Purpose: Renders a node identity proposal inline in the chat thread.
 * Scope: Display-only tool renderer for `core__propose_node_identity`.
 *   Shows proposed name, icon, hue, mission, and DAO token details.
 *   User confirms or requests edits via chat message.
 * Invariants:
 *   - THREAD_REPLAY_SAFE: renders as static summary if confirmation message follows
 *   - UI_COMPONENT_PIPELINE: uses kit components only
 * Side-effects: none
 * Links: work/items/task.0260.node-creation-chat-orchestration.md
 */

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import type { ProposeNodeIdentityInput } from "@cogni/ai-tools";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  PaletteIcon,
  SparklesIcon,
} from "lucide-react";
import { Badge } from "@/components/kit/data-display/Badge";

export const IdentityProposalCard: ToolCallMessagePartComponent<
  ProposeNodeIdentityInput
> = ({ args, result }) => {
  const isConfirmed = result !== undefined;

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-border border-b bg-muted/30 px-4 py-2.5">
        <SparklesIcon className="size-4 text-primary" />
        <span className="font-semibold text-foreground text-sm">
          Node Identity Proposal
        </span>
        {isConfirmed && (
          <Badge intent="default" size="sm">
            <CheckCircle2Icon className="mr-1 size-3" />
            Confirmed
          </Badge>
        )}
      </div>

      {/* Body */}
      <div className="space-y-3 px-4 py-3">
        {/* Name + Mission row */}
        <div className="flex items-baseline gap-3">
          <span className="font-bold text-foreground text-lg tracking-tight">
            cogni/
            <span style={{ color: `hsl(${args.hue ?? 217}, 65%, 50%)` }}>
              {args.name}
            </span>
          </span>
        </div>
        <p className="text-muted-foreground text-sm">{args.mission}</p>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
          <div>
            <span className="text-muted-foreground">Icon</span>
            <p className="font-medium text-foreground">{args.icon}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Theme</span>
            <div className="flex items-center gap-1.5">
              <div
                className="size-4 rounded-full border border-border"
                style={{
                  backgroundColor: `hsl(${args.hue ?? 217}, 65%, 50%)`,
                }}
              />
              <PaletteIcon className="size-3 text-muted-foreground" />
              <span className="font-medium text-foreground">
                {args.hue ?? 217}°
              </span>
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">Token</span>
            <p className="font-medium text-foreground">{args.tokenName}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Symbol</span>
            <p className="font-medium text-foreground">{args.tokenSymbol}</p>
          </div>
        </div>

        {/* Mutability warning */}
        <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-muted-foreground text-xs">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>
            Token name &amp; symbol can be changed later via governance.{" "}
            <strong className="text-foreground">
              All other fields are permanent.
            </strong>
          </span>
        </div>
      </div>

      {/* Footer */}
      {!isConfirmed && (
        <div className="border-border border-t bg-muted/20 px-4 py-2.5">
          <p className="text-muted-foreground text-xs">
            Reply to confirm this identity or request changes.
          </p>
        </div>
      )}
    </div>
  );
};
