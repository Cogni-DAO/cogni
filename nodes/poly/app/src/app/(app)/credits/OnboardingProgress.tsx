// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/(app)/credits/OnboardingProgress`
 * Purpose: One-line state-driven progress rail at the top of the Money page —
 *   `Create wallet → Fund → Enable trading → Pick a target`. Gives a new user
 *   a sense of where they are in the first-user flow without adding a banner.
 * Scope: Client component. Derives state entirely from the shared
 *   `poly-wallet-status` and `poly-wallet-balances` React Query caches
 *   already owned by `TradingWalletPanel` — no new fetches.
 * Invariants:
 *   - STATE_DRIVEN_UI (task.0361): no local step state, no dismiss button,
 *     no persistence. Rail is a pure projection of wallet status.
 *   - FUND_THRESHOLD_IS_UX_HINT: `usdc_e >= 1` is a UX heuristic to mark the
 *     "Fund" step complete — it is not a trading-eligibility gate (the real
 *     gate is `trading_ready` + per-trade caps on the server).
 * Side-effects: IO via React Query's cache only (no new fetches unless the
 *   consumer route renders this before `TradingWalletPanel`; acceptable).
 * Links: work/items/task.0365.poly-onboarding-ux-polish-v0-1.md,
 *        work/items/task.0361.poly-first-user-onboarding-flow-v0.md
 * @public
 */

"use client";

import type {
  PolyWalletBalancesOutput,
  PolyWalletStatusOutput,
} from "@cogni/node-contracts";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import type { ReactElement } from "react";

/**
 * Minimum USDC.e the rail treats as "funded enough to consider the fund step
 * done". Deliberately conservative — MIRROR_USDC defaults to ~$1, so any
 * real first copy-trade requires at least this much sitting in the wallet.
 */
const FUND_STEP_MIN_USDC = 1;

type StepStatus = "done" | "current" | "todo";

interface Step {
  label: string;
  status: StepStatus;
}

async function fetchStatus(): Promise<PolyWalletStatusOutput> {
  const res = await fetch("/api/v1/poly/wallet/status", {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`wallet status failed: ${res.status}`);
  return (await res.json()) as PolyWalletStatusOutput;
}

async function fetchBalances(): Promise<PolyWalletBalancesOutput> {
  const res = await fetch("/api/v1/poly/wallet/balances", {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`wallet balances failed: ${res.status}`);
  return (await res.json()) as PolyWalletBalancesOutput;
}

function deriveSteps(
  status: PolyWalletStatusOutput | undefined,
  balances: PolyWalletBalancesOutput | undefined
): readonly Step[] {
  const connected = status?.connected === true;
  const funded = (balances?.usdc_e ?? 0) >= FUND_STEP_MIN_USDC;
  const ready = status?.trading_ready === true;

  // Pick the first non-done step as the "current" marker. If everything is
  // done except the last nudge, the last step becomes current.
  const rawStatuses: StepStatus[] = [
    connected ? "done" : "todo",
    funded ? "done" : "todo",
    ready ? "done" : "todo",
    "todo",
  ];
  const firstTodo = rawStatuses.indexOf("todo");
  if (firstTodo >= 0) rawStatuses[firstTodo] = "current";

  return [
    { label: "Create wallet", status: rawStatuses[0] as StepStatus },
    { label: "Fund", status: rawStatuses[1] as StepStatus },
    { label: "Enable trading", status: rawStatuses[2] as StepStatus },
    { label: "Pick a target", status: rawStatuses[3] as StepStatus },
  ];
}

export function OnboardingProgress(): ReactElement | null {
  const statusQuery = useQuery({
    queryKey: ["poly-wallet-status"],
    queryFn: fetchStatus,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  const connected = statusQuery.data?.connected === true;

  const balancesQuery = useQuery({
    queryKey: ["poly-wallet-balances"],
    queryFn: fetchBalances,
    enabled: connected,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  // Hide entirely until status resolves — showing a half-filled rail while
  // loading is worse than showing nothing for 200ms.
  if (!statusQuery.data) return null;
  // Deployment doesn't run per-tenant trading wallets → onboarding rail is
  // meaningless; the panel itself renders a single info sentence instead.
  if (!statusQuery.data.configured) return null;

  const steps = deriveSteps(statusQuery.data, balancesQuery.data);

  return (
    <nav aria-label="Onboarding progress" className="mb-5 overflow-x-auto pb-1">
      <ol className="flex min-w-full items-center gap-3 whitespace-nowrap font-mono text-xs uppercase tracking-widest sm:gap-4">
        {steps.map((step, idx) => (
          <li key={step.label} className="flex items-center gap-3 sm:gap-4">
            <StepDot status={step.status} index={idx + 1} />
            <span
              className={
                step.status === "done"
                  ? "text-foreground"
                  : step.status === "current"
                    ? "text-foreground"
                    : "text-muted-foreground/60"
              }
            >
              {step.label}
            </span>
            {idx < steps.length - 1 ? (
              <span
                aria-hidden
                className={
                  step.status === "done"
                    ? "h-px w-6 bg-foreground/40 sm:w-10"
                    : "h-px w-6 bg-border sm:w-10"
                }
              />
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function StepDot({
  status,
  index,
}: {
  status: StepStatus;
  index: number;
}): ReactElement {
  if (status === "done") {
    return (
      <span
        role="img"
        aria-label={`Step ${index} complete`}
        className="inline-flex size-5 items-center justify-center rounded-full bg-foreground text-background"
      >
        <Check size={12} strokeWidth={3} />
      </span>
    );
  }
  if (status === "current") {
    return (
      <span
        role="img"
        aria-label={`Step ${index} in progress`}
        className="relative inline-flex size-5 items-center justify-center rounded-full border border-foreground font-semibold text-xs"
      >
        {index}
        <span className="-inset-0.5 absolute animate-ping rounded-full border border-foreground/30" />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={`Step ${index} not started`}
      className="inline-flex size-5 items-center justify-center rounded-full border border-muted-foreground/30 text-muted-foreground/60 text-xs"
    >
      {index}
    </span>
  );
}
