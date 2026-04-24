// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/top-wallets/route`
 * Purpose: Dashboard endpoint for the "Top Wallets" card — returns top Polymarket wallets by PnL for a window.
 * Scope: Validates query via Zod, delegates to WalletCapability. Does not implement business logic.
 * Invariants:
 *   - AUTH_REQUIRED: Internal dashboard endpoint; session user must be present.
 *   - CAPABILITY_NOT_ADAPTER: Route calls WalletCapability; never imports the Data API client directly.
 *   - READ_ONLY: Proxies a public read-only endpoint.
 *   - NO_SECRETS: Polymarket Data API is public — no credentials touched.
 * Side-effects: IO (HTTP via capability)
 * Links: [createWalletCapability](../../../../../../bootstrap/capabilities/wallet.ts), work/items/task.0315
 * @public
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createWalletCapability } from "@/bootstrap/capabilities/wallet";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getServerSessionUser } from "@/lib/auth/server";

// Route-local schema — mirrors WalletTimePeriodSchema / WalletOrderBySchema from
// @cogni/ai-tools. Declared inline because app uses zod 4 while ai-tools is
// built against zod 3, and cross-version `z.infer` loses the enum narrowing.
// Max is 200 to power the /research discovery grid (AI-tool surface stays at 50).
const QuerySchema = z.object({
  timePeriod: z.enum(["DAY", "WEEK", "MONTH", "ALL"]).optional(),
  orderBy: z.enum(["PNL", "VOL"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const dynamic = "force-dynamic";
export const maxDuration = 10; // seconds — bounds the Polymarket Data API leaderboard fetch

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.top-wallets",
    auth: { mode: "required", getSessionUser: getServerSessionUser },
  },
  async (_ctx, request) => {
    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      timePeriod: searchParams.get("timePeriod") || undefined,
      orderBy: searchParams.get("orderBy") || undefined,
      limit: searchParams.get("limit") || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const walletCapability = createWalletCapability();
    const result = await walletCapability.listTopTraders({
      timePeriod: parsed.data.timePeriod ?? "WEEK",
      orderBy: parsed.data.orderBy ?? "PNL",
      limit: parsed.data.limit ?? 10,
    });

    return NextResponse.json(result);
  }
);
