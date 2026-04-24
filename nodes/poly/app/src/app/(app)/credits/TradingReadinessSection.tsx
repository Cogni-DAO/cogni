// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/credits/TradingReadinessSection`
 * Purpose: One-click "Enable Trading" surface on the Money page. Mirrors
 *   Polymarket's own onboarding modal (Deploy ✓ / Sign ✓ / Approve ⬜) but
 *   collapses step 1 (Deploy) and step 2 (Sign) — our adapter already covers
 *   them on /connect — leaving only the 6-target Approve Tokens ceremony
 *   rendered as per-pill progress. After success, collapses to a condensed
 *   "6/6 approvals signed" checkpoint with a disclosure for tx hashes
 *   (task.0365 polish).
 * Scope: Client component. POSTs /api/v1/poly/wallet/enable-trading via
 *   React Query mutation; invalidates `poly-wallet-status` on success so
 *   the "Trading enabled" checkpoint replaces the button without a reload.
 * Invariants:
 *   - IDEMPOTENT_CTA: POSTing is safe at any time — backend skips satisfied
 *     targets. No client-side lockout beyond React Query's inflight flag.
 *   - PARTIAL_FAILURE_VISIBLE: per-step `state` surfaces as colored pills
 *     even when the overall outcome is `ready: false` — user sees which
 *     approval failed and retries.
 *   - STACKED_CTA (task.0365): the primary action button lives below its
 *     label + copy, never side-by-side — prevents the cramp in the narrow
 *     right column of the Money page.
 * Side-effects: IO (POST enable-trading; React Query cache invalidation).
 * Links: packages/node-contracts/src/poly.wallet.enable-trading.v1.contract.ts,
 *        work/items/task.0355.poly-trading-wallet-enable-trading.md,
 *        work/items/task.0365.poly-onboarding-ux-polish-v0-1.md
 * @public
 */

"use client";

import type { PolyWalletEnableTradingOutput } from "@cogni/node-contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  XCircle,
} from "lucide-react";
import { type ReactElement, useState } from "react";

export interface TradingReadinessSectionProps {
  /** From `poly.wallet.status.v1` — drives the initial view. */
  readonly tradingReady: boolean;
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
        // Bust status immediately so the "Trading enabled" checkpoint swaps in.
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

  // Ready checkpoint: steady state (no mutation) OR the most recent mutation
  // succeeded end-to-end. Without the latter, a fresh successful "Enable
  // trading" click would keep rendering the authorize-box with step rows
  // until the user hard-refreshed the page.
  if (derivedReady && !inFlight && (!result || result.ready)) {
    return <TradingReadyCheckpoint steps={result?.steps ?? null} />;
  }

  return (
    <section
      aria-label="Enable trading"
      className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4"
    >
      <div className="flex flex-col gap-1">
        <span className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
          Step — Authorize
        </span>
        <h3 className="font-semibold text-base leading-tight">
          Enable trading
        </h3>
        <p className="text-muted-foreground text-xs leading-snug">
          Do this now — approvals{" "}
          <span className="font-medium text-foreground">don't cost USDC</span>.
          You'll deposit USDC.e next. We'll sign ~6 approval transactions from
          your trading wallet — no browser wallet popup.
        </p>
      </div>

      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={inFlight || insufficientGas}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {inFlight ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Authorizing approvals…
          </>
        ) : (
          "Enable trading"
        )}
      </button>

      {insufficientGas ? (
        <div className="rounded-md bg-warning/15 px-3 py-2 text-warning text-xs leading-snug">
          Need at least {MIN_POL_FOR_ENABLE} POL for gas — enable sends several
          txs. Send a small amount of POL to your trading-wallet address above.
        </div>
      ) : null}

      {result ? <StepRows steps={result.steps} /> : null}

      {mutation.isError ? (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs leading-snug">
          {(mutation.error as Error).message}
        </div>
      ) : null}
    </section>
  );
}

function TradingReadyCheckpoint({
  steps,
}: {
  steps: PolyWalletEnableTradingOutput["steps"] | null;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const totalSteps = steps?.length ?? 6;
  const signedCount = steps
    ? steps.filter((s) => s.state === "satisfied" || s.state === "set").length
    : totalSteps;

  return (
    <section
      aria-label="Trading enabled"
      className="overflow-hidden rounded-lg border border-success/30 bg-success/5"
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-success/20 text-success">
          <CheckCircle2 size={16} strokeWidth={2.25} />
        </span>
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="font-semibold text-sm text-success">
            Trading enabled
          </span>
          <span className="font-mono text-success/80 text-xs tabular-nums">
            {signedCount}/{totalSteps} approvals signed · Polymarket ready
          </span>
        </div>
        {steps && steps.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-background/40 px-2 py-1 font-mono text-success text-xs uppercase tracking-wider transition-colors hover:border-success/60"
          >
            {open ? "Hide" : "Approvals"}
            <ChevronDown
              size={12}
              className={
                open
                  ? "rotate-180 transition-transform"
                  : "transition-transform"
              }
            />
          </button>
        ) : null}
      </div>
      {open && steps ? (
        <div className="border-success/20 border-t bg-background/40 px-4 py-3">
          <StepRows steps={steps} tone="success" />
        </div>
      ) : null}
    </section>
  );
}

function StepRows({
  steps,
  tone = "neutral",
}: {
  steps: PolyWalletEnableTradingOutput["steps"];
  tone?: "neutral" | "success";
}): ReactElement {
  return (
    <ul className="flex flex-col gap-1.5">
      {steps.map((step) => (
        <li
          key={`${step.kind}:${step.operator}`}
          className="flex items-center gap-2 text-xs"
        >
          <StateIcon state={step.state} />
          <span
            className={
              tone === "success"
                ? "flex-1 truncate text-foreground/90"
                : "flex-1 truncate"
            }
          >
            {step.label}
          </span>
          {step.tx_hash ? (
            <a
              href={`https://polygonscan.com/tx/${step.tx_hash}`}
              target="_blank"
              rel="noreferrer noopener"
              className="truncate font-mono text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
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
    return <Check size={14} className="text-success" strokeWidth={2.5} />;
  }
  if (state === "failed") {
    return <XCircle size={14} className="text-destructive" />;
  }
  // "skipped" — pre-flight gate not met, rendered as dim circle.
  return <Circle size={14} className="text-muted-foreground" />;
}
