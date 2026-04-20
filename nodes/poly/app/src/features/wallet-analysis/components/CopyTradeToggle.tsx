// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/components/CopyTradeToggle`
 * Purpose: Per-wallet copy-trade status indicator + on/off toggle, styled after the dashboard's "N active" live-agents pill. Shows whether the calling user is currently mirroring this wallet and flips state on click.
 * Scope: Client component. Uses the shared COPY_TARGETS_QUERY_KEY so it cross-invalidates with TopWalletsCard on dashboard. Does not decide mode / sizing — uses server defaults.
 * Invariants:
 *   - PER_USER_RLS: server enforces who can see + write targets; client never sends user_id.
 *   - SHARED_QUERY_KEY: both Monitored Wallets card + this toggle read and invalidate the same key, so toggling here immediately updates the dashboard.
 *   - DISABLED_WHILE_MUTATING: prevents double-submit on rapid clicks.
 * Side-effects: IO (React Query fetch + mutate on /api/v1/poly/copy-trade/targets).
 * Links: docs/spec/poly-multi-tenant-auth.md, nodes/poly/app/src/features/wallet-analysis/client/copy-trade-targets.ts
 * @public
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Radio } from "lucide-react";
import type { ReactElement } from "react";
import {
  COPY_TARGETS_QUERY_KEY,
  createCopyTarget,
  deleteCopyTarget,
  fetchCopyTargets,
} from "@/features/wallet-analysis/client/copy-trade-targets";
import { cn } from "@/shared/util/cn";

export type CopyTradeToggleProps = {
  /** Lowercased 0x wallet address whose mirror status this toggle controls. */
  addr: string;
};

export function CopyTradeToggle({ addr }: CopyTradeToggleProps): ReactElement {
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

  // Styled after the dashboard "{N} active" pill — same token palette so
  // "copy-trading" reads as a live-agent indicator when active.
  const base =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs transition-colors";
  const label = pending
    ? tracked
      ? "Stopping…"
      : "Starting…"
    : tracked
      ? "Copy-trading"
      : "Copy-trade";

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
        base,
        tracked
          ? "bg-success/15 text-success hover:bg-success/25"
          : "border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
        disabled && "cursor-not-allowed opacity-60"
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
