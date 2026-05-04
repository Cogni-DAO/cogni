// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/ExecutionActivityCard`
 * Purpose: Unified Polymarket execution surface for the dashboard — open
 * positions as the primary view, closed position history one tab away.
 * Scope: Client component. Read-only. Open positions sourced from
 * live_positions; closed history from closed_positions.
 * Invariants:
 *   - LIVE_POSITIONS_ONLY_IN_OPEN_TAB: the Open tab renders only live_positions rows.
 *   - CLOSE_BUTTON_ONLY_ON_OPEN_TAB: History tab is read-only (variant="history").
 *   - NO_STALE_OPEN_ROW_AFTER_CLOSE: recentlyClosedIds suppresses closed rows
 *     until the next live_positions refetch confirms they are gone.
 * Side-effects: IO (React Query), clipboard (user-triggered).
 * Links: [fetchExecution](../_api/fetchExecution.ts)
 * @public
 */

"use client";

import type { WalletExecutionMarketGroup } from "@cogni/poly-node-contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { PositionsTable } from "@/app/(app)/_components/positions-table";
import {
  Button,
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

type ExecutionView = "open" | "markets" | "history";
const MARKET_GROUP_PAGE_SIZE = 10;

export function ExecutionActivityCard(): ReactElement {
  const queryClient = useQueryClient();
  const [view, setView] = useState<ExecutionView>("open");
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
          : "filled_size_usdc" in result &&
            result.status === "filled" &&
            result.filled_size_usdc > 0;
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
            <ToggleGroupItem value="open" className="px-3 text-xs">
              Open
            </ToggleGroupItem>
            <ToggleGroupItem value="markets" className="px-3 text-xs">
              Markets
            </ToggleGroupItem>
            <ToggleGroupItem value="history" className="px-3 text-xs">
              History
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {view === "open" ? (
          <OpenPositionsPanel
            positions={openPositions}
            warnings={executionData?.warnings ?? []}
            isLoading={isExecutionLoading}
            isError={isExecutionError}
            onPositionAction={handlePositionAction}
            pendingActionPositionId={pendingActionPositionId}
            positionActionError={positionActionError}
          />
        ) : view === "markets" ? (
          <MarketGroupsPanel
            groups={executionData?.market_groups ?? []}
            warnings={executionData?.warnings ?? []}
            isLoading={isExecutionLoading}
            isError={isExecutionError}
          />
        ) : (
          <ClosedPositionsPanel
            positions={closedPositions}
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
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.max(
    1,
    Math.ceil(groups.length / MARKET_GROUP_PAGE_SIZE)
  );
  useEffect(() => {
    setPageIndex((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);
  const pageGroups = useMemo(
    () =>
      groups.slice(
        pageIndex * MARKET_GROUP_PAGE_SIZE,
        (pageIndex + 1) * MARKET_GROUP_PAGE_SIZE
      ),
    [groups, pageIndex]
  );
  const pageFrom = pageIndex * MARKET_GROUP_PAGE_SIZE + 1;
  const pageTo = Math.min(
    (pageIndex + 1) * MARKET_GROUP_PAGE_SIZE,
    groups.length
  );

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
        {isLoading ? (
          <p className="rounded border px-4 py-6 text-center text-muted-foreground text-sm">
            Loading market exposure…
          </p>
        ) : groups.length === 0 ? (
          <p className="rounded border px-4 py-6 text-center text-muted-foreground text-sm">
            No open market exposure.
          </p>
        ) : (
          <>
            <div className="overflow-hidden rounded-md border">
              {pageGroups.map((group, index) => (
                <details
                  key={group.groupKey}
                  open={index === 0}
                  className="border-border border-b last:border-b-0"
                >
                  <summary className="cursor-pointer px-4 py-3 hover:bg-muted/40">
                    <div className="grid gap-3 lg:grid-cols-2 lg:items-center">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-sm">
                          {group.eventTitle ??
                            group.eventSlug ??
                            group.lines[0]?.marketTitle ??
                            "Market"}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {group.marketCount} line
                          {group.marketCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                        <MarketStat
                          label="Our value"
                          value={formatUsd(group.ourValueUsdc)}
                        />
                        <MarketStat
                          label="Targets"
                          value={formatUsd(group.targetValueUsdc)}
                        />
                        <MarketStat
                          label="P/L"
                          value={formatSignedUsd(group.pnlUsd)}
                          valueClassName={pnlClass(group.pnlUsd)}
                        />
                        <MarketStat
                          label="Hedges"
                          value={String(group.hedgeCount)}
                        />
                      </div>
                    </div>
                  </summary>
                  <div className="space-y-3 border-border border-t bg-muted/10 px-4 py-3">
                    {group.lines.map((line) => (
                      <div key={line.conditionId} className="space-y-2">
                        <div className="grid gap-2 text-sm lg:grid-cols-2 lg:items-end">
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {line.marketTitle}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              VWAP our {formatPrice(line.ourVwap)} · targets{" "}
                              {formatPrice(line.targetVwap)}
                            </p>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <MarketStat
                              label="Our line"
                              value={formatUsd(line.ourValueUsdc)}
                            />
                            <MarketStat
                              label="Target line"
                              value={formatUsd(line.targetValueUsdc)}
                            />
                            <MarketStat
                              label="Hedges"
                              value={String(line.hedgeCount)}
                            />
                          </div>
                        </div>
                        <div className="divide-y rounded-md border bg-background">
                          {line.positions.map((position) => (
                            <div
                              key={`${position.side}:${position.walletAddress}:${position.tokenId}`}
                              className="grid gap-2 px-3 py-2 text-sm md:grid-cols-5 md:items-center"
                            >
                              <div className="min-w-0 md:col-span-2">
                                <p className="truncate font-medium">
                                  {position.side === "our_wallet"
                                    ? "Our position"
                                    : position.label}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                  {position.outcome}
                                  {position.hedgeRole === "hedge"
                                    ? " · hedge"
                                    : position.hedgeRole === "primary"
                                      ? " · primary"
                                      : ""}
                                </p>
                              </div>
                              <MarketStat
                                label="Value"
                                value={formatUsd(position.currentValueUsdc)}
                              />
                              <MarketStat
                                label="VWAP"
                                value={formatPrice(position.vwap)}
                              />
                              <MarketStat
                                label="Shares"
                                value={formatShares(position.shares)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
            {groups.length > MARKET_GROUP_PAGE_SIZE ? (
              <div className="flex flex-col items-center justify-between gap-2 text-muted-foreground text-sm sm:flex-row">
                <span>
                  {pageFrom} - {pageTo} of {groups.length} markets
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    disabled={pageIndex === 0}
                    onClick={() => setPageIndex((current) => current - 1)}
                  >
                    <ChevronLeft className="size-4" aria-hidden="true" />
                    <span className="sr-only">Previous market page</span>
                  </Button>
                  <span className="px-2 font-mono text-xs tabular-nums">
                    {pageIndex + 1} / {pageCount}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    disabled={pageIndex >= pageCount - 1}
                    onClick={() => setPageIndex((current) => current + 1)}
                  >
                    <ChevronRight className="size-4" aria-hidden="true" />
                    <span className="sr-only">Next market page</span>
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function OpenPositionsPanel({
  positions,
  warnings,
  isLoading,
  isError,
  onPositionAction,
  pendingActionPositionId,
  positionActionError,
}: {
  positions: readonly WalletPosition[];
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
  if (isError) {
    return (
      <p className="px-5 py-6 text-center text-muted-foreground text-sm">
        Failed to load execution data. Try again shortly.
      </p>
    );
  }

  return (
    <div className="space-y-3 px-5 pb-4">
      <div className="space-y-2">
        <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
          Open Positions
        </h3>
        {warnings.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Some upstream data is temporarily unavailable, so a few rows may
            render with a shorter trace.
          </p>
        ) : null}
        {positionActionError ? (
          <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-xs">
            {positionActionError}
          </p>
        ) : null}
        <PositionsTable
          positions={positions}
          isLoading={isLoading}
          emptyMessage="No open positions."
          onPositionAction={onPositionAction}
          pendingActionPositionId={pendingActionPositionId}
        />
      </div>
    </div>
  );
}

function MarketStat({
  label,
  value,
  valueClassName = "",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}): ReactElement {
  return (
    <div className="min-w-0">
      <p className="truncate text-muted-foreground">{label}</p>
      <p className={`truncate font-mono tabular-nums ${valueClassName}`}>
        {value}
      </p>
    </div>
  );
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatSignedUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatUsd(Math.abs(value))}`;
}

function formatPrice(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(3);
}

function formatShares(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function pnlClass(value: number): string {
  return value >= 0 ? "text-success" : "text-destructive";
}

function ClosedPositionsPanel({
  positions,
  isLoading,
  isError,
}: {
  positions: readonly WalletPosition[];
  isLoading: boolean;
  isError: boolean;
}): ReactElement {
  if (isError) {
    return (
      <p className="px-5 py-6 text-center text-muted-foreground text-sm">
        Failed to load position history. Try again shortly.
      </p>
    );
  }

  return (
    <div className="space-y-3 px-5 pb-4">
      <div className="space-y-2">
        <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
          Position History
        </h3>
        <PositionsTable
          positions={positions}
          isLoading={isLoading}
          variant="history"
          emptyMessage="No closed positions yet."
        />
      </div>
    </div>
  );
}
