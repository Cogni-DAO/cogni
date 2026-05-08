// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/ExecutionActivityCard`
 * Purpose: Unified Polymarket execution surface for the dashboard — two
 * sibling tabs (`Positions`, `Markets`), each with an internal Live/Closed
 * filter. Mirrors the structural symmetry between per-position and
 * per-market-group views.
 * Scope: Client component. Read-only. Live rows sourced from
 * live_positions; closed rows from closed_positions.
 * Invariants:
 *   - LIVE_POSITIONS_ONLY_IN_LIVE_FILTER: the Positions tab renders only
 *     live_positions rows when statusFilter==="live".
 *   - CLOSE_BUTTON_ONLY_ON_LIVE_FILTER: closed filter is read-only
 *     (PositionsTable variant="history").
 *   - NO_STALE_OPEN_ROW_AFTER_CLOSE: recentlyClosedIds suppresses closed
 *     rows until the next live_positions refetch confirms they are gone.
 *     Applies only when statusFilter==="live"; closed rows are sourced
 *     from closed_positions which is unaffected by close-action latency.
 * Side-effects: IO (React Query), clipboard (user-triggered).
 * Links: [fetchExecution](../_api/fetchExecution.ts)
 * @public
 */

"use client";

import type { WalletExecutionMarketGroup } from "@cogni/poly-node-contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import {
  MarketsDeltaDistribution,
  MarketsTable,
  PositionsDeltaDistribution,
  type StatusFilter,
} from "@/app/(app)/_components/markets-table";
import { PositionsTable } from "@/app/(app)/_components/positions-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ToggleGroup,
  ToggleGroupItem,
} from "@/components";
import type { WalletPosition } from "@/features/wallet-analysis";
import type { fetchExecution } from "../_api/fetchExecution";
import {
  postClosePosition,
  postRedeemPosition,
} from "../_api/fetchPositionActions";
import { useDashboardExecution } from "../_hooks/useDashboardExecution";

type ExecutionView = "positions" | "markets";

