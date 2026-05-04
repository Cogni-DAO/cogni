// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/research/trader-comparison/route`
 * Purpose: HTTP GET for the research trader-comparison board.
 * Scope: Thin handler. Auth via getSessionUser, Zod query validation, service DB aggregation, response validation.
 * Invariants: Caps comparisons to three wallets through the contract; partial P/L failures return warnings with a 200.
 * Side-effects: DB reads and public Polymarket P/L reads via the feature service.
 * Links: nodes/poly/packages/node-contracts/src/poly.research-trader-comparison.v1.contract.ts
 * @public
 */

import {
  PolyResearchTraderComparisonQuerySchema,
  PolyResearchTraderComparisonResponseSchema,
} from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { resolveServiceDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getTraderComparison } from "@/features/wallet-analysis/server/trader-comparison-service";

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.research-trader-comparison",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");
    const url = new URL(request.url);
    const queryParse = PolyResearchTraderComparisonQuerySchema.safeParse({
      wallet: url.searchParams.getAll("wallet"),
      label: url.searchParams.getAll("label"),
      interval: url.searchParams.get("interval") ?? undefined,
    });
    if (!queryParse.success) {
      return NextResponse.json(
        { error: "invalid_query", message: queryParse.error.message },
        { status: 400 }
      );
    }

    const db =
      resolveServiceDb() as unknown as import("drizzle-orm/node-postgres").NodePgDatabase<
        Record<string, unknown>
      >;
    const response = await getTraderComparison(
      db,
      queryParse.data.wallet.map((address, index) => ({
        address,
        label: queryParse.data.label[index],
      })),
      queryParse.data.interval
    );

    return NextResponse.json(
      PolyResearchTraderComparisonResponseSchema.parse(response)
    );
  }
);
