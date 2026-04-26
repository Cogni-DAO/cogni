// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/credits/TradingWalletPanel`
 * Purpose: Money page panel hosting the whole trading-wallet lifecycle —
 *   create (inline `TradingWalletConnectFlow` when `configured && !connected`),
 *   fund (USDC.e / POL readout + Polygon bridge link), enable trading
 *   (`TradingReadinessSection`, task.0355), and stubbed fund/withdraw
 *   (task.0351 / task.0352).
 * Scope: Client component. React Query fetches `/wallet/status` + `/wallet/balances`;
 *   reads the session via `next-auth/react` only to surface `userId` to the
 *   inline connect flow. On `onConnected`, invalidates `poly-wallet-status`
 *   so the panel flips from "create" to "balances" without a reload.
 * Invariants:
 *   - ENABLE_TRADING_VISIBLE: when connected AND `trading_ready=false`, the
 *     readiness section is the primary above-the-fold CTA on this card.
 *     Without it the user cannot reach the CLOB — APPROVALS_BEFORE_PLACE
 *     blocks `authorizeIntent`. Losing this CTA bricks every trade.
 *   - PROFILE_IS_IDENTITY_ONLY (task.0361): this panel owns the "create a
 *     trading wallet" action; `/profile` no longer has a wallet row.
 *   - PARTIAL_FAILURE_VISIBLE: render USDC.e/POL as "—" when the RPC errored.
 * Side-effects: IO (fetch API via React Query; `onConnected` triggers
 *   `poly-wallet-status` invalidation).
 * Links: packages/node-contracts/src/poly.wallet.connection.v1.contract.ts,
 *        packages/node-contracts/src/poly.wallet.balances.v1.contract.ts,
 *        packages/node-contracts/src/poly.wallet.enable-trading.v1.contract.ts,
 *        work/items/task.0355.poly-trading-wallet-enable-trading.md,
 *        work/items/task.0361.poly-first-user-onboarding-flow-v0.md,
 *        work/items/task.0365.poly-onboarding-ux-polish-v0-1.md,
 *        work/items/task.0351.poly-trading-wallet-withdrawal.md,
 *        work/items/task.0352.poly-trading-wallet-fund-flow.md
 * @public
 */

"use client";

import type {
  PolyWalletBalancesOutput,
  PolyWalletStatusOutput,
} from "@cogni/node-contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Info } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import type { ReactElement } from "react";
import { AddressChip, Card, HintText } from "@/components";
import { TradingReadinessSection } from "./TradingReadinessSection";
import { TradingWalletConnectFlow } from "./TradingWalletConnectFlow";

async function fetchWalletStatus(): Promise<PolyWalletStatusOutput> {
  const res = await fetch("/api/v1/poly/wallet/status", {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`wallet status failed: ${res.status}`);
  }
  return (await res.json()) as PolyWalletStatusOutput;
}

async function fetchWalletBalances(): Promise<PolyWalletBalancesOutput> {
  const res = await fetch("/api/v1/poly/wallet/balances", {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`wallet balances failed: ${res.status}`);
  }
  return (await res.json()) as PolyWalletBalancesOutput;
}

function formatDecimal(n: number | null, fractionDigits: number): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

const stubBtn =
  "w-full cursor-not-allowed rounded-md border border-border/60 bg-muted/50 px-3 py-2 font-medium text-muted-foreground text-sm";

const POLY_WALLET_STATUS_QUERY_KEY = ["poly-wallet-status"] as const;

export function TradingWalletPanel(): ReactElement {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  const statusQuery = useQuery({
    queryKey: POLY_WALLET_STATUS_QUERY_KEY,
    queryFn: fetchWalletStatus,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  const connected = statusQuery.data?.connected === true;

  const balancesQuery = useQuery({
    queryKey: ["poly-wallet-balances"],
    queryFn: fetchWalletBalances,
    enabled: connected,
    refetchInterval: 20_000,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  });

  const status = statusQuery.data;
  const balances = balancesQuery.data;

  return (
    <Card className="flex flex-col gap-4 p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
          Trading wallet
        </span>
        {status?.funder_address ? (
          <AddressChip address={status.funder_address} />
        ) : null}
      </div>

      {statusQuery.isLoading ? (
        <div className="h-14 animate-pulse rounded bg-muted" />
      ) : !status?.configured ? (
        <p className="text-muted-foreground text-sm">
          Trading wallet not enabled on this deployment.
        </p>
      ) : !connected ? (
        userId ? (
          <TradingWalletConnectFlow
            userId={userId}
            onConnected={() => {
              void queryClient.invalidateQueries({
                queryKey: POLY_WALLET_STATUS_QUERY_KEY,
              });
            }}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            Sign in to create your trading wallet.
          </p>
        )
      ) : (
        <div className="flex flex-col gap-3">
          {/* Balances immediately above stub actions — compact, no semantic mix-up */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md bg-muted/40 px-3 py-2">
              <div className="text-muted-foreground text-xs uppercase tracking-wide">
                USDC.e
              </div>
              <div className="font-semibold text-xl tabular-nums tracking-tight">
                {formatDecimal(balances?.usdc_e ?? null, 2)}
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2">
              <div className="text-muted-foreground text-xs uppercase tracking-wide">
                POL
              </div>
              <div className="font-semibold text-xl tabular-nums tracking-tight">
                {formatDecimal(balances?.pol ?? null, 4)}
              </div>
            </div>
          </div>
          <TradingReadinessSection
            tradingReady={status.trading_ready}
            isFunded={(balances?.usdc_e ?? 0) > 0}
            polBalance={balances?.pol ?? null}
            usdcBalance={balances?.usdc_e ?? null}
          />

          {status.trading_ready ? (
            <Link
              href="/research"
              className="inline-flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-3 font-medium text-primary text-sm transition-colors hover:bg-primary/20"
            >
              <span>Next — pick a wallet to copy on Research</span>
              <ArrowRight size={16} />
            </Link>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled
              title="Coming soon — task.0352"
              className={stubBtn}
            >
              Fund
            </button>
            <button
              type="button"
              disabled
              title="Coming soon — task.0351"
              className={stubBtn}
            >
              Withdraw
            </button>
          </div>

          {balances && balances.errors.length > 0 ? (
            <HintText icon={<Info size={16} />}>
              Partial read — retrying.
            </HintText>
          ) : null}

          <p className="text-muted-foreground text-xs leading-snug">
            Send USDC.e on Polygon to your trading-wallet address above — any
            wallet or{" "}
            <a
              href="https://portal.polygon.technology/bridge"
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-muted-foreground/40 hover:decoration-foreground"
            >
              Polygon Portal bridge
            </a>
            . You also need ~0.2 POL for gas. One-click deposit/withdraw flows
            next.
          </p>
        </div>
      )}
    </Card>
  );
}
