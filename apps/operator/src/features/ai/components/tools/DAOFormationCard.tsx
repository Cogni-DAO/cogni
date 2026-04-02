"use client";

/**
 * Module: `@features/ai/components/tools/DAOFormationCard`
 * Purpose: Renders inline DAO formation card with wallet signing in the chat thread.
 * Scope: Display-only tool renderer for `core__request_dao_formation`.
 *   P0: shows formation params and instructs user to sign. The actual wallet
 *   integration (useDAOFormation hook) is wired in P1.
 *   P0 renders a clear call-to-action for the user to complete formation.
 * Invariants:
 *   - FORMATION_LOGIC_UNCHANGED: does not modify formation.reducer.ts or txBuilders.ts
 *   - TOOL_RENDERER_IDEMPOTENT: safe to re-render (no side effects on mount)
 *   - THREAD_REPLAY_SAFE: shows completed state if result is present
 * Side-effects: none (P0); wallet signing in P1
 * Links: work/items/task.0260.node-creation-chat-orchestration.md
 */

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import type { RequestDaoFormationInput } from "@cogni/ai-tools";
import {
  CheckCircle2Icon,
  Loader2Icon,
  ShieldIcon,
  WalletIcon,
} from "lucide-react";
import { Badge } from "@/components/kit/data-display/Badge";

export const DAOFormationCard: ToolCallMessagePartComponent<
  RequestDaoFormationInput
> = ({ args, result, status }) => {
  const isComplete = result !== undefined;
  const isRunning = status?.type === "running";

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-border border-b bg-muted/30 px-4 py-2.5">
        <ShieldIcon className="size-4 text-primary" />
        <span className="font-semibold text-foreground text-sm">
          DAO Formation
        </span>
        {isComplete ? (
          <Badge intent="default" size="sm">
            <CheckCircle2Icon className="mr-1 size-3" />
            Created
          </Badge>
        ) : isRunning ? (
          <Badge intent="secondary" size="sm">
            <Loader2Icon className="mr-1 size-3 animate-spin" />
            Waiting
          </Badge>
        ) : null}
      </div>

      {/* Body */}
      <div className="space-y-3 px-4 py-3">
        {/* Token info */}
        <div className="flex items-center gap-4">
          <div className="rounded-lg bg-primary/10 p-2.5">
            <WalletIcon className="size-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground">{args.tokenName}</p>
            <p className="text-muted-foreground text-sm">{args.tokenSymbol}</p>
          </div>
        </div>

        {isComplete ? (
          /* Completed state */
          <div className="rounded-lg bg-success/10 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <CheckCircle2Icon className="size-4 text-success" />
              <span className="font-medium text-foreground text-sm">
                DAO deployed successfully
              </span>
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              Formation result received. Proceeding with node scaffolding.
            </p>
          </div>
        ) : (
          /* Awaiting wallet action */
          <>
            {/* Steps */}
            <div className="space-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <div className="flex size-5 items-center justify-center rounded-full bg-primary/20 font-bold text-primary text-xs">
                  1
                </div>
                <span className="text-foreground">
                  Create DAO + governance token
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex size-5 items-center justify-center rounded-full bg-muted font-bold text-muted-foreground text-xs">
                  2
                </div>
                <span className="text-muted-foreground">
                  Deploy CogniSignal contract
                </span>
              </div>
            </div>

            {/* TODO P1: inline wallet connect + sign buttons here */}
            {/* eslint-disable-next-line ui-governance/token-classname-patterns -- border-dashed is a style modifier, not a color token */}
            <div className="rounded-md border border-primary/30 border-dashed bg-primary/5 px-3 py-2.5 text-center">
              <p className="font-medium text-primary text-sm">
                Connect wallet &amp; sign 2 transactions
              </p>
              <p className="mt-0.5 text-muted-foreground text-xs">
                Inline signing coming soon — complete via /setup/dao for now
              </p>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      {!isComplete && (
        <div className="border-border border-t bg-muted/20 px-4 py-2.5">
          <p className="text-muted-foreground text-xs">
            After signing, paste the repo-spec YAML to continue.
          </p>
        </div>
      )}
    </div>
  );
};
