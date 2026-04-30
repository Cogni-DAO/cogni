// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/credits/AutoWrapToggle`
 * Purpose: Single-control consent toggle for the auto-wrap loop (task.0429).
 *   When ON, the 60s background job wraps any USDC.e at the funder address
 *   into pUSD — required because CLOB BUYs only spend pUSD. Closes the cash
 *   leak from deposits, V1 redeems, and external transfers.
 * Scope: Client component. Reads `auto_wrap_consent_at` from the existing
 *   `poly-wallet-status` query; writes via `POST` / `DELETE` on
 *   `/api/v1/poly/wallet/auto-wrap/consent` with optimistic update.
 * Invariants:
 *   - PARENT_GATES_VISIBILITY: only mounted when `connected && trading_ready`
 *     — the toggle is meaningless without an enabled trading wallet.
 *   - SINGLE_QUERY_KEY: shares the `poly-wallet-status` cache with the panel
 *     so a toggle flip immediately reflects in any sibling reader.
 * Side-effects: IO (fetch). Optimistic mutation rolls back on error.
 * Links: nodes/poly/packages/node-contracts/src/poly.wallet.auto-wrap.v1.contract.ts,
 *        work/items/task.0429.poly-auto-wrap-consent-loop.md
 * @public
 */

"use client";

import type { PolyWalletStatusOutput } from "@cogni/poly-node-contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { type ReactElement, useId, useState } from "react";

const POLY_WALLET_STATUS_QUERY_KEY = ["poly-wallet-status"] as const;

async function postConsent(): Promise<void> {
  const res = await fetch("/api/v1/poly/wallet/auto-wrap/consent", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(`auto-wrap consent grant failed: ${res.status}`);
  }
}

async function deleteConsent(): Promise<void> {
  const res = await fetch("/api/v1/poly/wallet/auto-wrap/consent", {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`auto-wrap consent revoke failed: ${res.status}`);
  }
}

export interface AutoWrapToggleProps {
  /** Current consent timestamp from `/wallet/status`. `null` when off. */
  autoWrapConsentAt: string | null;
}

export function AutoWrapToggle({
  autoWrapConsentAt,
}: AutoWrapToggleProps): ReactElement {
  const queryClient = useQueryClient();
  const labelId = useId();
  const descId = useId();
  const [optimisticOn, setOptimisticOn] = useState<boolean | null>(null);

  const serverOn = autoWrapConsentAt !== null;
  const on = optimisticOn ?? serverOn;

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      if (next) await postConsent();
      else await deleteConsent();
    },
    onMutate: (next) => {
      setOptimisticOn(next);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: POLY_WALLET_STATUS_QUERY_KEY,
      });
      setOptimisticOn(null);
    },
  });

  const isPending = mutation.isPending;

  return (
    <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              id={labelId}
              className="font-medium text-foreground text-sm leading-none"
            >
              Auto-wrap USDC.e&nbsp;→&nbsp;pUSD
            </span>
            <StatusPill on={on} pending={isPending} />
          </div>
          <p
            id={descId}
            className="mt-1.5 text-muted-foreground text-xs leading-snug"
          >
            Polymarket BUYs spend pUSD. When on, we convert any USDC.e arriving
            here — from deposits, settlements, or transfers — every minute.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          aria-describedby={descId}
          aria-busy={isPending}
          disabled={isPending}
          onClick={() => mutation.mutate(!on)}
          className={[
            "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center",
            "rounded-full border transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:opacity-60",
            on
              ? "border-primary/60 bg-primary"
              : "border-border/60 bg-muted",
          ].join(" ")}
        >
          <span
            aria-hidden
            className={[
              "pointer-events-none inline-block h-3.5 w-3.5",
              "translate-x-0.5 transform rounded-full bg-background shadow-sm",
              "transition-transform duration-150",
              on ? "translate-x-[1.125rem]" : "",
            ].join(" ")}
          />
          {isPending ? (
            <Loader2
              aria-hidden
              size={10}
              className="-translate-y-1/2 absolute top-1/2 right-1.5 animate-spin text-primary-foreground"
            />
          ) : null}
        </button>
      </div>
    </div>
  );
}

function StatusPill({
  on,
  pending,
}: {
  on: boolean;
  pending: boolean;
}): ReactElement {
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
        <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground/60" />
        Updating
      </span>
    );
  }
  if (on) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-medium text-[10px] text-emerald-600 uppercase tracking-wider dark:text-emerald-400">
        <span className="h-1 w-1 rounded-full bg-emerald-500" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
      <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
      Off
    </span>
  );
}

export type PolyWalletStatusForAutoWrap = Pick<
  PolyWalletStatusOutput,
  "auto_wrap_consent_at"
>;
