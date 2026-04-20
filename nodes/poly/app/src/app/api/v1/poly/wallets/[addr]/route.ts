// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallets/[addr]/route`
 * Purpose: HTTP GET — wallet analysis for any 0x Polymarket wallet, slice-scoped via `?include=`.
 * Scope: Thin handler. Auth via getSessionUser, Zod validation via the wallet-analysis v1 contract, then dispatch to per-slice service helpers. Returns Zod-validated response shape; partial slice failures surface in `warnings`, not in HTTP status.
 * Invariants: Any 0x address → 200 (slice availability decides what's populated). 401 when unauthenticated. Address normalized to lowercase by the contract before any handler logic runs.
 * Side-effects: IO (Polymarket Data API + CLOB public via the service layer).
 * Notes: Cache + concurrency + reuse-mandate live in the service module.
 * Links: docs/design/wallet-analysis-components.md, packages/node-contracts/src/poly.wallet-analysis.v1.contract.ts
 * @public
 */

import {
  PolyAddressSchema,
  WalletAnalysisQuerySchema,
  type WalletAnalysisResponse,
  WalletAnalysisResponseSchema,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { fetchOperatorExtras } from "@/app/_lib/poly/operator-extras";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getBalanceSlice,
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
  async (_ctx, request, _sessionUser, context) => {
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
    });
    if (!queryParse.success) {
      return NextResponse.json(
        { error: "invalid_query", message: queryParse.error.message },
        { status: 400 }
      );
    }
    const include = queryParse.data.include;

    const wantSnapshot = include.includes("snapshot");
    const wantTrades = include.includes("trades");
    const wantBalance = include.includes("balance");

    const [snapshotR, tradesR, balanceR] = await Promise.all([
      wantSnapshot ? getSnapshotSlice(addr) : null,
      wantTrades ? getTradesSlice(addr) : null,
      wantBalance ? getBalanceSlice(addr, fetchOperatorExtras) : null,
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

    return NextResponse.json(WalletAnalysisResponseSchema.parse(response));
  }
);
