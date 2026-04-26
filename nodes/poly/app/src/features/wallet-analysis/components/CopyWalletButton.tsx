// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/CopyWalletButton`
 * Purpose: Per-wallet copy-trade pill — "+ Copy wallet" when untracked, pulsing Radio "Copy-trading" when tracked. Used in the wallet-analysis page header and the wallet drawer header so users can mirror straight from the analysis surface.
 * Scope: Client component. Reads + invalidates the same `["dashboard-copy-targets"]` React Query key the dashboard's CopyTradedWalletsCard and `/research` view use, so flips reflect across surfaces.
 * Invariants:
 *   - PER_USER_RLS: server enforces per-user visibility + writes; client never sends user_id.
 *   - SHARED_QUERY_KEY: ["dashboard-copy-targets"] — must match dashboard + /research view.
 *   - DISABLED_WHILE_MUTATING: prevents double-submit on rapid clicks.
 * Side-effects: IO (React Query fetch + mutate on /api/v1/poly/copy-trade/targets).
 * @public
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Radio } from "lucide-react";
import type { ReactElement } from "react";
import {
  createCopyTarget,
  deleteCopyTarget,
  fetchCopyTargets,
} from "@/app/(app)/dashboard/_api/fetchCopyTargets";
import { cn } from "@/shared/util/cn";

const COPY_TARGETS_QUERY_KEY = ["dashboard-copy-targets"] as const;

export type CopyWalletButtonProps = {
  /** 0x wallet address whose mirror status this button controls. */
  addr: string;
  className?: string;
};

export function CopyWalletButton({
  addr,
  className,
}: CopyWalletButtonProps): ReactElement {
  const queryClient = useQueryClient();
  const addrLower = addr.toLowerCase();

  const { data, isLoading } = useQuery({
    queryKey: COPY_TARGETS_QUERY_KEY,
    queryFn: fetchCopyTargets,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const existing = data?.targets.find(
    (t) => t.target_wallet.toLowerCase() === addrLower
  );
  const tracked = existing !== undefined;

  const createM = useMutation({
    mutationFn: () => createCopyTarget({ target_wallet: addrLower }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: COPY_TARGETS_QUERY_KEY }),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteCopyTarget(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: COPY_TARGETS_QUERY_KEY }),
  });

  const pending = createM.isPending || deleteM.isPending;
  const disabled = isLoading || pending;

  const onClick = (): void => {
    if (disabled) return;
    if (tracked && existing) deleteM.mutate(existing.target_id);
    else createM.mutate();
  };

  const label = pending
    ? tracked
      ? "Stopping…"
      : "Starting…"
    : tracked
      ? "Copy-trading"
      : "Copy wallet";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={tracked}
      title={
        tracked
          ? "Click to stop copy-trading this wallet"
          : "Click to start copy-trading this wallet (mirror its fills)"
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs transition-colors",
        tracked
          ? "bg-success/15 text-success hover:bg-success/25"
          : "border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
        disabled && "cursor-not-allowed opacity-60",
        className
      )}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : tracked ? (
        <Radio className="size-3.5 animate-pulse" aria-hidden />
      ) : (
        <Plus className="size-3.5" aria-hidden />
      )}
      <span>{label}</span>
    </button>
  );
}
