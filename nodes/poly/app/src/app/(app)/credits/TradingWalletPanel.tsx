// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/credits/TradingWalletPanel`
 * Purpose: Money page panel for the user's Polymarket trading wallet —
 *   funder address (copy + explorer), compact USDC.e | POL readout, stub
 *   Fund | Withdraw row (task.0351 / task.0352), single card.
 * Scope: Client component. React Query fetches `/wallet/status` + `/wallet/balances`.
 *   Does not own the page container. Funding + withdrawal are stubbed until
 *   task.0351 / task.0352 land.
 * Invariants:
 *   - READ_ONLY_V0: no trading-wallet write actions (withdraw, fund-with-siwe) in v0.
 *   - PARTIAL_FAILURE_VISIBLE: render USDC.e/POL as "—" when the RPC errored.
 * Side-effects: IO (fetch API via React Query).
 * Links: packages/node-contracts/src/poly.wallet.connection.v1.contract.ts,
 *        packages/node-contracts/src/poly.wallet.balances.v1.contract.ts,
 *        work/items/task.0351.poly-trading-wallet-withdrawal.md,
 *        work/items/task.0352.poly-trading-wallet-fund-flow.md
 * @public
 */

"use client";

import type {
  PolyWalletBalancesOutput,
  PolyWalletStatusOutput,
} from "@cogni/node-contracts";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import type { ReactElement } from "react";
import { AddressChip, Card, HintText } from "@/components";

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

export function TradingWalletPanel(): ReactElement {
  const statusQuery = useQuery({
    queryKey: ["poly-wallet-status"],
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
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">
            Create a wallet in Profile to deposit.
          </p>
          <a
            href="/profile"
            className="w-fit rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm hover:bg-primary/90"
          >
            Profile
          </a>
        </div>
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
            Deposit USDC.e + POL on Polygon from any wallet; one-click flows
            next.
          </p>
        </div>
      )}
    </Card>
  );
}
