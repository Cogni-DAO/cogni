// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_components/CopyTargetControlPanel`
 * Purpose: Dashboard-first copy-trading controls for the two curated target
 *          wallets, plus the global wallet-grant policy and wallet quick jump.
 * Scope: Client component. Owns React Query wiring for copy targets and grants;
 *        delegates shared visual controls to kit components.
 * Side-effects: IO (fetch copy targets, mutate target rows, read/write grants).
 * Links: docs/spec/poly-copy-trade-execution.md,
 *        nodes/poly/packages/node-contracts/src/poly.copy-trade.targets.v1.contract.ts
 * @public
 */

"use client";

import type {
  PolyCopyTradeTarget,
  PolyWalletGrantsPutInput,
} from "@cogni/poly-node-contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Radio } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";

import { AddressChip, Button, Card, CardContent } from "@/components";
import { PolicyControls } from "@/components/kit/policy/PolicyControls";
import { WalletQuickJump } from "@/features/wallet-analysis";
import { cn } from "@/shared/util/cn";

import {
  createCopyTarget,
  deleteCopyTarget,
  fetchCopyTargets,
  updateCopyTargetPolicy,
} from "../_api/fetchCopyTargets";
import {
  fetchWalletGrants,
  POLY_WALLET_GRANTS_QUERY_KEY,
  putWalletGrants,
} from "../_api/fetchWalletGrants";

export const COPY_TARGETS_QUERY_KEY = ["dashboard-copy-targets"] as const;

const CURATED_TARGETS = [
  {
    label: "RN1",
    wallet: "0x2005d16a84ceefa912d4e380cd32e7ff827875ea",
  },
  {
    label: "swisstony",
    wallet: "0x204f72f35326db932158cba6adff0b9a1da95e14",
  },
] as const;

export function CopyTargetControlPanel(): ReactElement {
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(true);

  const targetsQuery = useQuery({
    queryKey: COPY_TARGETS_QUERY_KEY,
    queryFn: fetchCopyTargets,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
  const grantsQuery = useQuery({
    queryKey: POLY_WALLET_GRANTS_QUERY_KEY,
    queryFn: fetchWalletGrants,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  const targetsByWallet = useMemo(() => {
    const map = new Map<string, PolyCopyTradeTarget>();
    for (const target of targetsQuery.data?.targets ?? []) {
      map.set(target.target_wallet.toLowerCase(), target);
    }
    return map;
  }, [targetsQuery.data]);

  const createMutation = useMutation({
    mutationFn: (target_wallet: string) => createCopyTarget({ target_wallet }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: COPY_TARGETS_QUERY_KEY }),
  });
  const deleteMutation = useMutation({
    mutationFn: (targetId: string) => deleteCopyTarget(targetId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: COPY_TARGETS_QUERY_KEY }),
  });
  const policyMutation = useMutation({
    mutationFn: ({
      targetId,
      next,
    }: {
      targetId: string;
      next: {
        mirror_filter_percentile: number;
        mirror_max_usdc_per_trade: number;
      };
    }) => updateCopyTargetPolicy(targetId, next),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: COPY_TARGETS_QUERY_KEY }),
  });
  const grantsMutation = useMutation({
    mutationFn: (next: PolyWalletGrantsPutInput) => putWalletGrants(next),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: POLY_WALLET_GRANTS_QUERY_KEY }),
  });

  const grant = grantsQuery.data?.connected ? grantsQuery.data.grant : null;
  const targetStates = CURATED_TARGETS.map((curated) => ({
    label: curated.label,
    active: Boolean(targetsByWallet.get(curated.wallet)),
  }));

  if (collapsed) {
    return (
      <Card>
        <CardContent className="p-2">
          <button
            type="button"
            aria-label="Expand copy controls"
            onClick={() => setCollapsed(false)}
            className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[var(--ring-width-sm)] focus-visible:ring-ring"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {targetStates.map((targetState) => (
                <CollapsedTargetSignal
                  key={targetState.label}
                  label={targetState.label}
                  active={targetState.active}
                />
              ))}
            </div>
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {grant ? (
              <PolicyControls
                label="Global policy"
                values={{
                  per_order_usdc_cap: grant.per_order_usdc_cap,
                  daily_usdc_cap: grant.daily_usdc_cap,
                }}
                onSave={async (next) => {
                  await grantsMutation.mutateAsync(next);
                }}
              />
            ) : (
              <div className="flex flex-col gap-2">
                <span className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
                  Global policy
                </span>
                <div className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
                  Policy unlocks after the trading wallet is enabled.
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Collapse copy controls"
            onClick={() => setCollapsed(true)}
            className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-[var(--ring-width-sm)] focus-visible:ring-ring"
          >
            <ChevronUp className="size-4" aria-hidden />
          </button>
        </div>

        <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
          Copy targets
        </h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {CURATED_TARGETS.map((curated) => {
            const target = targetsByWallet.get(curated.wallet);
            return (
              <CopyTargetCard
                key={curated.wallet}
                label={curated.label}
                wallet={curated.wallet}
                target={target}
                loading={targetsQuery.isLoading}
                mutating={
                  createMutation.isPending ||
                  deleteMutation.isPending ||
                  policyMutation.isPending
                }
                onCreate={() => createMutation.mutate(curated.wallet)}
                onDelete={() => {
                  if (target) deleteMutation.mutate(target.target_id);
                }}
                onSave={async (next) => {
                  if (!target) return;
                  await policyMutation.mutateAsync({
                    targetId: target.target_id,
                    next,
                  });
                }}
              />
            );
          })}
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-widest">
            Open any wallet
          </h2>
          <WalletQuickJump />
        </div>
      </CardContent>
    </Card>
  );
}