export function ExecutionActivityCard(): ReactElement {
  const queryClient = useQueryClient();
  const [view, setView] = useState<ExecutionView>("positions");
  const [positionActionError, setPositionActionError] = useState<string | null>(
    null
  );

  // Per-item suppression: ids added on close success, removed when refetch
  // confirms the position is gone from live_positions.
  const [recentlyClosedIds, setRecentlyClosedIds] = useState<
    ReadonlySet<string>
  >(new Set());

  const positionAction = useMutation({
    mutationFn: async (args: {
      kind: "close" | "redeem";
      position: WalletPosition;
    }) => {
      if (args.kind === "close") {
        return postClosePosition(args.position.asset);
      }
      return postRedeemPosition(args.position.conditionId);
    },
    onSuccess: (result, vars) => {
      setPositionActionError(null);
      const shouldSuppress =
        vars.kind === "redeem"
          ? "tx_hash" in result
          : "kind" in result &&
            (result.kind === "order" || result.kind === "classified");
      if (shouldSuppress) {
        setRecentlyClosedIds(
          (prev) => new Set([...prev, vars.position.positionId])
        );
      }
      void queryClient.invalidateQueries({
        queryKey: ["dashboard-wallet-execution"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["dashboard-trading-wallet"],
      });
    },
    onError: (err: unknown) => {
      setPositionActionError(err instanceof Error ? err.message : String(err));
    },
  });

  const pendingActionPositionId =
    positionAction.isPending && positionAction.variables
      ? positionAction.variables.position.positionId
      : null;

  const handlePositionAction = useCallback(
    (position: WalletPosition, action: "close" | "redeem") => {
      positionAction.mutate({ kind: action, position });
    },
    [positionAction]
  );

  const reconcileRecentlyClosed = useCallback(
    (data: Awaited<ReturnType<typeof fetchExecution>>) => {
      const liveIds = new Set(data.live_positions.map((p) => p.positionId));
      setRecentlyClosedIds((prev) => {
        const next = new Set([...prev].filter((id) => liveIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
    },
    []
  );
  const {
    data: executionData,
    isLoading: isExecutionLoading,
    isError: isExecutionError,
  } = useDashboardExecution({ onLiveData: reconcileRecentlyClosed });

  const openPositions = useMemo<WalletPosition[]>(
    () =>
      (executionData?.live_positions ?? [])
        .filter((p) => !recentlyClosedIds.has(p.positionId))
        .map((position) => ({
          ...position,
          ...(position.marketSlug !== null
            ? { marketSlug: position.marketSlug }
            : {}),
          ...(position.eventSlug !== null
            ? { eventSlug: position.eventSlug }
            : {}),
          ...(position.marketUrl !== null
            ? { marketUrl: position.marketUrl }
            : {}),
          ...(position.closedAt !== null
            ? { closedAt: position.closedAt }
            : {}),
        })),
    [executionData?.live_positions, recentlyClosedIds]
  );

  const closedPositions = useMemo<WalletPosition[]>(
    () =>
      (executionData?.closed_positions ?? []).map((position) => ({
        ...position,
        ...(position.marketSlug !== null
          ? { marketSlug: position.marketSlug }
          : {}),
        ...(position.eventSlug !== null
          ? { eventSlug: position.eventSlug }
          : {}),
        ...(position.marketUrl !== null
          ? { marketUrl: position.marketUrl }
          : {}),
        ...(position.closedAt !== null ? { closedAt: position.closedAt } : {}),
      })),
    [executionData?.closed_positions]
  );

  return (
    <Card>
      <CardHeader className="px-5 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              Execution
            </CardTitle>
          </div>

          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(value) => {
              if (value) setView(value as ExecutionView);
            }}
            className="rounded-lg border"
          >
            <ToggleGroupItem value="positions" className="px-3 text-xs">
              Positions
            </ToggleGroupItem>
            <ToggleGroupItem value="markets" className="px-3 text-xs">
              Markets
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {view === "positions" ? (
          <PositionsPanel
            openPositions={openPositions}
            closedPositions={closedPositions}
            groups={executionData?.market_groups ?? []}
            warnings={executionData?.warnings ?? []}
            isLoading={isExecutionLoading}
            isError={isExecutionError}
            onPositionAction={handlePositionAction}
            pendingActionPositionId={pendingActionPositionId}
            positionActionError={positionActionError}
          />
        ) : (
          <MarketGroupsPanel
            groups={executionData?.market_groups ?? []}
            warnings={executionData?.warnings ?? []}
            isLoading={isExecutionLoading}
            isError={isExecutionError}
          />
        )}
      </CardContent>
    </Card>
  );
}

function MarketGroupsPanel({
  groups,
  warnings,
  isLoading,
  isError,
}: {
  groups: readonly WalletExecutionMarketGroup[];
  warnings: readonly { code: string; message: string }[];
  isLoading: boolean;
  isError: boolean;
}): ReactElement {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("live");

  if (isError) {
    return (
      <p className="px-5 py-6 text-center text-muted-foreground text-sm">
        Failed to load market exposure. Try again shortly.
      </p>
    );
  }

  return (
    <div className="space-y-3 px-5 pb-4">
      <div className="space-y-2">
        <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
          Markets
        </h3>
        {warnings.some(
          (warning) => warning.code === "market_exposure_unavailable"
        ) ? (
          <p className="text-muted-foreground text-xs">
            Copy-target overlays are temporarily unavailable.
          </p>
        ) : null}
        <MarketsDeltaDistribution groups={groups} statusFilter={statusFilter} />
        <MarketsTable
          groups={groups}
          isLoading={isLoading}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />
      </div>
    </div>
  );
}

function PositionsPanel({
  openPositions,
  closedPositions,
  groups,
  warnings,
  isLoading,
  isError,
  onPositionAction,
  pendingActionPositionId,
  positionActionError,
}: {
  openPositions: readonly WalletPosition[];
  closedPositions: readonly WalletPosition[];
  groups: readonly WalletExecutionMarketGroup[];
  warnings: readonly { code: string; message: string }[];
  isLoading: boolean;
  isError: boolean;
  onPositionAction: (
    position: WalletPosition,
    action: "close" | "redeem"
  ) => void;
  pendingActionPositionId: string | null;
  positionActionError: string | null;
}): ReactElement {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("live");

  if (isError) {
    return (
      <p className="px-5 py-6 text-center text-muted-foreground text-sm">
        Failed to load execution data. Try again shortly.
      </p>
    );
  }

  const isLive = statusFilter === "live";
  const positions = isLive ? openPositions : closedPositions;

  return (
    <div className="space-y-3 px-5 pb-4">
      <div className="space-y-2">
        <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
          Positions
        </h3>
        {isLive && warnings.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Some upstream data is temporarily unavailable, so a few rows may
            render with a shorter trace.
          </p>
        ) : null}
        {isLive && positionActionError ? (
          <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-xs">
            {positionActionError}
          </p>
        ) : null}
        <PositionsDeltaDistribution
          positions={positions}
          groups={groups}
          statusFilter={statusFilter}
        />
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={statusFilter}
            onValueChange={(value) => {
              if (value === "live" || value === "closed")
                setStatusFilter(value);
            }}
            disabled={isLoading}
            aria-label="Filter positions by status"
          >
            <ToggleGroupItem value="live" className="gap-1.5">
              <span className="text-xs">Live</span>
              <span className="font-mono text-muted-foreground text-xs tabular-nums">
                ({openPositions.length})
              </span>
            </ToggleGroupItem>
            <ToggleGroupItem value="closed" className="gap-1.5">
              <span className="text-xs">Closed</span>
              <span className="font-mono text-muted-foreground text-xs tabular-nums">
                ({closedPositions.length})
              </span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {isLive ? (
          <PositionsTable
            positions={positions}
            isLoading={isLoading}
            emptyMessage="No open positions."
            onPositionAction={onPositionAction}
            pendingActionPositionId={pendingActionPositionId}
          />
        ) : (
          <PositionsTable
            positions={positions}
            isLoading={isLoading}
            variant="history"
            emptyMessage="No closed positions yet."
          />
        )}
      </div>
    </div>
  );
}
