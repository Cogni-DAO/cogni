// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/research/target-overlap`
 * Purpose: HTTP GET — RN1/swisstony shared-vs-solo active-market overlap.
 * Scope: Thin route. Validates query/output with the poly research overlap
 * contract and delegates aggregation to the wallet-analysis feature service.
 * Invariants:
 *   - AUTH_REQUIRED: research surface is protected.
 *   - SAVED_FACTS_ONLY: reads Postgres observed trader facts; no live upstream
 *     Polymarket calls on page load.
 * Side-effects: DB reads only.
 * Links: docs/design/poly-copy-target-performance-benchmark.md, work/items/task.5005
 * @public
 */

import {
  PolyResearchTargetOverlapQuerySchema,
  PolyResearchTargetOverlapResponseSchema,
} from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { resolveServiceDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getTargetOverlapSlice } from "@/features/wallet-analysis/server/target-overlap-service";

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.research.target-overlap",
    auth: { mode: "required", getSessionUser },
  },
  async (_ctx, request) => {
    const url = new URL(request.url);
    const parsed = PolyResearchTargetOverlapQuerySchema.safeParse({
      interval: url.searchParams.get("interval") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_query", message: parsed.error.message },
        { status: 400 }
      );
    }
    const db =
      resolveServiceDb() as unknown as import("drizzle-orm/node-postgres").NodePgDatabase<
        Record<string, unknown>
      >;
    const overlap = await getTargetOverlapSlice(db, parsed.data.interval);
    return NextResponse.json(
      PolyResearchTargetOverlapResponseSchema.parse(overlap)
    );
  }
);
