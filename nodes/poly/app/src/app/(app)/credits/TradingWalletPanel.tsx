// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/credits/TradingWalletPanel`
 * Purpose: Money page panel hosting the whole trading-wallet lifecycle —
 *   create (inline `TradingWalletConnectFlow` when `configured && !connected`),
 *   fund (deposit hero + condensed balance line + Polygon bridge), enable
 *   trading (`TradingReadinessSection`, task.0355), and — once ready — the
 *   "Trading enabled" checkpoint + next-step nudge onto /research.
 * Scope: Client component. React Query fetches `/wallet/status` + `/wallet/balances`;
 *   reads the session via `next-auth/react` only to surface `userId` to the
 *   inline connect flow. On `onConnected`, invalidates `poly-wallet-status`
 *   so the panel flips from "create" to "balances" without a reload.
 * Invariants:
 *   - ENABLE_TRADING_VISIBLE: when connected AND `trading_ready=false`, the
 *     readiness section is the primary CTA below the deposit hero. Without
 *     it the user cannot reach the CLOB — APPROVALS_BEFORE_PLACE blocks
 *     `authorizeIntent`. Losing this CTA bricks every trade.
 *   - DEPOSIT_IS_HERO (task.0365): when connected AND `trading_ready=false`,
 *     the funder address is the single most prominent element — new users'
 *     blocker is "where do I send money?", not "which button is primary?".
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
 *        work/items/task.0365.poly-onboarding-ux-polish-v0-1.md
 * @public
 */

"use client";

import type {
  PolyWalletBalancesOutput,
  PolyWalletStatusOutput,
} from "@cogni/node-contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, Info, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import type { ReactElement } from "react";
import { Card, CopyAddressButton, HintText } from "@/components";
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

/**
 * Minimum POL the panel treats as "gas OK" in the condensed balance line.
 * Matches `MIN_POL_FOR_ENABLE` in TradingReadinessSection — one source of
 * truth for the user's mental model of "enough gas to enable trading".
 */
const GAS_OK_MIN_POL = 0.02;

function formatDecimal(n: number | null, fractionDigits: number): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

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
    <Card className="flex flex-col gap-5 p-5 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2 border-border/60 border-b pb-3">
        <span className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.22em]">
          Trading wallet
        </span>
        <StatusBadge status={status} />
      </header>

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
        <ConnectedBody
          funderAddress={status.funder_address}
          tradingReady={status.trading_ready}
          balances={balances}
        />
      )}
    </Card>
  );
}

function StatusBadge({
  status,
}: {
  status: PolyWalletStatusOutput | undefined;
}): ReactElement | null {
  if (!status?.configured) return null;
  if (!status.connected) {
    return (
      <span className="rounded-full border border-border px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
        Not created
      </span>
    );
  }
  if (!status.trading_ready) {
    return (
      <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] text-primary uppercase tracking-wider">
        Setup in progress
      </span>
    );
  }
  return (
    <span className="rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 font-mono text-[10px] text-success uppercase tracking-wider">
      Live
    </span>
  );
}

interface ConnectedBodyProps {
  readonly funderAddress: string | null;
  readonly tradingReady: boolean;
  readonly balances: PolyWalletBalancesOutput | undefined;
}

function ConnectedBody({
  funderAddress,
  tradingReady,
  balances,
}: ConnectedBodyProps): ReactElement {
  return (
    <div className="flex flex-col gap-5">
      {!tradingReady && funderAddress ? (
        <DepositHero address={funderAddress} />
      ) : null}

      <BalanceLine balances={balances} />

      <TradingReadinessSection
        tradingReady={tradingReady}
        polBalance={balances?.pol ?? null}
        usdcBalance={balances?.usdc_e ?? null}
      />

      {tradingReady ? (
        <Link
          href="/research"
          className="group inline-flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-4 py-3 font-medium text-primary text-sm transition-colors hover:bg-primary/15"
        >
          <span>Next — pick a wallet to copy on Research</span>
          <ArrowRight
            size={16}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      ) : (
        <NextStepNudge />
      )}

      {balances && balances.errors.length > 0 ? (
        <HintText icon={<Info size={16} />}>Partial read — retrying.</HintText>
      ) : null}
    </div>
  );
}

function DepositHero({ address }: { address: string }): ReactElement {
  return (
    <section
      aria-label="Deposit address"
      className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent p-4"
    >
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.22em]">
          Step — Deposit
        </span>
        <h3 className="font-semibold text-base leading-tight sm:text-lg">
          Send USDC.e on Polygon to this address
        </h3>
        <p className="text-muted-foreground text-xs leading-snug">
          Any amount works — ~$2 is enough for your first copy-trade. You also
          need a tiny bit of POL for gas; we suggest ~0.2 POL.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border/80 bg-background/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            Your trading-wallet address
          </span>
          <a
            href={`https://polygonscan.com/address/${address}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground uppercase tracking-wider hover:text-foreground"
          >
            Polygonscan
            <ExternalLink size={10} />
          </a>
        </div>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 break-all font-mono text-[13px] text-foreground leading-snug sm:text-sm"
            data-testid="deposit-address"
          >
            {address}
          </code>
          <CopyAddressButton
            address={address}
            className="shrink-0 rounded-md border border-border/70 bg-background px-2 py-1 hover:border-foreground"
            label="Copy trading-wallet deposit address"
          />
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-warning text-xs leading-snug">
        <ShieldAlert size={14} className="mt-0.5 shrink-0" />
        <span>
          <span className="font-semibold">Polygon network only.</span> Sending
          USDC from Ethereum mainnet or any other chain will lose the funds.
          Need to bridge?{" "}
          <a
            href="https://portal.polygon.technology/bridge"
            target="_blank"
            rel="noreferrer noopener"
            className="underline decoration-warning/60 underline-offset-2 hover:decoration-warning"
          >
            Polygon Portal
          </a>
          .
        </span>
      </div>
    </section>
  );
}

function BalanceLine({
  balances,
}: {
  balances: PolyWalletBalancesOutput | undefined;
}): ReactElement {
  const usdc = balances?.usdc_e ?? null;
  const pol = balances?.pol ?? null;
  const gasOk = pol !== null && pol >= GAS_OK_MIN_POL;

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-sm tabular-nums">
      <span className="inline-flex items-baseline gap-1.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          USDC.e
        </span>
        <span
          className={
            usdc !== null && usdc > 0
              ? "font-semibold text-foreground"
              : "text-muted-foreground"
          }
        >
          {formatDecimal(usdc, 2)}
        </span>
      </span>
      <span aria-hidden className="text-muted-foreground/40">
        ·
      </span>
      <span className="inline-flex items-baseline gap-1.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          POL
        </span>
        <span className="text-foreground">{formatDecimal(pol, 4)}</span>
        {pol !== null ? (
          <span
            className={
              gasOk
                ? "text-[10px] text-success uppercase tracking-wider"
                : "text-[10px] text-warning uppercase tracking-wider"
            }
          >
            {gasOk ? "· gas ok" : "· low gas"}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function NextStepNudge(): ReactElement {
  return (
    <div className="rounded-md border border-border/80 border-dashed bg-muted/30 px-3 py-2 text-muted-foreground text-xs leading-snug">
      Once USDC.e lands and trading is enabled, you'll pick a wallet to mirror
      on <span className="font-medium text-foreground">/research</span>.
    </div>
  );
}
