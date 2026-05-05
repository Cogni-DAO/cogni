// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallets/[addr]/route`
 * Purpose: HTTP GET — wallet analysis for any 0x Polymarket wallet, slice-scoped via `?include=` with optional `interval` for the P/L slice.
 * Scope: Thin handler. Auth via getSessionUser, Zod validation via the wallet-analysis v1 contract, then dispatch to per-slice service helpers. Returns Zod-validated response shape; partial slice failures surface in `warnings`, not in HTTP status.
 * Invariants: Any 0x address → 200 (slice availability decides what's populated). 401 when unauthenticated. Address normalized to lowercase by the contract before any handler logic runs.
 * Side-effects: IO (Polymarket Data API + CLOB public + public user-pnl via the service layer).
 * Notes: Cache + concurrency + reuse-mandate live in the service module.
 * Links: docs/design/wallet-analysis-components.md, nodes/poly/packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  PolyAddressSchema,
  WalletAnalysisQuerySchema,
  type WalletAnalysisResponse,
  WalletAnalysisResponseSchema,
} from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveServiceDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import { getBenchmarkSlice } from "@/features/wallet-analysis/server/copy-target-benchmark-service";
import {
  getBalanceSlice,
  getDistributionsSlice,
  getPnlSlice,
  getSnapshotSlice,
  getTradesSlice,
} from "@/features/wallet-analysis/server/wallet-analysis-service";

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging<{
  params: Promise<{ addr: string }>;
}>(
  {
    routeId: "poly.wallet-analysis",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser, context) => {
    if (!sessionUser) throw new Error("sessionUser required");
    if (!context) {
      return NextResponse.json({ error: "missing_params" }, { status: 500 });
    }
    const { addr: rawAddr } = await context.params;
    const addrParse = PolyAddressSchema.safeParse(rawAddr);
    if (!addrParse.success) {
      return NextResponse.json(
        { error: "invalid_address", message: addrParse.error.message },
        { status: 400 }
      );
    }
    const addr = addrParse.data;

    const url = new URL(request.url);
    const queryParse = WalletAnalysisQuerySchema.safeParse({
      include: url.searchParams.getAll("include"),
      interval: url.searchParams.get("interval") ?? undefined,
      distributionMode: url.searchParams.get("distributionMode") ?? undefined,
    });
    if (!queryParse.success) {
      return NextResponse.json(
        { error: "invalid_query", message: queryParse.error.message },
        { status: 400 }
      );
    }
    const include = queryParse.data.include;
    const interval = queryParse.data.interval;
    const distributionMode = queryParse.data.distributionMode;

    const wantSnapshot = include.includes("snapshot");
    const wantTrades = include.includes("trades");
    const wantBalance = include.includes("balance");
    const wantPnl = include.includes("pnl");
    const wantDistributions = include.includes("distributions");
    const wantBenchmark = include.includes("benchmark");
    const serviceDb =
      wantBenchmark ||
      wantPnl ||
      wantTrades ||
      wantBalance ||
      wantSnapshot ||
      wantDistributions
        ? (resolveServiceDb() as unknown as import("drizzle-orm/node-postgres").NodePgDatabase<
            Record<string, unknown>
          >)
        : null;
    const comparisonWalletAddress = wantBenchmark
      ? await readComparisonWalletAddress(sessionUser.id, ctx.log)
      : null;

    const [snapshotR, tradesR, balanceR, pnlR, distributionsR, benchmarkR] =
      await Promise.all([
        wantSnapshot && serviceDb ? getSnapshotSlice(serviceDb, addr) : null,
        wantTrades && serviceDb ? getTradesSlice(serviceDb, addr) : null,
        wantBalance && serviceDb ? getBalanceSlice(serviceDb, addr) : null,
        wantPnl && serviceDb ? getPnlSlice(serviceDb, addr, interval) : null,
        wantDistributions && serviceDb
          ? getDistributionsSlice(serviceDb, addr, distributionMode)
          : null,
        wantBenchmark && serviceDb
          ? getBenchmarkSlice(serviceDb, addr, interval, {
              comparisonWalletAddress,
            })
          : null,
      ]);

    const response: WalletAnalysisResponse = {
      address: addr,
      warnings: [],
    };
    if (snapshotR) {
      if (snapshotR.kind === "ok") response.snapshot = snapshotR.value;
      else response.warnings.push(snapshotR.warning);
    }
    if (tradesR) {
      if (tradesR.kind === "ok") response.trades = tradesR.value;
      else response.warnings.push(tradesR.warning);
    }
    if (balanceR) {
      if (balanceR.kind === "ok") response.balance = balanceR.value;
      else response.warnings.push(balanceR.warning);
    }
    if (pnlR) {
      if (pnlR.kind === "ok") response.pnl = pnlR.value;
      else response.warnings.push(pnlR.warning);
    }
    if (distributionsR) {
      if (distributionsR.kind === "ok")
        response.distributions = distributionsR.value;
      else response.warnings.push(distributionsR.warning);
    }
    if (benchmarkR) {
      if (benchmarkR.kind === "ok") response.benchmark = benchmarkR.value;
      else response.warnings.push(benchmarkR.warning);
    }

    return NextResponse.json(WalletAnalysisResponseSchema.parse(response));
  }
);

async function readComparisonWalletAddress(
  userId: string,
  log: Parameters<typeof getPolyTraderWalletAdapter>[0]
): Promise<string | null> {
  const container = getContainer();
  const account = await container
    .accountsForUser(toUserId(userId))
    .getOrCreateBillingAccountForUser({ userId });
  try {
    const adapter = getPolyTraderWalletAdapter(log);
    const summary = await adapter.getConnectionSummary(account.id);
    return summary?.funderAddress.toLowerCase() ?? null;
  } catch (err) {
    if (err instanceof WalletAdapterUnconfiguredError) return null;
    throw err;
  }
}
