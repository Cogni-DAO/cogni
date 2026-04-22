// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/credits/TradingWalletPanel`
 * Purpose: Money page panel for the user's Polymarket trading wallet —
 *   shows the funder address (with copy + Polygonscan link), USDC.e + POL
 *   balances, and stub Fund / Withdraw buttons linked to the backlog tasks
 *   that will wire them up end-to-end.
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
import { AddressChip, Card, HintText, SectionCard } from "@/components";

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
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Trading Wallet
          </span>
          {status?.funder_address ? (
            <AddressChip address={status.funder_address} />
          ) : null}
        </div>

        {statusQuery.isLoading ? (
          <div className="h-14 animate-pulse rounded bg-muted" />
        ) : !status?.configured ? (
          <p className="text-muted-foreground text-sm">
            Trading wallets aren't configured on this deployment yet.
          </p>
        ) : !connected ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">
              No trading wallet yet. Create one from your Profile to start
              funding.
            </p>
            <a
              href="/profile"
              className="w-fit rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm hover:bg-primary/90"
            >
              Go to Profile
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md bg-muted/40 p-3">
                <div className="text-muted-foreground text-xs uppercase tracking-wider">
                  USDC.e
                </div>
                <div className="font-bold text-2xl">
                  {formatDecimal(balances?.usdc_e ?? null, 2)}
                </div>
              </div>
              <div className="rounded-md bg-muted/40 p-3">
                <div className="text-muted-foreground text-xs uppercase tracking-wider">
                  POL (gas)
                </div>
                <div className="font-bold text-2xl">
                  {formatDecimal(balances?.pol ?? null, 4)}
                </div>
              </div>
            </div>
            {balances && balances.errors.length > 0 ? (
              <HintText icon={<Info size={16} />}>
                Partial read — some balances failed to fetch and will retry.
              </HintText>
            ) : null}
          </div>
        )}
      </Card>

      <SectionCard title="Fund & Withdraw">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled
            title="Coming soon — task.0352 wires one-click funding from your connected wallet"
            className="w-full cursor-not-allowed rounded-md bg-muted px-4 py-2 text-muted-foreground"
          >
            Fund trading wallet (coming soon)
          </button>
          <button
            type="button"
            disabled
            title="Coming soon — task.0351 wires withdrawal to an external Polygon address"
            className="w-full cursor-not-allowed rounded-md bg-muted px-4 py-2 text-muted-foreground"
          >
            Withdraw USDC.e (coming soon)
          </button>
        </div>

        <HintText icon={<Info size={16} />}>
          For now, copy your trading wallet address above and send USDC.e + a
          small amount of POL (for gas) on the Polygon network. One-click
          funding and withdrawal are landing in follow-up tasks.
        </HintText>
      </SectionCard>
    </div>
  );
}