function CollapsedTargetSignal({
  label,
  active,
}: {
  label: string;
  active: boolean;
}): ReactElement {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 font-mono text-xs uppercase tracking-wide",
        active
          ? "border-success/30 bg-success/10 text-success"
          : "border-border/60 bg-background/40 text-muted-foreground"
      )}
    >
      <Radio
        className={cn("size-3", active ? "animate-pulse" : "opacity-35")}
        aria-hidden
      />
      {label} copy {active ? "active" : "--"}
    </span>
  );
}

function CopyTargetCard({
  label,
  wallet,
  target,
  loading,
  mutating,
  onCreate,
  onDelete,
  onSave,
}: {
  label: string;
  wallet: string;
  target: PolyCopyTradeTarget | undefined;
  loading: boolean;
  mutating: boolean;
  onCreate: () => void;
  onDelete: () => void;
  onSave: (next: {
    mirror_filter_percentile: number;
    mirror_max_usdc_per_trade: number;
  }) => Promise<void>;
}): ReactElement {
  const active = Boolean(target);

  return (
    <div className="flex min-h-48 min-w-0 flex-col gap-3 rounded-md border bg-background/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base leading-none">{label}</h3>
            <TargetSignal active={active} />
          </div>
          <AddressChip address={wallet} className="mt-2 text-xs" />
        </div>
        <TargetActiveSwitch
          label={label}
          active={active}
          disabled={loading || mutating}
          onToggle={active ? onDelete : onCreate}
        />
      </div>

      <TargetPolicyEditor
        target={target}
        disabled={!active || mutating}
        onSave={onSave}
      />
    </div>
  );
}

function TargetSignal({ active }: { active: boolean }): ReactElement {
  if (!active) {
    return (
      <span className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
        --
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 font-medium text-success text-xs">
      <Radio className="size-3 animate-pulse" aria-hidden />
      active
    </span>
  );
}

function TargetActiveSwitch({
  label,
  active,
  disabled,
  onToggle,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-label={`${active ? "Pause" : "Turn on"} ${label}`}
      aria-checked={active}
      disabled={disabled}
      onClick={onToggle}
      className={[
        "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center",
        "rounded-full border transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:opacity-60",
        active ? "border-primary/60 bg-primary" : "border-border/60 bg-muted",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "pointer-events-none inline-block h-3.5 w-3.5",
          "translate-x-0.5 transform rounded-full bg-background shadow-sm",
          "transition-transform duration-150",
          active ? "translate-x-[1.125rem]" : "",
        ].join(" ")}
      />
    </button>
  );
}

function TargetPolicyEditor({
  target,
  disabled,
  onSave,
}: {
  target: PolyCopyTradeTarget | undefined;
  disabled: boolean;
  onSave: (next: {
    mirror_filter_percentile: number;
    mirror_max_usdc_per_trade: number;
  }) => Promise<void>;
}): ReactElement {
  const [percentile, setPercentile] = useState(
    target?.mirror_filter_percentile ?? 75
  );
  const [maxBet, setMaxBet] = useState(
    (target?.mirror_max_usdc_per_trade ?? 5).toFixed(2)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPercentile(target?.mirror_filter_percentile ?? 75);
    setMaxBet((target?.mirror_max_usdc_per_trade ?? 5).toFixed(2));
    setError(null);
  }, [target]);

  const parsedMaxBet = Number.parseFloat(maxBet);
  const changed =
    target &&
    (percentile !== target.mirror_filter_percentile ||
      maxBet.trim() !== target.mirror_max_usdc_per_trade.toFixed(2));
  const percentileSizing =
    target?.sizing_policy_kind === "target_percentile_scaled";

  async function handleSave() {
    if (!target) return;
    if (!Number.isFinite(parsedMaxBet) || parsedMaxBet <= 0) {
      setError("Max must be greater than 0");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        mirror_filter_percentile: percentile,
        mirror_max_usdc_per_trade: parsedMaxBet,
      });
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-auto flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <ValueCell
          label={target && percentileSizing ? `p${percentile}` : "p--"}
          value={target && percentileSizing ? "min bet" : "--"}
        />
        <ValueCell label="p100" value={target ? "max bet" : "--"} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            Threshold p{percentile}
          </span>
          <input
            type="range"
            min={50}
            max={99}
            step={1}
            value={percentile}
            disabled={disabled || !percentileSizing || saving}
            onChange={(e) => setPercentile(Number(e.target.value))}
            className={cn(
              "h-9 w-full accent-primary",
              (disabled || !percentileSizing) && "opacity-40"
            )}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            p100 max
          </span>
          <span className="flex h-9 items-center gap-1 rounded-md border border-input bg-background px-2">
            <span className="text-muted-foreground text-sm">$</span>
            <input
              inputMode="decimal"
              value={maxBet}
              disabled={disabled || saving}
              onChange={(e) => setMaxBet(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm tabular-nums outline-none disabled:opacity-50"
            />
          </span>
        </label>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={disabled || saving || !changed}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
      {error ? (
        <div className="text-destructive text-xs" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function ValueCell({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="font-semibold text-base tabular-nums tracking-tight">
        {value}
      </div>
    </div>
  );
}
