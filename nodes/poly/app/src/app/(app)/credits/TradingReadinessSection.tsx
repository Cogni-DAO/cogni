// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/credits/TradingReadinessSection`
 * Purpose: One-click "Enable Trading" surface on the Money page. Mirrors
 *   Polymarket's own onboarding modal (Deploy ✓ / Sign ✓ / Approve ⬜) but
 *   collapses step 1 (Deploy) and step 2 (Sign) — our adapter already covers
 *   them on /connect — leaving only the 6-target Approve Tokens ceremony
 *   rendered as per-pill progress.
 * Scope: Client component. POSTs /api/v1/poly/wallet/enable-trading via
 *   React Query mutation; invalidates `poly-wallet-status` on success so
 *   the "✓ Trading enabled" badge replaces the button without a reload.
 * Invariants:
 *   - IDEMPOTENT_CTA: POSTing is safe at any time — backend skips satisfied
 *     targets. No client-side lockout beyond React Query's inflight flag.
 *   - PARTIAL_FAILURE_VISIBLE: per-step `state` surfaces as colored pills
 *     even when the overall outcome is `ready: false` — user sees which
 *     approval failed and retries.
 *   - FUNDED_RECOLOR (task.0365): the same compact "Trading enabled" badge
 *     swaps green tokens for warning/yellow tokens when `isFunded=false`.
 *     Same pill, same shape, same one line — just a different color says
 *     "approvals on-chain, but you have $0 USDC.e so you can't trade yet".
 * Side-effects: IO (POST enable-trading; React Query cache invalidation).
 * Links: packages/node-contracts/src/poly.wallet.enable-trading.v1.contract.ts,
 *        work/items/task.0355.poly-trading-wallet-enable-trading.md,
 *        work/items/task.0365.poly-onboarding-ux-polish-v0-1.md
 * @public
 */

"use client";

import type { PolyWalletEnableTradingOutput } from "@cogni/node-contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import type { ReactElement } from "react";

export interface TradingReadinessSectionProps {
  /** From `poly.wallet.status.v1` — drives the initial view. */
  readonly tradingReady: boolean;
  /**
   * Whether the wallet has any USDC.e (`> 0`). When `tradingReady && !isFunded`
   * the "Trading enabled" pill recolors to warning/yellow (FUNDED_RECOLOR,
   * task.0365) — approvals alone are not enough to actually place an order.
   */
  readonly isFunded: boolean;
  /** Decimal POL on Polygon. `null` on unknown / RPC error. */
  readonly polBalance: number | null;
  /** Decimal USDC.e. `null` on unknown. Informational (not gated on). */
  readonly usdcBalance: number | null;
}

const MIN_POL_FOR_ENABLE = 0.02;

async function postEnableTrading(): Promise<PolyWalletEnableTradingOutput> {
  const res = await fetch("/api/v1/poly/wallet/enable-trading", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `enable-trading failed: ${res.status}`);
  }
  return (await res.json()) as PolyWalletEnableTradingOutput;
}

export function TradingReadinessSection(
  props: TradingReadinessSectionProps
): ReactElement | null {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: postEnableTrading,
    onSuccess: (result) => {
      if (result.ready) {
        // Bust status immediately so the "✓ Trading enabled" badge swaps in.
        qc.invalidateQueries({ queryKey: ["poly-wallet-status"] });
      }
    },
  });

  // The most recent mutation result wins the render — partial failures show
  // their step pills until the user clicks again.
  const result = mutation.data;
  const derivedReady = result?.ready ?? props.tradingReady;
  const inFlight = mutation.isPending;
  const insufficientGas =
    !derivedReady &&
    props.polBalance !== null &&
    props.polBalance < MIN_POL_FOR_ENABLE;

  // Compact confirmation: either steady state (no mutation) OR the most recent
  // mutation succeeded end-to-end (`result.ready === true`). Without the
  // latter, a fresh successful "Enable trading" click would keep rendering the
  // big authorize-box with step rows until the user hard-refreshed the page.
  if (derivedReady && !inFlight && (!result || result.ready)) {
    // FUNDED_RECOLOR: same shape, swap success → warning tokens when $0.
    const tone = props.isFunded
      ? "border-success/30 bg-success/10 text-success"
      : "border-warning/40 bg-warning/10 text-warning";
    const sub = props.isFunded
      ? "Approvals signed in-app"
      : "Approvals signed · add USDC.e to trade";
    const subTone = props.isFunded ? "text-success/70" : "text-warning/80";
    return (
      <div
        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${tone}`}
      >
        <CheckCircle2 size={16} />
        <span className="font-medium">Trading enabled</span>
        <span className={`text-xs ${subTone}`}>· {sub}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-sm">
            {derivedReady ? "Trading enabled" : "Authorize trading"}
          </span>
          <span className="text-muted-foreground text-xs leading-snug">
            {derivedReady
              ? "Polymarket approvals are on-chain. We signed them from your trading wallet—no browser wallet."
              : "~6 approval txs from this wallet, server-signed. No extension popup."}
          </span>
        </div>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={inFlight || insufficientGas}
          className="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {inFlight ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Authorizing…
            </>
          ) : derivedReady ? (
            "Re-check"
          ) : (
            "Enable trading"
          )}
        </button>
      </div>

      {insufficientGas ? (
        <div className="rounded-md bg-warning/15 px-3 py-2 text-warning text-xs">
          At least {MIN_POL_FOR_ENABLE} POL for gas (enable sends several txs).
        </div>
      ) : null}

      {result ? <StepRows steps={result.steps} /> : null}

      {mutation.isError ? (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs">
          {(mutation.error as Error).message}
        </div>
      ) : null}
    </div>
  );
}

function StepRows({
  steps,
}: {
  steps: PolyWalletEnableTradingOutput["steps"];
}): ReactElement {
  return (
    <ul className="flex flex-col gap-1.5">
      {steps.map((step) => (
        <li
          key={`${step.kind}:${step.operator}`}
          className="flex items-center gap-2 text-xs"
        >
          <StateIcon state={step.state} />
          <span className="flex-1 truncate">{step.label}</span>
          {step.tx_hash ? (
            <a
              href={`https://polygonscan.com/tx/${step.tx_hash}`}
              target="_blank"
              rel="noreferrer noopener"
              className="truncate font-mono text-muted-foreground text-xs underline-offset-2 hover:underline"
            >
              {step.tx_hash.slice(0, 10)}…
            </a>
          ) : null}
          {step.error ? (
            <span className="truncate text-destructive text-xs">
              {step.error}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function StateIcon({
  state,
}: {
  state: PolyWalletEnableTradingOutput["steps"][number]["state"];
}): ReactElement {
  if (state === "satisfied" || state === "set") {
    return <CheckCircle2 size={14} className="text-success" />;
  }
  if (state === "failed") {
    return <XCircle size={14} className="text-destructive" />;
  }
  // "skipped" — pre-flight gate not met, rendered as dim circle.
  return <Circle size={14} className="text-muted-foreground" />;
}
